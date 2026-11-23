// エージェントの演奏: 楽譜の予約(score.play / score.stop / score.get_status)と、人からの指示(prompt.send)。
// operation-contract §6.2(CMD-26〜29、EVT-07)、verification-plan VER-A-009。
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToWorklet, WorkletStatus } from "../src/audio/messages.js";
import { WorkletBackend } from "../src/audio/worklet-backend.js";
import { WorkletCore } from "../src/audio/worklet-core.js";
import { EngineBackend } from "../src/control/backend.js";
import { buildCatalog } from "../src/control/catalog.js";
import { SCORE_LIMITS, parseScore, scoreEvents } from "../src/control/performance.js";
import { RecordingBackend, Session } from "../src/control/session.js";
import type { ActorKind, CommandResponse, FailureResponse, PerformanceStatus, SessionEvent, SuccessResponse } from "../src/control/types.js";
import { REGISTRY } from "../src/modules/registry.js";

const FS = 48000;
const LEAD = Math.round(SCORE_LIMITS.leadSeconds * FS);
const CATALOG = buildCatalog(REGISTRY);
type Args = Record<string, unknown>;
let n = 0;

function rig(be: EngineBackend | RecordingBackend = new EngineBackend(FS, REGISTRY), withMidi = true) {
  const s = new Session({ catalog: CATALOG, backend: be, sessionId: "s-perf" });
  const events: SessionEvent[] = [];
  s.subscribe((e) => events.push(e));
  const send = (actor: ActorKind, command: string, args?: Args, extra: Args = {}): CommandResponse =>
    s.handle({ v: 1, request_id: `p-${++n}`, command, ...(args ? { args } : {}), ...extra }, actor);
  const ok = (actor: ActorKind, command: string, args?: Args, extra: Args = {}): SuccessResponse => {
    const r = send(actor, command, args, extra);
    assert.equal(r.ok, true, `${command}: ${JSON.stringify(r)}`);
    return r as SuccessResponse;
  };
  const fail = (actor: ActorKind, command: string, args?: Args): FailureResponse => {
    const r = send(actor, command, args);
    assert.equal(r.ok, false, `${command} は失敗するはず: ${JSON.stringify(r)}`);
    return r as FailureResponse;
  };
  if (withMidi) ok("agent", "module.add", { id: "midi", type: "MOD-IO-002" }); // 単音(voices = 1)
  if (be instanceof EngineBackend) ok("human", "engine.start");
  const perf = (kind?: string) => events.filter((e) => e.event === "performance.changed" && (!kind || (e.data as { reason: string }).reason === kind));
  return { s, be, events, send, ok, fail, perf };
}

/** 1サンプルずつ処理して、MIDI-CV の GATE(チャンネル ch)が high かを記録する。添字 = 処理したサンプルの通算。 */
function gateTrace(be: EngineBackend, samples: number, block = 1, ch = 0): boolean[] {
  const out: boolean[] = [];
  const mod = (be as unknown as { engine: { get(id: string): { output(n: string): { values: Float32Array } } } }).engine;
  const L = new Float32Array(block);
  const R = new Float32Array(block);
  for (let i = 0; i < samples; i += block) {
    be.processBlock(L, R);
    for (let k = 0; k < block; k++) out.push(mod.get("midi").output("GATE").values[ch]! > 1); // ブロックの終わりの値(block=1 のとき毎サンプル)
  }
  return out;
}
const edges = (g: boolean[]): { on: number[]; off: number[] } => {
  const on: number[] = [];
  const off: number[] = [];
  for (let i = 1; i < g.length; i++) {
    if (g[i] && !g[i - 1]) on.push(i);
    if (!g[i] && g[i - 1]) off.push(i);
  }
  return { on, off };
};

// ---- VER-A-009a 時刻 ----

test("VER-A-009a 楽譜の音符は、楽譜の中の位置から計算したサンプルちょうどで MIDI-CV に届く(予約がなければ 0.1 秒後に始まる)", () => {
  const r = rig();
  const res = r.ok("agent", "score.play", { notes: [{ t: 0, dur: 0.25, note: 60 }, { t: 0.5, dur: 0.125, note: 62 }] });
  assert.equal(res.result.score_id, 1);
  assert.equal(res.result.starts_in, 0.1);
  assert.equal(res.result.ends_in, 0.725);
  assert.equal(res.revision, 1, "演奏ではリビジョンが変わらない(1 は MIDI-CV の追加の分)");
  const e = edges(gateTrace(r.be as EngineBackend, FS));
  assert.deepEqual(e.on, [LEAD, LEAD + 24000]);
  assert.deepEqual(e.off, [LEAD + 12000, LEAD + 24000 + 6000]);
});

test("VER-A-009a tempo_bpm を付けると単位が拍になる。ピッチは MIDI ノート番号どおり(60 = 0 V、72 = 1 V)", () => {
  const r = rig();
  r.ok("agent", "score.play", { tempo_bpm: 120, notes: [{ t: 0, dur: 1, note: 72 }, { t: 2, dur: 1, note: 60 }], length: 4 });
  const be = r.be as EngineBackend;
  const e = edges(gateTrace(be, 3 * FS));
  assert.deepEqual(e.on, [LEAD, LEAD + FS]); // 2 拍 = 1 秒
  assert.deepEqual(e.off, [LEAD + FS / 2, LEAD + FS + FS / 2]);
  const r2 = rig();
  r2.ok("agent", "score.play", { notes: [{ t: 0, dur: 1, note: 72 }] });
  gateTrace(r2.be as EngineBackend, LEAD + 100);
  const pitch = (r2.be as unknown as { engine: { get(id: string): { output(n: string): { values: Float32Array } } } }).engine.get("midi").output("PITCH").values[0];
  assert.equal(pitch, 1);
});

test("VER-A-009a ブロック長 1 と 128 で、出力がビット同一(予約はサンプル単位で、ブロックの区切りに依らない)", () => {
  const render = (block: number): number[] => {
    const r = rig();
    r.ok("agent", "module.add", { id: "vco", type: "MOD-OSC-001" });
    r.ok("agent", "module.add", { id: "vca", type: "MOD-AMP-001" });
    r.ok("agent", "batch", {
      ops: [
        { command: "cable.connect", args: { from: { module: "midi", port: "PITCH" }, to: { module: "vco", port: "pitch" } } },
        { command: "cable.connect", args: { from: { module: "vco", port: "saw" }, to: { module: "vca", port: "in1" } } },
        { command: "cable.connect", args: { from: { module: "midi", port: "GATE" }, to: { module: "vca", port: "cv1" } } },
        { command: "cable.connect", args: { from: { module: "vca", port: "out" }, to: { module: "out", port: "IN_L" } } },
      ],
    });
    r.ok("agent", "score.play", { notes: [{ t: 0.0123, dur: 0.05, note: 57 }, { t: 0.0701, dur: 0.03, note: 64 }, { t: 0.0701, dur: 0.08, note: 67 }] });
    const be = r.be as EngineBackend;
    const out = new Float32Array(12800);
    const R = new Float32Array(12800);
    for (let i = 0; i < out.length; i += block) be.processBlock(out.subarray(i, i + block), R.subarray(i, i + block));
    assert.ok(out.some((v) => v !== 0), "音が出ている");
    return Array.from(new Uint32Array(out.buffer));
  };
  assert.deepEqual(render(1), render(128));
});

// ---- VER-A-009b 続き ----

test("VER-A-009b 演奏中に次の楽譜を送ると、前の楽譜の末尾と同じサンプルから始まる(間も重なりもない)", () => {
  const r = rig();
  const be = r.be as EngineBackend;
  r.ok("agent", "score.play", { notes: [{ t: 0, dur: 0.1, note: 60 }], length: 0.5 });
  const first = gateTrace(be, 12000); // 0.25 秒進める(演奏の途中)
  const st = r.ok("agent", "score.get_status").result as unknown as PerformanceStatus;
  assert.equal(st.playing, true);
  assert.equal(st.remaining, 0.35);
  const second = r.ok("agent", "score.play", { notes: [{ t: 0, dur: 0.1, note: 62 }, { t: 0.25, dur: 0.1, note: 64 }], length: 0.5 });
  assert.equal(second.result.score_id, 2);
  assert.equal(second.result.starts_in, 0.35);
  assert.equal(second.result.remaining, 0.85);
  assert.equal(second.result.queued_scores, 2);
  const e = edges([...first, ...gateTrace(be, FS)]);
  const end1 = LEAD + FS / 2;
  assert.deepEqual(e.on, [LEAD, end1, end1 + 12000]);
  // 3つ目も同じ規則で続く。予約が尽きた後に送った楽譜は、今から 0.1 秒後
  const now = be.sampleNow();
  assert.equal((r.ok("agent", "score.get_status").result as unknown as PerformanceStatus).playing, false);
  r.ok("agent", "score.play", { notes: [{ t: 0, dur: 0.01, note: 60 }] });
  assert.deepEqual(edges(gateTrace(be, FS / 2)).on.map((i) => i + now), [now + LEAD]);
});

test("VER-A-009b 楽譜の末尾の音符と、続きの楽譜の先頭の同じ音は、切れてから鳴り直す(ノートオフが先)。音符は次の楽譜へはみ出せる", () => {
  type Midi = { at: number; bytes: number[] };
  const ev = scoreEvents([{ t: 0, dur: 1, note: 60, vel: 100, ch: 1 }], 1000, FS).concat(scoreEvents([{ t: 0, dur: 1, note: 60, vel: 100, ch: 1 }], 1000 + FS, FS)) as Midi[];
  ev.sort((a, b) => a.at - b.at || (a.bytes[0]! & 0x10) - (b.bytes[0]! & 0x10));
  assert.deepEqual(ev.map((e) => [e.at, e.bytes[0]]), [[1000, 0x90], [1000 + FS, 0x80], [1000 + FS, 0x90], [1000 + 2 * FS, 0x80]]);
  // はみ出す音符: length は最後の音符の開始以上ならよい
  const p = parseScore({ notes: [{ t: 0.9, dur: 0.5, note: 60 }], length: 1 });
  assert.equal(p.lengthSeconds, 1);
  // 長さ 0 に丸まる音符でも、1 サンプルは鳴る
  const tiny = scoreEvents([{ t: 0, dur: 1e-9, note: 60, vel: 1, ch: 16 }], 5, FS);
  assert.deepEqual(tiny, [{ at: 5, bytes: [0x9f, 60, 1] }, { at: 6, bytes: [0x8f, 60, 0] }]);
});

// ---- VER-A-009c 置き換えと停止 ----

test("VER-A-009c replace は予約を捨てて今から始める。score.stop は予約を捨て、鳴っている音を止める", () => {
  const r = rig();
  const be = r.be as EngineBackend;
  r.ok("agent", "score.play", { notes: [{ t: 0, dur: 5, note: 60 }, { t: 6, dur: 1, note: 62 }] });
  const g = gateTrace(be, LEAD + 4800);
  assert.equal(g[g.length - 1], true, "鳴っている");
  const now = be.sampleNow();
  const rep = r.ok("agent", "score.play", { mode: "replace", notes: [{ t: 0.2, dur: 0.1, note: 70 }] });
  assert.equal(rep.result.queued_scores, 1);
  assert.equal(rep.result.starts_in, 0.1);
  const e = edges([true, ...gateTrace(be, FS)]);
  assert.deepEqual(e.off[0], 1, "置き換えた瞬間に、前の音が止まる");
  assert.deepEqual(e.on, [1 + LEAD + 9600], "前の楽譜の 2 つ目の音符は鳴らない");
  assert.equal(now + FS, be.sampleNow());
  r.ok("agent", "score.play", { notes: [{ t: 0, dur: 5, note: 60 }] });
  gateTrace(be, LEAD + 4800);
  r.events.length = 0;
  assert.deepEqual(r.ok("human", "score.stop").result, { stopped: true });
  assert.equal(be.scheduled, 0);
  assert.equal(gateTrace(be, 100).some((x) => x), false, "止まる");
  assert.equal(r.perf("stopped").length, 1);
  assert.deepEqual(r.ok("agent", "score.stop").result, { stopped: false }, "予約がなくても成功する");
  assert.equal(r.perf("stopped").length, 1, "捨てるものがなければ通知しない");
});

// ---- VER-A-009d 指示 ----

test("VER-A-009d 人の指示がエージェントに届き、ack_prompt を付けた楽譜で「反映済み」になる。エージェントは指示を送れない", () => {
  const r = rig();
  const e = r.fail("agent", "prompt.send", { text: "x" });
  assert.equal(e.error.id, "ERR-005");
  const p1 = r.ok("human", "prompt.send", { text: "  もっと静かに  " }).result.prompt as { id: number; text: string; acked: boolean };
  assert.deepEqual(p1, { id: 1, text: "もっと静かに", acked: false });
  r.ok("human", "prompt.send", { text: "テンポを落として" });
  const st = r.ok("agent", "score.get_status").result as unknown as PerformanceStatus;
  assert.deepEqual(st.prompts, [{ id: 1, text: "もっと静かに", acked: false }, { id: 2, text: "テンポを落として", acked: false }]);
  const sent = r.perf("prompt_sent");
  assert.equal(sent.length, 2);
  assert.equal((sent[1]!.data as { actor: { kind: string } }).actor.kind, "human");
  assert.equal((sent[1]!.data as unknown as PerformanceStatus).prompts.length, 2);
  // 1 件目だけを踏まえた楽譜
  const played = r.ok("agent", "score.play", { notes: [{ t: 0, dur: 1, note: 60, vel: 30 }], ack_prompt: 1 });
  assert.deepEqual((played.result.prompts as { id: number; acked: boolean }[]).map((p) => [p.id, p.acked]), [[1, true], [2, false]]);
  assert.equal(r.perf("prompt_acked").length, 1);
  // 既に反映済みのものを指しても、通知は増えない
  r.ok("agent", "score.play", { notes: [{ t: 0, dur: 1, note: 60 }], ack_prompt: 1 });
  assert.equal(r.perf("prompt_acked").length, 1);
  // 指示は 20 件まで保持する
  for (let i = 0; i < 25; i++) r.ok("human", "prompt.send", { text: `指示 ${i}` });
  const many = (r.ok("agent", "score.get_status").result as unknown as PerformanceStatus).prompts;
  assert.equal(many.length, 20);
  assert.equal(many[19]!.text, "指示 24");
  // 入力の検査
  for (const [args, reason] of [[{}, "missing"], [{ text: 1 }, "type"], [{ text: "   " }, "empty"], [{ text: "あ".repeat(501) }, "too_long"], [{ text: "x", y: 1 }, "unknown_key"]] as [Args, string][]) {
    const f = r.fail("human", "prompt.send", args);
    assert.equal(f.error.id, "ERR-003");
    assert.equal(f.error.details.reason, reason);
  }
  assert.equal(r.ok("human", "prompt.send", { text: "あ".repeat(500) }).ok, true);
});

// ---- VER-A-009e 安全性 ----

test("VER-A-009e 音声が動作中でない・緊急停止中は演奏できない(ERR-301)。緊急停止で予約は捨てられ、解除の後に続きが鳴らない", () => {
  const stopped = rig(new RecordingBackend({ audioState: "stopped" }));
  const f = stopped.fail("agent", "score.play", { notes: [{ t: 0, dur: 1, note: 60 }] });
  assert.equal(f.error.id, "ERR-301");
  assert.deepEqual((stopped.be as RecordingBackend).calls.filter((c) => c[0] === "scheduleMidi"), []);

  const r = rig();
  const be = r.be as EngineBackend;
  r.ok("agent", "score.play", { notes: [{ t: 0, dur: 0.5, note: 60 }, { t: 1, dur: 0.5, note: 62 }, { t: 2, dur: 0.5, note: 64 }] });
  gateTrace(be, LEAD + 4800);
  r.events.length = 0;
  r.ok("agent", "engine.panic");
  assert.equal(be.scheduled, 0, "音声側の予約も捨てる");
  assert.equal(r.perf("stopped").length, 1);
  assert.equal((r.ok("agent", "score.get_status").result as unknown as PerformanceStatus).playing, false);
  const during = r.fail("agent", "score.play", { notes: [{ t: 0, dur: 1, note: 60 }] });
  assert.equal(during.error.id, "ERR-301");
  assert.equal(during.error.details.panic, true);
  r.ok("human", "engine.release_panic");
  assert.equal(gateTrace(be, 3 * FS).some((x) => x), false, "解除の後、続きは鳴らない");
  // 解除の後は、また演奏できる
  r.ok("agent", "score.play", { notes: [{ t: 0, dur: 0.1, note: 60 }] });
  assert.equal(edges(gateTrace(be, FS)).on.length, 1);
});

test("VER-A-009e 音声が止まった・中断したら、予約を捨てて知らせる。演奏はリビジョンと履歴を変えない。パッチの置き換えでは予約を捨てない", () => {
  const be = new RecordingBackend({ audioState: "running" });
  const r = rig(be);
  const rev = r.s.revision;
  r.ok("agent", "score.play", { notes: [{ t: 0, dur: 100, note: 60 }] });
  r.ok("human", "prompt.send", { text: "a" });
  assert.equal(r.s.revision, rev);
  assert.deepEqual(r.s.history, { can_undo: true, can_redo: false });
  r.ok("human", "history.undo"); // MIDI-CV の追加が戻る(演奏は履歴にない)
  assert.equal(r.s.getPatch().modules.length, 1);
  assert.equal(r.s.performance.playing, true);
  r.ok("agent", "patch.new");
  assert.equal(r.s.performance.playing, true, "パッチの置き換えでは捨てない");
  r.events.length = 0;
  be.audioState = "suspended";
  r.s.pollBackend();
  assert.equal(r.s.performance.playing, false);
  const stopped = r.perf("stopped");
  assert.equal(stopped.length, 1);
  assert.equal((stopped[0]!.data as { actor: unknown }).actor, null);
  assert.ok(be.calls.some((c: unknown[]) => c[0] === "clearSchedule"));
});

test("VER-A-009g 演奏し終えると、状態の確認(pollBackend)で EVT-07(finished)が1回出る", () => {
  const r = rig();
  const be = r.be as EngineBackend;
  r.ok("agent", "score.play", { notes: [{ t: 0, dur: 0.1, note: 60 }], length: 0.2 });
  r.events.length = 0;
  gateTrace(be, 4800);
  r.s.pollBackend();
  assert.equal(r.perf("finished").length, 0, "まだ途中");
  gateTrace(be, 2 * LEAD + 9600);
  r.s.pollBackend();
  r.s.pollBackend();
  const fin = r.perf("finished");
  assert.equal(fin.length, 1);
  assert.deepEqual({ playing: (fin[0]!.data as unknown as PerformanceStatus).playing, remaining: (fin[0]!.data as unknown as PerformanceStatus).remaining }, { playing: false, remaining: 0 });
});

// ---- VER-A-009f 入力の検査 ----

test("VER-A-009f score.play の検証エラーと、その順。失敗では何も予約しない", () => {
  const r = rig();
  const be = r.be as EngineBackend;
  const N = { t: 0, dur: 1, note: 60 };
  const cases: [Args, string, Args?][] = [
    [{}, "ERR-003", { arg: "notes", reason: "missing" }],
    [{ notes: {} }, "ERR-003", { arg: "notes", reason: "type" }],
    [{ notes: [N], extra: 1 }, "ERR-003", { arg: "extra", reason: "unknown_key" }],
    [{ notes: [1] }, "ERR-003", { arg: "notes[0]", reason: "type" }],
    [{ notes: [{ t: 0, dur: 1 }] }, "ERR-003", { arg: "notes[0].note", reason: "missing" }],
    [{ notes: [{ ...N, pitch: 1 }] }, "ERR-003", { arg: "notes[0].pitch", reason: "unknown_key" }],
    [{ notes: [{ ...N, t: "0" }] }, "ERR-003", { arg: "notes[0].t", reason: "type" }],
    [{ notes: [{ ...N, dur: Infinity }] }, "ERR-003", { arg: "notes[0].dur", reason: "type" }],
    [{ notes: [{ ...N, note: 60.5 }] }, "ERR-122", { arg: "notes[0].note" }],
    [{ notes: [{ ...N, vel: 1.5 }] }, "ERR-122", { arg: "notes[0].vel" }],
    [{ notes: [N], mode: "now" }, "ERR-003", { arg: "mode", reason: "unknown_value" }],
    [{ notes: [N], ack_prompt: 1.5 }, "ERR-122", { arg: "ack_prompt" }],
    [{ notes: [] }, "ERR-003", { arg: "length", reason: "missing" }],
    [{ notes: Array.from({ length: 2001 }, () => N) }, "ERR-106", { limit: "score_notes", max: 2000 }],
    [{ notes: [N], tempo_bpm: 19 }, "ERR-123", { arg: "tempo_bpm" }],
    [{ notes: [{ ...N, t: -0.1 }] }, "ERR-123", { arg: "notes[0].t" }],
    [{ notes: [{ ...N, dur: 0 }] }, "ERR-123", { arg: "notes[0].dur" }],
    [{ notes: [{ ...N, note: 128 }] }, "ERR-123", { arg: "notes[0].note" }],
    [{ notes: [{ ...N, vel: 0 }] }, "ERR-123", { arg: "notes[0].vel" }],
    [{ notes: [{ ...N, ch: 17 }] }, "ERR-123", { arg: "notes[0].ch" }],
    [{ notes: [{ ...N, t: 601 }] }, "ERR-123", { arg: "notes[0].t" }],
    [{ notes: [{ ...N, t: 5 }], length: 4 }, "ERR-123", { arg: "length" }],
    [{ notes: [N], length: 601 }, "ERR-123", { arg: "length" }],
    [{ notes: [N], ack_prompt: -1 }, "ERR-123", { arg: "ack_prompt" }],
  ];
  for (const [args, id, details] of cases) {
    const f = r.fail("agent", "score.play", args);
    assert.equal(f.error.id, id, JSON.stringify(args).slice(0, 80));
    for (const [k, v] of Object.entries(details ?? {})) assert.deepEqual(f.error.details[k], v, `${JSON.stringify(args).slice(0, 60)}: ${k}`);
  }
  // 順: 形の誤り(ERR-003)が、値の範囲(ERR-123)より先。値の範囲が、音声の状態(ERR-301)より先
  assert.equal(r.fail("agent", "score.play", { notes: [{ ...N, note: 999 }, { t: 0 }] }).error.id, "ERR-003");
  assert.equal(be.scheduled, 0);
  assert.equal(r.perf().length, 0);
  const stopped = rig(new RecordingBackend({ audioState: "stopped" }));
  assert.equal(stopped.fail("agent", "score.play", { notes: [{ ...N, note: 999 }] }).error.id, "ERR-123");
  // 境界の値は通る
  r.ok("agent", "score.play", { notes: [{ t: 0, dur: 0.001, note: 0, vel: 1, ch: 16 }, { t: 600, dur: 0.001, note: 127, vel: 127, ch: 1 }], length: 600, mode: "replace" });
});

test("VER-A-009f 上限: 予約済みの音符の合計(10000)と、予約できる時間(900 秒)。超えた楽譜は予約されない", () => {
  const r = rig(new RecordingBackend({ audioState: "running" }));
  const notes = Array.from({ length: 2000 }, (_, i) => ({ t: i * 0.01, dur: 0.005, note: 60 }));
  for (let i = 0; i < 5; i++) r.ok("agent", "score.play", { notes, length: 20 });
  const f = r.fail("agent", "score.play", { notes: [{ t: 0, dur: 1, note: 60 }] });
  assert.equal(f.error.id, "ERR-106");
  assert.equal(f.error.details.limit, "queued_notes");
  assert.equal(r.s.performance.scores.length, 5);
  r.ok("agent", "score.stop");
  r.ok("agent", "score.play", { notes: [], length: 600 });
  const g = r.fail("agent", "score.play", { notes: [], length: 400 });
  assert.equal(g.error.id, "ERR-106");
  assert.equal(g.error.details.limit, "score_horizon_seconds");
  assert.equal(r.ok("agent", "score.play", { notes: [], length: 200 }).result.remaining, 800.1);
});

test("冪等キーを付けた score.play は、再送しても二重に予約しない。MIDI-CV がないパッチでは注意(no_midi_module)が付く", () => {
  const be = new RecordingBackend({ audioState: "running" });
  const r = rig(be, false);
  const a = r.ok("agent", "score.play", { notes: [{ t: 0, dur: 1, note: 60 }] }, { idempotency_key: "k" });
  assert.deepEqual(a.warnings.map((w) => w.code), ["no_midi_module"]);
  const b = r.ok("agent", "score.play", { notes: [{ t: 0, dur: 1, note: 60 }] }, { idempotency_key: "k" });
  assert.equal(b.replayed, true);
  assert.equal(b.result.score_id, 1);
  assert.equal(be.calls.filter((c) => c[0] === "scheduleMidi").length, 1);
  assert.equal(r.s.performance.scores.length, 1);
  // 人も演奏できる(同じ規則)
  const h = r.ok("human", "score.play", { notes: [{ t: 0, dur: 1, note: 60 }] });
  assert.equal(h.result.score_id, 2);
  assert.equal((r.s.performance.scores[1]!.actor as { kind: string }).kind, "human");
});

// ---- ワークレット経由(メインスレッド側は、音声側の時刻を見積もる) ----

test("ワークレット経由: 予約がメッセージで届き、見積もった時刻から 0.1 秒後に始まる。続きは前の楽譜の末尾ちょうど。緊急停止で音声側の予約も消える", () => {
  let clock = 0;
  const wb = new WorkletBackend({ clock: () => clock });
  const received: ToWorklet[] = [];
  const core = new WorkletCore(FS, REGISTRY, () => undefined);
  const port = {
    postMessage(m: ToWorklet): void {
      const copy = JSON.parse(JSON.stringify(m)) as ToWorklet;
      received.push(copy);
      core.onMessage(copy);
    },
  };
  const render = (samples: number): void => {
    const L = new Float32Array(128);
    for (let i = 0; i < samples; i += 128) core.process(L, new Float32Array(128));
    wb.onMessage({ type: "status", status: JSON.parse(JSON.stringify(core.status())) as WorkletStatus });
  };
  wb.attach(port, FS);
  const r = rig(wb as unknown as EngineBackend);
  r.ok("human", "engine.start");
  render(12800);
  clock = 20; // 最後の状態から 20 ms 経った
  const now = wb.sampleNow();
  assert.equal(now, 12800 + 960);
  const a = r.ok("agent", "score.play", { notes: [{ t: 0, dur: 0.5, note: 60 }], length: 1 });
  assert.equal(a.result.starts_in, 0.1);
  const sched = received.filter((m) => m.type === "schedule") as { type: "schedule"; events: { at: number; bytes: number[] }[] }[];
  assert.deepEqual(sched[0]!.events, [{ at: now + LEAD, bytes: [0x90, 60, 100] }, { at: now + LEAD + 24000, bytes: [0x80, 60, 0] }]);
  clock = 40;
  r.ok("agent", "score.play", { notes: [{ t: 0, dur: 0.5, note: 62 }] });
  assert.equal(sched.length, 1);
  const again = received.filter((m) => m.type === "schedule") as typeof sched;
  assert.equal(again[1]!.events[0]!.at, now + LEAD + FS, "続きは、前の楽譜の末尾ちょうど(時刻の見積もりに依らない)");
  assert.equal(core.be.scheduled, 4);
  r.ok("agent", "engine.panic");
  assert.equal(core.be.scheduled, 0);
  render(1280);
  assert.equal(wb.desyncCount, 0);
});

// ---- 楽譜の中のパラメータの変化(CMD-26 の params) ----

function paramRig() {
  const r = rig();
  r.ok("agent", "module.add", { id: "vcf", type: "MOD-FLT-001", params: { cutoff: 1 } });
  r.ok("agent", "module.add", { id: "amp", type: "MOD-AMP-001" });
  const be = r.be as EngineBackend;
  const raw = (id: string, name: string): number => {
    be.flush();
    return (be as unknown as { engine: { get(id: string): { getRawParam(n: string): number } } }).engine.get(id).getRawParam(name);
  };
  const run = (samples: number): void => {
    const L = new Float32Array(1);
    for (let i = 0; i < samples; i++) be.processBlock(L, new Float32Array(1));
  };
  const patchValue = (id: string, name: string): number => r.s.getPatch().modules.find((m) => m.id === id)!.params[name]!;
  return { ...r, be, raw, run, patchValue };
}

test("楽譜にパラメータの変化を書ける: 書いた位置のサンプルちょうどで音声側の値が変わる。パッチ・リビジョン・履歴は変わらない", () => {
  const r = paramRig();
  const rev = r.s.revision;
  r.ok("agent", "score.play", { notes: [{ t: 0, dur: 2, note: 60 }], params: [{ t: 0.5, module_id: "vcf", param: "cutoff", value: 3 }, { t: 1, module_id: "vcf", param: "res", value: 0.5 }] });
  r.run(LEAD + 24000 - 1);
  assert.equal(r.raw("vcf", "cutoff"), 1, "位置の 1 サンプル前は元の値");
  r.run(1);
  // 位置のサンプルを処理する直前に変わる(そのサンプルから新しい値)
  r.run(1);
  assert.equal(r.raw("vcf", "cutoff"), 3);
  assert.equal(r.raw("vcf", "res"), 0);
  r.run(24000);
  assert.equal(r.raw("vcf", "res"), 0.5);
  assert.equal(r.be.overridden, 2);
  assert.equal(r.patchValue("vcf", "cutoff"), 1, "パッチの値は変わらない");
  assert.equal(r.s.revision, rev);
  assert.equal((r.ok("agent", "module.get", { module_id: "vcf" }).result.module as { params: Record<string, number> }).params.cutoff, 1);
});

test("dur を付けると、その長さをかけて直線で動く(1 サンプルごと)。ブロック長 1 と 128 で同じ値になる", () => {
  const sample = (block: number): number[] => {
    const r = paramRig();
    r.ok("agent", "score.play", { notes: [], length: 2, params: [{ t: 0, dur: 1, module_id: "vcf", param: "cutoff", value: 5 }] });
    const out: number[] = [];
    const L = new Float32Array(block);
    for (let i = 0; i < (LEAD + FS + 1280) / block; i++) {
      r.be.processBlock(L, new Float32Array(block));
      if (((i + 1) * block) % 1280 === 0) out.push(r.raw("vcf", "cutoff"));
    }
    return out;
  };
  const a = sample(1);
  assert.deepEqual(a, sample(128));
  // 1280 サンプルごとの値: 始まる前は 1、動いている間は直線、終わった後は 5
  a.forEach((v, i) => {
    const done = (i + 1) * 1280 - LEAD; // 変化が始まってから処理したサンプル数
    const expected = done <= 0 ? 1 : done >= FS ? 5 : 1 + (4 * done) / FS;
    assert.ok(Math.abs(v - expected) < 1e-9, `${(i + 1) * 1280} サンプル目: ${v}(期待 ${expected})`);
  });
  assert.equal(a[0], 1);
  assert.equal(a[a.length - 1], 5);
  for (let i = 1; i < a.length; i++) assert.ok(a[i]! >= a[i - 1]!, "単調に増える");
});

test("演奏が終わる・止まる・緊急停止すると、楽譜が動かしたパラメータはパッチの値へ戻る。続きの楽譜がある間は戻らない", () => {
  const r = paramRig();
  r.ok("agent", "score.play", { notes: [], length: 0.2, params: [{ t: 0, module_id: "vcf", param: "cutoff", value: 4 }] });
  r.run(LEAD + 100);
  assert.equal(r.raw("vcf", "cutoff"), 4);
  // 続きを送る: 区切りをまたいでも戻らない
  r.ok("agent", "score.play", { notes: [], length: 0.2 });
  r.run(9600);
  r.s.pollBackend();
  assert.equal(r.raw("vcf", "cutoff"), 4, "演奏が続いている間は、動かした値のまま");
  r.run(9600 + LEAD);
  r.s.pollBackend(); // 演奏し終えた(EVT-07 finished)
  assert.equal(r.raw("vcf", "cutoff"), 1, "終わるとパッチの値に戻る");
  assert.equal(r.be.overridden, 0);
  // 止める
  r.ok("agent", "score.play", { notes: [], length: 5, params: [{ t: 0, module_id: "vcf", param: "cutoff", value: -2 }, { t: 0, dur: 4, module_id: "vcf", param: "res", value: 1 }] });
  r.run(LEAD + 4800);
  assert.equal(r.raw("vcf", "cutoff"), -2);
  assert.ok(r.raw("vcf", "res") > 0 && r.raw("vcf", "res") < 1, "動いている途中");
  r.ok("agent", "score.stop");
  assert.equal(r.raw("vcf", "cutoff"), 1);
  assert.equal(r.raw("vcf", "res"), 0);
  r.run(4800);
  assert.equal(r.raw("vcf", "res"), 0, "止めた後は動かない");
  // 緊急停止
  r.ok("agent", "score.play", { notes: [], length: 5, params: [{ t: 0, module_id: "vcf", param: "cutoff", value: 2 }] });
  r.run(LEAD + 10);
  r.ok("agent", "engine.panic");
  assert.equal(r.raw("vcf", "cutoff"), 1);
});

test("演奏中に param.set でパッチの値を変えたら、パッチの側が優先される(演奏の後に戻す先もその値)", () => {
  const r = paramRig();
  r.ok("agent", "score.play", { notes: [], length: 1, params: [{ t: 0, module_id: "vcf", param: "cutoff", value: 4 }, { t: 0, dur: 0.9, module_id: "vcf", param: "res", value: 1 }] });
  r.run(LEAD + 100);
  r.ok("human", "param.set", { module_id: "vcf", param: "cutoff", value: 2.5 });
  r.ok("human", "param.set", { module_id: "vcf", param: "res", value: 0.2 });
  r.run(100);
  assert.equal(r.raw("vcf", "cutoff"), 2.5);
  assert.equal(r.raw("vcf", "res"), 0.2, "進行中の変化も止まる");
  r.run(FS + LEAD);
  r.s.pollBackend();
  assert.equal(r.raw("vcf", "cutoff"), 2.5);
  assert.equal(r.raw("vcf", "res"), 0.2);
  // モジュールを削除しても、予約済みの変化で落ちない
  r.ok("agent", "score.play", { notes: [], length: 1, params: [{ t: 0.5, module_id: "amp", param: "gain", value: 1 }] });
  r.ok("agent", "module.remove", { module_id: "amp" });
  assert.doesNotThrow(() => r.run(FS + LEAD));
  assert.equal(r.be.takeDesync(), null);
});

test("パラメータの変化の検査: 対象と値は param.set と同じ規則(ERR-102 / ERR-121 / ERR-122 / ERR-123)。失敗では何も予約しない", () => {
  const r = paramRig();
  const P = { t: 0, module_id: "vcf", param: "cutoff", value: 1 };
  const cases: [Record<string, unknown>, string][] = [
    [{ params: {} }, "ERR-003"],
    [{ params: [1] }, "ERR-003"],
    [{ params: [{ t: 0, module_id: "vcf", param: "cutoff" }] }, "ERR-003"],
    [{ params: [{ ...P, extra: 1 }] }, "ERR-003"],
    [{ params: [{ ...P, t: "0" }] }, "ERR-003"],
    [{ params: [{ ...P, module_id: 1 }] }, "ERR-003"],
    [{ params: Array.from({ length: 2001 }, () => P) }, "ERR-106"],
    [{ params: [{ ...P, t: -1 }] }, "ERR-123"],
    [{ params: [{ ...P, dur: -1 }] }, "ERR-123"],
    [{ params: [{ ...P, module_id: "nope" }] }, "ERR-102"],
    [{ params: [{ ...P, param: "nope" }] }, "ERR-121"],
    [{ params: [{ ...P, value: "high" }] }, "ERR-122"],
    [{ params: [{ ...P, value: 99 }] }, "ERR-123"],
    [{ params: [{ t: 0, module_id: "amp", param: "response", value: 0.5 }] }, "ERR-122"],
  ];
  for (const [extra, id] of cases) {
    const f = r.fail("agent", "score.play", { notes: [], length: 4, ...extra });
    assert.equal(f.error.id, id, JSON.stringify(extra).slice(0, 80));
  }
  assert.equal(r.be.scheduled, 0);
  assert.equal(r.perf().length, 0);
  // 整数・列挙のパラメータは、dur を付けても切り替えになる(途中の値を取らない)
  r.ok("agent", "score.play", { notes: [], length: 1, params: [{ t: 0, dur: 0.5, module_id: "amp", param: "response", value: 1 }] });
  r.run(LEAD + 2);
  assert.equal(r.raw("amp", "response"), 1);
  // 同じ位置では、パラメータの変化が音符より先に行われる
  const ev = scoreEvents([{ t: 0, dur: 1, note: 60, vel: 100, ch: 1 }], 0, FS, [{ t: 0, dur: 0, moduleId: "vcf", param: "cutoff", value: 2 }]);
  assert.deepEqual(ev.map((e) => ("param" in e ? "param" : e.bytes[0])), ["param", 0x90, 0x80]);
});

// ---- ミキサー卓(MOD-MIX-002)の読出し: エージェントが音を聞かずに配分を確かめる ----

test("meter.read でミキサー卓の全チャンネルの音量と帯域を 1 回で読める。読出し値を持たないモジュールは ERR-303、種別にない項目は ERR-003", () => {
  const r = rig();
  r.ok("agent", "batch", {
    ops: [
      { command: "module.add", args: { id: "lo", type: "MOD-OSC-001", params: { range: -2 } } }, // 約 65 Hz
      { command: "module.add", args: { id: "hi", type: "MOD-OSC-001", params: { range: 2, tune: 1 } } }, // 約 2093 Hz
      { command: "module.add", args: { id: "desk", type: "MOD-MIX-002", params: { "level[1]": 1, "level[2]": 0.25, "pan[2]": 1, window_ms: 100 } } },
      { command: "cable.connect", args: { from: { module: "lo", port: "sine" }, to: { module: "desk", port: "in1" } } },
      { command: "cable.connect", args: { from: { module: "hi", port: "sine" }, to: { module: "desk", port: "in2" } } },
      { command: "cable.connect", args: { from: { module: "desk", port: "L" }, to: { module: "out", port: "IN_L" } } },
      { command: "cable.connect", args: { from: { module: "desk", port: "R" }, to: { module: "out", port: "IN_R" } } },
    ],
  });
  const be = r.be as EngineBackend;
  const L = new Float32Array(128);
  for (let i = 0; i < 100; i++) be.processBlock(L, new Float32Array(128)); // 約 0.27 秒
  const got = r.ok("agent", "meter.read", { module_id: "desk" });
  const v = got.result.values as Record<string, number[]> & { windows: number; out_low: number; out_high: number };
  assert.deepEqual(Object.keys(v).sort(), ["ch_audible", "ch_high", "ch_low", "ch_mid", "ch_peak", "ch_rms", "out_high", "out_low", "out_mid", "out_peak", "out_rms", "send_peak", "send_rms", "windows"]);
  assert.ok(v.windows >= 2);
  // チャンネル 1(低い正弦波、音量 1): 実効値 約 3.54 V、低域が最大
  assert.ok(Math.abs(v.ch_rms[0]! - 5 / Math.SQRT2) < 0.05, String(v.ch_rms[0]));
  assert.ok(v.ch_low[0]! > v.ch_mid[0]! && v.ch_low[0]! > v.ch_high[0]!);
  // チャンネル 2(高い正弦波、音量 0.25): 実効値 約 0.88 V、高域が最大
  assert.ok(Math.abs(v.ch_rms[1]! - 1.25 / Math.SQRT2) < 0.02, String(v.ch_rms[1]));
  assert.ok(v.ch_high[1]! > v.ch_mid[1]! && v.ch_high[1]! > v.ch_low[1]!);
  assert.deepEqual(v.ch_rms.slice(2), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(v.ch_audible, [1, 1, 1, 1, 1, 1, 1, 1]);
  // 項目を選んで読む
  const some = r.ok("agent", "meter.read", { module_id: "desk", fields: ["ch_rms", "windows"] }).result.values as Record<string, unknown>;
  assert.deepEqual(Object.keys(some), ["ch_rms", "windows"]);
  // ソロを入れると、読出し値でも分かる(パッチを変えずに楽譜で一時的に入れる)
  r.ok("agent", "score.play", { notes: [], length: 1, params: [{ t: 0, module_id: "desk", param: "solo[2]", value: 1 }] });
  for (let i = 0; i < 120; i++) be.processBlock(L, new Float32Array(128));
  const solo = r.ok("agent", "meter.read", { module_id: "desk", fields: ["ch_audible", "ch_rms"] }).result.values as Record<string, number[]>;
  assert.deepEqual(solo.ch_audible, [0, 1, 0, 0, 0, 0, 0, 0]);
  assert.ok(solo.ch_rms[0]! < 0.01, "ソロでないチャンネルは消える");
  assert.equal(r.s.getPatch().modules.find((m) => m.id === "desk")!.params["solo[2]"], 0, "パッチの値は変わらない");
  // エラー
  assert.equal(r.fail("agent", "meter.read", { module_id: "lo" }).error.id, "ERR-303");
  assert.equal(r.fail("agent", "meter.read", { module_id: "desk", fields: ["level"] }).error.id, "ERR-003"); // MOD-IO-003 の項目
  assert.equal(r.fail("agent", "meter.read", { module_id: "desk", fields: ["nope"] }).error.id, "ERR-003");
  assert.equal(r.fail("agent", "meter.read", { module_id: "nope" }).error.id, "ERR-102");
  // module.list_types に読出し値の項目が載る
  const types = r.ok("agent", "module.list_types", { type: "MOD-MIX-002" }).result.types as { readouts: string[]; category: string }[];
  assert.ok(types[0]!.readouts.includes("ch_rms") && types[0]!.readouts.includes("out_low"));
});
