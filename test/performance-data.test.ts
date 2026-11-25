// 演奏データ: 演奏した楽譜の自動保存、一覧・読み出し・再演奏、演奏の長さの予定。
// operation-contract §6.3(CMD-30〜33、EVT-08)、data-contract §15、verification-plan VER-A-010。
import assert from "node:assert/strict";
import { test } from "node:test";
import { EngineBackend } from "../src/control/backend.js";
import { buildCatalog } from "../src/control/catalog.js";
import { Controller, ControllerEvent, MAX_PERFORMANCE_BYTES, PerformanceSavedEvent } from "../src/control/controller.js";
import { MemoryPatchStore } from "../src/control/memory-store.js";
import { PERFORMANCE_FORMAT, SCORE_LIMITS } from "../src/control/performance.js";
import { Session } from "../src/control/session.js";
import type { ActorKind, CommandResponse, FailureResponse, SuccessResponse } from "../src/control/types.js";
import { REGISTRY } from "../src/modules/registry.js";

const FS = 48000;
const LEAD = Math.round(SCORE_LIMITS.leadSeconds * FS);
const CATALOG = buildCatalog(REGISTRY);
type Args = Record<string, unknown>;
type Obj = Record<string, any>;
let n = 0;

/** 2026-11-23 21:04:05(その場所の時刻)。名前は 20261123-210405 になる。 */
const T0 = new Date(2026, 10, 23, 21, 4, 5).getTime();
const NAME = "20261123-210405";

function rig(opts: { store?: MemoryPatchStore | null } = {}) {
  const be = new EngineBackend(FS, REGISTRY);
  const session = new Session({ catalog: CATALOG, backend: be, sessionId: "s-pd" });
  const perfStore = opts.store === null ? undefined : (opts.store ?? new MemoryPatchStore({ maxBytes: MAX_PERFORMANCE_BYTES }));
  let clock = T0;
  const c = new Controller({ session, store: new MemoryPatchStore(), ...(perfStore ? { performanceStore: perfStore } : {}), now: () => clock });
  const events: ControllerEvent[] = [];
  c.subscribe((e) => events.push(e));
  const send = (actor: ActorKind, command: string, args?: Args): Promise<CommandResponse> =>
    c.handle({ v: 1, request_id: `pd-${++n}`, command, ...(args ? { args } : {}) }, actor);
  const ok = async (actor: ActorKind, command: string, args?: Args): Promise<SuccessResponse> => {
    const r = await send(actor, command, args);
    assert.equal(r.ok, true, `${command}: ${JSON.stringify(r)}`);
    return r as SuccessResponse;
  };
  const fail = async (actor: ActorKind, command: string, args?: Args): Promise<FailureResponse> => {
    const r = await send(actor, command, args);
    assert.equal(r.ok, false, `${command} は失敗するはず: ${JSON.stringify(r)}`);
    return r as FailureResponse;
  };
  /** 音声を進める(秒)。その後、状態の確認と、演奏データの保存。 */
  const run = async (seconds: number): Promise<void> => {
    const L = new Float32Array(4800);
    const R = new Float32Array(4800);
    for (let left = Math.round(seconds * FS); left > 0; left -= 4800) be.processBlock(left < 4800 ? L.subarray(0, left) : L, left < 4800 ? R.subarray(0, left) : R);
    session.pollBackend();
    await c.savePerformances();
  };
  const saved = (): PerformanceSavedEvent["data"][] => events.filter((e): e is PerformanceSavedEvent => e.event === "performance.saved").map((e) => e.data);
  const file = async (name: string): Promise<Obj> => {
    await c.savePerformances();
    const r = await perfStore!.read(name);
    assert.equal(r.ok, true, `演奏データ ${name} がある`);
    return JSON.parse((r as { value: { text: string } }).value.text) as Obj;
  };
  const names = async (): Promise<string[]> => ((await ok("agent", "performance.list")).result.performances as Obj[]).map((p) => p.name);
  return { be, session, c, events, send, ok, fail, run, saved, file, names, perfStore, tick: (ms: number) => (clock += ms) };
}

/** MIDI-CV → VCO → VCA → 出力 の、音が出るパッチ。 */
async function voice(r: ReturnType<typeof rig>): Promise<void> {
  await r.ok("agent", "batch", {
    ops: [
      { command: "module.add", args: { id: "midi", type: "MOD-IO-002" } },
      { command: "module.add", args: { id: "vco", type: "MOD-OSC-001" } },
      { command: "module.add", args: { id: "vcf", type: "MOD-FLT-001" } },
      { command: "module.add", args: { id: "vca", type: "MOD-AMP-001" } },
      { command: "cable.connect", args: { from: { module: "midi", port: "PITCH" }, to: { module: "vco", port: "pitch" } } },
      { command: "cable.connect", args: { from: { module: "vco", port: "saw" }, to: { module: "vcf", port: "in" } } },
      { command: "cable.connect", args: { from: { module: "vcf", port: "out" }, to: { module: "vca", port: "in1" } } },
      { command: "cable.connect", args: { from: { module: "midi", port: "GATE" }, to: { module: "vca", port: "cv1" } } },
      { command: "cable.connect", args: { from: { module: "vca", port: "out" }, to: { module: "out", port: "IN_L" } } },
    ],
  });
  await r.ok("human", "engine.start");
}

/** 音声を samples だけ進めて、左の出力を返す。 */
function render(be: EngineBackend, samples: number): Float32Array {
  const L = new Float32Array(samples);
  const R = new Float32Array(samples);
  for (let i = 0; i < samples; i += 128) be.processBlock(L.subarray(i, Math.min(samples, i + 128)), R.subarray(i, Math.min(samples, i + 128)));
  return L;
}

const SCORE_A = { tempo_bpm: 120, notes: [{ t: 0, dur: 0.5, note: 60 }, { t: 1, dur: 0.5, note: 67, vel: 90 }], params: [{ t: 0, dur: 1, module_id: "vcf", param: "cutoff", value: 3 }], length: 2 };
const SCORE_B = { notes: [{ t: 0, dur: 0.25, note: 72 }], length: 0.5 };

// ---- VER-A-010a 保存 ----

test("VER-A-010a 楽譜を送ると、日時つきの名前の演奏データが保存され、EVT-08 が出る。続きの楽譜で同じファイルが書き直される", async () => {
  const r = rig();
  await voice(r);
  await r.ok("agent", "score.play", { ...SCORE_A, mode: "append" });
  let f = await r.file(NAME);
  assert.equal(f.format, PERFORMANCE_FORMAT);
  assert.equal(f.schema_version, 1);
  assert.equal(f.started_at, new Date(T0).toISOString().replace(/\.\d{3}Z$/, "Z"));
  assert.equal(f.ended_at, null);
  assert.equal(f.ended_by, null);
  assert.equal(f.fs, FS);
  assert.equal(f.length_seconds, 1);
  assert.deepEqual(f.plan, { duration_seconds: null });
  assert.equal(f.entries.length, 1);
  assert.equal(f.entries[0].at, 0);
  assert.equal(f.entries[0].actor.kind, "agent");
  assert.deepEqual(f.entries[0].score, SCORE_A, "渡した楽譜がそのまま残る(mode と ack_prompt は除く)");
  assert.deepEqual(f.patch.modules.map((m: Obj) => m.id), ["out", "midi", "vco", "vcf", "vca"], "演奏を始めた時点のパッチ");
  assert.equal(f.patch.modules.find((m: Obj) => m.id === "vcf").params.cutoff !== undefined, true, "全パラメータを含む");
  assert.deepEqual(r.saved(), [{ name: NAME, ok: true, entries: 1, length_seconds: 1, closed: false }]);

  // 続き: 同じファイルに足される。位置は、前の楽譜の末尾
  await r.run(0.3);
  r.tick(5000);
  await r.ok("human", "score.play", SCORE_B);
  f = await r.file(NAME);
  assert.equal(f.entries.length, 2);
  assert.equal(f.entries[1].at, 1);
  assert.deepEqual(f.entries[1].actor.kind, "human");
  assert.equal(f.length_seconds, 1.5);
  assert.deepEqual(await r.names(), [NAME], "ファイルは 1 つ");
  assert.deepEqual(r.saved().at(-1), { name: NAME, ok: true, entries: 2, length_seconds: 1.5, closed: false });
});

test("VER-A-010a 同じ秒に始まった別の演奏は -2 が付く(上書きしない)。一覧は新しい順", async () => {
  const r = rig();
  await voice(r);
  await r.ok("agent", "score.play", SCORE_B);
  await r.ok("agent", "score.stop");
  await r.ok("agent", "score.play", SCORE_A);
  await r.ok("agent", "score.stop");
  r.tick(61_000);
  await r.ok("agent", "score.play", SCORE_B);
  assert.deepEqual(await r.names(), ["20261123-210506", `${NAME}-2`, NAME]);
  assert.deepEqual((await r.file(NAME)).entries[0].score, SCORE_B);
  assert.deepEqual((await r.file(`${NAME}-2`)).entries[0].score, SCORE_A);
});

// ---- VER-A-010b 演奏の区切り ----

test("VER-A-010b 止める・置き換える・緊急停止・音声の停止で演奏データが閉じ、次の楽譜は新しい演奏データになる", async () => {
  const r = rig();
  await voice(r);
  // 止める: 長さは、止めた時点まで
  await r.ok("agent", "score.play", SCORE_A);
  await r.run(0.5);
  r.tick(1000);
  await r.ok("agent", "score.stop");
  let f = await r.file(NAME);
  assert.equal(f.ended_by, "stopped");
  assert.equal(f.ended_at, new Date(T0 + 1000).toISOString().replace(/\.\d{3}Z$/, "Z"));
  assert.ok(Math.abs(f.length_seconds - 0.4) < 1e-9, `止めた時点まで: ${f.length_seconds}`);
  assert.equal(r.saved().at(-1)!.closed, true);
  // 置き換え
  r.tick(1000);
  await r.ok("agent", "score.play", SCORE_A);
  r.tick(1000);
  await r.ok("agent", "score.play", { ...SCORE_B, mode: "replace" });
  assert.equal((await r.file("20261123-210407")).ended_by, "replaced");
  // 緊急停止
  await r.ok("agent", "engine.panic");
  f = await r.file("20261123-210408");
  assert.equal(f.ended_by, "panic");
  await r.ok("human", "engine.release_panic");
  // 音声の停止
  r.tick(1000);
  await r.ok("agent", "score.play", SCORE_A);
  r.be.stop();
  r.session.pollBackend();
  assert.equal((await r.file("20261123-210409")).ended_by, "audio_stopped");
  assert.equal((await r.names()).length, 4);
});

test("VER-A-010b 演奏し終えて 30 秒以内の続きは同じ演奏データに入る(間は無音)。30 秒を過ぎたら閉じる", async () => {
  const r = rig();
  await voice(r);
  await r.ok("agent", "score.play", SCORE_B); // 0.5 秒
  await r.run(10.6); // 演奏し終えて 10 秒
  assert.equal((await r.file(NAME)).ended_by, null, "まだ閉じない");
  await r.ok("agent", "score.play", SCORE_B);
  let f = await r.file(NAME);
  assert.equal(f.entries.length, 2);
  assert.ok(Math.abs(f.entries[1].at - 10.6) < 1e-9, `続きの位置は実際に始まる位置: ${f.entries[1].at}`);
  await r.run(0.7 + SCORE_LIMITS.idleCloseSeconds);
  f = await r.file(NAME);
  assert.equal(f.ended_by, "finished");
  assert.ok(Math.abs(f.length_seconds - 11.1) < 1e-9);
  r.tick(60_000);
  await r.ok("agent", "score.play", SCORE_B);
  assert.equal((await r.names()).length, 2, "次の楽譜は新しい演奏データ");
});

test("VER-A-010h タブを閉じるときに記録中の演奏データを閉じる: 続きを待っている間なら finished、演奏中なら audio_stopped", async () => {
  const r = rig();
  await voice(r);
  // 演奏し終えて、続きを待っている間(30 秒以内)に閉じる
  await r.ok("agent", "score.play", SCORE_B); // 0.5 秒
  await r.run(5);
  assert.equal((await r.file(NAME)).ended_by, null, "まだ閉じていない");
  assert.equal(r.session.closePerformanceOnExit(), true);
  await r.c.savePerformances();
  let f = await r.file(NAME);
  assert.equal(f.ended_by, "finished");
  assert.equal(typeof f.ended_at, "string");
  assert.ok(Math.abs(f.length_seconds - 0.5) < 1e-9, `長さは演奏した分のまま: ${f.length_seconds}`);
  assert.equal(r.saved().at(-1)!.closed, true);
  assert.equal(r.session.closePerformanceOnExit(), false, "記録中の演奏がなければ何もしない");
  // 演奏中に閉じる: 長さは閉じた時点まで
  r.tick(60_000);
  await r.ok("agent", "score.play", { notes: [{ t: 0, dur: 4, note: 60 }], length: 4 });
  await r.run(1);
  assert.equal(r.session.closePerformanceOnExit(), true);
  await r.c.savePerformances();
  const second = (await r.names())[0]!;
  f = await r.file(second);
  assert.equal(f.ended_by, "audio_stopped");
  assert.ok(f.length_seconds > 0 && f.length_seconds < 4, `長さは閉じた時点まで: ${f.length_seconds}`);
});

test("VER-A-010i サーバーにつながっていない間の保存は控えておき、つながり直したら最新の状態を書く(閉じた印を含む)", async () => {
  const inner = new MemoryPatchStore({ maxBytes: MAX_PERFORMANCE_BYTES });
  let online = true;
  const writes: string[] = [];
  const store = {
    list: () => inner.list(),
    read: (name: string) => inner.read(name),
    remove: (name: string) => inner.remove(name),
    write: (name: string, text: string, overwrite: boolean) => {
      if (!online) return Promise.resolve({ ok: false as const, error: "unavailable" as const, message: "サーバーに接続していない" });
      writes.push(name);
      return inner.write(name, text, overwrite);
    },
  } as unknown as MemoryPatchStore;
  const r = rig({ store });
  await voice(r);
  // (1) 演奏中に切れる: 続きの楽譜は書けないが、保存はやめない。つながり直したら、続きまで入った状態を書く
  await r.ok("agent", "score.play", SCORE_B);
  await r.c.savePerformances();
  assert.equal((await r.file(NAME)).entries.length, 1);
  online = false;
  await r.ok("agent", "score.play", SCORE_B);
  await r.c.savePerformances();
  assert.equal(r.saved().filter((d) => !d.ok).length, 0, "つながっていないための失敗は、知らせない");
  assert.equal((await r.file(NAME)).entries.length, 1, "切れている間は書けていない");
  online = true;
  await r.c.retryPerformances();
  assert.equal((await r.file(NAME)).entries.length, 2, "つながり直したら、続きまで入る");
  // (2) 演奏し終えて続きを待っている間に切れ、その間に閉じる: つながり直したら、閉じた印が付く
  online = false;
  await r.run(2 + SCORE_LIMITS.idleCloseSeconds); // 2 つの楽譜は約 1.1 秒で終わる。その 30 秒後に閉じる
  assert.equal((await r.file(NAME)).ended_by, null, "切れている間は閉じた印が書けていない");
  online = true;
  await r.c.retryPerformances();
  const f = await r.file(NAME);
  assert.equal(f.ended_by, "finished");
  assert.equal(typeof f.ended_at, "string");
  assert.equal(r.saved().at(-1)!.closed, true);
  // (3) 書くものがなければ、つながり直しても書かない
  const n = writes.length;
  await r.c.retryPerformances();
  assert.equal(writes.length, n);
  // (4) 最初の保存から切れていても、つながり直したら日時つきの名前で新しく書く
  r.tick(60_000);
  online = false;
  await r.ok("agent", "score.play", SCORE_B);
  await r.c.savePerformances();
  assert.equal((await r.names()).length, 1);
  online = true;
  await r.c.retryPerformances();
  assert.equal((await r.names()).length, 2);
});

test("VER-A-010i つながっていない以外の失敗(保存先のエラー)では、今までどおり、その演奏の保存をやめる", async () => {
  const inner = new MemoryPatchStore({ maxBytes: MAX_PERFORMANCE_BYTES });
  let broken = false;
  const store = {
    list: () => inner.list(),
    read: (name: string) => inner.read(name),
    remove: (name: string) => inner.remove(name),
    write: (name: string, text: string, overwrite: boolean) =>
      broken ? Promise.resolve({ ok: false as const, error: "failed" as const, message: "書けない" }) : inner.write(name, text, overwrite),
  } as unknown as MemoryPatchStore;
  const r = rig({ store });
  await voice(r);
  await r.ok("agent", "score.play", SCORE_B);
  await r.c.savePerformances();
  broken = true;
  await r.ok("agent", "score.play", SCORE_B);
  await r.c.savePerformances();
  assert.equal(r.saved().at(-1)!.ok, false);
  assert.equal(r.saved().at(-1)!.reason, "failed");
  broken = false;
  await r.c.retryPerformances();
  await r.ok("agent", "score.play", SCORE_B);
  await r.c.savePerformances();
  assert.equal((await r.file(NAME)).entries.length, 1, "保存をやめた演奏は、直っても書かない");
});

// ---- VER-A-010c 再演奏 ----

test("VER-A-010c 再演奏: パッチが演奏データのものに置き換わり、元の演奏と同じ音がビット同一で出る。置き換えは取り消せる", async () => {
  const r = rig();
  await voice(r);
  await r.ok("agent", "param.set", { module_id: "vcf", param: "cutoff", value: 1.5 });
  await r.ok("agent", "score.play", SCORE_A);
  await r.ok("agent", "score.play", SCORE_B);
  const first = render(r.be, LEAD + 2 * FS);
  assert.ok(first.some((v) => Math.abs(v) > 0.01), "音が出ている");
  await r.run(0.1);
  await r.ok("agent", "score.stop");

  // パッチを変える(再演奏で元に戻るはず)
  await r.ok("agent", "param.set", { module_id: "vcf", param: "cutoff", value: -2 });
  await r.ok("agent", "module.remove", { module_id: "vco" });
  const before = (await r.ok("agent", "patch.get")).revision;
  r.tick(120_000);

  // 新しいエンジンの状態(発振の位相など)を揃えるため、別の Session で再演奏する = 保存した文字だけから再現できる
  const r2 = rig({ store: r.perfStore! });
  await r2.ok("human", "engine.start");
  const res = await r2.ok("agent", "performance.replay", { name: NAME });
  assert.deepEqual(res.result, { name: NAME, scores: 2, length_seconds: (await r.file(NAME)).length_seconds, migrated: null });
  const again = render(r2.be, LEAD + 2 * FS);
  assert.deepEqual(again, first, "同じパッチに同じ楽譜を同じ位置で予約すれば、同じ音(ビット同一)");

  // 同じ Session でも再演奏できる: パッチが戻り、履歴で取り消せる
  const back = await r.ok("agent", "performance.replay", { name: NAME });
  assert.equal(back.revision, before + 1);
  const patch = (await r.ok("agent", "patch.get")).result.patch as Obj;
  assert.deepEqual(patch.modules.map((m: Obj) => m.id), ["out", "midi", "vco", "vcf", "vca"]);
  assert.equal(patch.modules.find((m: Obj) => m.id === "vcf").params.cutoff, 1.5);
  const st = (await r.ok("agent", "score.get_status")).result as Obj;
  assert.equal(st.playing, true);
  assert.equal(st.scores.length, 2);
  // 再演奏も 1 つの演奏として残る
  const names = await r.names();
  assert.equal(names.length, 3);
  const rep = await r.file(names[0]!);
  assert.equal(rep.replay_of, NAME);
  assert.deepEqual(rep.entries.map((e: Obj) => e.at), [0, 1]);
  await r.ok("agent", "history.undo");
  assert.equal(((await r.ok("agent", "patch.get")).result.patch as Obj).modules.some((m: Obj) => m.id === "vco"), false, "置き換えを取り消せる");
});

test("VER-A-010c 元の演奏の途中でパッチが変わっていたら、印が残り、再演奏で注意が出る", async () => {
  const r = rig();
  await voice(r);
  await r.ok("agent", "score.play", SCORE_B);
  await r.ok("agent", "param.set", { module_id: "vcf", param: "res", value: 0.5 });
  await r.ok("agent", "score.play", SCORE_B);
  await r.ok("agent", "score.play", SCORE_B);
  const f = await r.file(NAME);
  assert.deepEqual(f.entries.map((e: Obj) => e.patch_changed ?? false), [false, true, false]);
  assert.equal(f.patch.modules.find((m: Obj) => m.id === "vcf").params.res !== 0.5, true, "パッチは、演奏を始めた時点のもの");
  const res = await r.ok("agent", "performance.replay", { name: NAME });
  assert.deepEqual(res.warnings.map((w) => w.code), ["patch_changes_ignored"]);
});

// ---- VER-A-010d 失敗 ----

test("VER-A-010d 再演奏の失敗: 名前がない・形式や版が違う・中身が不正・音声が動作中でない・楽譜が不正。パッチも予約も変わらない", async () => {
  const r = rig();
  await voice(r);
  await r.ok("agent", "score.play", SCORE_A);
  await r.ok("agent", "score.stop");
  const good = await r.file(NAME);
  const put = (name: string, doc: unknown): Promise<unknown> => r.perfStore!.write(name, typeof doc === "string" ? doc : JSON.stringify(doc), true);
  await put("x-format", { ...good, format: "modular-synth-patch" });
  await put("x-version", { ...good, schema_version: 2 });
  await put("x-empty", { ...good, entries: [] });
  await put("x-entry", { ...good, entries: [{ at: -1, score: {} }] });
  await put("x-json", "{");
  await put("x-patch", { ...good, patch: { ...good.patch, modules: [...good.patch.modules, { id: "z", type: "MOD-XYZ-999", spec_version: "0.1" }] } });
  await put("x-score", { ...good, entries: [good.entries[0], { at: 1, actor: good.entries[0].actor, score: { notes: [{ t: 0, dur: 1, note: 128 }] } }] });
  await put("x-param", { ...good, patch: { ...good.patch, modules: good.patch.modules.filter((m: Obj) => m.id !== "vcf"), cables: [] } });

  await r.ok("agent", "module.add", { id: "extra", type: "MOD-NSE-001" });
  const snap = async () => JSON.stringify([(await r.ok("agent", "patch.get")).result.patch, (await r.ok("agent", "patch.get")).revision, (await r.ok("agent", "score.get_status")).result.playing]);
  const s0 = await snap();
  const cases: [Args, string][] = [
    [{ name: "nothing" }, "ERR-202"],
    [{}, "ERR-003"],
    [{ name: "../x" }, "ERR-201"],
    [{ name: "x-format" }, "ERR-205"],
    [{ name: "x-version" }, "ERR-205"],
    [{ name: "x-empty" }, "ERR-204"],
    [{ name: "x-entry" }, "ERR-204"],
    [{ name: "x-json" }, "ERR-204"],
    [{ name: "x-patch" }, "ERR-204"],
    [{ name: "x-score" }, "ERR-123"],
    [{ name: "x-param" }, "ERR-102"], // 楽譜が動かすモジュールが、演奏データのパッチにない
  ];
  for (const [args, id] of cases) {
    const f = await r.fail("agent", "performance.replay", args);
    assert.equal(f.error.id, id, JSON.stringify(args));
    assert.equal(await snap(), s0, `${JSON.stringify(args)}: 何も変わらない`);
  }
  assert.equal(((await r.fail("agent", "performance.replay", { name: "x-score" })).error.details as Obj).entry, 1);
  assert.equal(((await r.fail("agent", "performance.replay", { name: "x-empty" })).error.details as Obj).issues[0].rule, "DAT-V19");
  // 音声が動作中でない
  r.be.stop();
  r.session.pollBackend();
  assert.equal((await r.fail("agent", "performance.replay", { name: NAME })).error.id, "ERR-301");
  assert.equal(JSON.parse(await snap())[1], JSON.parse(s0)[1], "パッチも変わらない");
  // 読み出しは、音声が止まっていてもできる
  assert.deepEqual((await r.ok("agent", "performance.read", { name: NAME })).result.performance, good);
  assert.equal((await r.fail("agent", "performance.read", { name: "nothing" })).error.id, "ERR-202");
  assert.equal((await r.fail("agent", "performance.read", { name: "x-json" })).error.id, "ERR-204");
});

test("VER-A-010d 保存の失敗では EVT-08(ok: false)が出て、演奏は続く。保存先がなければ performance.* は ERR-207", async () => {
  const store = new MemoryPatchStore({ maxBytes: MAX_PERFORMANCE_BYTES });
  const r = rig({ store });
  await voice(r);
  store.failOn.set("write", "failed");
  const res = await r.ok("agent", "score.play", SCORE_A);
  assert.equal(res.result.score_id, 1);
  await r.c.savePerformances();
  assert.deepEqual(r.saved(), [{ name: null, ok: false, entries: 1, length_seconds: 1, closed: false, reason: "failed" }]);
  store.failOn.clear();
  await r.ok("agent", "score.play", SCORE_B);
  await r.c.savePerformances();
  assert.equal(r.saved().length, 1, "失敗した演奏の保存は、やり直さない(途中からのデータを作らない)");
  assert.equal((await r.ok("agent", "score.get_status")).result.playing, true, "演奏は続いている");
  assert.deepEqual(await r.names(), []);
  // 大きすぎる
  const small = new MemoryPatchStore({ maxBytes: 600 });
  const r3 = rig({ store: small });
  await voice(r3);
  await r3.ok("agent", "score.play", SCORE_A);
  await r3.c.savePerformances();
  assert.equal(r3.saved()[0]!.ok, false);
  assert.equal(r3.saved()[0]!.reason, "too_large");

  const none = rig({ store: null });
  await voice(none);
  await none.ok("agent", "score.play", SCORE_A);
  for (const [cmd, args] of [["performance.list", {}], ["performance.read", { name: NAME }], ["performance.replay", { name: NAME }]] as [string, Args][]) {
    assert.equal((await none.fail("agent", cmd, args)).error.id, "ERR-207", cmd);
  }
  assert.deepEqual(none.saved(), []);
});

// ---- VER-A-010e 演奏の長さの予定 ----

test("VER-A-010e 演奏の長さの予定: score.get_status の plan と演奏データに載る。範囲外は ERR-123。予定を過ぎても演奏は止まらない", async () => {
  const r = rig();
  await voice(r);
  assert.deepEqual((await r.ok("agent", "score.get_status")).result.plan, { duration_seconds: null, elapsed_seconds: 0 });
  assert.deepEqual((await r.ok("agent", "performance.set_plan", { duration_seconds: 1 })).result.plan, { duration_seconds: 1, elapsed_seconds: 0 });
  const changed = r.events.filter((e) => e.event === "performance.changed" && (e.data as Obj).reason === "plan_changed");
  assert.equal(changed.length, 1);
  await r.ok("agent", "performance.set_plan", { duration_seconds: 1 });
  assert.equal(r.events.filter((e) => e.event === "performance.changed" && (e.data as Obj).reason === "plan_changed").length, 1, "同じ値では通知しない");
  for (const [args, id] of [[{}, "ERR-003"], [{ duration_seconds: "60" }, "ERR-003"], [{ duration_seconds: 0.5 }, "ERR-123"], [{ duration_seconds: 86401 }, "ERR-123"], [{ duration_seconds: 60, x: 1 }, "ERR-003"]] as [Args, string][]) {
    assert.equal((await r.fail("agent", "performance.set_plan", args)).error.id, id, JSON.stringify(args));
  }
  const played = await r.ok("agent", "score.play", SCORE_A);
  assert.equal((played.result as Obj).plan.duration_seconds, 1);
  assert.deepEqual((await r.file(NAME)).plan, { duration_seconds: 1 });
  await r.run(1.6);
  const st = (await r.ok("agent", "score.get_status")).result as Obj;
  assert.equal(st.plan.elapsed_seconds, 1.5, "演奏の先頭(最初の楽譜の開始)からの経過");
  await r.ok("agent", "score.play", SCORE_B);
  assert.equal((await r.ok("agent", "score.get_status")).result.playing, true, "予定を過ぎても演奏できる(予定は情報)");
  assert.equal(((await r.ok("human", "performance.set_plan", { duration_seconds: null })).result as Obj).plan.duration_seconds, null);
});
