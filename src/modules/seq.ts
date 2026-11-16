// MOD-SEQ-001 ステップシーケンサ(仕様 v0.2)。
// 主入力は CLOCK(N を決める)、副入力は RESET。ステップ値(cv[i]、gate[i])は全エンジン共有、
// 位置・パルスカウンタ・hold・グライド状態はエンジンごと。

import { EncNum, decNum, encArr } from "../engine/codec.js";
import { ModuleDef, ModuleState, ParamDef, SynthModule } from "../engine/module.js";
import {
  GATE_OFF,
  GATE_ON,
  MAX_CHANNELS,
  V_LIMIT,
  clamp,
  resetIgnoreSamples,
  roundHalfUp,
  triggerSamples,
} from "../engine/util.js";

const STEPS = 16;
const CV_NAMES: string[] = [];
const GATE_NAMES: string[] = [];
for (let i = 1; i <= STEPS; i++) {
  CV_NAMES.push(`cv[${i}]`);
  GATE_NAMES.push(`gate[${i}]`);
}

const PARAMS: ParamDef[] = [
  { name: "length", kind: "int", min: 1, max: STEPS, default: 8 },
  ...CV_NAMES.map((name): ParamDef => ({ name, kind: "float", min: -10, max: 10, default: 0, unit: "V" })),
  ...GATE_NAMES.map((name): ParamDef => ({ name, kind: "float", min: 0, max: 1, default: 1 })),
  { name: "glide", kind: "float", min: 0, max: 10, default: 0, unit: "s" },
  { name: "run", kind: "float", min: 0, max: 1, default: 1 },
];

const DEF: ModuleDef = {
  specId: "MOD-SEQ-001",
  specVersion: "0.2",
  title: "ステップシーケンサ",
  inputs: [
    { name: "CLOCK", type: "clock", unconnected: 0 },
    { name: "RESET", type: "trigger", unconnected: 0 },
  ],
  outputs: [
    { name: "CV", type: "cv" },
    { name: "GATE", type: "gate" },
    { name: "TRIG", type: "trigger" },
    { name: "EOC", type: "trigger" },
  ],
  params: PARAMS,
  stateful: true,
};

function schmitt(v: number, state: number): number {
  if (state === 0) return v >= GATE_ON ? 1 : 0;
  return v <= GATE_OFF ? 0 : 1;
}

export class SeqModule extends SynthModule {
  readonly def = DEF;

  private n = 1;
  private readonly pos = new Uint8Array(MAX_CHANNELS);
  private readonly clkState = new Uint8Array(MAX_CHANNELS);
  private readonly rstState = new Uint8Array(MAX_CHANNELS);
  private readonly hold = new Int32Array(MAX_CHANNELS);
  private readonly trigCnt = new Int32Array(MAX_CHANNELS);
  private readonly eocCnt = new Int32Array(MAX_CHANNELS);
  /** グライド後の CV(float32)。 */
  private readonly cvY = new Float32Array(MAX_CHANNELS);

  constructor(fs: number) {
    super(fs);
    this.init();
  }

  private initEngines(from: number, to: number): void {
    for (let c = from; c < to; c++) {
      this.pos[c] = 0;
      this.clkState[c] = 0;
      this.rstState[c] = 0;
      this.hold[c] = 0;
      this.trigCnt[c] = 0;
      this.eocCnt[c] = 0;
      this.cvY[c] = 0;
    }
  }

  protected resetState(): void {
    this.initEngines(0, MAX_CHANNELS);
    this.n = 1;
  }

  /** エンジン数(読出し値)。 */
  get engines(): number {
    return this.n;
  }

  /** 現在位置 pos[c](0始まり。読出し値)。 */
  position(c = 0): number {
    return this.pos[c]!;
  }

  /** 真偽型パラメータ(gate[i]、run): NaN/∞は既定1、有限の0以外は1。 */
  private flag(name: string): boolean {
    const v = this.rawParams.get(name)!;
    return Number.isFinite(v) ? v !== 0 : true;
  }

  step(): void {
    const clock = this.inputs[0]!;
    const reset = this.inputs[1]!;
    const cvOut = this.outputs[0]!;
    const gateOut = this.outputs[1]!;
    const trigOut = this.outputs[2]!;
    const eocOut = this.outputs[3]!;

    const n = clock.connected ? clock.channels : 1;
    if (n > this.n) this.initEngines(this.n, n);
    this.n = n;

    this.sanitizeInput(clock, n);
    this.sanitizeInput(reset, n);

    const fs = this.fs;
    const Nt = triggerSamples(fs);
    const Nh = resetIgnoreSamples(fs);
    const rawLen = this.rawParams.get("length")!;
    const L = clamp(roundHalfUp(Number.isFinite(rawLen) ? rawLen : 8), 1, STEPS);
    const rawGlide = this.rawParams.get("glide")!;
    const glide = Number.isFinite(rawGlide) ? clamp(rawGlide, 0, 10) : 0;
    const a = glide <= 0 ? 1 : 1 - Math.exp(-1 / (glide * fs));
    const run = this.flag("run");

    cvOut.channels = n;
    gateOut.channels = n;
    trigOut.channels = n;
    eocOut.channels = n;

    for (let c = 0; c < n; c++) {
      // 0./1. 入力とシュミット
      const cv = clock.connected ? clock.values[c]! : 0;
      const r = this.chan(reset, c);
      const rPrev = this.rstState[c]!;
      const cPrev = this.clkState[c]!;
      this.rstState[c] = schmitt(r, rPrev);
      this.clkState[c] = schmitt(cv, cPrev);
      const rstEdge = rPrev === 0 && this.rstState[c] === 1;
      const clkEdge = cPrev === 0 && this.clkState[c] === 1;

      let pos = this.pos[c]!;
      if (pos >= L) pos = 0;

      // 2. RESET
      if (rstEdge) {
        pos = 0;
        this.hold[c] = Nh;
        this.trigCnt[c] = 0;
        this.eocCnt[c] = 0;
      } else if (this.hold[c]! > 0) {
        this.hold[c]!--;
      }

      // 3. CLOCK
      if (run && clkEdge && this.hold[c] === 0) {
        let p = pos + 1;
        const wrapped = p >= L;
        if (wrapped) p = 0;
        pos = p;
        if (this.flag(GATE_NAMES[pos]!)) this.trigCnt[c] = Nt;
        if (wrapped) this.eocCnt[c] = Nt;
      }
      this.pos[c] = pos;

      // 4. グライド
      const rawCv = this.rawParams.get(CV_NAMES[pos]!)!;
      const target = clamp(Number.isFinite(rawCv) ? rawCv : 0, -10, 10);
      const y = Math.fround(this.cvY[c]! + a * (target - this.cvY[c]!));
      this.cvY[c] = y;

      // 5. 出力
      this.writeOut(cvOut, c, clamp(y, -V_LIMIT, V_LIMIT));
      gateOut.values[c] = run && this.flag(GATE_NAMES[pos]!) ? 10 : 0;
      trigOut.values[c] = this.trigCnt[c]! > 0 ? 10 : 0;
      if (this.trigCnt[c]! > 0) this.trigCnt[c]!--;
      eocOut.values[c] = this.eocCnt[c]! > 0 ? 10 : 0;
      if (this.eocCnt[c]! > 0) this.eocCnt[c]!--;
    }
  }

  override getState(): ModuleState {
    const n = this.n;
    return {
      pos: Array.from(this.pos.subarray(0, n)),
      clk_state: Array.from(this.clkState.subarray(0, n)),
      rst_state: Array.from(this.rstState.subarray(0, n)),
      hold: Array.from(this.hold.subarray(0, n)),
      trig_cnt: Array.from(this.trigCnt.subarray(0, n)),
      eoc_cnt: Array.from(this.eocCnt.subarray(0, n)),
      cv_y: encArr(this.cvY.subarray(0, n)),
    };
  }

  override setState(state: ModuleState): void {
    // 0.1 の保存データ(1組のスカラー)はエンジン0として読む(§9)。
    const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v === undefined ? [] : [v as T]);
    const pos = arr<number>(state.pos);
    const cs = arr<number>(state.clk_state);
    const rs = arr<number>(state.rst_state);
    const hold = arr<number>(state.hold);
    const tc = arr<number>(state.trig_cnt);
    const ec = arr<number>(state.eoc_cnt);
    const ys = arr<EncNum>(state.cv_y);
    const n = Math.max(1, Math.min(MAX_CHANNELS, pos.length));
    this.initEngines(0, MAX_CHANNELS);
    for (let c = 0; c < n; c++) {
      this.pos[c] = pos[c] ?? 0;
      this.clkState[c] = cs[c] ? 1 : 0;
      this.rstState[c] = rs[c] ? 1 : 0;
      this.hold[c] = hold[c] ?? 0;
      this.trigCnt[c] = tc[c] ?? 0;
      this.eocCnt[c] = ec[c] ?? 0;
      this.cvY[c] = c < ys.length ? decNum(ys[c]!) : 0;
    }
    this.n = n;
  }
}
