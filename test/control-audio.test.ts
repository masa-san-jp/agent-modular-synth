// コマンド処理(Session)を実際の音声(エンジン+出力保護)につないだ確認。
// コマンドで組んだパッチと、同じ構成を直接組んだ場合で、出力がビット同一になること。
import assert from "node:assert/strict";
import { test } from "node:test";
import { AudioCore, DEMO_PATCH } from "../src/audio/core.js";
import { EngineBackend } from "../src/control/backend.js";
import { buildCatalog } from "../src/control/catalog.js";
import { Session } from "../src/control/session.js";
import type { CommandResponse, SuccessResponse } from "../src/control/types.js";
import { REGISTRY } from "../src/modules/registry.js";

const FS = 48000;
const CATALOG = buildCatalog(REGISTRY);
const bits = (b: Float32Array): number[] => Array.from(new Uint32Array(b.buffer, b.byteOffset, b.length));
const peak = (b: Float32Array): number => b.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

interface Rig {
  s: Session;
  be: EngineBackend;
  ok(actor: "human" | "agent", command: string, args?: Record<string, unknown>): SuccessResponse;
  send(actor: "human" | "agent", command: string, args?: Record<string, unknown>): CommandResponse;
  render(frames: number): Float32Array;
}

let n = 0;
function rig(): Rig {
  const be = new EngineBackend(FS, REGISTRY);
  const s = new Session({ catalog: CATALOG, backend: be, sessionId: "s-audio" });
  const send: Rig["send"] = (actor, command, args) =>
    s.handle({ v: 1, request_id: `q-${++n}`, command, ...(args ? { args } : {}) }, actor);
  const ok: Rig["ok"] = (actor, command, args) => {
    const r = send(actor, command, args);
    assert.equal(r.ok, true, `${command} が失敗: ${JSON.stringify(r)}`);
    return r as SuccessResponse;
  };
  const render = (frames: number): Float32Array => {
    const L = new Float32Array(frames);
    const R = new Float32Array(frames);
    for (let i = 0; i < frames; i += 128) be.processBlock(L.subarray(i, i + 128), R.subarray(i, i + 128));
    return L;
  };
  return { s, be, ok, send, render };
}

/** デモ用パッチ(DEMO_PATCH)と同じ構成を、人とエージェントが交互にコマンドで組む。 */
function buildByCommands(r: Rig): void {
  const add = (actor: "human" | "agent", id: string, type: string, params?: Record<string, number>): void => {
    r.ok(actor, "module.add", { id, type, ...(params ? { params } : {}) });
  };
  add("human", "pitch", "MOD-UTL-001", { gain: 0, offset: 0 });
  add("agent", "gate", "MOD-UTL-001", { gain: 0, offset: 0 });
  add("human", "vco", "MOD-OSC-001");
  add("agent", "env", "MOD-ENV-001", { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3 });
  add("human", "trim", "MOD-UTL-001", { gain: 0.5, offset: 0 });
  add("agent", "vca", "MOD-AMP-001");
  const con = (actor: "human" | "agent", from: string, to: string): void => {
    const [fm, fp] = from.split(".");
    const [tm, tp] = to.split(".");
    r.ok(actor, "cable.connect", { from: { module: fm, port: fp }, to: { module: tm, port: tp } });
  };
  con("agent", "pitch.out", "vco.pitch");
  con("human", "gate.out", "env.gate");
  con("agent", "vco.saw", "vca.in1");
  con("human", "env.env", "trim.in");
  con("agent", "trim.out", "vca.cv1");
  con("human", "vca.out", "out.IN_L");
}

/** 同じ構成を直接組んで鳴らした基準(AudioCore)。 */
function reference(frames: number, gateAt: number): Float32Array {
  const c = new AudioCore(FS, REGISTRY);
  c.loadPatch(DEMO_PATCH);
  c.start();
  const L = new Float32Array(frames);
  const R = new Float32Array(frames);
  for (let i = 0; i < frames; i += 128) {
    if (i === gateAt) c.setParam("gate", "offset", 10);
    c.processBlock(L.subarray(i, i + 128), R.subarray(i, i + 128));
  }
  return L;
}

test("音声の開始前にコマンドで組んだパッチ: 開始後の出力が、直接組んだ場合とビット同一", () => {
  const r = rig();
  buildByCommands(r); // 音声は stopped。エージェントも編集できる(REQ-A-008)
  assert.equal(peak(r.render(1280)), 0, "開始前は無音");
  assert.equal(r.send("agent", "engine.start").ok, false, "エージェントは音声を開始できない");
  r.ok("human", "engine.start");
  const a = r.render(1280);
  r.ok("agent", "param.set", { module_id: "gate", param: "offset", value: 10 });
  const b = r.render(24000 - 1280 + 64); // 128 の倍数に切り上げ
  const got = new Float32Array(a.length + b.length);
  got.set(a);
  got.set(b, a.length);
  const ref = reference(got.length, 1280);
  assert.ok(peak(got) > 0.01, "音が出ている");
  assert.deepEqual(bits(got), bits(ref));
});

test("音声が動いている間にコマンドで組んだパッチ(差分の適用): 直接組んだ場合とビット同一", () => {
  const r = rig();
  r.ok("human", "engine.start"); // 空のパッチで開始
  buildByCommands(r); // 差分として渡り、次のブロックの先頭でまとめて適用される
  const a = r.render(1280);
  r.ok("human", "param.set", { module_id: "gate", param: "offset", value: 10 });
  const b = r.render(12800);
  const got = new Float32Array(a.length + b.length);
  got.set(a);
  got.set(b, a.length);
  assert.deepEqual(bits(got), bits(reference(got.length, 1280)));
  const st = r.ok("agent", "engine.get_status");
  assert.equal((st.result as { engine_revision: number }).engine_revision, r.s.revision, "エンジンに最新のリビジョンが反映されている");
});

test("取り消し・やり直し・batch の全体取り消しが、音にも反映される", () => {
  const r = rig();
  r.ok("human", "engine.start");
  buildByCommands(r);
  r.ok("human", "output.set_level", { level_db: -20 });
  r.ok("human", "param.set", { module_id: "gate", param: "offset", value: 10 });
  assert.ok(peak(r.render(12800)) > 0.01);
  // ケーブルを抜くと無音、取り消すとまた鳴る
  const cables = (r.ok("agent", "patch.get").result as { patch: { cables: { id: string; to: { module: string } }[] } }).patch.cables;
  const toOut = cables.find((c) => c.to.module === "out")!;
  r.ok("agent", "cable.disconnect", { cable_id: toOut.id });
  r.render(1280);
  assert.equal(peak(r.render(6400)), 0, "出力へのケーブルを抜くと無音");
  r.ok("human", "history.undo");
  r.render(1280);
  assert.ok(peak(r.render(6400)) > 0.01, "取り消すとまた鳴る(エージェントの操作を人が取り消せる)");
  // 途中で失敗する batch は、パッチにも音にも影響しない
  const before = r.s.revision;
  const bad = r.send("agent", "batch", {
    ops: [
      { command: "cable.disconnect", args: { cable_id: toOut.id } },
      { command: "param.set", args: { module_id: "nope", param: "x", value: 1 } },
    ],
  });
  assert.equal(bad.ok, false);
  assert.equal(r.s.revision, before);
  r.render(1280);
  assert.ok(peak(r.render(6400)) > 0.01, "失敗した batch の後も鳴り続ける");
});

test("meter.read が実際の信号の値を返す。エージェントは人が決めた上限を超える音量にできない", () => {
  const r = rig();
  r.ok("human", "engine.start");
  r.ok("agent", "module.add", { id: "src", type: "MOD-UTL-001", params: { gain: 0, offset: 3 } });
  r.ok("agent", "module.add", { id: "mtr", type: "MOD-IO-003", params: { window_ms: 10 } });
  r.ok("agent", "cable.connect", { from: { module: "src", port: "out" }, to: { module: "mtr", port: "IN" } });
  r.render(4800);
  const m = r.ok("agent", "meter.read", { module_id: "mtr" }).result as { values: Record<string, number> };
  assert.ok(Math.abs(m.values.mean! - 3) < 1e-6, `mean=${m.values.mean}`);
  assert.ok(Math.abs(m.values.peak! - 3) < 1e-6);
  r.ok("human", "output.set_level", { level_db: -30 });
  assert.equal(r.send("agent", "output.set_level", { level_db: -10 }).ok, false);
  r.ok("agent", "output.set_level", { level_db: -40 });
});

test("緊急停止: エージェントが実行でき、無音になる。解除は人だけ", () => {
  const r = rig();
  r.ok("human", "engine.start");
  buildByCommands(r);
  r.ok("human", "param.set", { module_id: "gate", param: "offset", value: 10 });
  assert.ok(peak(r.render(12800)) > 0.01);
  r.ok("agent", "engine.panic");
  assert.equal(peak(r.render(6400)), 0);
  assert.equal(r.send("agent", "engine.release_panic").ok, false);
  r.ok("human", "engine.release_panic");
  assert.ok(peak(r.render(12800)) > 0.01, "パッチとパラメータは残っているので、解除後に鳴る");
});

test("真偽型のパラメータ(mute など)は 0 と 1 だけを受け付ける(操作契約 §12)", () => {
  const r = rig();
  const bad = r.send("agent", "param.set", { module_id: "out", param: "mute", value: 0.5 });
  assert.equal(bad.ok, false);
  assert.equal((bad as { error: { id: string } }).error.id, "ERR-122");
  r.ok("agent", "param.set", { module_id: "out", param: "mute", value: 1 });
  const types = (r.ok("agent", "module.list_types").result as { types: { type: string; params: { name: string; kind: string }[] }[] }).types;
  const mute = types.find((t) => t.type === "MOD-IO-001")!.params.find((p) => p.name === "mute")!;
  assert.equal(mute.kind, "bool");
});
