// AudioWorkletProcessor。描画スレッドで動く(DEC-101)。中身は WorkletCore(エンジンと出力保護は EngineBackend)。
// パッチの正本はメインスレッドの Session で、ここへは全体の置き換えか差分が届く。
import { REGISTRY } from "../modules/registry.js";
import { ToWorklet } from "./messages.js";
import { WorkletCore } from "./worklet-core.js";

// AudioWorkletGlobalScope の宣言(DOM の型定義に依存しないため最小限)
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: { postMessage(msg: unknown): void; onmessage: ((ev: { data: unknown }) => void) | null };
  constructor();
}

const STATUS_INTERVAL_SECONDS = 0.05;

class SynthProcessor extends AudioWorkletProcessor {
  private readonly core = new WorkletCore(sampleRate, REGISTRY, (msg) => this.port.postMessage(msg));
  private sinceStatus = 0;
  private scratchR = new Float32Array(128);

  constructor() {
    super();
    this.port.onmessage = (ev) => this.core.onMessage(ev.data as ToWorklet);
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
    this.core.process(left, right);
    this.sinceStatus += left.length;
    if (this.sinceStatus >= STATUS_INTERVAL_SECONDS * sampleRate) {
      this.sinceStatus = 0;
      try {
        this.port.postMessage({ type: "status", status: this.core.status() });
      } catch {
        // 状態の送信の失敗で音声の処理を止めない
      }
    }
    return true;
  }
}

registerProcessor("synth-processor", SynthProcessor);
