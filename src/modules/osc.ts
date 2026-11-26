// MOD-OSC-001 VCO(仕様 v0.3)。
// 位相アキュムレータ(double)から saw / pulse / tri / sine を同時に生成する。
// saw・pulse・tri は帯域制限する(段差に PolyBLEP、角に PolyBLAMP。2 サンプルの多項式。§6、DEC-028)。
// 主入力は pitch(N を決める)。fm・pwm・sync は副入力。エンジンごとに phase と sync_state を持つ。

import { ModuleDef, ModuleState, SynthModule } from "../engine/module.js";
import { GATE_OFF, GATE_ON, MAX_CHANNELS, clamp } from "../engine/util.js";

const F0 = 261.6256; // COM-03: C4
const PW_MIN = 0.02;
const PW_MAX = 0.98;

/**
 * 段差の位置 d(位相)から見た、いまの位相 ph の距離をサンプル数で返す(§6 の `dist`)。
 * 位相の差を [-0.5, 0.5) に折り返してから dphi で割る。
 */
function dist(ph: number, d: number, dphi: number): number {
  let u = ph - d;
  if (u >= 0.5) u -= 1;
  else if (u < -0.5) u += 1;
  return u / dphi;
}

/** 高さ 1 の段差の補正(PolyBLEP)。段差の直前 1 サンプルと直後 1 サンプルだけが 0 でない。 */
function blep(x: number): number {
  if (x >= 0 && x < 1) {
    const t = 1 - x;
    return -0.5 * t * t;
  }
  if (x >= -1 && x < 0) {
    const t = 1 + x;
    return 0.5 * t * t;
  }
  return 0;
}

/** 傾きが 1 サンプルあたり 1 変わる角の補正(PolyBLAMP。blep を積分したもの)。 */
function blamp(x: number): number {
  if (x >= 0 && x < 1) {
    const t = 1 - x;
    return (t * t * t) / 6;
  }
  if (x >= -1 && x < 0) {
    const t = 1 + x;
    return (t * t * t) / 6;
  }
  return 0;
}

const DEF: ModuleDef = {
  specId: "MOD-OSC-001",
  specVersion: "0.3",
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
    { name: "range", kind: "int", min: -2, max: 2, default: 0 },
    { name: "tune", kind: "float", min: -1, max: 1, default: 0 },
    { name: "fm_amt", kind: "float", min: -1, max: 1, default: 0 },
    { name: "pw", kind: "float", min: PW_MIN, max: PW_MAX, default: 0.5 },
    { name: "pwm_amt", kind: "float", min: -1, max: 1, default: 0 },
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
  // 音程 → 周波数の控え(同じ音程が続く間は、2 のべき乗を計算し直さない。結果は同じ)
  private readonly lastV = new Float64Array(MAX_CHANNELS).fill(NaN);
  private readonly lastF = new Float64Array(MAX_CHANNELS);

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
      if (v !== this.lastV[c]) {
        this.lastV[c] = v;
        this.lastF[c] = F0 * Math.pow(2, v);
      }
      const f = this.lastF[c]!;
      const dphi = Math.min(f / this.fs, 0.5);

      // 3. パルス幅
      const pwEff = clamp(pw + (pwmAmt * xPwm) / 10, PW_MIN, PW_MAX);

      // 4. 波形(位相を進める前の値から)。ナイーブな形に、段差と角の補正を足す
      const b0 = blep(dist(ph, 0, dphi)); // 位相 0: saw は -8 V、pulse は +8 V の段差
      const bPw = blep(dist(ph, pwEff, dphi)); // 位相 pw_eff: pulse は -8 V の段差
      const x = ph < 0.25 ? ph : ph < 0.75 ? 0.5 - ph : ph - 1;
      const k = 40 * dphi; // tri の傾きの変化(1 サンプルあたり)
      this.writeOut(oSaw, c, 4 * (2 * ph - 1) - 8 * b0);
      this.writeOut(oPulse, c, (ph < pwEff ? 4 : -4) + 8 * b0 - 8 * bPw);
      this.writeOut(oTri, c, 20 * x - k * blamp(dist(ph, 0.25, dphi)) + k * blamp(dist(ph, 0.75, dphi)));
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
