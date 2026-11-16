// MOD-NSE-001 ノイズ源(白色ノイズ)(仕様 v0.2)。
// y = (2u − 1)·level、u = COM-11 の uniform()。入力なし、常に N = 1。
// 状態は PRNG(s0..s3)と applied_seed。seed の変更は次のステップ冒頭で再シードする。

import { ModuleDef, ModuleState, SynthModule } from "../engine/module.js";
import { Prng, normalizeSeed } from "../engine/prng.js";

const DEFAULT_SEED = 1;

const DEF: ModuleDef = {
  specId: "MOD-NSE-001",
  specVersion: "0.2",
  title: "ノイズ源(白色ノイズ)",
  inputs: [],
  outputs: [{ name: "out", type: "audio" }],
  params: [
    { name: "level", kind: "float", min: 0, max: 10, default: 5, unit: "V" },
    { name: "seed", kind: "seed", min: 0, max: 4294967295, default: DEFAULT_SEED },
  ],
  stateful: true,
};

export class NseModule extends SynthModule {
  readonly def = DEF;

  private readonly prng = new Prng(DEFAULT_SEED);
  private appliedSeed = DEFAULT_SEED;

  constructor(fs: number) {
    super(fs);
    this.init();
  }

  /** COM-11: 正規化後の seed(NaN/∞ → 1、負 → 0、切り捨て、mod 2³²)。 */
  private seedValue(): number {
    return normalizeSeed(this.getRawParam("seed"), DEFAULT_SEED);
  }

  protected resetState(): void {
    const s = this.seedValue();
    this.prng.seed(s);
    this.appliedSeed = s;
  }

  step(): void {
    const out = this.outputs[0]!;
    // 1. seed の変更を反映
    const s = this.seedValue();
    if (this.appliedSeed !== s) {
      this.prng.seed(s);
      this.appliedSeed = s;
    }
    // 2. 乱数と出力(uniform は毎ステップ必ず1回)
    const u = this.prng.uniform();
    const lv = this.param("level"); // NaN/∞ は 5.0、範囲は [0, 10] にクランプ
    out.channels = 1;
    this.writeOut(out, 0, (2 * u - 1) * lv);
  }

  override getState(): ModuleState {
    return { s: this.prng.getState(), applied_seed: this.appliedSeed };
  }

  override setState(state: ModuleState): void {
    // 復元時は再シードしない(§9)。
    const s = state.s;
    if (Array.isArray(s) && s.length >= 4) this.prng.setState(s as number[]);
    const a = Number(state.applied_seed);
    if (Number.isFinite(a)) this.appliedSeed = a >>> 0;
  }
}
