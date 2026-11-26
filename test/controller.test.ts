// 全コマンドの非同期の窓口(src/control/controller.ts)と、保存のコマンド(patch.save / load / list / read / delete)の試験。
// 受入例(operation-contract §18 の AX-01、AX-10c、AX-12)と無効な例(data-contract §12 の DX-nn)の期待値は契約の表のまま。
// 保存先はメモリ上の PatchStore(src/control/memory-store.ts)。音声側は RecordingBackend と EngineBackend の両方。
import assert from "node:assert/strict";
import { test } from "node:test";
import { EngineBackend } from "../src/control/backend.js";
import { buildCatalog } from "../src/control/catalog.js";
import { Controller, ControllerEvent } from "../src/control/controller.js";
import { ERRORS } from "../src/control/errors.js";
import { MemoryPatchStore } from "../src/control/memory-store.js";
import { MAX_PATCH_BYTES } from "../src/control/patch-doc.js";
import { RecordingBackend, Session } from "../src/control/session.js";
import { ActorKind, AudioState, CommandResponse, FailureResponse, Patch, SuccessResponse } from "../src/control/types.js";
import { REGISTRY } from "../src/modules/registry.js";

const CATALOG = buildCatalog(REGISTRY);

/** 基準パッチ P0 = data-contract §11 の完全な例。 */
const P0: Patch = {
  format: "modular-synth-patch",
  schema_version: 1,
  meta: {
    title: "基本の減算シンセ",
    description: "MIDI-CV → VCO(saw) → LPF → VCA → 出力。ADSRがVCAを開閉する。",
    created_at: "2026-11-13T09:00:00Z",
    modified_at: "2026-11-13T09:30:00Z",
    saved_by: { kind: "human" },
    app_version: "0.1.0",
  },
  modules: [
    { id: "out", type: "MOD-IO-001", spec_version: "0.2", params: { level: 1.0, mute: 0 }, ui: { x: 40, y: 0 } },
    { id: "midi1", type: "MOD-IO-002", spec_version: "0.2", params: { channel: 0, transpose: 0, voices: 1, cc_number: 1 }, ui: { x: 0, y: 0 } },
    { id: "vco1", type: "MOD-OSC-001", spec_version: "0.3", params: { range: 0, tune: 0.0, fm_amt: 0.0, pw: 0.5, pwm_amt: 0.0 }, ui: { x: 10, y: 0 } },
    { id: "vcf1", type: "MOD-FLT-001", spec_version: "0.2", params: { cutoff: 1.0, res: 0.3, cv2_level: 1.0, cv3_level: 1.0 }, ui: { x: 20, y: 0 } },
    {
      id: "vca1",
      type: "MOD-AMP-001",
      spec_version: "0.2",
      params: { gain: 0.0, in1_level: 1.0, in2_level: 1.0, cv2_level: 1.0, out_level: 1.0, response: 0 },
      ui: { x: 30, y: 0 },
    },
    { id: "env1", type: "MOD-ENV-001", spec_version: "0.2", params: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3 }, ui: { x: 20, y: 1 } },
  ],
  cables: [
    { id: "c1", from: { module: "midi1", port: "PITCH" }, to: { module: "vco1", port: "pitch" } },
    { id: "c2", from: { module: "vco1", port: "saw" }, to: { module: "vcf1", port: "in" } },
    { id: "c3", from: { module: "vcf1", port: "out" }, to: { module: "vca1", port: "in1" } },
    { id: "c4", from: { module: "midi1", port: "GATE" }, to: { module: "env1", port: "gate" } },
    { id: "c5", from: { module: "env1", port: "env" }, to: { module: "vca1", port: "cv1" } },
    { id: "c6", from: { module: "vca1", port: "out" }, to: { module: "out", port: "IN_L" } },
  ],
};

const T0 = "2026-11-19T12:00:00Z";
const T1 = "2026-11-19T12:05:00Z";

type Extra = Record<string, unknown>;

interface Rig {
  s: Session;
  be: RecordingBackend;
  store: MemoryPatchStore;
  c: Controller;
  events: ControllerEvent[];
  /** 保存時刻に使う時刻(書き換えられる)。 */
  clock: { now: string };
  send(actor: ActorKind, command: string, args?: Record<string, unknown>, extra?: Extra): Promise<CommandResponse>;
  ok(actor: ActorKind, command: string, args?: Record<string, unknown>, extra?: Extra): Promise<SuccessResponse>;
  fail(actor: ActorKind, command: string, args?: Record<string, unknown>, extra?: Extra): Promise<FailureResponse>;
  param(module: string, name: string): number;
  /** 保存先のファイルの中身(JSON として解釈したもの)。 */
  file(name: string): Patch;
}

let counter = 0;

function rig(opts: { audioState?: AudioState; patch?: Patch | null; revision?: number; maxPatchFiles?: number; maxBytes?: number } = {}): Rig {
  const be = new RecordingBackend({ audioState: opts.audioState ?? "running" });
  const patch = opts.patch === null ? undefined : (opts.patch ?? P0);
  const s = new Session({
    catalog: CATALOG,
    backend: be,
    sessionId: "s-test",
    ...(patch ? { patch } : {}),
    revision: opts.revision ?? (patch ? 10 : 0),
  });
  be.calls.length = 0;
  const clock = { now: T0 };
  const store = new MemoryPatchStore({ now: () => new Date(clock.now), ...(opts.maxBytes !== undefined ? { maxBytes: opts.maxBytes } : {}) });
  const c = new Controller({
    session: s,
    store,
    now: () => new Date(clock.now),
    ...(opts.maxPatchFiles !== undefined ? { maxPatchFiles: opts.maxPatchFiles } : {}),
  });
  const events: ControllerEvent[] = [];
  c.subscribe((ev) => events.push(ev));
  const send: Rig["send"] = (actor, command, args, extra) =>
    c.handle({ v: 1, request_id: `r-${++counter}`, command, ...(args ? { args } : {}), ...(extra ?? {}) }, actor);
  return {
    s,
    be,
    store,
    c,
    events,
    clock,
    send,
    async ok(actor, command, args, extra) {
      const r = await send(actor, command, args, extra);
      assert.equal(r.ok, true, `${command} は成功するはず: ${JSON.stringify(r)}`);
      return r as SuccessResponse;
    },
    async fail(actor, command, args, extra) {
      const r = await send(actor, command, args, extra);
      assert.equal(r.ok, false, `${command} は失敗するはず: ${JSON.stringify(r)}`);
      return r as FailureResponse;
    },
    param: (module, name) => s.getPatch().modules.find((m) => m.id === module)!.params[name]!,
    file: (name) => {
      const text = store.get(name);
      assert.notEqual(text, undefined, `ファイル ${name} があるはず`);
      return JSON.parse(text!) as Patch;
    },
  };
}

/** 失敗した要求が状態を一切変えないこと(パッチ・リビジョン・履歴・通知・音声側)を確かめる枠。 */
async function unchanged(r: Rig, fn: () => Promise<void>): Promise<void> {
  const patch = r.s.getPatch();
  const rev = r.s.revision;
  const history = r.s.history;
  const events = r.events.length;
  const calls = r.be.calls.length;
  const level = r.be.levelDb;
  await fn();
  assert.deepEqual(r.s.getPatch(), patch, "パッチは不変");
  assert.equal(r.s.revision, rev, "リビジョンは不変");
  assert.deepEqual(r.s.history, history, "履歴は不変");
  assert.equal(r.events.length, events, "通知なし");
  assert.equal(r.be.calls.length, calls, "音声側への呼出しなし");
  assert.equal(r.be.levelDb, level, "音量は不変");
}

function expectError(res: FailureResponse, id: keyof typeof ERRORS): void {
  assert.equal(res.error.id, id, JSON.stringify(res.error));
  assert.equal(res.error.code, ERRORS[id]);
}

/** DAT-04 の一致: モジュール・ケーブルをIDで対応づけ、type・spec_version・全パラメータ・ui、from・to、題名・説明を比べる。 */
function assertSamePatch(a: Patch, b: Patch): void {
  const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((x, y) => (x.id < y.id ? -1 : 1));
  assert.deepEqual(byId(a.modules), byId(b.modules));
  assert.deepEqual(byId(a.cables), byId(b.cables));
  assert.equal(a.meta.title, b.meta.title);
  assert.equal(a.meta.description, b.meta.description);
}

const ofEvent = (events: ControllerEvent[], name: string) => events.filter((e) => e.event === name);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const text = (doc: unknown) => JSON.stringify(doc);
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** 待たせる門。`open()` を呼ぶまで、`wait` は終わらない。 */
function gate(): { wait: Promise<void>; open(): void } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => (open = resolve));
  return { wait, open };
}

// =====================================================================================
// 受入例(operation-contract §18)
// =====================================================================================

test("AX-01: パッチ保存→復元", async () => {
  const r = rig();
  // ① 保存
  const a = await r.ok("agent", "patch.save", { name: "bass-01" });
  assert.equal(a.revision, 10);
  assert.equal(a.result.name, "bass-01");
  // ② 変更
  const b = await r.ok("agent", "param.set", { module_id: "vcf1", param: "res", value: 0.9 });
  assert.equal(b.revision, 11);
  // ③ 復元
  const c = await r.ok("agent", "patch.load", { name: "bass-01" });
  assert.equal(c.revision, 12);
  assert.equal(c.result.migrated, null);
  // ④ 読出し
  const d = await r.ok("agent", "patch.get");
  assert.equal(d.revision, 12);
  // 適用後の状態: モジュール・パラメータ・ケーブルが P0 と一致(vcf1.res = 0.3)
  assertSamePatch(d.result.patch as Patch, P0);
  assert.equal(r.param("vcf1", "res"), 0.3);
  // ファイル bass-01.patch.json がある
  assert.equal(r.store.has("bass-01"), true);
  assertSamePatch(r.file("bass-01"), P0);
  // 履歴は②③の2件
  const u1 = await r.ok("agent", "history.undo");
  assert.equal((u1.result.undone as { command: string }).command, "patch.load");
  const u2 = await r.ok("agent", "history.undo");
  assert.equal((u2.result.undone as { command: string }).command, "param.set");
  expectError(await r.fail("agent", "history.undo"), "ERR-141");
});

test("AX-10c: 権限外(保存先)。name が ../etc/x の patch.save は ERR-201 で、ファイルは作られない", async () => {
  const r = rig();
  await unchanged(r, async () => {
    const res = await r.fail("agent", "patch.save", { name: "../etc/x" });
    expectError(res, "ERR-201");
  });
  assert.equal(r.store.size, 0);
  assert.equal(r.store.calls.length, 0, "保存先を呼ばない");
});

test("AX-12: 壊れたパッチの読込", async () => {
  const r = rig();
  await unchanged(r, async () => {
    const res = await r.fail("agent", "patch.load", {
      patch: {
        format: "modular-synth-patch",
        schema_version: 1,
        modules: [
          { id: "out", type: "MOD-IO-001", spec_version: "0.2" },
          { id: "x1", type: "MOD-XYZ-999", spec_version: "0.1" },
        ],
        cables: [],
      },
    });
    expectError(res, "ERR-204");
    assert.equal((res.error.details.issues as { rule: string }[])[0]!.rule, "DAT-V06");
    assert.equal(res.revision, 10);
  });
  assert.deepEqual(r.s.getPatch(), P0, "P0 のまま");
});

// =====================================================================================
// patch.save(CMD-12)
// =====================================================================================

test("CMD-12 / DAT-35: 保存はメモリ上の meta を更新するが、リビジョン・履歴・EVT-01・音量の対象外。直後の patch.get はファイルと一致する", async () => {
  const r = rig();
  const res = await r.ok("agent", "patch.save", { name: "bass-01" }, { client_id: "agent-a" });
  assert.equal(res.revision, 10);
  assert.equal(res.result.saved_at, T0);
  assert.equal(res.result.overwritten, false);
  assert.equal(res.result.bytes, Buffer.byteLength(r.store.get("bass-01")!, "utf8"));
  assert.deepEqual(r.s.history, { can_undo: false, can_redo: false });
  assert.equal(ofEvent(r.events, "patch.changed").length, 0);
  assert.equal(ofEvent(r.events, "output.changed").length, 0);
  assert.equal(r.be.calls.length, 0, "音声側への呼出しなし");
  // メモリ上の meta: modified_at・saved_by・app_version を書き、created_at は引き継ぐ
  const meta = r.s.getPatch().meta;
  assert.equal(meta.created_at, "2026-11-13T09:00:00Z");
  assert.equal(meta.modified_at, T0);
  assert.deepEqual(meta.saved_by, { kind: "agent", client_id: "agent-a" });
  assert.equal(typeof meta.app_version, "string");
  assert.equal(meta.title, P0.meta.title);
  assert.equal(meta.description, P0.meta.description);
  // モジュール・ケーブル・パラメータは変えない
  assertSamePatch(r.s.getPatch(), P0);
  // ファイルの内容 = 直後の patch.get
  const got = await r.ok("agent", "patch.get");
  assert.deepEqual(r.file("bass-01"), got.result.patch);
  // EVT-06
  assert.deepEqual(ofEvent(r.events, "library.changed"), [
    { v: 1, event: "library.changed", session_id: "s-test", data: { name: "bass-01", action: "saved", actor: { kind: "agent", client_id: "agent-a" } } },
  ]);
});

test("DAT-35: created_at はなければ保存時刻を書き、次の保存では引き継ぐ。saved_by は受け口が決めた操作者", async () => {
  const r = rig({ patch: null });
  assert.deepEqual(r.s.getPatch().meta, { title: "", description: "" });
  await r.ok("human", "patch.save", { name: "a" });
  assert.deepEqual(r.s.getPatch().meta, {
    title: "",
    description: "",
    created_at: T0,
    modified_at: T0,
    saved_by: { kind: "human" },
    app_version: r.s.getPatch().meta.app_version,
  });
  r.clock.now = T1;
  await r.ok("agent", "patch.save", { name: "b" });
  const meta = r.s.getPatch().meta;
  assert.equal(meta.created_at, T0);
  assert.equal(meta.modified_at, T1);
  assert.deepEqual(meta.saved_by, { kind: "agent" });
  assert.equal(r.file("b").meta.created_at, T0);
  assert.equal(r.s.revision, 0);
});

test("CMD-12: 保存時刻・saved_by は history.undo で戻らない。patch.new では「なし」になり、その取り消しで置き換わる前の値に戻る", async () => {
  const r = rig();
  await r.ok("human", "param.set", { module_id: "vcf1", param: "res", value: 0.9 });
  await r.ok("agent", "patch.save", { name: "a" });
  await r.ok("human", "history.undo");
  assert.equal(r.param("vcf1", "res"), 0.3);
  assert.equal(r.s.getPatch().meta.modified_at, T0);
  assert.deepEqual(r.s.getPatch().meta.saved_by, { kind: "agent" });
  await r.ok("human", "patch.new");
  assert.deepEqual(r.s.getPatch().meta, { title: "", description: "" });
  await r.ok("human", "history.undo");
  assert.equal(r.s.getPatch().meta.modified_at, T0);
  assert.deepEqual(r.s.getPatch().meta.saved_by, { kind: "agent" });
});

test("ERR-203: 同名があり overwrite の指定がない(false)なら、人でもエージェントでも拒否。ファイルは変わらない", async () => {
  const r = rig();
  await r.ok("human", "patch.save", { name: "a" });
  const before = r.store.get("a");
  await r.ok("human", "param.set", { module_id: "vcf1", param: "res", value: 0.9 });
  r.clock.now = T1;
  for (const actor of ["human", "agent"] as const) {
    for (const args of [{ name: "a" }, { name: "a", overwrite: false }]) {
      await unchanged(r, async () => {
        const res = await r.fail(actor, "patch.save", args);
        expectError(res, "ERR-203");
        assert.equal(res.error.details.name, "a");
      });
    }
  }
  assert.equal(r.store.get("a"), before);
});

test("§15.3 / DAT-33: 人は overwrite: true で常に上書きできる(エージェントが保存したファイルも)", async () => {
  const r = rig();
  await r.ok("agent", "patch.save", { name: "a" });
  await r.ok("human", "param.set", { module_id: "vcf1", param: "res", value: 0.9 });
  r.clock.now = T1;
  const res = await r.ok("human", "patch.save", { name: "a", overwrite: true });
  assert.equal(res.result.overwritten, true);
  assert.equal(res.result.saved_at, T1);
  assert.deepEqual(r.file("a").meta.saved_by, { kind: "human" });
  assert.equal(r.file("a").modules.find((m) => m.id === "vcf1")!.params.res, 0.9);
  // 人が上書きした後は、エージェントは上書きできない(判定はファイルに今書かれている値)
  await unchanged(r, async () => {
    const denied = await r.fail("agent", "patch.save", { name: "a", overwrite: true });
    expectError(denied, "ERR-005");
    assert.equal(denied.error.details.command, "patch.save");
    assert.equal(denied.error.details.actor_kind, "agent");
  });
  assert.deepEqual(r.file("a").meta.saved_by, { kind: "human" });
});

test("§15.3: エージェントは、最後にエージェントが保存したファイルだけ上書きできる", async () => {
  const r = rig();
  await r.ok("agent", "patch.save", { name: "mine" });
  await r.ok("human", "patch.save", { name: "yours" });
  const yours = r.store.get("yours");
  await r.ok("agent", "param.set", { module_id: "vcf1", param: "res", value: 0.9 });
  r.clock.now = T1;
  const res = await r.ok("agent", "patch.save", { name: "mine", overwrite: true });
  assert.equal(res.result.overwritten, true);
  assert.equal(r.file("mine").modules.find((m) => m.id === "vcf1")!.params.res, 0.9);
  assert.equal(r.file("mine").meta.modified_at, T1);
  // メモリ上のパッチの saved_by は agent(直前の保存)だが、判定には使わない
  assert.deepEqual(r.s.getPatch().meta.saved_by, { kind: "agent" });
  await unchanged(r, async () => {
    expectError(await r.fail("agent", "patch.save", { name: "yours", overwrite: true }), "ERR-005");
  });
  assert.equal(r.store.get("yours"), yours, "人のファイルは変わらない");
});

test("DAT-36: アプリの外で置かれたファイル(saved_by なし・kind が agent 以外・書式が不正・JSONでない)は人が保存した扱いで、エージェントは上書きできない", async () => {
  const r = rig();
  const withSavedBy = (savedBy: unknown): string => {
    const doc = copy(P0) as unknown as { meta: Record<string, unknown> };
    if (savedBy === undefined) delete doc.meta.saved_by;
    else doc.meta.saved_by = savedBy;
    return text(doc);
  };
  const files: Record<string, string> = {
    "no-saved-by": withSavedBy(undefined),
    "kind-human": withSavedBy({ kind: "human" }),
    "kind-other": withSavedBy({ kind: "robot" }),
    "kind-upper": withSavedBy({ kind: "Agent" }),
    "saved-by-string": withSavedBy("agent"),
    "saved-by-extra-key": withSavedBy({ kind: "agent", role: "x" }),
    "saved-by-bad-client": withSavedBy({ kind: "agent", client_id: 5 }),
    "no-meta": text({ format: "modular-synth-patch", schema_version: 1, modules: [], cables: [] }),
    "not-json": '{"format": "modular-synth-patch", "schema_version": 1, "modules": [',
    "not-object": "[1, 2, 3]",
    empty: "",
  };
  for (const [name, body] of Object.entries(files)) r.store.put(name, body);
  await unchanged(r, async () => {
    for (const name of Object.keys(files)) {
      const res = await r.fail("agent", "patch.save", { name, overwrite: true });
      expectError(res, "ERR-005");
    }
  });
  for (const [name, body] of Object.entries(files)) assert.equal(r.store.get(name), body, `${name} は変わらない`);
  // アプリの外で kind を agent に書き換えたファイルは、エージェントが上書きできる(保護の対象外)
  r.store.put("edited", withSavedBy({ kind: "agent" }));
  assert.equal((await r.ok("agent", "patch.save", { name: "edited", overwrite: true })).result.overwritten, true);
  // 人はどれでも上書きできる
  for (const name of Object.keys(files)) {
    assert.equal((await r.ok("human", "patch.save", { name, overwrite: true })).result.overwritten, true);
  }
});

test("DAT-36: patch.load で渡したJSONの saved_by は判定に使わない(偽っても、保存時にはアプリが agent と書く)", async () => {
  const r = rig();
  await r.ok("human", "patch.save", { name: "yours" });
  const forged = copy(P0);
  forged.meta.saved_by = { kind: "agent" };
  await r.ok("agent", "patch.load", { patch: forged });
  expectError(await r.fail("agent", "patch.save", { name: "yours", overwrite: true }), "ERR-005");
  const human = copy(P0);
  human.meta.saved_by = { kind: "human" };
  await r.ok("agent", "patch.load", { patch: human });
  await r.ok("agent", "patch.save", { name: "mine" });
  assert.deepEqual(r.file("mine").meta.saved_by, { kind: "agent" });
  assert.equal((await r.ok("agent", "patch.save", { name: "mine", overwrite: true })).result.overwritten, true);
});

test("ERR-106: 新しい名前の保存でファイル数の上限を超えるなら拒否。既存ファイルの上書きは対象外", async () => {
  const r = rig({ maxPatchFiles: 2 });
  await r.ok("agent", "patch.save", { name: "a" });
  r.store.put("b", "壊れたファイルも数える");
  r.store.put("NOT A NAME", "名前が規則に合わないものは数えない");
  await unchanged(r, async () => {
    const res = await r.fail("agent", "patch.save", { name: "c" });
    expectError(res, "ERR-106");
    assert.equal(res.error.details.max, 2);
    assert.equal(typeof res.error.details.limit, "string");
  });
  assert.equal(r.store.has("c"), false);
  assert.equal((await r.ok("agent", "patch.save", { name: "a", overwrite: true })).result.overwritten, true);
  await r.ok("human", "patch.delete", { name: "b" });
  await r.ok("agent", "patch.save", { name: "c" });
});

test("ERR-106 / ERR-206 / ERR-203: 保存先が返した上限・重複の失敗も契約のエラーにする", async () => {
  const cases: [Parameters<MemoryPatchStore["failOn"]["set"]>[1], keyof typeof ERRORS][] = [
    ["too_many", "ERR-106"],
    ["too_large", "ERR-206"],
    ["exists", "ERR-203"],
    ["invalid_name", "ERR-201"],
  ];
  for (const [error, id] of cases) {
    const r = rig();
    r.store.failOn.set("write", error);
    await unchanged(r, async () => {
      expectError(await r.fail("agent", "patch.save", { name: "a" }), id);
    });
    assert.equal(r.store.has("a"), false);
  }
  // 大きさの上限(保存先の上限を小さくして確かめる)
  const r = rig({ maxBytes: 100 });
  await unchanged(r, async () => {
    const res = await r.fail("agent", "patch.save", { name: "a" });
    expectError(res, "ERR-206");
    assert.equal(res.error.details.limit_bytes, MAX_PATCH_BYTES);
  });
});

// =====================================================================================
// 名前の検証(DAT-31、ERR-201)と引数の形(ERR-003)
// =====================================================================================

test("DAT-31 / ERR-201: 無効な名前(上位参照・区切り文字・予約名・大文字・空白・非ASCII・長すぎ)はどのコマンドでも拒否し、保存先を呼ばない", async () => {
  const r = rig();
  r.store.put("ok", text(P0));
  r.store.calls.length = 0;
  const names = [
    "..",
    ".",
    "../etc/x",
    "..\\x",
    "a/b",
    "a\\b",
    "/etc/passwd",
    "a.b",
    ".hidden",
    "a.patch.json",
    "con",
    "prn",
    "aux",
    "nul",
    "com1",
    "com9",
    "lpt1",
    "lpt9",
    "A",
    "Bass",
    "a b",
    " a",
    "",
    "_a",
    "-a",
    "ベース",
    "a\u0000",
    "a\n",
    "x".repeat(65),
  ];
  await unchanged(r, async () => {
    for (const name of names) {
      for (const [actor, command, args] of [
        ["agent", "patch.save", { name }],
        ["agent", "patch.save", { name, overwrite: true }],
        ["agent", "patch.load", { name }],
        ["agent", "patch.read", { name }],
        ["human", "patch.delete", { name }],
      ] as [ActorKind, string, Record<string, unknown>][]) {
        const res = await r.fail(actor, command, args);
        expectError(res, "ERR-201");
        assert.equal(res.error.details.name, name);
      }
    }
  });
  assert.equal(r.store.calls.length, 0, "保存先を呼ばない");
  assert.equal(r.store.size, 1);
  // 規則に合う名前の境界
  for (const name of ["a", "0", "a-b_c", "con1", "x".repeat(64)]) await r.ok("agent", "patch.save", { name });
});

test("ERR-003: 保存のコマンドの引数の不足・未知のキー・型違い", async () => {
  const r = rig();
  await unchanged(r, async () => {
    const cases: [ActorKind, string, Record<string, unknown> | undefined][] = [
      ["agent", "patch.save", undefined],
      ["agent", "patch.save", {}],
      ["agent", "patch.save", { name: 5 }],
      ["agent", "patch.save", { name: "a", overwrite: "yes" }],
      ["agent", "patch.save", { name: "a", overwrite: 1 }],
      ["agent", "patch.save", { name: "a", path: "/tmp" }],
      ["agent", "patch.load", {}],
      ["agent", "patch.load", { name: "a", patch: {} }],
      ["agent", "patch.load", { name: null }],
      ["agent", "patch.load", { patch: "{}" }],
      ["agent", "patch.load", { patch: [] }],
      ["agent", "patch.load", { patch: null }],
      ["agent", "patch.load", { name: "a", folder: "x" }],
      ["agent", "patch.list", { name: "a" }],
      ["agent", "patch.read", {}],
      ["agent", "patch.read", { name: "a", validate: true }],
      ["human", "patch.delete", {}],
      ["human", "patch.delete", { name: ["a"] }],
    ];
    for (const [actor, command, args] of cases) {
      expectError(await r.fail(actor, command, args), "ERR-003");
    }
  });
  assert.equal(r.store.calls.length, 0);
});

test("§3.3: 保存のコマンドでも、封筒(ERR-001・ERR-012)、権限(ERR-005)、expected_revision(ERR-008)を引数・名前より先に見る", async () => {
  const r = rig();
  await unchanged(r, async () => {
    const raw = async (req: unknown, actor: ActorKind = "agent") => (await r.c.handle(req, actor)) as FailureResponse;
    expectError(await raw({ v: 1, command: "patch.save", args: { name: "a" } }), "ERR-001");
    expectError(await raw({ v: 1, request_id: "x", command: "patch.save", args: { name: "a" }, actor: "human" }), "ERR-001");
    expectError(await raw({ v: 2, request_id: "x", command: "patch.save", args: { name: "a" } }), "ERR-012");
    expectError(await raw({ v: 1, request_id: "x", command: "patch.delete", args: { name: "../x" } }), "ERR-005");
    const conflict = await r.fail("agent", "patch.save", { name: "../x" }, { expected_revision: 9 });
    expectError(conflict, "ERR-008");
    assert.deepEqual(conflict.error.details, { expected_revision: 9, current_revision: 10 });
    expectError(await r.fail("agent", "patch.load", { name: "nothing" }, { expected_revision: 3 }), "ERR-008");
  });
  assert.equal(r.store.calls.length, 0);
  await r.ok("agent", "patch.save", { name: "a" }, { expected_revision: 10 });
});

// =====================================================================================
// patch.delete(CMD-16)
// =====================================================================================

test("CMD-16 / §15.2: patch.delete は人のみ。エージェントは ERR-005 で、ファイルは残る", async () => {
  const r = rig();
  await r.ok("agent", "patch.save", { name: "a" });
  const before = r.events.length;
  const res = await r.fail("agent", "patch.delete", { name: "a" });
  expectError(res, "ERR-005");
  assert.deepEqual(res.error.details, { command: "patch.delete", actor_kind: "agent" });
  assert.equal(r.store.has("a"), true);
  assert.equal(r.events.length, before);
  // 人は削除できる。パッチ・リビジョン・履歴は変わらず、EVT-06 が出る
  const patch = r.s.getPatch();
  const ok = await r.ok("human", "patch.delete", { name: "a" });
  assert.deepEqual(ok.result, { name: "a" });
  assert.equal(ok.revision, 10);
  assert.equal(r.store.has("a"), false);
  assert.deepEqual(r.s.getPatch(), patch);
  assert.deepEqual(r.s.history, { can_undo: false, can_redo: false });
  assert.deepEqual(r.events.slice(before), [
    { v: 1, event: "library.changed", session_id: "s-test", data: { name: "a", action: "deleted", actor: { kind: "human" } } },
  ]);
});

// =====================================================================================
// 存在しない名前(ERR-202)
// =====================================================================================

test("ERR-202: 存在しない名前の patch.load / patch.read / patch.delete", async () => {
  const r = rig();
  await unchanged(r, async () => {
    for (const [actor, command] of [
      ["agent", "patch.load"],
      ["agent", "patch.read"],
      ["human", "patch.delete"],
    ] as [ActorKind, string][]) {
      const res = await r.fail(actor, command, { name: "nothing" });
      expectError(res, "ERR-202");
      assert.equal(res.error.details.name, "nothing");
    }
  });
});

// =====================================================================================
// patch.load(CMD-13)
// =====================================================================================

/** data-contract §12 の無効な例。 */
const DX: Record<string, { text: string; id: keyof typeof ERRORS; rule: string }> = {
  "DX-01": { text: '{"format": "modular-synth-patch", "schema_version": 1, "modules": [', id: "ERR-204", rule: "DAT-V02" },
  "DX-02": { text: text({ ...P0, schema_version: 99 }), id: "ERR-205", rule: "DAT-V04" },
  "DX-03": { text: text({ ...P0, format: "vcv-rack-patch" }), id: "ERR-205", rule: "DAT-V03" },
  "DX-04": {
    text: '{"format": "modular-synth-patch", "schema_version": 1, "modules": [{"id": "out", "type": "MOD-IO-001", "spec_version": "0.2"}, {"id": "x1", "type": "MOD-XYZ-999", "spec_version": "0.1"}], "cables": []}',
    id: "ERR-204",
    rule: "DAT-V06",
  },
  "DX-05": {
    text: '{"format": "modular-synth-patch", "schema_version": 1, "modules": [{"id": "out", "type": "MOD-IO-001", "spec_version": "0.2"}, {"id": "vcf1", "type": "MOD-FLT-001", "spec_version": "0.2", "params": {"resonance": 0.5}}], "cables": []}',
    id: "ERR-204",
    rule: "DAT-V10",
  },
  "DX-06": {
    text: '{"format": "modular-synth-patch", "schema_version": 1, "modules": [{"id": "out", "type": "MOD-IO-001", "spec_version": "0.2"}, {"id": "vcf1", "type": "MOD-FLT-001", "spec_version": "0.2", "params": {"cutoff": 7.5}}], "cables": []}',
    id: "ERR-204",
    rule: "DAT-V12",
  },
  "DX-07": {
    text: '{"format": "modular-synth-patch", "schema_version": 1, "modules": [{"id": "out", "type": "MOD-IO-001", "spec_version": "0.2"}, {"id": "env1", "type": "MOD-ENV-001", "spec_version": "0.2", "params": {"attack": "fast", "sustain": null}}], "cables": []}',
    id: "ERR-204",
    rule: "DAT-V11",
  },
  "DX-08": {
    text: '{"format": "modular-synth-patch", "schema_version": 1, "modules": [{"id": "vco1", "type": "MOD-OSC-001", "spec_version": "0.3"}], "cables": []}',
    id: "ERR-204",
    rule: "DAT-V09",
  },
  "DX-09": {
    text: '{"format": "modular-synth-patch", "schema_version": 1, "modules": [{"id": "out", "type": "MOD-IO-001", "spec_version": "0.2"}, {"id": "vco1", "type": "MOD-OSC-001", "spec_version": "0.3"}, {"id": "vco2", "type": "MOD-OSC-001", "spec_version": "0.3"}], "cables": [{"id": "c1", "from": {"module": "vco1", "port": "saw"}, "to": {"module": "out", "port": "IN_L"}}, {"id": "c2", "from": {"module": "vco2", "port": "saw"}, "to": {"module": "out", "port": "IN_L"}}]}',
    id: "ERR-204",
    rule: "DAT-V16",
  },
  "DX-10": {
    text: '{"format": "modular-synth-patch", "schema_version": 1, "modules": [{"id": "out", "type": "MOD-IO-001", "spec_version": "0.2"}, {"id": "vco1", "type": "MOD-OSC-001", "spec_version": "0.3"}], "cables": [{"id": "c1", "from": {"module": "vco1", "port": "square"}, "to": {"module": "out", "port": "IN_L"}}, {"id": "c2", "from": {"module": "out", "port": "IN_L"}, "to": {"module": "vco1", "port": "fm"}}]}',
    id: "ERR-204",
    rule: "DAT-V14",
  },
  "DX-11": {
    text: text({ ...P0, modules: P0.modules.map((m) => (m.id === "vco1" ? { ...m, spec_version: "9.0" } : m)) }),
    id: "ERR-205",
    rule: "DAT-V07",
  },
  "DX-12": { text: text({ ...P0, script: "..." }), id: "ERR-204", rule: "DAT-V05" },
};

for (const [dx, example] of Object.entries(DX)) {
  test(`${dx}: 無効なパッチの patch.load は ${example.id}(${example.rule})で、現在のパッチは不変(名前での読込と、JSONを直接渡す読込)`, async () => {
    const r = rig();
    // 現在のパッチを P0 から変えておく(失敗した読込で、P0 にも空にもならないことを見る)
    await r.ok("human", "param.set", { module_id: "vcf1", param: "res", value: 0.9 });
    r.store.put("broken", example.text);
    await unchanged(r, async () => {
      const byName = await r.fail("agent", "patch.load", { name: "broken" });
      expectError(byName, example.id);
      assert.equal(byName.revision, 11);
      if (example.id === "ERR-204") {
        const issues = byName.error.details.issues as { rule: string; path: string; message: string }[];
        assert.equal(issues[0]!.rule, example.rule);
        for (const i of issues) assert.deepEqual(Object.keys(i).sort(), ["message", "path", "rule"]);
      } else {
        assert.ok("found" in byName.error.details && "supported" in byName.error.details, JSON.stringify(byName.error.details));
      }
      if (dx === "DX-02") assert.equal(byName.error.details.found, 99);
      if (dx !== "DX-01") {
        // JSON として読める例は、patch で直接渡しても同じ結果
        const direct = await r.fail("agent", "patch.load", { patch: JSON.parse(example.text) as Record<string, unknown> });
        expectError(direct, example.id);
        assert.deepEqual(direct.error.details, byName.error.details);
      }
    });
    assert.equal(r.param("vcf1", "res"), 0.9);
    assert.equal(r.store.get("broken"), example.text, "ファイルは書き換えない");
  });
}

test("ERR-206: 大きすぎるパッチの patch.load は拒否し、現在のパッチは不変", async () => {
  const r = rig();
  const big = copy(P0);
  big.meta.description = "x".repeat(MAX_PATCH_BYTES);
  r.store.put("big", text(big));
  await unchanged(r, async () => {
    for (const args of [{ name: "big" }, { patch: big as unknown as Record<string, unknown> }]) {
      const res = await r.fail("agent", "patch.load", args);
      expectError(res, "ERR-206");
      assert.equal(res.error.details.limit_bytes, MAX_PATCH_BYTES);
    }
  });
});

test("CMD-13: 読込はパッチ全体の置き換え。リビジョン +1、履歴1件、EVT-01(patch_replaced)1件、音声側は applyPatch", async () => {
  const r = rig();
  await r.ok("agent", "patch.save", { name: "p0" });
  await r.ok("human", "patch.new");
  r.events.length = 0;
  r.be.calls.length = 0;
  const res = await r.ok("agent", "patch.load", { name: "p0" }, { client_id: "agent-a" });
  assert.equal(res.revision, 12);
  assert.equal(res.result.migrated, null);
  assert.deepEqual(res.warnings, []);
  assert.deepEqual(res.result.patch, r.s.getPatch());
  assertSamePatch(res.result.patch as Patch, P0);
  // meta の保存時刻などは、読んだファイルに書かれていた値(DAT-35)
  assert.deepEqual(r.s.getPatch().meta, r.file("p0").meta);
  assert.deepEqual(r.events, [
    {
      v: 1,
      event: "patch.changed",
      session_id: "s-test",
      data: {
        revision: 12,
        previous_revision: 11,
        actor: { kind: "agent", client_id: "agent-a" },
        command: "patch.load",
        request_id: res.request_id,
        changes: [{ kind: "patch_replaced" }],
      },
    },
  ]);
  assert.deepEqual(r.be.calls.map((c) => c[0]), ["applyPatch"]);
  assert.deepEqual(r.be.calls[0]![1], r.s.getPatch());
  assert.equal(r.be.calls[0]![2], 12);
  assert.deepEqual(r.s.history, { can_undo: true, can_redo: false });
});

test("CMD-13 / §9.8: 読込は取り消せる(置き換え前のパッチへ戻る)。やり直しもできる。履歴は消えない", async () => {
  const r = rig();
  await r.ok("agent", "patch.save", { name: "p0" });
  await r.ok("human", "module.add", { type: "MOD-LFO-001", id: "lfo1" });
  await r.ok("human", "patch.set_meta", { title: "作業中" });
  const working = r.s.getPatch();
  const loaded = await r.ok("agent", "patch.load", { name: "p0" });
  assert.equal(loaded.revision, 13);
  const afterLoad = r.s.getPatch();
  r.events.length = 0;
  r.be.calls.length = 0;
  // 人が、エージェントの読込を取り消す
  const undo = await r.ok("human", "history.undo");
  assert.equal(undo.revision, 14);
  assert.deepEqual(undo.result.undone, { command: "patch.load", actor: { kind: "agent" }, revision: 13 });
  assert.deepEqual(r.s.getPatch(), working, "置き換え前のパッチ(meta を含む)へ戻る");
  assert.deepEqual((r.events[0] as { data: { changes: unknown[] } }).data.changes, [{ kind: "patch_replaced" }]);
  assert.deepEqual(r.be.calls.map((c) => c[0]), ["applyPatch"]);
  // 読込の前の変更も、続けて取り消せる
  assert.deepEqual(r.s.history, { can_undo: true, can_redo: true });
  // やり直し
  const redo = await r.ok("human", "history.redo");
  assert.equal(redo.revision, 15);
  assert.deepEqual(redo.result.redone, { command: "patch.load", actor: { kind: "agent" }, revision: 13 });
  assert.deepEqual(r.s.getPatch(), afterLoad);
  await r.ok("human", "history.undo");
  await r.ok("human", "history.undo");
  await r.ok("human", "history.undo");
  assert.deepEqual(r.s.getPatch().modules, P0.modules);
  expectError(await r.fail("human", "history.undo"), "ERR-141");
});

test("CMD-13: JSON を直接渡す読込(patch)。省略パラメータは既定値で補い param_defaulted、meta の時刻などは渡した値(なければ「なし」)", async () => {
  const r = rig();
  const res = await r.ok("agent", "patch.load", {
    patch: {
      format: "modular-synth-patch",
      schema_version: 1,
      modules: [
        { id: "out", type: "MOD-IO-001", spec_version: "0.2" },
        { id: "vco1", type: "MOD-OSC-001", spec_version: "0.3", params: { tune: 0.5 } },
      ],
      cables: [{ id: "c1", from: { module: "vco1", port: "saw" }, to: { module: "out", port: "IN_L" } }],
    },
  });
  assert.equal(res.revision, 11);
  assert.equal(res.result.migrated, null);
  assert.ok(res.warnings.some((w) => w.code === "param_defaulted"), JSON.stringify(res.warnings));
  const patch = r.s.getPatch();
  assert.deepEqual(patch.meta, { title: "", description: "" });
  assert.deepEqual(patch.modules, [
    { id: "out", type: "MOD-IO-001", spec_version: "0.2", params: { level: 1.0, mute: 0 } },
    { id: "vco1", type: "MOD-OSC-001", spec_version: "0.3", params: { range: 0, tune: 0.5, fm_amt: 0.0, pw: 0.5, pwm_amt: 0.0 } },
  ]);
  assert.equal(patch.cables.length, 1);
  assert.equal(r.store.calls.length, 0, "保存先は使わない");
});

test("DAT-9.4: 移行があった読込は result.migrated に内容を入れ、warnings に migrated を入れる。元のファイルは書き換えない(DAT-60)", async () => {
  const r = rig();
  const old = copy(P0) as unknown as { modules: { id: string; spec_version: string; params: Record<string, number> }[] };
  for (const m of old.modules) m.spec_version = "0.1";
  delete old.modules.find((m) => m.id === "midi1")!.params.voices;
  const body = text(old);
  r.store.put("old", body);
  const res = await r.ok("agent", "patch.load", { name: "old" });
  assert.equal(res.revision, 11);
  const migrated = res.result.migrated as { schema_from: number; schema_to: number; modules: { id: string; type: string; spec_from: string; spec_to: string }[] };
  assert.equal(migrated.schema_from, 1);
  assert.equal(migrated.schema_to, 1);
  assert.deepEqual(
    migrated.modules.map((m) => [m.id, m.spec_from, m.spec_to]),
    P0.modules.map((m) => [m.id, "0.1", m.type === "MOD-OSC-001" ? "0.3" : "0.2"]),
  );
  assert.ok(res.warnings.some((w) => w.code === "migrated"), JSON.stringify(res.warnings));
  assertSamePatch(r.s.getPatch(), P0);
  assert.equal(r.store.get("old"), body);
  // JSON を直接渡しても同じ
  const direct = await r.ok("agent", "patch.load", { patch: JSON.parse(body) as Record<string, unknown> });
  assert.deepEqual(direct.result.migrated, migrated);
});

test("§2.2 規則4: 読込の後の自動採番は「現在の次番号」と「読み込んだパッチ内の最大値+1」の大きい方", async () => {
  const r = rig({ patch: null });
  const withM = (n: number) => ({
    format: "modular-synth-patch",
    schema_version: 1,
    modules: [
      { id: "out", type: "MOD-IO-001", spec_version: "0.2" },
      { id: `m${n}`, type: "MOD-LFO-001", spec_version: "0.2" },
    ],
    cables: [{ id: `c${n + 2}`, from: { module: `m${n}`, port: "sine" }, to: { module: "out", port: "IN_L" } }],
  });
  await r.ok("agent", "patch.load", { patch: withM(7) });
  const a = await r.ok("agent", "module.add", { type: "MOD-LFO-001" });
  assert.equal((a.result.module as { id: string }).id, "m8");
  const c = await r.ok("agent", "cable.connect", { from: { module: "m8", port: "sine" }, to: { module: "out", port: "IN_R" } });
  assert.equal((c.result.cable as { id: string }).id, "c10");
  // 小さい番号のパッチを読んでも、次番号は下がらない
  await r.ok("agent", "patch.load", { patch: withM(2) });
  const b = await r.ok("agent", "module.add", { type: "MOD-LFO-001" });
  assert.equal((b.result.module as { id: string }).id, "m9");
});

test("§2.4: 読込で音量は min(現在値, 既定値) に下がり(EVT-03 reset_to_default)、上限は変わらない。既定値以下なら変わらず、通知もない", async () => {
  const r = rig();
  await r.ok("agent", "patch.save", { name: "p0" });
  // 人が既定値(-20)より上げている
  await r.ok("human", "output.set_level", { level_db: -6 });
  r.events.length = 0;
  await r.ok("agent", "patch.load", { name: "p0" });
  assert.equal(r.be.levelDb, -20);
  assert.equal(r.be.agentMaxLevelDb, -6);
  assert.deepEqual(r.events.map((e) => e.event), ["patch.changed", "output.changed"]);
  assert.deepEqual(r.events[1]!.data, { level_db: -20, agent_max_level_db: -6, panic: false, actor: { kind: "agent" }, reason: "reset_to_default" });
  // 人が既定値より下げている: 読込でも、その取り消しでも上がらない
  await r.ok("human", "output.set_level", { level_db: -30 });
  r.events.length = 0;
  await r.ok("agent", "patch.load", { name: "p0" });
  await r.ok("agent", "history.undo");
  await r.ok("agent", "patch.load", { patch: copy(P0) as unknown as Record<string, unknown> });
  const status = await r.ok("agent", "engine.get_status");
  const output = status.result.output as { level_db: number; agent_max_level_db: number };
  assert.equal(output.level_db, -30);
  assert.equal(output.agent_max_level_db, -30);
  assert.equal(ofEvent(r.events, "output.changed").length, 0);
  // 保存・一覧・読出し・削除は音量を変えない(§2.4 の7)
  await r.ok("human", "output.set_level", { level_db: -3 });
  await r.ok("agent", "patch.save", { name: "p1" });
  await r.ok("agent", "patch.list");
  await r.ok("agent", "patch.read", { name: "p1" });
  await r.ok("human", "patch.delete", { name: "p1" });
  assert.equal(r.be.levelDb, -3);
});

test("CMD-13: 緊急停止中・音声未開始でも読込は成功し、緊急停止と音声状態は変えない", async () => {
  const r = rig({ audioState: "stopped" });
  await r.ok("agent", "patch.save", { name: "p0" });
  await r.ok("agent", "engine.panic");
  const res = await r.ok("agent", "patch.load", { name: "p0" });
  assert.equal(res.audio_state, "stopped");
  assert.equal(r.be.panicOn, true);
  assert.equal(r.be.audioState, "stopped");
  assert.equal(res.revision, 11);
});

// =====================================================================================
// patch.read(CMD-15)と patch.list(CMD-14)
// =====================================================================================

test("CMD-15: patch.read はファイルの内容をそのまま返し(検証・移行なし)、現在のパッチを変えない", async () => {
  const r = rig();
  await r.ok("agent", "patch.save", { name: "p0" });
  await r.ok("human", "param.set", { module_id: "vcf1", param: "res", value: 0.9 });
  // 検証に通らない内容(未知の種別・古い版・未知のキー)も、JSON として読めればそのまま返す
  const odd = { format: "modular-synth-patch", schema_version: 99, modules: [{ id: "x1", type: "MOD-XYZ-999", spec_version: "0.1" }], extra: [1, "a", null] };
  r.store.put("odd", text(odd));
  r.store.put("not-json", DX["DX-01"]!.text);
  await unchanged(r, async () => {
    const a = await r.ok("agent", "patch.read", { name: "p0" });
    assert.deepEqual(a.result.patch, r.file("p0"));
    assert.equal((a.result.patch as Patch).modules.find((m) => m.id === "vcf1")!.params.res, 0.3);
    assert.equal(a.result.bytes, Buffer.byteLength(r.store.get("p0")!, "utf8"));
    assert.equal(a.result.modified_at, T0);
    assert.deepEqual(Object.keys(a.result).sort(), ["bytes", "modified_at", "patch"]);
    assert.equal(a.revision, 11);
    const b = await r.ok("agent", "patch.read", { name: "odd" });
    assert.deepEqual(b.result.patch, odd);
    assert.deepEqual(b.warnings, []);
    const c = await r.fail("agent", "patch.read", { name: "not-json" });
    expectError(c, "ERR-204");
  });
  assert.equal(r.param("vcf1", "res"), 0.9);
});

test("CMD-14: patch.list は名前が規則に合うファイルを返し、読めない・壊れたファイルも readable: false で載せる", async () => {
  const r = rig();
  await r.ok("agent", "patch.save", { name: "b-agent" });
  r.clock.now = T1;
  await r.ok("human", "patch.save", { name: "a-human" });
  r.store.put("c-broken", DX["DX-01"]!.text);
  r.store.put("d-unknown-type", DX["DX-04"]!.text);
  r.store.put("Not A Name", text(P0));
  await unchanged(r, async () => {
    const res = await r.ok("agent", "patch.list");
    const patches = res.result.patches as Record<string, unknown>[];
    assert.deepEqual(
      patches.map((p) => [p.name, p.title, p.saved_by_kind, p.readable, p.modified_at]),
      [
        ["a-human", P0.meta.title, "human", true, T1],
        ["b-agent", P0.meta.title, "agent", true, T0],
        ["c-broken", null, null, false, T1],
        ["d-unknown-type", null, null, false, T1],
      ],
    );
    for (const p of patches) {
      assert.deepEqual(Object.keys(p).sort(), ["bytes", "modified_at", "name", "readable", "saved_by_kind", "title"]);
      assert.equal(p.bytes, Buffer.byteLength(r.store.get(p.name as string)!, "utf8"));
    }
  });
  // 空のフォルダ
  const empty = rig();
  assert.deepEqual((await empty.ok("agent", "patch.list")).result, { patches: [] });
});

// =====================================================================================
// 冪等キー(§7)
// =====================================================================================

test("§7: patch.save の再送は保存済みの応答を返し、ファイルを書き直さない(overwrite: false でも ERR-203 にならない)。EVT-06 は1件", async () => {
  const r = rig();
  const first = await r.ok("agent", "patch.save", { name: "a" }, { idempotency_key: "k-save" });
  assert.equal(first.replayed, false);
  const body = r.store.get("a");
  await r.ok("agent", "param.set", { module_id: "vcf1", param: "res", value: 0.9 });
  r.clock.now = T1;
  const writes = r.store.calls.filter((c) => c[0] === "write").length;
  const again = await r.c.handle({ v: 1, request_id: "again", command: "patch.save", args: { name: "a" }, idempotency_key: "k-save" }, "agent");
  assert.equal(again.ok, true);
  assert.equal(again.replayed, true);
  assert.equal(again.request_id, "again");
  assert.equal(again.revision, 10, "最初の応答時の値のまま");
  assert.deepEqual((again as SuccessResponse).result, first.result);
  assert.equal(r.store.get("a"), body, "書き直さない");
  assert.equal(r.store.calls.filter((c) => c[0] === "write").length, writes);
  assert.equal(ofEvent(r.events, "library.changed").length, 1);
  // 同じ鍵で内容が違えば ERR-009
  expectError(await r.fail("agent", "patch.save", { name: "b" }, { idempotency_key: "k-save" }), "ERR-009");
  assert.equal(r.store.has("b"), false);
  // 鍵なしの再送は ERR-203
  expectError(await r.fail("agent", "patch.save", { name: "a" }), "ERR-203");
});

test("§7: patch.load・patch.delete の再送は1回分しか効かない。読出し(patch.list / patch.read)は鍵を無視して毎回実行する", async () => {
  const r = rig();
  await r.ok("agent", "patch.save", { name: "a" });
  const first = await r.ok("agent", "patch.load", { name: "a" }, { idempotency_key: "k-load" });
  assert.equal(first.revision, 11);
  const again = await r.ok("agent", "patch.load", { name: "a" }, { idempotency_key: "k-load" });
  assert.equal(again.replayed, true);
  assert.equal(again.revision, 11);
  assert.equal(r.s.revision, 11);
  assert.equal(ofEvent(r.events, "patch.changed").length, 1);
  expectError(await r.fail("agent", "patch.load", { name: "b" }, { idempotency_key: "k-load" }), "ERR-009");
  // 削除: 2回目は ERR-202 でなく、保存済みの応答
  const del = await r.ok("human", "patch.delete", { name: "a" }, { idempotency_key: "k-del" });
  assert.equal(del.replayed, false);
  const delAgain = await r.ok("human", "patch.delete", { name: "a" }, { idempotency_key: "k-del" });
  assert.equal(delAgain.replayed, true);
  assert.equal(ofEvent(r.events, "library.changed").filter((e) => (e.data as { action: string }).action === "deleted").length, 1);
  // 読出しは鍵を無視する(同じ鍵で別の内容でも ERR-009 にならず、毎回実行する)
  await r.ok("agent", "patch.save", { name: "x" });
  const l1 = await r.ok("agent", "patch.list", undefined, { idempotency_key: "k-read" });
  await r.ok("agent", "patch.save", { name: "y" });
  const l2 = await r.ok("agent", "patch.list", undefined, { idempotency_key: "k-read" });
  assert.equal(l2.replayed, false);
  assert.equal((l1.result.patches as unknown[]).length, 1);
  assert.equal((l2.result.patches as unknown[]).length, 2);
  const rd = await r.ok("agent", "patch.read", { name: "x" }, { idempotency_key: "k-read" });
  assert.equal(rd.replayed, false);
});

test("§7.5: 失敗した応答は保存しない(保存先の失敗の後、同じ鍵で再送すると、あらためて実行する)", async () => {
  const r = rig();
  r.store.failOn.set("write", "failed");
  expectError(await r.fail("agent", "patch.save", { name: "a" }, { idempotency_key: "k" }), "ERR-207");
  r.store.failOn.clear();
  const res = await r.ok("agent", "patch.save", { name: "a" }, { idempotency_key: "k" });
  assert.equal(res.replayed, false);
  assert.equal(r.store.has("a"), true);
});

// =====================================================================================
// 直列化(§1.2、§11.7)
// =====================================================================================

test("直列化: 保存の書込みを待つ間に来た要求は、保存の応答が決まってから処理する(割り込まない)", async () => {
  const r = rig();
  const g = gate();
  r.store.before = (op) => (op === "write" ? g.wait : undefined);
  const order: string[] = [];
  const save = r.send("agent", "patch.save", { name: "a" }).then((x) => (order.push("save"), x));
  const set = r.send("human", "param.set", { module_id: "vcf1", param: "res", value: 0.9 }).then((x) => (order.push("param.set"), x));
  const get = r.send("agent", "patch.get").then((x) => (order.push("patch.get"), x));
  for (let i = 0; i < 5; i++) await tick();
  // 書込みの途中: 後の要求はまだ処理されていない
  assert.deepEqual(r.store.calls.at(-1), ["write", "a"]);
  assert.equal(r.c.pending, 3);
  assert.equal(r.s.revision, 10);
  assert.equal(r.param("vcf1", "res"), 0.3);
  assert.deepEqual(order, []);
  assert.equal(r.events.length, 0);
  g.open();
  const [a, b, c] = (await Promise.all([save, set, get])) as [SuccessResponse, SuccessResponse, SuccessResponse];
  assert.deepEqual(order, ["save", "param.set", "patch.get"]);
  assert.equal(a.ok && b.ok && c.ok, true);
  assert.equal(a.revision, 10);
  assert.equal(b.revision, 11);
  assert.equal(c.revision, 11);
  // ファイルは保存の時点の内容(後から来た param.set の前)
  assert.equal(r.file("a").modules.find((m) => m.id === "vcf1")!.params.res, 0.3);
  // 保存時刻などは param.set の前に付いている
  const got = c.result.patch as Patch;
  assert.equal(got.meta.modified_at, T0);
  assert.equal(got.modules.find((m) => m.id === "vcf1")!.params.res, 0.9);
  assert.deepEqual(r.events.map((e) => e.event), ["library.changed", "patch.changed"]);
  assert.equal(r.c.pending, 0);
});

test("直列化: 読込の読出しを待つ間に来た変更は、読込の後のパッチに適用される(expected_revision も読込の後の値で判定)", async () => {
  const r = rig();
  await r.ok("agent", "patch.save", { name: "p0" });
  await r.ok("human", "module.add", { type: "MOD-LFO-001", id: "lfo1" });
  const g = gate();
  r.store.before = (op) => (op === "read" ? g.wait : undefined);
  const load = r.send("agent", "patch.load", { name: "p0" });
  // 読込の前のリビジョン(11)を前提にした変更と、読込の後(12)を前提にした変更
  const stale = r.send("human", "param.set", { module_id: "lfo1", param: "freq", value: 0.5 }, { expected_revision: 11 });
  const fresh = r.send("human", "param.set", { module_id: "vcf1", param: "res", value: 0.9 }, { expected_revision: 12 });
  const gone = r.send("human", "param.set", { module_id: "lfo1", param: "freq", value: 0.5 });
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(r.s.revision, 11, "読込はまだ適用されていない");
  g.open();
  const [a, b, c, d] = await Promise.all([load, stale, fresh, gone]);
  assert.equal(a.ok, true);
  assert.equal(a.revision, 12);
  expectError(b as FailureResponse, "ERR-008");
  assert.equal(c.ok, true);
  assert.equal(c.revision, 13);
  expectError(d as FailureResponse, "ERR-102"); // lfo1 は読込で置き換わってなくなった
  assert.equal(r.param("vcf1", "res"), 0.9);
  assert.equal(r.s.getPatch().modules.some((m) => m.id === "lfo1"), false);
});

test("直列化: 同時に来た2つの保存は順に処理する(同じ名前の2つ目は ERR-203、エージェントの上書きの判定は1つ目の後のファイルで行う)", async () => {
  const r = rig();
  const g = gate();
  r.store.before = () => g.wait;
  const a = r.send("human", "patch.save", { name: "a" });
  const b = r.send("agent", "patch.save", { name: "a" });
  const c = r.send("agent", "patch.save", { name: "a", overwrite: true });
  const d = r.send("agent", "patch.list");
  for (let i = 0; i < 5; i++) await tick();
  g.open();
  const [ra, rb, rc, rd] = await Promise.all([a, b, c, d]);
  assert.equal(ra.ok, true);
  expectError(rb as FailureResponse, "ERR-203");
  expectError(rc as FailureResponse, "ERR-005");
  assert.equal(((rd as SuccessResponse).result.patches as unknown[]).length, 1);
  assert.deepEqual(r.file("a").meta.saved_by, { kind: "human" });
});

test("直列化: 待っている間に呼出し側が要求のオブジェクトを書き換えても、受け取った時点の内容で処理する", async () => {
  const r = rig();
  const g = gate();
  r.store.before = () => g.wait;
  const first = r.send("agent", "patch.save", { name: "a" });
  const req = { v: 1, request_id: "m", command: "param.set", args: { module_id: "vcf1", param: "res", value: 0.5 } };
  const second = r.c.handle(req, "agent");
  req.args.value = 0.99;
  g.open();
  await first;
  assert.equal((await second).ok, true);
  assert.equal(r.param("vcf1", "res"), 0.5);
});

test("§10: 通知は応答の後。deliver を渡すと、応答を渡してから通知を出す(保存のコマンドも、それ以外も)", async () => {
  const r = rig();
  const log: string[] = [];
  r.c.subscribe((ev) => log.push(ev.event));
  const deliver = (res: CommandResponse) => log.push(`response:${res.command}`);
  const req = (command: string, args?: Record<string, unknown>) => ({ v: 1, request_id: `d-${++counter}`, command, ...(args ? { args } : {}) });
  await r.c.handle(req("patch.save", { name: "a" }), "human", deliver);
  await r.c.handle(req("output.set_level", { level_db: -6 }), "human", deliver);
  await r.c.handle(req("patch.load", { name: "a" }), "agent", deliver);
  await r.c.handle(req("param.set", { module_id: "vcf1", param: "res", value: 0.9 }), "agent", deliver);
  await r.c.handle(req("patch.delete", { name: "a" }), "human", deliver);
  await r.c.handle(req("patch.load", { name: "a" }), "agent", deliver);
  assert.deepEqual(log, [
    "response:patch.save",
    "library.changed",
    "response:output.set_level",
    "output.changed",
    "response:patch.load",
    "patch.changed",
    "output.changed",
    "response:param.set",
    "patch.changed",
    "response:patch.delete",
    "library.changed",
    "response:patch.load",
  ]);
});

test("保存のコマンド以外は Session.handle と同じ結果(応答の形、リビジョン、通知)", async () => {
  const r = rig();
  const viaController = await r.c.handle({ v: 1, request_id: "x", command: "param.set", args: { module_id: "vcf1", param: "res", value: 0.9 }, client_id: "a" }, "agent");
  const direct = rig();
  const viaSession = direct.s.handle({ v: 1, request_id: "x", command: "param.set", args: { module_id: "vcf1", param: "res", value: 0.9 }, client_id: "a" }, "agent");
  assert.deepEqual(viaController, viaSession);
  assert.deepEqual(r.events, direct.events);
  // 封筒が壊れた要求・未定義のコマンド
  expectError((await r.c.handle("not an object", "agent")) as FailureResponse, "ERR-001");
  expectError((await r.c.handle({ v: 1, request_id: "y", command: "patch.rename" }, "agent")) as FailureResponse, "ERR-002");
  expectError((await r.c.handle({ v: 1, request_id: "y", command: "engine.start" }, "agent")) as FailureResponse, "ERR-005");
});

// =====================================================================================
// 保存先の失敗(ERR-207)
// =====================================================================================

test("ERR-207: 保存先が失敗を返した・例外になった場合。状態(パッチ・meta・リビジョン・履歴)は変わらず、通知も出ない", async () => {
  for (const mode of ["result", "throw"] as const) {
    const r = rig();
    await r.ok("agent", "patch.save", { name: "a" });
    await r.ok("human", "param.set", { module_id: "vcf1", param: "res", value: 0.9 });
    r.clock.now = T1;
    const body = r.store.get("a");
    const breakOp = (op: "list" | "read" | "write" | "remove") => {
      r.store.failOn.clear();
      r.store.throwOn.clear();
      if (mode === "result") r.store.failOn.set(op, "failed");
      else r.store.throwOn.add(op);
    };
    await unchanged(r, async () => {
      const cases: ["list" | "read" | "write" | "remove", ActorKind, string, Record<string, unknown> | undefined][] = [
        ["read", "agent", "patch.save", { name: "b" }], // 同名の有無の確認
        ["list", "agent", "patch.save", { name: "b" }], // ファイル数の確認
        ["write", "agent", "patch.save", { name: "b" }],
        ["write", "human", "patch.save", { name: "a", overwrite: true }],
        ["read", "agent", "patch.load", { name: "a" }],
        ["list", "agent", "patch.list", undefined],
        ["read", "agent", "patch.read", { name: "a" }],
        ["remove", "human", "patch.delete", { name: "a" }],
      ];
      for (const [op, actor, command, args] of cases) {
        breakOp(op);
        const res = await r.fail(actor, command, args);
        expectError(res, "ERR-207");
        assert.equal(typeof res.error.details.reason, "string", JSON.stringify(res.error));
        assert.equal(res.revision, 11);
      }
    });
    assert.equal(r.store.get("a"), body);
    assert.equal(r.store.has("b"), false);
    assert.equal(r.s.getPatch().meta.modified_at, T0, "失敗した保存は meta を変えない");
    // 失敗の後も、窓口は次の要求を処理できる
    r.store.failOn.clear();
    r.store.throwOn.clear();
    await r.ok("agent", "patch.save", { name: "b" });
  }
});

// =====================================================================================
// EngineBackend(実際のエンジン+出力保護)
// =====================================================================================

const FS = 48000;

interface AudioRig {
  s: Session;
  be: EngineBackend;
  c: Controller;
  store: MemoryPatchStore;
  events: ControllerEvent[];
  ok(actor: ActorKind, command: string, args?: Record<string, unknown>): Promise<SuccessResponse>;
  fail(actor: ActorKind, command: string, args?: Record<string, unknown>): Promise<FailureResponse>;
  /** frames サンプルを処理して左チャンネルを返す。 */
  render(frames: number): Float32Array;
}

function audioRig(): AudioRig {
  const be = new EngineBackend(FS, REGISTRY);
  const s = new Session({ catalog: CATALOG, backend: be, sessionId: "s-audio" });
  const store = new MemoryPatchStore({ now: () => new Date(T0) });
  const c = new Controller({ session: s, store, now: () => new Date(T0) });
  const events: ControllerEvent[] = [];
  c.subscribe((ev) => events.push(ev));
  const send = (actor: ActorKind, command: string, args?: Record<string, unknown>) =>
    c.handle({ v: 1, request_id: `q-${++counter}`, command, ...(args ? { args } : {}) }, actor);
  return {
    s,
    be,
    c,
    store,
    events,
    async ok(actor, command, args) {
      const r = await send(actor, command, args);
      assert.equal(r.ok, true, `${command} が失敗: ${JSON.stringify(r)}`);
      return r as SuccessResponse;
    },
    async fail(actor, command, args) {
      const r = await send(actor, command, args);
      assert.equal(r.ok, false, `${command} は失敗するはず: ${JSON.stringify(r)}`);
      return r as FailureResponse;
    },
    render(frames) {
      const L = new Float32Array(frames);
      const R = new Float32Array(frames);
      for (let i = 0; i < frames; i += 128) be.processBlock(L.subarray(i, i + 128), R.subarray(i, i + 128));
      return L;
    },
  };
}

const peak = (b: Float32Array): number => b.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
/** 負 → 正のゼロ交差の数(周波数の目安)。 */
const risings = (b: Float32Array): number => {
  let n = 0;
  for (let i = 1; i < b.length; i++) if (b[i - 1]! < 0 && b[i]! >= 0) n++;
  return n;
};
const bits = (b: Float32Array): number[] => Array.from(new Uint32Array(b.buffer, b.byteOffset, b.length));

/** VCO(saw)を出力へつないだだけの、鳴り続けるパッチを組む。 */
async function buildTone(r: AudioRig): Promise<void> {
  await r.ok("human", "module.add", { type: "MOD-OSC-001", id: "vco1" });
  await r.ok("human", "cable.connect", { from: { module: "vco1", port: "sine" }, to: { module: "out", port: "IN_L" } });
  await r.ok("human", "param.set", { module_id: "out", param: "level", value: 0.5 });
}

test("EngineBackend AX-01: 保存 → 変更 → 復元で、音が保存時のものに戻る(構成とパラメータの一致が音に現れる)", async () => {
  const r = audioRig();
  await buildTone(r);
  await r.ok("human", "engine.start");
  r.render(FS / 5);
  const original = r.render(FS / 5);
  assert.ok(peak(original) > 0.001, `鳴っている: ${peak(original)}`);
  const f0 = risings(original);
  // ① 保存
  const saved = await r.ok("agent", "patch.save", { name: "tone" });
  // 保存は音を変えない(エンジンを作り直さない)
  assert.equal(risings(r.render(FS / 5)), f0);
  // ② 変更: 1オクターブ上げる
  await r.ok("agent", "param.set", { module_id: "vco1", param: "tune", value: 1 });
  r.render(FS / 5);
  const changed = r.render(FS / 5);
  const f1 = risings(changed);
  assert.ok(f1 > f0 * 1.8 && f1 < f0 * 2.2, `1オクターブ上: ${f0} → ${f1}`);
  // ③ 復元
  const loaded = await r.ok("agent", "patch.load", { name: "tone" });
  assert.equal(loaded.revision, saved.revision + 2);
  assert.equal(loaded.result.migrated, null);
  r.render(FS / 5);
  const restored = r.render(FS / 5);
  assert.equal(risings(restored), f0, "読込後は保存時の高さに戻る");
  assert.ok(Math.abs(peak(restored) - peak(original)) < peak(original) * 0.01, "音量も同じ");
  // エンジンに反映済みのリビジョン(§11.3)
  const status = await r.ok("agent", "engine.get_status");
  assert.equal(status.result.engine_revision, loaded.revision);
  // 読込を取り消すと、変更後の音に戻る
  await r.ok("human", "history.undo");
  r.render(FS / 5);
  assert.equal(risings(r.render(FS / 5)), f1);
});

test("EngineBackend: 読込後のエンジンは初期状態から始まり、同じパッチを直接組んだ場合とビット同一(COM-10)", async () => {
  const a = audioRig();
  await buildTone(a);
  await a.ok("human", "engine.start");
  a.render(FS / 10);
  await a.ok("agent", "patch.save", { name: "tone" });
  await a.ok("agent", "patch.new");
  const silent = a.render(FS / 10);
  assert.equal(peak(silent), 0, "空のパッチは無音");
  await a.ok("agent", "patch.load", { name: "tone" });
  const afterLoad = a.render(FS / 5);
  assert.ok(peak(afterLoad) > 0.001, "読込後に音が出る");
  // 基準: 別のセッションで、同じファイルを JSON で読んでから音声を開始する
  const b = audioRig();
  await b.ok("agent", "patch.load", { patch: JSON.parse(a.store.get("tone")!) as Record<string, unknown> });
  await b.ok("human", "engine.start");
  assert.deepEqual(bits(afterLoad), bits(b.render(FS / 5)));
});

test("EngineBackend AX-16 相当: 読込で音量は上がらない(既定値より下げていればそのまま、上げていれば既定値まで下がる)", async () => {
  const r = audioRig();
  await buildTone(r);
  await r.ok("human", "engine.start");
  await r.ok("agent", "patch.save", { name: "tone" });
  const D = r.be.status().levelDb;
  // 既定値より 10 dB 下げた状態(AX-16 の前提)
  await r.ok("human", "output.set_level", { level_db: D - 10 });
  r.render(FS / 5);
  const quiet = peak(r.render(FS / 5));
  r.events.length = 0;
  await r.ok("agent", "patch.load", { name: "tone" });
  let status = await r.ok("agent", "engine.get_status");
  assert.deepEqual(
    [(status.result.output as { level_db: number }).level_db, (status.result.output as { agent_max_level_db: number }).agent_max_level_db],
    [D - 10, D - 10],
  );
  assert.equal(ofEvent(r.events, "output.changed").length, 0, "値が変わらないので EVT-03 は出ない");
  // 読込の直後は無音からフェードインし、定常でも読込の前を超えない
  const fadeIn = r.render(128);
  assert.ok(Math.abs(fadeIn[0]!) < quiet * 0.05, `読込の直後は無音から: ${fadeIn[0]}`);
  r.render(FS / 5);
  const afterQuiet = peak(r.render(FS / 5));
  assert.ok(afterQuiet <= quiet * 1.001, `読込で音量が上がらない: ${quiet} → ${afterQuiet}`);
  assert.ok(afterQuiet > quiet * 0.9, "下がりもしない");
  // 既定値より上げた状態: 読込で既定値まで下がる。上限は変わらない
  await r.ok("human", "output.set_level", { level_db: D + 10 });
  r.render(FS / 5);
  const loud = peak(r.render(FS / 5));
  r.events.length = 0;
  await r.ok("agent", "patch.load", { name: "tone" });
  status = await r.ok("agent", "engine.get_status");
  assert.deepEqual(
    [(status.result.output as { level_db: number }).level_db, (status.result.output as { agent_max_level_db: number }).agent_max_level_db],
    [D, D + 10],
  );
  assert.deepEqual(
    ofEvent(r.events, "output.changed").map((e) => (e.data as { reason: string; level_db: number }).reason),
    ["reset_to_default"],
  );
  r.render(FS / 5);
  const afterLoud = peak(r.render(FS / 5));
  assert.ok(afterLoud < loud * 0.5, `既定値まで下がる: ${loud} → ${afterLoud}`);
  // 保存は音量を変えない
  await r.ok("human", "output.set_level", { level_db: D + 5 });
  await r.ok("agent", "patch.save", { name: "tone2" });
  assert.equal(r.be.status().levelDb, D + 5);
});

test("EngineBackend AX-12 / DAT-40: 無効なパッチの読込・保存先の失敗では、鳴っている音が変わらない", async () => {
  const r = audioRig();
  await buildTone(r);
  await r.ok("human", "engine.start");
  await r.ok("agent", "patch.save", { name: "tone" });
  r.render(FS / 5);
  // 基準: 何もせずに続けた場合の出力
  const ref = audioRig();
  await buildTone(ref);
  await ref.ok("human", "engine.start");
  ref.render(FS / 5);
  const before = r.s.getPatch();
  expectError(
    await r.fail("agent", "patch.load", {
      patch: {
        format: "modular-synth-patch",
        schema_version: 1,
        modules: [
          { id: "out", type: "MOD-IO-001", spec_version: "0.2" },
          { id: "x1", type: "MOD-XYZ-999", spec_version: "0.1" },
        ],
        cables: [],
      },
    }),
    "ERR-204",
  );
  r.store.put("broken", DX["DX-06"]!.text);
  expectError(await r.fail("agent", "patch.load", { name: "broken" }), "ERR-204");
  r.store.failOn.set("read", "failed");
  expectError(await r.fail("agent", "patch.load", { name: "tone" }), "ERR-207");
  assert.deepEqual(r.s.getPatch(), before);
  assert.deepEqual(bits(r.render(FS / 10)), bits(ref.render(FS / 10)), "エンジンは作り直されず、音は続く");
});

test("EngineBackend: 音声未開始(stopped)でも保存・読込は成功し、開始後は読み込んだパッチが鳴る(§11.4)", async () => {
  const r = audioRig();
  await buildTone(r);
  const saved = await r.ok("agent", "patch.save", { name: "tone" });
  assert.equal(saved.audio_state, "stopped");
  await r.ok("agent", "patch.new");
  const loaded = await r.ok("agent", "patch.load", { name: "tone" });
  assert.equal(loaded.audio_state, "stopped");
  assert.equal(peak(r.render(1280)), 0, "開始前は無音");
  await r.ok("human", "engine.start");
  assert.ok(peak(r.render(FS / 5)) > 0.001);
});
