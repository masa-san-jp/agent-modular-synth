// MOD-FNC-001 スルー/関数発生器(仕様 v0.2)。
// 状態機械 IDLE/RISE/FALL。IDLE は in へのスルー、RISE/FALL は 0→10→0 V の関数。
// 主入力は in と trig(N を決める)、副入力は cycle, rise_cv, fall_cv。状態 y は倍精度(COM-05)。

import { EncNum, decNum, encArr } from "../engine/codec.js";
import { ModuleDef, ModuleState, SynthModule } from "../engine/module.js";
import { GATE_OFF, GATE_ON, MAX_CHANNELS, V_LIMIT, clamp } from "../engine/util.js";

const T_MIN = 0.001;
const T_MAX = 100;

const DEF: ModuleDef = {
  specId: "MOD-FNC-001",
  specVersion: "0.2",
  title: "スルー/関数発生器",
  inputs: [
    { name: "in", type: "cv", unconnected: 0 },
    { name: "trig", type: "trigger", unconnected: 0 },
    { name: "cycle", type: "gate", unconnected: 0 },
    { name: "rise_cv", type: "cv", unconnected: 0 },
    { name: "fall_cv", type: "cv", unconnected: 0 },
  ],
  outputs: [
    { name: "out", type: "cv" },
    { name: "eor", type: "gate" },
    { name: "eoc", type: "gate" },
  ],
  params: [
    { name: "rise", kind: "float", min: T_MIN, max: T_MAX, default: 0.1, unit: "s" },
    { name: "fall", kind: "float", min: T_MIN, max: T_MAX, default: 0.1, unit: "s" },
    // 列挙(0=線形, 1=指数)。0.5 以上を 1 に丸める(四捨五入、0.5 は切り上げ)。
    { name: "response", kind: "int", min: 0, max: 1, default: 0 },
  ],
  stateful: true,
};

const IDLE = 0;
const RISE = 1;
const FALL = 2;
const LN1000 = Math.log(1000);
const SNAP = 0.01;
const CV_K = 1 / 8; // COM-18: 相対加算型の感度(V⁻¹、固定)

/** COM-04 のシュミット検出。新しい状態を返す。 */
function schmitt(v: number, state: number): number {
  if (state === 0) return v >= GATE_ON ? 1 : 0;
  return v <= GATE_OFF ? 0 : 1;
}

export class FncModule extends SynthModule {
  readonly def = DEF;

  // エンジンごとの状態(§5)。先頭 n 組が有効。
  private n = 1;
  private readonly y = new Float64Array(MAX_CHANNELS);
  private readonly stage = new Uint8Array(MAX_CHANNELS);
  private readonly t = new Uint8Array(MAX_CHANNELS);
  private readonly c = new Uint8Array(MAX_CHANNELS);
  /** move() の完了フラグ(戻り値を2つ返す代わり)。 */
  private done = false;

  constructor(fs: number) {
    super(fs);
    this.init();
  }

  private initEngines(from: number, to: number): void {
    for (let e = from; e < to; e++) {
      this.y[e] = 0;
      this.stage[e] = IDLE;
      this.t[e] = 0;
      this.c[e] = 0;
    }
  }

  protected resetState(): void {
    this.initEngines(0, MAX_CHANNELS);
    this.n = 1;
  }

  /** §6 の move(y, target, n)。新しい y を返し、完了なら this.done = true。 */
  private move(y: number, target: number, n: number, expo: boolean): number {
    if (expo) {
      const k = 1 - Math.exp(-LN1000 / n);
      const y2 = y + (target - y) * k;
      if (Math.abs(target - y2) <= SNAP) {
        this.done = true;
        return target;
      }
      this.done = false;
      return y2;
    }
    const st = 10 / n;
    const d = target - y;
    if (Math.abs(d) <= 1.5 * st) {
      this.done = true;
      return target;
    }
    this.done = false;
    return y + Math.sign(d) * st;
  }

  step(): void {
    const inP = this.inputs[0]!;
    const trig = this.inputs[1]!;
    const cycle = this.inputs[2]!;
    const riseCv = this.inputs[3]!;
    const fallCv = this.inputs[4]!;
    const outP = this.outputs[0]!;
    const eorP = this.outputs[1]!;
    const eocP = this.outputs[2]!;

    // COM-08: N = 主入力 in, trig のチャンネル数の最大値(両方未接続なら 1)。増えたエンジンは初期状態。
    const n = Math.max(1, this.chCount(inP), this.chCount(trig));
    if (n > this.n) this.initEngines(this.n, n);
    this.n = n;

    // COM-12: 読むチャンネルだけを整形して数える。
    this.sanitizeInput(inP, n);
    this.sanitizeInput(trig, n);
    this.sanitizeInput(cycle, n);
    this.sanitizeInput(riseCv, n);
    this.sanitizeInput(fallCv, n);

    const fs = this.fs;
    const rise = this.param("rise");
    const fall = this.param("fall");
    const expo = this.param("response") === 1;

    outP.channels = n;
    eorP.channels = n;
    eocP.channels = n;
    for (let e = 0; e < n; e++) {
      const inp = clamp(this.chan(inP, e), -V_LIMIT, V_LIMIT);
      const Tr = clamp(rise * Math.max(0, 1 + this.chan(riseCv, e) * CV_K), T_MIN, T_MAX);
      const Tf = clamp(fall * Math.max(0, 1 + this.chan(fallCv, e) * CV_K), T_MIN, T_MAX);
      const nr = Math.max(1, Tr * fs);
      const nf = Math.max(1, Tf * fs);

      const tPrev = this.t[e]!;
      const tNew = schmitt(this.chan(trig, e), tPrev);
      const cNew = schmitt(this.chan(cycle, e), this.c[e]!);
      this.t[e] = tNew;
      this.c[e] = cNew;

      // 1. イベント(TRIGGER → cycle)
      let stage = this.stage[e]!;
      if (tPrev === 0 && tNew === 1 && stage !== RISE) stage = RISE;
      if (cNew === 1 && stage === IDLE) stage = RISE;

      // 2. 移動
      let y = this.y[e]!;
      if (stage === RISE) {
        y = this.move(y, 10, nr, expo);
        if (this.done) stage = FALL;
      } else if (stage === FALL) {
        y = this.move(y, 0, nf, expo);
        if (this.done) stage = cNew === 1 ? RISE : IDLE;
      } else {
        y = this.move(y, inp, inp > y ? nr : nf, expo);
      }
      this.y[e] = y;
      this.stage[e] = stage;

      // 3. 出力
      this.writeOut(outP, e, y);
      this.writeOut(eorP, e, stage === FALL ? 10 : 0);
      this.writeOut(eocP, e, stage === RISE ? 0 : 10);
    }
  }

  override getState(): ModuleState {
    const n = this.n;
    return {
      y: encArr(this.y.subarray(0, n)),
      stage: Array.from(this.stage.subarray(0, n)),
      t: Array.from(this.t.subarray(0, n)),
      c: Array.from(this.c.subarray(0, n)),
    };
  }

  override setState(state: ModuleState): void {
    // 0.1 の保存データ(状態1組のスカラー)はエンジン0として読む(§9)。
    const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v === undefined ? [] : [v as T]);
    const ys = arr<EncNum>(state.y);
    const st = arr<number>(state.stage);
    const ts = arr<number>(state.t);
    const cs = arr<number>(state.c);
    const n = Math.max(1, Math.min(MAX_CHANNELS, ys.length));
    this.initEngines(0, MAX_CHANNELS);
    for (let e = 0; e < n; e++) {
      this.y[e] = e < ys.length ? decNum(ys[e]!) : 0;
      const s = st[e];
      this.stage[e] = s === RISE || s === FALL ? s : IDLE;
      this.t[e] = ts[e] ? 1 : 0;
      this.c[e] = cs[e] ? 1 : 0;
    }
    this.n = n;
  }
}
