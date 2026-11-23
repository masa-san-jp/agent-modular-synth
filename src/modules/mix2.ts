// MOD-MIX-002 ミキサー卓(8チャンネル)(仕様 v0.1)。
// チャンネルごとに「入力(ポリは全チャンネルを加算)→ 平滑した音量 → パンで左右へ、センド量でセンドへ」。
// あわせて、チャンネルごと・出力・センドの音量と、低・中・高の帯域の量を窓ごとに測る(読出し値。read())。

import { EncNum, decInto, decNum, encArr, encNum } from "../engine/codec.js";
import { InPort, ModuleDef, ModuleState, ParamDef, SynthModule } from "../engine/module.js";
import { V_LIMIT, clamp } from "../engine/util.js";

const CH = 8;
/** 音量の平滑の時定数 [s](仕様 §6。MOD-IO-001 と同じ値)。 */
const TAU = 0.005;
/** 帯域を分ける周波数 [Hz]。 */
const F_LOW = 200;
const F_HIGH = 2000;
const U32_MAX = 4294967295;

const each = (make: (i: number) => ParamDef): ParamDef[] => Array.from({ length: CH }, (_, k) => make(k + 1));

const DEF: ModuleDef = {
  specId: "MOD-MIX-002",
  specVersion: "0.1",
  title: "ミキサー卓(8チャンネル)",
  inputs: Array.from({ length: CH }, (_, k) => ({ name: `in${k + 1}`, type: "audio" as const, unconnected: 0 })),
  outputs: [
    { name: "L", type: "audio" },
    { name: "R", type: "audio" },
    { name: "SEND", type: "audio" },
  ],
  params: [
    ...each((i) => ({ name: `level[${i}]`, kind: "float", min: 0, max: 1, default: 0.7 })),
    ...each((i) => ({ name: `pan[${i}]`, kind: "float", min: -1, max: 1, default: 0 })),
    ...each((i) => ({ name: `mute[${i}]`, kind: "bool", min: 0, max: 1, default: 0 })),
    ...each((i) => ({ name: `solo[${i}]`, kind: "bool", min: 0, max: 1, default: 0 })),
    ...each((i) => ({ name: `send[${i}]`, kind: "float", min: 0, max: 1, default: 0 })),
    { name: "master", kind: "float", min: 0, max: 1, default: 1 },
    { name: "window_ms", kind: "float", min: 10, max: 2000, default: 300 },
  ],
  stateful: true,
};

/** 読出し値の項目(仕様 §3)。 */
export const MIX2_READOUTS = [
  "ch_peak", "ch_rms", "ch_low", "ch_mid", "ch_high",
  "out_peak", "out_rms", "out_low", "out_mid", "out_high",
  "send_peak", "send_rms", "ch_audible", "windows",
] as const;

const rmsOf = (sumsq: number, n: number): number => {
  const r = Math.sqrt(sumsq / n);
  return Number.isFinite(r) ? r : 0; // §8
};

export class Mix2Module extends SynthModule {
  readonly def = DEF;

  // ---- パラメータの有効値の控え(パラメータが変わったときだけ作り直す。毎サンプル名前で引かない) ----
  private dirty = true;
  private readonly pTarget = new Float64Array(CH); // 音量の目標値(ミュート・ソロを反映)
  private readonly pCos = new Float64Array(CH);
  private readonly pSin = new Float64Array(CH);
  private readonly pSend = new Float64Array(CH);
  private readonly pAudible = new Uint8Array(CH);
  private pMaster = 1;
  private pWindowMs = 300;

  // ---- 状態(§5) ----
  private readonly g = new Float64Array(CH);
  private gm = 1;
  private readonly lp200 = new Float64Array(CH);
  private readonly lp2k = new Float64Array(CH);
  private oLp200 = 0;
  private oLp2k = 0;
  // 窓の累積
  private cnt = 0;
  private readonly aPk = new Float64Array(CH);
  private readonly aSq = new Float64Array(CH);
  private readonly aLo = new Float64Array(CH);
  private readonly aMi = new Float64Array(CH);
  private readonly aHi = new Float64Array(CH);
  private readonly aOut = new Float64Array(9); // [pkL, pkR, sqL, sqR, lo, mi, hi, pkS, sqS]
  // 読出し値
  private readonly rPk = new Float64Array(CH);
  private readonly rRms = new Float64Array(CH);
  private readonly rLo = new Float64Array(CH);
  private readonly rMi = new Float64Array(CH);
  private readonly rHi = new Float64Array(CH);
  private readonly rOut = new Float64Array(9); // [pkL, pkR, rmsL, rmsR, lo, mi, hi, pkS, rmsS]
  private windows = 0;

  constructor(fs: number) {
    super(fs);
    this.init();
  }

  override setParam(name: string, value: number): void {
    super.setParam(name, value);
    this.dirty = true;
  }

  /** パラメータの有効値から、毎サンプル使う値を作る(仕様 §6 の 2)。 */
  private refresh(): void {
    let anySolo = false;
    for (let i = 1; i <= CH; i++) if (this.param(`solo[${i}]`) !== 0) anySolo = true;
    for (let k = 0; k < CH; k++) {
      const i = k + 1;
      const audible = this.param(`mute[${i}]`) === 0 && (!anySolo || this.param(`solo[${i}]`) !== 0);
      this.pAudible[k] = audible ? 1 : 0;
      this.pTarget[k] = audible ? this.param(`level[${i}]`) : 0;
      const theta = ((this.param(`pan[${i}]`) + 1) * Math.PI) / 4;
      this.pCos[k] = Math.cos(theta);
      this.pSin[k] = Math.sin(theta);
      this.pSend[k] = this.param(`send[${i}]`);
    }
    this.pMaster = this.param("master");
    this.pWindowMs = this.param("window_ms");
    this.dirty = false;
  }

  private clearWindow(): void {
    this.cnt = 0;
    this.aPk.fill(0);
    this.aSq.fill(0);
    this.aLo.fill(0);
    this.aMi.fill(0);
    this.aHi.fill(0);
    this.aOut.fill(0);
  }

  protected resetState(): void {
    this.refresh();
    this.g.set(this.pTarget); // 初期値は目標値(平滑の途中から始まらない)
    this.gm = this.pMaster;
    this.lp200.fill(0);
    this.lp2k.fill(0);
    this.oLp200 = 0;
    this.oLp2k = 0;
    this.clearWindow();
    this.rPk.fill(0);
    this.rRms.fill(0);
    this.rLo.fill(0);
    this.rMi.fill(0);
    this.rHi.fill(0);
    this.rOut.fill(0);
    this.windows = 0;
  }

  /** 接続された入力の全チャンネルを昇順に加算(倍精度)。非有限のチャンネルは 0 V として数える。 */
  private sum(port: InPort): number {
    this.sanitizeInput(port, port.channels);
    let s = 0;
    for (let c = 0; c < port.channels; c++) s += port.values[c]!;
    return s;
  }

  step(): void {
    if (this.dirty) this.refresh();
    const fs = this.fs;
    const a = 1 - Math.exp(-1 / (TAU * fs));
    const aL = 1 - Math.exp((-2 * Math.PI * F_LOW) / fs);
    const aH = 1 - Math.exp((-2 * Math.PI * F_HIGH) / fs);
    let busL = 0;
    let busR = 0;
    let busS = 0;
    for (let k = 0; k < CH; k++) {
      const port = this.inputs[k]!;
      const x = port.connected ? this.sum(port) : 0;
      this.g[k] = this.g[k]! + a * (this.pTarget[k]! - this.g[k]!);
      const v = this.g[k]! * x;
      // 何も来ていないチャンネル(信号もフィルタの残りも 0)は、足しても変わらないので飛ばす
      if (v === 0 && this.lp200[k] === 0 && this.lp2k[k] === 0) continue;
      busL += v * this.pCos[k]!;
      busR += v * this.pSin[k]!;
      busS += v * this.pSend[k]!;
      this.lp200[k] = this.lp200[k]! + aL * (v - this.lp200[k]!);
      this.lp2k[k] = this.lp2k[k]! + aH * (v - this.lp2k[k]!);
      const lo = this.lp200[k]!;
      const mi = this.lp2k[k]! - lo;
      const hi = v - this.lp2k[k]!;
      const av = Math.abs(v);
      if (av > this.aPk[k]!) this.aPk[k] = av;
      this.aSq[k] = this.aSq[k]! + v * v;
      this.aLo[k] = this.aLo[k]! + lo * lo;
      this.aMi[k] = this.aMi[k]! + mi * mi;
      this.aHi[k] = this.aHi[k]! + hi * hi;
    }
    this.gm = this.gm + a * (this.pMaster - this.gm);
    const L = clamp(this.gm * busL, -V_LIMIT, V_LIMIT);
    const R = clamp(this.gm * busR, -V_LIMIT, V_LIMIT);
    const S = clamp(busS, -V_LIMIT, V_LIMIT);
    const o = this.outputs;
    o[0]!.channels = 1;
    o[1]!.channels = 1;
    o[2]!.channels = 1;
    this.writeOut(o[0]!, 0, L);
    this.writeOut(o[1]!, 0, R);
    this.writeOut(o[2]!, 0, S);

    // 出力のメーター
    const m = (L + R) / 2;
    this.oLp200 += aL * (m - this.oLp200);
    this.oLp2k += aH * (m - this.oLp2k);
    const lo = this.oLp200;
    const mi = this.oLp2k - lo;
    const hi = m - this.oLp2k;
    const A = this.aOut;
    if (Math.abs(L) > A[0]!) A[0] = Math.abs(L);
    if (Math.abs(R) > A[1]!) A[1] = Math.abs(R);
    A[2] = A[2]! + L * L;
    A[3] = A[3]! + R * R;
    A[4] = A[4]! + lo * lo;
    A[5] = A[5]! + mi * mi;
    A[6] = A[6]! + hi * hi;
    if (Math.abs(S) > A[7]!) A[7] = Math.abs(S);
    A[8] = A[8]! + S * S;

    // 窓を閉じる
    this.cnt += 1;
    const W = Math.max(1, Math.floor((this.pWindowMs * fs) / 1000 + 0.5));
    if (this.cnt >= W) {
      const n = this.cnt;
      for (let k = 0; k < CH; k++) {
        this.rPk[k] = this.aPk[k]!;
        this.rRms[k] = rmsOf(this.aSq[k]!, n);
        this.rLo[k] = rmsOf(this.aLo[k]!, n);
        this.rMi[k] = rmsOf(this.aMi[k]!, n);
        this.rHi[k] = rmsOf(this.aHi[k]!, n);
      }
      const r = this.rOut;
      r[0] = A[0]!;
      r[1] = A[1]!;
      r[2] = rmsOf(A[2]!, n);
      r[3] = rmsOf(A[3]!, n);
      r[4] = rmsOf(A[4]!, n);
      r[5] = rmsOf(A[5]!, n);
      r[6] = rmsOf(A[6]!, n);
      r[7] = A[7]!;
      r[8] = rmsOf(A[8]!, n);
      this.windows = Math.min(this.windows + 1, U32_MAX);
      this.clearWindow();
    }
  }

  /** 読出し値(§3)。直前に処理したサンプルの直後の値。 */
  read(): Record<string, number | number[]> {
    if (this.dirty) this.refresh();
    const r = this.rOut;
    return {
      ch_peak: Array.from(this.rPk),
      ch_rms: Array.from(this.rRms),
      ch_low: Array.from(this.rLo),
      ch_mid: Array.from(this.rMi),
      ch_high: Array.from(this.rHi),
      out_peak: [r[0]!, r[1]!],
      out_rms: [r[2]!, r[3]!],
      out_low: r[4]!,
      out_mid: r[5]!,
      out_high: r[6]!,
      send_peak: r[7]!,
      send_rms: r[8]!,
      ch_audible: Array.from(this.pAudible),
      windows: this.windows,
    };
  }

  /** COM-14: §5 の状態をすべて保存する(nonfinite_count は保存しない)。 */
  override getState(): ModuleState {
    return {
      g: encArr(this.g),
      gm: encNum(this.gm),
      lp200: encArr(this.lp200),
      lp2k: encArr(this.lp2k),
      o_lp: [encNum(this.oLp200), encNum(this.oLp2k)],
      cnt: this.cnt,
      acc: [this.aPk, this.aSq, this.aLo, this.aMi, this.aHi, this.aOut].map((x) => encArr(x)),
      read: [this.rPk, this.rRms, this.rLo, this.rMi, this.rHi, this.rOut].map((x) => encArr(x)),
      windows: this.windows,
    };
  }

  override setState(state: ModuleState): void {
    const arr = (v: unknown, dst: Float64Array): void => {
      if (Array.isArray(v)) decInto(v as EncNum[], dst);
    };
    arr(state.g, this.g);
    if (state.gm !== undefined) this.gm = decNum(state.gm as EncNum);
    arr(state.lp200, this.lp200);
    arr(state.lp2k, this.lp2k);
    if (Array.isArray(state.o_lp)) {
      this.oLp200 = decNum(state.o_lp[0] as EncNum);
      this.oLp2k = decNum(state.o_lp[1] as EncNum);
    }
    if (typeof state.cnt === "number") this.cnt = state.cnt;
    if (Array.isArray(state.acc)) [this.aPk, this.aSq, this.aLo, this.aMi, this.aHi, this.aOut].forEach((dst, i) => arr((state.acc as unknown[])[i], dst));
    if (Array.isArray(state.read)) [this.rPk, this.rRms, this.rLo, this.rMi, this.rHi, this.rOut].forEach((dst, i) => arr((state.read as unknown[])[i], dst));
    if (typeof state.windows === "number") this.windows = state.windows;
  }
}
