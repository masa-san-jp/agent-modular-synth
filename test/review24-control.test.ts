// Issue #24 の独立レビューで見つかった、コマンド処理(src/control/)の不具合の再発防止の試験。
// 各試験は、修正前の実装では失敗する(レビューで再現した手順をそのまま試験にしてある)。
import assert from "node:assert/strict";
import { test } from "node:test";
import { EngineBackend } from "../src/control/backend.js";
import { buildCatalog } from "../src/control/catalog.js";
import { Controller } from "../src/control/controller.js";
import { MAX_REQUEST_DEPTH, MAX_UI_DEPTH, depthExceeds, tryStringify } from "../src/control/json.js";
import { MemoryPatchStore } from "../src/control/memory-store.js";
import { MAX_PATCH_BYTES, parsePatchText, serializePatchDocument, utf8ByteLength } from "../src/control/patch-doc.js";
import { RecordingBackend, Session } from "../src/control/session.js";
import type { ActorKind, CommandResponse, FailureResponse, Patch, SessionEvent, SuccessResponse } from "../src/control/types.js";
import { REGISTRY } from "../src/modules/registry.js";

const CATALOG = buildCatalog(REGISTRY);
type Args = Record<string, unknown>;
let n = 0;
const reqOf = (command: string, args?: Args, extra: Args = {}) => ({ v: 1, request_id: `q-${++n}`, command, ...(args ? { args } : {}), ...extra });

function sessionRig(backend: RecordingBackend | EngineBackend = new RecordingBackend({ audioState: "running" }), limits: Args = {}) {
  const s = new Session({ catalog: CATALOG, backend, sessionId: "s-r24", limits });
  const events: SessionEvent[] = [];
  s.subscribe((e) => events.push(e));
  const send = (actor: ActorKind, command: string, args?: Args, extra: Args = {}): CommandResponse => s.handle(reqOf(command, args, extra), actor);
  const ok = (actor: ActorKind, command: string, args?: Args, extra: Args = {}): SuccessResponse => {
    const r = send(actor, command, args, extra);
    assert.equal(r.ok, true, `${command}: ${JSON.stringify(r)}`);
    return r as SuccessResponse;
  };
  const fail = (actor: ActorKind, command: string, args?: Args, extra: Args = {}): FailureResponse => {
    const r = send(actor, command, args, extra);
    assert.equal(r.ok, false, `${command} は失敗するはず`);
    return r as FailureResponse;
  };
  return { s, events, send, ok, fail };
}

/** エンジンが今持っているケーブル("from.module.port>to.module.port" の昇順)。 */
function engineCables(be: EngineBackend): string[] {
  be.flush();
  const snap = (be as unknown as { engine: { snapshot(): { cables: { from: [string, string]; to: [string, string] }[] } } }).engine.snapshot();
  return snap.cables.map((c) => `${c.from.join(".")}>${c.to.join(".")}`).sort();
}
const patchCables = (p: Patch): string[] => p.cables.map((c) => `${c.from.module}.${c.from.port}>${c.to.module}.${c.to.port}`).sort();

// ---- 緊急停止と保存先 ----

test("緊急停止は、保存先の読み書きを待っている間も、待たずに実行される(応答しない保存先でも止められる)", async () => {
  const be = new RecordingBackend({ audioState: "running" });
  const s = new Session({ catalog: CATALOG, backend: be, sessionId: "s" });
  const store = new MemoryPatchStore();
  let release: () => void = () => undefined;
  store.before = () => new Promise<void>((r) => (release = r)); // 保存先が答えない
  const c = new Controller({ session: s, store, now: () => 0, storeTimeoutMs: 0 });
  const saving = c.handle(reqOf("patch.save", { name: "a" }), "human");
  const listing = c.handle(reqOf("patch.list"), "agent");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(c.pending, 2, "保存と一覧は待ち行列にいる");
  const panic = await c.handle(reqOf("engine.panic"), "agent");
  assert.equal(panic.ok, true);
  assert.equal(be.status().panic, true, "保存先を待たずに緊急停止した");
  assert.equal(c.pending, 2, "待っている要求はそのまま");
  // 保存先が答えれば、待っていた要求は元の順に終わる
  store.before = null;
  release();
  assert.equal((await saving).ok, true);
  assert.equal((await listing).ok, true);
});

test("保存先が時間内に答えなければ ERR-207 で打ち切り、後ろの要求は処理される", async () => {
  const s = new Session({ catalog: CATALOG, backend: new RecordingBackend({ audioState: "running" }), sessionId: "s" });
  const store = new MemoryPatchStore();
  store.before = (op) => (op === "list" ? new Promise<void>(() => undefined) : undefined); // list だけ永久に答えない
  const c = new Controller({ session: s, store, now: () => 0, storeTimeoutMs: 30 });
  const t0 = Date.now();
  const list = c.handle(reqOf("patch.list"), "agent");
  const get = c.handle(reqOf("patch.get"), "agent");
  const r = (await list) as FailureResponse;
  assert.equal(r.ok, false);
  assert.equal(r.error.id, "ERR-207");
  assert.equal((await get).ok, true);
  assert.ok(Date.now() - t0 < 2000);
});

// ---- ui と保存文書の大きさ ----

test("上限いっぱいのパッチ(256 モジュール・1024 ケーブル・各 ui 約 1024 バイト)の保存文書は 1 MiB に収まり、読み戻すと同じ内容", () => {
  const filler = (bytes: number): Record<string, unknown> => {
    // 数値の配列: 字下げすると要素ごとに行が増え、最も膨らむ形
    const ui: Record<string, unknown> = { x: 1, y: 2, a: [] as number[] };
    while (utf8ByteLength(JSON.stringify(ui)) <= bytes - 2) (ui.a as number[]).push(0);
    return ui;
  };
  const ui = filler(1024);
  assert.ok(utf8ByteLength(JSON.stringify(ui)) <= 1024);
  const modules: Patch["modules"] = [{ id: "out", type: "MOD-IO-001", spec_version: "0.2", params: { level: 1, mute: 0 }, ui }];
  for (let i = 1; i < 256; i++) {
    modules.push({ id: `mix_${i}`, type: "MOD-MIX-001", spec_version: CATALOG.get("MOD-MIX-001")!.specVersion, params: {}, ui });
  }
  const mix = CATALOG.get("MOD-MIX-001")!;
  const ins = mix.inputs.filter((p) => p.connectable).map((p) => p.name);
  const cables: Patch["cables"] = [];
  outer: for (let i = 1; i < 256; i++) {
    for (const port of ins) {
      if (cables.length >= 1024) break outer;
      const from = i === 255 ? 1 : i + 1;
      cables.push({ id: `c${cables.length + 1}`, from: { module: `mix_${from}`, port: mix.outputs[0]!.name }, to: { module: `mix_${i}`, port } });
    }
  }
  const text0 = JSON.stringify({ format: "modular-synth-patch", schema_version: 1, meta: { title: "t", description: "" }, modules, cables });
  const loaded = parsePatchText(text0, CATALOG);
  assert.equal(loaded.ok, true, JSON.stringify(loaded).slice(0, 300));
  if (!loaded.ok) return;
  assert.equal(loaded.patch.modules.length, 256);
  assert.ok(loaded.patch.cables.length >= 512, `ケーブル ${loaded.patch.cables.length} 本`);
  const text = serializePatchDocument(loaded.patch);
  const bytes = utf8ByteLength(text);
  assert.ok(bytes <= MAX_PATCH_BYTES, `保存文書 ${bytes} バイト`);
  const again = parsePatchText(text, CATALOG);
  assert.equal(again.ok, true);
  if (again.ok) assert.deepEqual(again.patch, loaded.patch);
  // ui は1行、それ以外は2文字の字下げ(DAT-32)
  assert.ok(text.includes(`\n      "ui": ${JSON.stringify(ui)}\n`));
  assert.ok(text.startsWith('{\n  "format": "modular-synth-patch",\n  "schema_version": 1,\n  "meta": {\n    "title": "t",'));
  assert.ok(text.endsWith("\n}\n"));
});

test("ui のないパッチの保存文書は、従来どおり全体を2文字で字下げした JSON と同じ文字列", () => {
  const { s, ok } = sessionRig();
  ok("agent", "module.add", { id: "a", type: "MOD-OSC-001" });
  ok("agent", "cable.connect", { from: { module: "a", port: "sine" }, to: { module: "out", port: "IN_L" } });
  const p = s.getPatch();
  assert.equal(serializePatchDocument(p), JSON.stringify(JSON.parse(serializePatchDocument(p)), null, 2) + "\n");
  // 空のパッチ(ケーブルなし)も同じ
  const empty = sessionRig().s.getPatch();
  assert.equal(serializePatchDocument(empty), JSON.stringify(JSON.parse(serializePatchDocument(empty)), null, 2) + "\n");
});

test(`ui の入れ子は ${MAX_UI_DEPTH} 段まで: コマンドは ERR-003(too_deep)、パッチ文書は ERR-204(DAT-V18)。字下げで保存文書が膨らむ形を作れない`, () => {
  const nest = (depth: number): unknown => {
    let v: unknown = 0;
    for (let i = 1; i < depth; i++) v = [v];
    return { x: 0, y: 0, k: v }; // ui 自身が1段目
  };
  const { ok, fail, s } = sessionRig();
  ok("agent", "module.add", { id: "a", type: "MOD-OSC-001", ui: nest(MAX_UI_DEPTH) });
  const rev = s.revision;
  const e = fail("agent", "module.add", { id: "b", type: "MOD-OSC-001", ui: nest(MAX_UI_DEPTH + 1) });
  assert.equal(e.error.id, "ERR-003");
  assert.equal(e.error.details.reason, "too_deep");
  assert.equal(fail("agent", "module.move", { module_id: "a", ui: nest(MAX_UI_DEPTH + 1) }).error.id, "ERR-003");
  assert.equal(s.revision, rev);
  const doc = s.getPatch();
  doc.modules[1]!.ui = nest(MAX_UI_DEPTH + 1) as Record<string, unknown>;
  const r = parsePatchText(JSON.stringify(doc), CATALOG);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error.id, "ERR-204");
    assert.equal((r.error.details.issues as { rule: string }[])[0]!.rule, "DAT-V18");
  }
});

test("深い入れ子の補助: depthExceeds は 20 万段でもスタックを使い切らず、tryStringify は例外を投げない", () => {
  let deep: unknown = 0;
  for (let i = 0; i < 200000; i++) deep = [deep];
  assert.equal(depthExceeds(deep, MAX_REQUEST_DEPTH), true);
  assert.equal(tryStringify(deep), null);
  assert.equal(depthExceeds({ a: [1, { b: 2 }] }, 3), false);
  assert.equal(depthExceeds({ a: [1, { b: 2 }] }, 2), true);
  assert.equal(depthExceeds("x", 0), false);
  const cyc: Record<string, unknown> = {};
  cyc.self = cyc;
  assert.equal(tryStringify(cyc), null);
});

test("深い入れ子の要求は ERR-001(too_deep)。状態は変わらない", () => {
  const { s, send } = sessionRig();
  let deep: unknown = 0;
  for (let i = 0; i < 20000; i++) deep = { a: deep };
  const r = s.handle({ v: 1, request_id: "d1", command: "patch.load", args: { patch: deep } }, "agent") as FailureResponse;
  assert.equal(r.ok, false);
  assert.equal(r.error.id, "ERR-001");
  assert.equal(r.error.details.reason, "too_deep");
  assert.equal(s.revision, 0);
  assert.equal(send("agent", "patch.get").ok, true);
});

// ---- 音声の開始の失敗 ----

test("engine.start が ERR-304 で失敗しても、マスター音量・上限は変わらず、通知も出ない(§5: エラーで状態は変わらない)", () => {
  const be = new RecordingBackend({ audioState: "stopped" });
  const { ok, fail, events } = sessionRig(be);
  ok("human", "output.set_level", { level_db: -6 });
  be.startFailure = "device";
  events.length = 0;
  be.calls.length = 0;
  const e = fail("human", "engine.start");
  assert.equal(e.error.id, "ERR-304");
  assert.equal(be.status().levelDb, -6, "音量は下がらない");
  assert.equal(be.status().agentMaxLevelDb, -6);
  assert.deepEqual(events, []);
  assert.deepEqual(be.calls, [], "音声側には何も渡していない");
  // 開始できるようになれば、開始時に引き下げる
  be.startFailure = null;
  ok("human", "engine.start");
  assert.equal(be.status().levelDb, -20);
});

// ---- 履歴 ----

test("連続操作のまとめは、他の操作者の変更とその取り消しをまたがない(§9.4)", () => {
  const { s, ok } = sessionRig();
  ok("human", "module.add", { id: "u", type: "MOD-UTL-001", params: { gain: 0 } });
  ok("agent", "module.add", { id: "v", type: "MOD-UTL-001" });
  const set = (v: number) => ok("human", "param.set", { module_id: "u", param: "gain", value: v, coalesce_key: "d1" });
  set(0.1);
  set(0.2);
  set(0.3);
  ok("agent", "param.set", { module_id: "v", param: "gain", value: 0.5 });
  ok("agent", "history.undo"); // エージェントの変更を取り消す
  set(0.6); // 同じ鍵だが、間に他の変更とその取り消しが入っている
  const gain = () => s.getPatch().modules.find((m) => m.id === "u")!.params.gain;
  ok("human", "history.undo");
  assert.equal(gain(), 0.3, "0.6 の1回分だけが戻る");
  ok("human", "history.undo");
  assert.equal(gain(), 0, "最初の3回のまとめが戻る");
});

test("同じIDで種別を替える batch を取り消しても、音声側のケーブルは正本と一致し、続く切断で例外が出ない", () => {
  const be = new EngineBackend(48000, REGISTRY);
  const { s, ok, events } = sessionRig(be);
  ok("human", "engine.start");
  ok("agent", "module.add", { id: "x", type: "MOD-OSC-001" });
  ok("agent", "cable.connect", { id: "c1", from: { module: "x", port: "sine" }, to: { module: "out", port: "IN_L" } });
  ok("agent", "batch", {
    ops: [
      { command: "module.remove", args: { module_id: "x" } },
      { command: "module.add", args: { id: "x", type: "MOD-LFO-001" } },
      { command: "cable.connect", args: { id: "c1", from: { module: "x", port: "sine" }, to: { module: "out", port: "IN_L" } } },
    ],
  });
  assert.deepEqual(engineCables(be), patchCables(s.getPatch()));
  events.length = 0;
  ok("human", "history.undo");
  assert.equal(s.getPatch().modules.find((m) => m.id === "x")!.type, "MOD-OSC-001");
  assert.deepEqual(engineCables(be), patchCables(s.getPatch()), "取り消しの後もケーブルがある");
  assert.equal(be.takeDesync(), null);
  // 通知にも、ケーブルの付け直しが載る
  const kinds = (events.find((e) => e.event === "patch.changed")!.data as { changes: { kind: string }[] }).changes.map((c) => c.kind);
  assert.deepEqual(kinds, ["cable_removed", "module_removed", "module_added", "cable_added"]);
  ok("human", "history.redo");
  assert.deepEqual(engineCables(be), patchCables(s.getPatch()));
  ok("agent", "cable.disconnect", { cable_id: "c1" });
  const L = new Float32Array(128);
  assert.doesNotThrow(() => be.processBlock(L, new Float32Array(128)));
  assert.equal(be.takeDesync(), null);
  assert.deepEqual(engineCables(be), []);
});

test("音声側が差分の適用に失敗しても音声の処理は止まらず、ずれとして報告され、全体の渡し直しで正本と一致する", () => {
  const be = new EngineBackend(48000, REGISTRY);
  const { s, ok } = sessionRig(be);
  ok("human", "engine.start");
  ok("agent", "module.add", { id: "a", type: "MOD-OSC-001" });
  // 正本にないケーブルの切断を直接渡す(音声側だけがずれた状況)
  be.disconnect({ id: "zz", from: { module: "a", port: "sine" }, to: { module: "out", port: "IN_L" } });
  ok("agent", "cable.connect", { from: { module: "a", port: "sine" }, to: { module: "out", port: "IN_R" } });
  const L = new Float32Array(128);
  assert.doesNotThrow(() => be.processBlock(L, new Float32Array(128)));
  assert.notEqual(be.takeDesync(), null, "失敗が報告される");
  assert.deepEqual(engineCables(be), patchCables(s.getPatch()), "失敗した1件の後ろの差分は適用されている");
  s.resyncBackend();
  assert.equal(be.takeDesync(), null);
  assert.deepEqual(engineCables(be), patchCables(s.getPatch()));
});

test("ランダムな操作列(種別を替える batch、取り消し・やり直しを含む)で、音声側のモジュールとケーブルが常に正本と一致する", () => {
  let seed = 12345;
  const rnd = (k: number): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 8) % k;
  };
  const types = ["MOD-OSC-001", "MOD-LFO-001"]; // どちらも sine 出力を持つ
  for (let round = 0; round < 40; round++) {
    const be = new EngineBackend(48000, REGISTRY);
    const { s, send } = sessionRig(be);
    send("human", "engine.start");
    for (let step = 0; step < 60; step++) {
      const id = `m_${rnd(3)}`;
      const exists = s.getPatch().modules.some((m) => m.id === id);
      const port = ["IN_L", "IN_R"][rnd(2)]!;
      switch (rnd(7)) {
        case 0:
          send("agent", "module.add", { id, type: types[rnd(2)] });
          break;
        case 1:
          send("agent", "module.remove", { module_id: id });
          break;
        case 2:
          send("agent", "cable.connect", { id: `k_${port.toLowerCase()}`, from: { module: id, port: "sine" }, to: { module: "out", port } });
          break;
        case 3:
          send("agent", "cable.disconnect", { cable_id: `k_${port.toLowerCase()}` });
          break;
        case 4:
          if (exists) {
            const mine = s.getPatch().cables.filter((c) => c.from.module === id);
            send("agent", "batch", {
              ops: [
                { command: "module.remove", args: { module_id: id } },
                { command: "module.add", args: { id, type: types[rnd(2)] } },
                ...mine.map((c) => ({ command: "cable.connect", args: { id: c.id, from: c.from, to: c.to } })),
              ],
            });
          }
          break;
        case 5:
          send("human", "history.undo");
          break;
        default:
          send("human", "history.redo");
      }
      const p = s.getPatch();
      assert.deepEqual(engineCables(be), patchCables(p), `round ${round} step ${step}`);
      const ids = (be as unknown as { engine: { ids(): string[] } }).engine.ids().sort();
      assert.deepEqual(ids, p.modules.map((m) => m.id).sort(), `round ${round} step ${step}`);
      assert.equal(be.takeDesync(), null, `round ${round} step ${step}`);
    }
  }
});

test("大きな番号のID(m9007199254740991)があっても、ID 省略の追加は固まらずに採番される", () => {
  const { s, ok } = sessionRig();
  ok("agent", "module.add", { id: "m9007199254740991", type: "MOD-UTL-001" });
  ok("agent", "module.add", { id: "m1234567890", type: "MOD-UTL-001" }); // 10桁も採番の対象外
  const a = ok("agent", "module.add", { type: "MOD-UTL-001" });
  const b = ok("agent", "module.add", { type: "MOD-UTL-001" });
  assert.equal((a.result.module as { id: string }).id, "m1");
  assert.equal((b.result.module as { id: string }).id, "m2");
  // そのパッチを読み込んだ後も同じ
  const r = sessionRig();
  const loaded = new Session({ catalog: CATALOG, backend: new RecordingBackend({ audioState: "running" }), sessionId: "s2", patch: s.getPatch() });
  const c = loaded.handle(reqOf("module.add", { type: "MOD-UTL-001" }), "agent") as SuccessResponse;
  assert.equal(c.ok, true);
  assert.equal((c.result.module as { id: string }).id, "m3");
  assert.equal(r.s.revision, 0);
});

// ---- 冪等キー ----

test("冪等キーは操作者の種別ごとに別: 人が使った鍵をエージェントが同じ内容で送っても、人の応答は返らず、自分の権限で判定される", () => {
  const be = new RecordingBackend({ audioState: "running" });
  const { ok, fail, send } = sessionRig(be);
  ok("human", "output.set_level", { level_db: -3 }, { idempotency_key: "k1" });
  ok("human", "output.set_level", { level_db: -30 }); // 上限も −30 になる
  const e = fail("agent", "output.set_level", { level_db: -3 }, { idempotency_key: "k1" });
  assert.equal(e.error.id, "ERR-302", "鍵なしのときと同じ判定");
  assert.equal(e.replayed, false);
  assert.equal(e.actor.kind, "agent");
  assert.equal(be.status().levelDb, -30);
  // 同じ操作者の再送は、従来どおり保存済みの応答
  const again = send("human", "output.set_level", { level_db: -3 }, { idempotency_key: "k1" }) as SuccessResponse;
  assert.equal(again.replayed, true);
  assert.equal(again.actor.kind, "human");
  assert.equal(be.status().levelDb, -30, "再送では状態は変わらない");
});

test("冪等キーで保存する応答と、置き換えの履歴は、合計の大きさに上限がある(古いものから捨てる。最新は残す)", () => {
  const { s, ok, send } = sessionRig(new RecordingBackend({ audioState: "running" }), { idempotencyChars: 5000, historyChars: 12000 });
  for (let round = 0; round < 8; round++) {
    for (let i = 0; i < 20; i++) ok("agent", "module.add", { type: "MOD-MIX-001" }, { idempotency_key: `a${round}-${i}` });
    ok("human", "patch.new", {}, { idempotency_key: `n${round}` }); // 置き換え: 履歴がパッチ全体(20 モジュール)を持つ
  }
  const inner = s as unknown as { keyed: Map<string, { chars: number }>; keyedChars: number; undoStack: { chars: number }[] };
  let sum = 0;
  for (const v of inner.keyed.values()) sum += v.chars;
  assert.equal(sum, inner.keyedChars);
  assert.ok(inner.keyedChars <= 5000, `保存した応答の合計 ${inner.keyedChars}`);
  assert.ok(inner.keyed.size >= 1 && inner.keyed.size < 168, `鍵 ${inner.keyed.size} 件`);
  // 最新の鍵は残っている(再送は保存済みの応答)
  assert.equal((send("human", "patch.new", {}, { idempotency_key: "n7" }) as SuccessResponse).replayed, true);
  const hist = inner.undoStack.reduce((a, e) => a + e.chars, 0);
  assert.ok(hist > 0 && hist <= 12000, `履歴の合計 ${hist}`);
  assert.ok(inner.undoStack.length >= 1 && inner.undoStack.length < 168);
  assert.equal(ok("human", "history.undo").ok, true, "残った履歴は取り消せる");
});

// ---- 上書きの権限 ----

test("エージェントは、読めないファイルを上書きできない(中に saved_by.kind: agent と書いてあっても ERR-005)。読めて agent のものだけ上書きできる", async () => {
  const s = new Session({ catalog: CATALOG, backend: new RecordingBackend({ audioState: "running" }), sessionId: "s" });
  const store = new MemoryPatchStore();
  const c = new Controller({ session: s, store, now: () => 0 });
  const save = (actor: ActorKind, name: string) => c.handle(reqOf("patch.save", { name, overwrite: true }), actor);
  store.put("stub", '{"meta":{"saved_by":{"kind":"agent"}}}'); // 文書として読めない
  const good = JSON.parse(serializePatchDocument(s.getPatch())) as Patch;
  // saved_by を重複キーで human → agent の順に書いた文書(厳密な解釈では拒否される)
  store.put("dup", JSON.stringify({ ...good, meta: { title: "", description: "" } }).replace('"meta":{', '"meta":{"saved_by":{"kind":"human"},"saved_by":{"kind":"agent"},'));
  for (const name of ["stub", "dup"]) {
    const before = store.get(name);
    const r = (await save("agent", name)) as FailureResponse;
    assert.equal(r.ok, false, name);
    assert.equal(r.error.id, "ERR-005", name);
    assert.equal(store.get(name), before, "ファイルは変わらない");
  }
  // 人は上書きできる。エージェントが保存したものは、エージェントが上書きできる
  assert.equal((await save("human", "stub")).ok, true);
  assert.equal(((await save("agent", "stub")) as FailureResponse).error.id, "ERR-005", "人が保存したものは上書きできない");
  assert.equal((await c.handle(reqOf("patch.save", { name: "mine" }), "agent")).ok, true);
  assert.equal((await save("agent", "mine")).ok, true);
});

test("patch.read: 入れ子が深すぎるファイルは ERR-204(応答を文字列にできない値を返さない)。patch.list では readable:false", async () => {
  const s = new Session({ catalog: CATALOG, backend: new RecordingBackend({ audioState: "running" }), sessionId: "s" });
  const store = new MemoryPatchStore();
  const c = new Controller({ session: s, store, now: () => 0 });
  store.put("deep", "[".repeat(20000) + "]".repeat(20000));
  const r = (await c.handle(reqOf("patch.read", { name: "deep" }), "agent")) as FailureResponse;
  assert.equal(r.ok, false);
  assert.equal(r.error.id, "ERR-204");
  assert.notEqual(tryStringify(r), null);
  const list = (await c.handle(reqOf("patch.list"), "agent")) as SuccessResponse;
  assert.deepEqual((list.result.patches as { name: string; readable: boolean }[]).map((p) => [p.name, p.readable]), [["deep", false]]);
});
