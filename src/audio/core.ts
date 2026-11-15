// 音声の中核(エンジン+出力保護)。ブラウザのAPIに依存しないので、同じコードをオフラインで試験できる。
// AudioWorklet(worklet.ts)はこのクラスを包むだけ。

import { Engine } from "../engine/engine.js";
import { ModuleFactory } from "../engine/module.js";
import { Actor, OutputStage, OutputStageConfig, OutputStatus, PROVISIONAL } from "./output-stage.js";

/** エンジンに与えるパッチの記述(構成とパラメータ)。操作契約・データ契約の実装は後続で、ここでは最小限。 */
export interface PatchDesc {
  modules: { id: string; type: string; params?: Record<string, number> }[];
  cables: { from: [string, string]; to: [string, string] }[];
  /** 出力モジュール(MOD-IO-001)のID。 */
  output: string;
}

export interface CoreStatus extends OutputStatus {
  audioState: "stopped" | "running";
  fs: number;
  /** 各モジュールが COM-12 で置換した回数の合計(DEC-112)。 */
  moduleNonfiniteCount: number;
  /** 出力モジュールの clip_count(PRE が ±1.0 を超えたサンプル数。リミッターの前)。 */
  preClipCount: number;
  step: number;
}

interface PendingParam {
  module: string;
  name: string;
  value: number;
}

export class AudioCore {
  private engine: Engine;
  readonly stage: OutputStage;
  private outputId = "";
  private pending: PendingParam[] = [];
  private running = false;

  constructor(
    readonly fs: number,
    private readonly registry: ReadonlyMap<string, ModuleFactory>,
    cfg: OutputStageConfig = PROVISIONAL,
  ) {
    this.engine = new Engine(fs);
    this.stage = new OutputStage(fs, cfg);
  }

  /** パッチ全体を置き換える。音量は引き下げる(DEC-111)。 */
  loadPatch(desc: PatchDesc): void {
    const e = new Engine(this.fs);
    for (const m of desc.modules) {
      const f = this.registry.get(m.type);
      if (!f) throw new Error(`未知のモジュール種別 ${m.type}`);
      const mod = f(this.fs);
      for (const [k, v] of Object.entries(m.params ?? {})) mod.setParam(k, v);
      mod.reset(); // 初期値がパラメータに依存する状態を、読込時のパラメータで初期化する(COM-10)
      e.add(m.id, mod);
    }
    for (const c of desc.cables) e.connect(c.from[0], c.from[1], c.to[0], c.to[1]);
    const out = e.get(desc.output);
    out.output("PRE_L");
    out.output("PRE_R");
    this.engine = e;
    this.outputId = desc.output;
    this.pending = [];
    this.stage.reduce("patch_replaced");
  }

  /** パラメータ変更。次のブロックの先頭から有効(product-spec §5.6)。 */
  setParam(module: string, name: string, value: number): void {
    this.engine.get(module).getRawParam(name); // 存在の確認
    this.pending.push({ module, name, value });
  }

  /** 音声の開始・再開(人の操作でだけ呼ばれる)。 */
  start(): void {
    this.running = true;
    this.stage.start();
  }

  stop(): void {
    this.running = false;
    this.stage.stop();
  }

  setLevel(db: number, actor: Actor) {
    return this.stage.setLevel(db, actor);
  }

  /** 緊急停止: 即時に消音し、全モジュールの内部状態を初期化する。パッチは保持する。 */
  panic(): void {
    this.stage.panic();
    this.engine.reset();
  }

  releasePanic(): boolean {
    return this.stage.releasePanic();
  }

  /**
   * 1ブロックを処理して左右の出力を書く。ブロック長は任意(128 でも 1 でも結果は同じ)。
   * パッチがない、または音声が動いていないときは無音。
   */
  processBlock(left: Float32Array, right: Float32Array): void {
    if (this.pending.length) {
      for (const p of this.pending) this.engine.get(p.module).setParam(p.name, p.value);
      this.pending = [];
    }
    const n = left.length;
    if (!this.running || !this.outputId) {
      left.fill(0);
      right.fill(0);
      return;
    }
    const out = this.engine.get(this.outputId);
    const preL = out.output("PRE_L").values;
    const preR = out.output("PRE_R").values;
    const st = this.stage;
    for (let i = 0; i < n; i++) {
      this.engine.tick();
      st.step(preL[0]!, preR[0]!);
      left[i] = st.outL[0]!;
      right[i] = st.outR[0]!;
    }
  }

  status(): CoreStatus {
    let nf = 0;
    for (const id of this.engine.ids()) nf += this.engine.get(id).nonfiniteCount;
    let preClip = 0;
    if (this.outputId) {
      const o = this.engine.get(this.outputId) as unknown as { clipCount?: number };
      preClip = o.clipCount ?? 0;
    }
    return {
      ...this.stage.status(),
      audioState: this.running ? "running" : "stopped",
      fs: this.fs,
      moduleNonfiniteCount: nf,
      preClipCount: preClip,
      step: this.engine.step,
    };
  }

  takePeak(): number {
    return this.stage.takePeak();
  }
}

/** デモ用の固定パッチ: VCO → VCA → 出力。ADSR が VCA を開閉する。ピッチとゲートは定数源(MOD-UTL-001)で与える。 */
export const DEMO_PATCH: PatchDesc = {
  modules: [
    { id: "pitch", type: "MOD-UTL-001", params: { gain: 0, offset: 0 } },
    { id: "gate", type: "MOD-UTL-001", params: { gain: 0, offset: 0 } },
    { id: "vco", type: "MOD-OSC-001" },
    { id: "env", type: "MOD-ENV-001", params: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3 } },
    { id: "trim", type: "MOD-UTL-001", params: { gain: 0.5, offset: 0 } },
    { id: "vca", type: "MOD-AMP-001" },
    { id: "out", type: "MOD-IO-001" },
  ],
  cables: [
    { from: ["pitch", "out"], to: ["vco", "pitch"] },
    { from: ["gate", "out"], to: ["env", "gate"] },
    { from: ["vco", "saw"], to: ["vca", "in1"] },
    { from: ["env", "env"], to: ["trim", "in"] },
    { from: ["trim", "out"], to: ["vca", "cv1"] },
    { from: ["vca", "out"], to: ["out", "IN_L"] },
  ],
  output: "out",
};
