// メインスレッド側のバックエンド(WorkletBackend)が、ワークレット側(EngineBackend)と同じ状態を保つことの確認。
// 試験では MessagePort の代わりに、メッセージをそのまま EngineBackend へ渡す「同じプロセス内のワークレット」を使う。
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToWorklet, WorkletStatus } from "../src/audio/messages.js";
import { WorkletBackend } from "../src/audio/worklet-backend.js";
import { EngineBackend } from "../src/control/backend.js";
import { buildCatalog } from "../src/control/catalog.js";
import { Session } from "../src/control/session.js";
import type { SuccessResponse } from "../src/control/types.js";
import { REGISTRY } from "../src/modules/registry.js";

const FS = 48000;
const CATALOG = buildCatalog(REGISTRY);
const bits = (b: Float32Array): number[] => Array.from(new Uint32Array(b.buffer, b.byteOffset, b.length));

/** ワークレット(src/audio/worklet.ts)と同じ処理を、同じプロセス内で行う。 */
class FakeWorklet {
  readonly be = new EngineBackend(FS, REGISTRY);
  constructor(private readonly onStatus: (s: WorkletStatus) => void) {}
  postMessage(msg: ToWorklet): void {
    const be = this.be;
    switch (msg.type) {
      case "apply":
        return be.applyPatch(msg.patch, msg.revision);
      case "ops":
        for (const o of msg.ops) {
          if (o.op === "add") be.addModule(o.module);
          else if (o.op === "remove") be.removeModule(o.id);
          else if (o.op === "connect") be.connect(o.cable);
          else if (o.op === "disconnect") be.disconnect(o.cable);
          else be.setParam(o.id, o.name, o.value);
        }
        return be.commit(msg.revision);
      case "start":
        be.start();
        return;
      case "stop":
        return be.stop();
      case "panic":
        return be.panic();
      case "release_panic":
        be.releasePanic();
        return;
      case "level":
        be.setLevel(msg.db, msg.actor);
        return;
      case "midi":
        return be.midi(msg.bytes);
    }
  }
  render(frames: number): Float32Array {
    const L = new Float32Array(frames);
    const R = new Float32Array(frames);
    for (let i = 0; i < frames; i += 128) this.be.processBlock(L.subarray(i, i + 128), R.subarray(i, i + 128));
    const s = this.be.status();
    this.onStatus({
      fs: FS,
      sampleTime: s.sampleTime,
      running: s.audioState === "running",
      panic: s.panic,
      levelDb: s.levelDb,
      agentMaxLevelDb: s.agentMaxLevelDb,
      clipCount: s.clipCount,
      nonfiniteModules: s.nonfiniteModules,
      nonfiniteOutputStage: s.nonfiniteOutputStage,
      engineRevision: s.engineRevision ?? null,
      limiterGain: this.be.stage.status().limiterGain,
      peak: this.be.takePeak(),
      meters: this.be.meters(),
    });
    return L;
  }
}

interface St {
  levelDb: number;
  agentMaxLevelDb: number;
  panic: boolean;
  audioState: string;
}
interface Rig {
  s: Session;
  render(frames: number): Float32Array;
  status(): St;
  real(): St;
}

let n = 0;
function viaWorklet(): Rig {
  const wb = new WorkletBackend();
  const fake = new FakeWorklet((st) => wb.onMessage({ type: "status", status: st }));
  wb.attach(fake, FS);
  const s = new Session({ catalog: CATALOG, backend: wb, sessionId: "s-w" });
  return { s, render: (f) => fake.render(f), status: () => wb.status(), real: () => fake.be.status() };
}
function direct(): Rig {
  const be = new EngineBackend(FS, REGISTRY);
  const s = new Session({ catalog: CATALOG, backend: be, sessionId: "s-d" });
  const render = (frames: number): Float32Array => {
    const L = new Float32Array(frames);
    const R = new Float32Array(frames);
    for (let i = 0; i < frames; i += 128) be.processBlock(L.subarray(i, i + 128), R.subarray(i, i + 128));
    return L;
  };
  return { s, render, status: () => be.status(), real: () => be.status() };
}
const send = (r: Rig, actor: "human" | "agent", command: string, args?: Record<string, unknown>) =>
  r.s.handle({ v: 1, request_id: `w-${++n}`, command, ...(args ? { args } : {}) }, actor);

/** 人とエージェントの操作を混ぜた一連の操作。各段階の出力を集める。 */
function scenario(r: Rig): { audio: number[]; oks: boolean[] } {
  const audio: number[] = [];
  const oks: boolean[] = [];
  const go = (actor: "human" | "agent", command: string, args?: Record<string, unknown>): void => {
    oks.push(send(r, actor, command, args).ok);
  };
  const play = (frames: number): void => {
    audio.push(...bits(r.render(frames)));
  };
  go("agent", "module.add", { id: "pitch", type: "MOD-UTL-001", params: { gain: 0, offset: 0.25 } });
  go("human", "engine.start");
  go("agent", "module.add", { id: "vco", type: "MOD-OSC-001" });
  go("agent", "cable.connect", { from: { module: "pitch", port: "out" }, to: { module: "vco", port: "pitch" } });
  go("agent", "cable.connect", { from: { module: "vco", port: "saw" }, to: { module: "out", port: "IN_L" } });
  play(6400);
  go("human", "output.set_level", { level_db: -6 });
  go("agent", "output.set_level", { level_db: -3 }); // 上限を超えるので拒否される
  go("agent", "output.set_level", { level_db: -12 });
  play(6400);
  go("agent", "param.set", { module_id: "pitch", param: "offset", value: 0.5 });
  go("human", "history.undo");
  play(6400);
  go("agent", "engine.panic");
  play(1280);
  go("agent", "engine.release_panic"); // エージェントは解除できない
  go("human", "engine.release_panic");
  play(6400);
  go("human", "patch.new"); // 全体の置き換え(音量は引き下げ)
  go("agent", "module.add", { id: "n1", type: "MOD-NSE-001" });
  go("agent", "cable.connect", { from: { module: "n1", port: "out" }, to: { module: "out", port: "IN_L" } });
  play(6400);
  return { audio, oks };
}

test("WorkletBackend 経由の出力と各コマンドの成否が、EngineBackend を直接使う場合と一致(ビット同一)", () => {
  const a = scenario(viaWorklet());
  const b = scenario(direct());
  assert.deepEqual(a.oks, b.oks, "各コマンドの成否");
  assert.ok(a.audio.some((v) => v !== 0), "音が出ている");
  assert.deepEqual(a.audio, b.audio);
});

test("メインスレッド側が写している音量・上限・緊急停止の状態が、ワークレット側の実際の状態と一致し続ける", () => {
  const r = viaWorklet();
  const check = (what: string): void => {
    const m = r.status();
    const w = r.real();
    assert.equal(m.levelDb, w.levelDb, `${what}: 音量`);
    assert.equal(m.agentMaxLevelDb, w.agentMaxLevelDb, `${what}: 上限`);
    assert.equal(m.panic, w.panic, `${what}: 緊急停止`);
    assert.equal(m.audioState, w.audioState, `${what}: 音声状態`);
  };
  check("起動直後");
  send(r, "human", "engine.start");
  check("開始後");
  send(r, "human", "output.set_level", { level_db: -5 });
  check("人が音量を上げた後");
  send(r, "agent", "output.set_level", { level_db: -30 });
  check("エージェントが音量を下げた後");
  send(r, "human", "patch.new");
  check("パッチの置き換え後(引き下げ)");
  send(r, "agent", "engine.panic");
  check("緊急停止後");
  send(r, "human", "engine.release_panic");
  check("解除後");
});

test("音声の用意ができる前は engine.start が失敗し、状態は stopped のまま。編集はできる", () => {
  const wb = new WorkletBackend();
  const s = new Session({ catalog: CATALOG, backend: wb, sessionId: "s-x" });
  const r = s.handle({ v: 1, request_id: "x1", command: "engine.start" }, "human");
  assert.equal(r.ok, false);
  assert.equal(wb.status().audioState, "stopped");
  const ok = s.handle({ v: 1, request_id: "x2", command: "module.add", args: { type: "MOD-OSC-001" } }, "agent") as SuccessResponse;
  assert.equal(ok.ok, true, "音声が未開始でも編集はできる");
});
