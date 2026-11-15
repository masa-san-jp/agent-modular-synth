// MOD-OSC-001 VCO(仕様 v0.2)。
// 位相アキュムレータ(double)から saw / pulse / tri / sine を同時に生成する。
// 主入力は pitch(N を決める)。fm・pwm・sync は副入力。エンジンごとに phase と sync_state を持つ。

import { ModuleDef, ModuleState, SynthModule } from "../engine/module.js";
import { GATE_OFF, GATE_ON, MAX_CHANNELS, clamp } from "../engine/util.js";

const F0 = 261.6256; // COM-03: C4
const PW_MIN = 0.02;
const PW_MAX = 0.98;

const DEF: ModuleDef = {
  specId: "MOD-OSC-001",
  specVersion: "0.2",
  title: "VCO(電圧制御オシレータ)",
  inputs: [
    { name: "pitch", type: "pitch", unconnected: 0 },
    { name: "fm", type: "cv", unconnected: 0 },
    { name: "pwm", type: "cv", unconnected: 0 },
    { name: "sync", type: "trigger", unconnected: 0 },
  ],
  outputs: [
    { name: "saw", type: "audio" },
    { name: "pulse", type: "audio" },
    { name: "tri", type: "audio" },
    { name: "sine", type: "audio" },
  ],
  params: [
    { name: "range", kind: "int", min: -2, max: 2, default: 0, unit: "oct" },
    { name: "tune", kind: "float", min: -1, max: 1, default: 0, unit: "oct" },
    { name: "fm_amt", kind: "float", min: -1, max: 1, default: 0, unit: "oct/V" },
    { name: "pw", kind: "float", min: PW_MIN, max: PW_MAX, default: 0.5, unit: "ratio" },
    { name: "pwm_amt", kind: "float", min: -1, max: 1, default: 0, unit: "ratio/10V" },
  ],
  stateful: true,
};

export class OscModule extends SynthModule {
  readonly def = DEF;
  /** エンジンごとの位相(double、[0,1))。 */
  private readonly phase = new Float64Array(MAX_CHANNELS);
  /** エンジンごとのシュミット状態(0/1)。 */
  private readonly syncState = new Uint8Array(MAX_CHANNELS);
  /** 現在のエンジン数。 */
  private n = 1;

  constructor(fs: number) {
    super(fs);
    this.init();
  }

  protected resetState(): void {
    this.phase.fill(0);
    this.syncState.fill(0);
    this.n = 1;
  }

  /** N の変更(§5): 増えたエンジンは初期状態、減ったエンジンの状態は破棄。 */
  private setEngines(n: number): void {
    if (n === this.n) return;
    const keep = Math.min(n, this.n);
    for (let c = keep; c < MAX_CHANNELS; c++) {
      this.phase[c] = 0;
      this.syncState[c] = 0;
    }
    this.n = n;
  }

  step(): void {
    const pPitch = this.inputs[0]!;
    const pFm = this.inputs[1]!;
    const pPwm = this.inputs[2]!;
    const pSync = this.inputs[3]!;
    const oSaw = this.outputs[0]!;
    const oPulse = this.outputs[1]!;
    const oTri = this.outputs[2]!;
    const oSine = this.outputs[3]!;

    const n = pPitch.connected ? pPitch.channels : 1; // 主入力が未接続なら N = 1
    this.setEngines(n);
    this.sanitizeInput(pPitch, n);
    this.sanitizeInput(pFm, n);
    this.sanitizeInput(pPwm, n);
    this.sanitizeInput(pSync, n);

    const range = this.param("range");
    const tune = this.param("tune");
    const fmAmt = this.param("fm_amt");
    const pw = this.param("pw");
    const pwmAmt = this.param("pwm_amt");

    oSaw.channels = n;
    oPulse.channels = n;
    oTri.channels = n;
    oSine.channels = n;

    for (let c = 0; c < n; c++) {
      const xPitch = pPitch.connected ? pPitch.values[c]! : 0;
      const xFm = this.chan(pFm, c);
      const xPwm = this.chan(pPwm, c);
      const xSync = this.chan(pSync, c);

      // 1. sync(COM-04 のシュミット判定。立ち上がりで位相 0)
      let ph = this.phase[c]!;
      if (this.syncState[c] === 0) {
        if (xSync >= GATE_ON) {
          this.syncState[c] = 1;
          ph = 0;
        }
      } else if (xSync <= GATE_OFF) {
        this.syncState[c] = 0;
      }

      // 2. 周波数
      const v = clamp(xPitch + range + tune + fmAmt * xFm, -10, 10);
      const f = F0 * Math.pow(2, v);
      const dphi = Math.min(f / this.fs, 0.5);

      // 3. パルス幅
      const pwEff = clamp(pw + (pwmAmt * xPwm) / 10, PW_MIN, PW_MAX);

      // 4. 波形(位相を進める前の値から)
      const x = ph < 0.25 ? ph : ph < 0.75 ? 0.5 - ph : ph - 1;
      this.writeOut(oSaw, c, 4 * (2 * ph - 1));
      this.writeOut(oPulse, c, ph < pwEff ? 4 : -4);
      this.writeOut(oTri, c, 20 * x);
      this.writeOut(oSine, c, 5 * Math.sin(2 * Math.PI * ph));

      // 5. 状態更新
      ph += dphi;
      if (ph >= 1.0) ph -= 1.0;
      this.phase[c] = ph;
    }
  }

  override getState(): ModuleState {
    return {
      n: this.n,
      phase: Array.from(this.phase.subarray(0, this.n)),
      sync_state: Array.from(this.syncState.subarray(0, this.n)),
    };
  }

  override setState(state: ModuleState): void {
    // 0.1 のスナップショット(phase・sync_state が1組の数値)はエンジン0として読む(§9)。
    const ph = Array.isArray(state.phase) ? (state.phase as number[]) : [Number(state.phase ?? 0)];
    const ss = Array.isArray(state.sync_state) ? (state.sync_state as number[]) : [Number(state.sync_state ?? 0)];
    const n = clamp(Math.floor(Number(state.n ?? ph.length)) || 1, 1, MAX_CHANNELS);
    this.phase.fill(0);
    this.syncState.fill(0);
    for (let c = 0; c < n; c++) {
      const p = Number(ph[c] ?? 0);
      this.phase[c] = Number.isFinite(p) && p >= 0 && p < 1 ? p : 0;
      this.syncState[c] = ss[c] ? 1 : 0;
    }
    this.n = n;
  }
}
