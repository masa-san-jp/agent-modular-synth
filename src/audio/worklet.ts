// AudioWorkletProcessor。描画スレッドで動く(DEC-101)。エンジンと出力保護は EngineBackend に任せる。
// パッチの正本はメインスレッドの Session で、ここへは全体の置き換えか差分が届く。
import { EngineBackend } from "../control/backend.js";
import { REGISTRY } from "../modules/registry.js";
import { FromWorklet, ToWorklet } from "./messages.js";

// AudioWorkletGlobalScope の宣言(DOM の型定義に依存しないため最小限)
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: { postMessage(msg: unknown): void; onmessage: ((ev: { data: unknown }) => void) | null };
  constructor();
}

const STATUS_INTERVAL_SECONDS = 0.05;

class SynthProcessor extends AudioWorkletProcessor {
  private readonly be = new EngineBackend(sampleRate, REGISTRY);
  private sinceStatus = 0;
  private scratchR = new Float32Array(128);

  constructor() {
    super();
    this.port.onmessage = (ev) => this.onMessage(ev.data as ToWorklet);
  }

  private post(msg: FromWorklet): void {
    this.port.postMessage(msg);
  }

  private onMessage(msg: ToWorklet): void {
    try {
      const be = this.be;
      switch (msg.type) {
        case "apply":
          be.applyPatch(msg.patch, msg.revision);
          break;
        case "ops":
          for (const o of msg.ops) {
            if (o.op === "add") be.addModule(o.module);
            else if (o.op === "remove") be.removeModule(o.id);
            else if (o.op === "connect") be.connect(o.cable);
            else if (o.op === "disconnect") be.disconnect(o.cable);
            else be.setParam(o.id, o.name, o.value);
          }
          be.commit(msg.revision);
          break;
        case "start":
          be.start();
          break;
        case "stop":
          be.stop();
          break;
        case "panic":
          be.panic();
          break;
        case "release_panic":
          be.releasePanic();
          break;
        case "level":
          be.setLevel(msg.db, msg.actor);
          break;
        case "midi":
          be.midi(msg.bytes);
          break;
      }
    } catch (e) {
      this.post({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  private sendStatus(): void {
    const s = this.be.status();
    const st = this.be.stage.status();
    this.post({
      type: "status",
      status: {
        fs: sampleRate,
        sampleTime: s.sampleTime,
        running: s.audioState === "running",
        panic: s.panic,
        levelDb: s.levelDb,
        agentMaxLevelDb: s.agentMaxLevelDb,
        clipCount: s.clipCount,
        nonfiniteModules: s.nonfiniteModules,
        nonfiniteOutputStage: s.nonfiniteOutputStage,
        engineRevision: s.engineRevision ?? null,
        limiterGain: st.limiterGain,
        peak: this.be.takePeak(),
        meters: this.be.meters(),
      },
    });
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const left = out[0];
    let right = out[1];
    if (!right) {
      if (this.scratchR.length !== left.length) this.scratchR = new Float32Array(left.length);
      right = this.scratchR;
    }
    try {
      this.be.processBlock(left, right);
    } catch (e) {
      left.fill(0);
      right.fill(0);
      this.post({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
    this.sinceStatus += left.length;
    if (this.sinceStatus >= STATUS_INTERVAL_SECONDS * sampleRate) {
      this.sinceStatus = 0;
      this.sendStatus();
    }
    return true;
  }
}

registerProcessor("synth-processor", SynthProcessor);
