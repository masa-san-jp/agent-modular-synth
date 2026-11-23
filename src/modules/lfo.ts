// MOD-LFO-001 LFO(低周波オシレータ)(仕様 v0.2)。
// 位相アキュムレータ(倍精度)から5波形(saw, saw_inv, tri, sine, square。±4 V·depth)を同時に出す。
// f = clamp(freq·2^clamp(cv_amt·rate, ±30), 0.005, 4500)。reset の立ち上がりで位相 0。
// 主入力は rate(N を決める)、副入力は reset。

import { ModuleDef, ModuleState, SynthModule } from "../engine/module.js";
import { GATE_OFF, GATE_ON, MAX_CHANNELS, clamp } from "../engine/util.js";

const F_MIN = 0.005;
const F_MAX = 4500;

const DEF: ModuleDef = {
  specId: "MOD-LFO-001",
  specVersion: "0.2",
  title: "LFO(低周波オシレータ)",
  inputs: [
    { name: "rate", type: "pitch", unconnected: 0 },
    { name: "reset", type: "trigger", unconnected: 0 },
  ],
  outputs: [
    { name: "saw", type: "cv" },
    { name: "saw_inv", type: "cv" },
    { name: "tri", type: "cv" },
    { name: "sine", type: "cv" },
    { name: "square", type: "cv" },
  ],
  params: [
    { name: "freq", kind: "float", min: F_MIN, max: F_MAX, default: 2.0 },
    { name: "cv_amt", kind: "float", min: -1, max: 1, default: 1.0 },
    { name: "depth", kind: "float", min: 0, max: 1, default: 1.0 },
  ],
  stateful: true,
};

export class LfoModule extends SynthModule {
  readonly def = DEF;

  /** エンジンごとの位相(double、[0,1))。 */
  private readonly phase = new Float64Array(MAX_CHANNELS);
  /** エンジンごとの reset のシュミット状態(0/1)。 */
  private readonly resetState_ = new Uint8Array(MAX_CHANNELS);
  /** 現在のエンジン数。 */
  private n = 1;

  constructor(fs: number) {
    super(fs);
    this.init();
  }

  protected resetState(): void {
    this.phase.fill(0);
    this.resetState_.fill(0);
    this.n = 1;
  }

  /** N の変更(§5): 増えたエンジンは初期状態、減ったエンジンの状態は破棄。 */
  private setEngines(n: number): void {
    if (n === this.n) return;
    const keep = Math.min(n, this.n);
    for (let c = keep; c < MAX_CHANNELS; c++) {
      this.phase[c] = 0;
      this.resetState_[c] = 0;
    }
    this.n = n;
  }

  step(): void {
    const pRate = this.inputs[0]!;
    const pReset = this.inputs[1]!;
    const oSaw = this.outputs[0]!;
    const oSawInv = this.outputs[1]!;
    const oTri = this.outputs[2]!;
    const oSine = this.outputs[3]!;
    const oSquare = this.outputs[4]!;

    const n = pRate.connected ? pRate.channels : 1; // 主入力が未接続なら N = 1
    this.setEngines(n);
    this.sanitizeInput(pRate, n);
    this.sanitizeInput(pReset, n); // N 以上の番号のチャンネルは読まない(§8)

    const fr = this.param("freq"); // NaN/∞ は 2.0、[0.005, 4500] にクランプ
    const cvAmt = this.param("cv_amt");
    const d = this.param("depth"); // NaN/∞ は 1.0、[0, 1] にクランプ

    oSaw.channels = n;
    oSawInv.channels = n;
    oTri.channels = n;
    oSine.channels = n;
    oSquare.channels = n;

    for (let c = 0; c < n; c++) {
      const xRate = pRate.connected ? pRate.values[c]! : 0;
      const xReset = this.chan(pReset, c);

      // 1. reset(COM-04 のシュミット判定。立ち上がりで位相 0)
      let ph = this.phase[c]!;
      if (this.resetState_[c] === 0) {
        if (xReset >= GATE_ON) {
          this.resetState_[c] = 1;
          ph = 0;
        }
      } else if (xReset <= GATE_OFF) {
        this.resetState_[c] = 0;
      }

      // 2. 周波数
      const e = clamp(cvAmt * xRate, -30, 30);
      const f = clamp(fr * Math.pow(2, e), F_MIN, F_MAX);
      const dphi = Math.min(f / this.fs, 0.5);

      // 3. 波形(位相を進める前の値から)
      const q = (ph + 0.5) % 1;
      const sawv = 4 * (2 * q - 1);
      const x = ph < 0.25 ? ph : ph < 0.75 ? 0.5 - ph : ph - 1;
      const tri = 16 * x;
      const sine = 4 * Math.sin(2 * Math.PI * ph);
      const sq = ph < 0.5 ? 4 : -4;

      // 5. 出力(NaN/∞ なら 0)
      this.writeOut(oSaw, c, d * sawv);
      this.writeOut(oSawInv, c, -d * sawv);
      this.writeOut(oTri, c, d * tri);
      this.writeOut(oSine, c, d * sine);
      this.writeOut(oSquare, c, d * sq);

      // 4. 状態更新
      ph += dphi;
      if (ph >= 1.0) ph -= 1.0;
      this.phase[c] = ph;
    }
  }

  override getState(): ModuleState {
    return {
      n: this.n,
      phase: Array.from(this.phase.subarray(0, this.n)),
      reset_state: Array.from(this.resetState_.subarray(0, this.n)),
    };
  }

  override setState(state: ModuleState): void {
    // 0.1 のスナップショット(phase・reset_state が1組の数値)はエンジン0として読む(§9)。
    const ph = Array.isArray(state.phase) ? (state.phase as number[]) : [Number(state.phase ?? 0)];
    const rs = Array.isArray(state.reset_state) ? (state.reset_state as number[]) : [Number(state.reset_state ?? 0)];
    const n = clamp(Math.floor(Number(state.n ?? ph.length)) || 1, 1, MAX_CHANNELS);
    this.phase.fill(0);
    this.resetState_.fill(0);
    for (let c = 0; c < n; c++) {
      const p = Number(ph[c] ?? 0);
      this.phase[c] = Number.isFinite(p) && p >= 0 && p < 1 ? p : 0;
      this.resetState_[c] = rs[c] ? 1 : 0;
    }
    this.n = n;
  }
}
