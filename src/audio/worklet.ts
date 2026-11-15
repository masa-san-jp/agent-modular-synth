// AudioWorkletProcessor。描画スレッドで動く(DEC-101)。エンジンと出力保護は AudioCore に任せる。
import { REGISTRY } from "../modules/registry.js";
import { AudioCore } from "./core.js";
import { FromWorklet, ToWorklet } from "./messages.js";

// AudioWorkletGlobalScope の宣言(DOM の型定義に依存しないため最小限)
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: { postMessage(msg: unknown): void; onmessage: ((ev: { data: unknown }) => void) | null };
  constructor();
}

const STATUS_INTERVAL_SECONDS = 0.1;

class SynthProcessor extends AudioWorkletProcessor {
  private readonly core = new AudioCore(sampleRate, REGISTRY);
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
      switch (msg.type) {
        case "load":
          this.core.loadPatch(msg.patch);
          break;
        case "param":
          this.core.setParam(msg.module, msg.name, msg.value);
          break;
        case "start":
          this.core.start();
          break;
        case "stop":
          this.core.stop();
          break;
        case "panic":
          this.core.panic();
          break;
        case "release_panic":
          this.core.releasePanic();
          break;
        case "level": {
          const r = this.core.setLevel(msg.db, msg.actor);
          this.post({ type: "level_result", ok: r.ok, reason: r.ok ? undefined : r.reason });
          break;
        }
      }
    } catch (e) {
      this.post({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
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
    this.core.processBlock(left, right);
    this.sinceStatus += left.length;
    if (this.sinceStatus >= STATUS_INTERVAL_SECONDS * sampleRate) {
      this.sinceStatus = 0;
      this.post({ type: "status", status: this.core.status(), peak: this.core.takePeak() });
    }
    return true;
  }
}

registerProcessor("synth-processor", SynthProcessor);
