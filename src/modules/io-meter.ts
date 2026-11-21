// MOD-IO-003 メーター/スコープ(仕様 v0.2)。
// IN を THRU へ全チャンネル素通ししながら、channel で選んだ1チャンネルを測定する:
// ブロック窓の統計(peak/rms/mean/vmin/vmax)、peak_hold、トリガ付き(または連続)の波形フレーム。
// 測定状態はモジュールに1組(COM-08 の例外)。読出し値は read() で返す。

import { ModuleDef, ModuleState, SynthModule } from "../engine/module.js";
import { clamp, roundHalfUp } from "../engine/util.js";
import { EncNum, decNum, encArr, encNum } from "../engine/codec.js";

const RING_MAX = 4096;
const U32_MAX = 4294967295;

const DEF: ModuleDef = {
  specId: "MOD-IO-003",
  specVersion: "0.2",
  title: "メーター/スコープ",
  inputs: [{ name: "IN", type: "audio", unconnected: 0 }],
  outputs: [{ name: "THRU", type: "audio" }],
  params: [
    { name: "window_ms", kind: "float", min: 1, max: 1000, default: 100, unit: "ms" },
    { name: "capture_len", kind: "int", min: 4, max: RING_MAX, default: 512, unit: "sample" },
    { name: "trig_mode", kind: "int", min: 0, max: 2, default: 1 },
    { name: "trig_level", kind: "float", min: -12, max: 12, default: 0, unit: "V" },
    // 上限は capture_len−1(step で capture_len に合わせてクランプする)
    { name: "pre", kind: "int", min: 0, max: RING_MAX - 1, default: 0, unit: "sample" },
    { name: "channel", kind: "int", min: 1, max: 16, default: 1 },
  ],
  stateful: true,
};

const inc32 = (x: number): number => Math.min(x + 1, U32_MAX);

export class IoMeterModule extends SynthModule {
  readonly def = DEF;

  // §5 の内部状態(モジュールに1組)
  private level = 0;
  private cnt = 0;
  private sum = 0;
  private sumsq = 0;
  private mn = Infinity;
  private mx = -Infinity;
  private am = 0;
  private peak = 0;
  private rms = 0;
  private mean = 0;
  private vmin = 0;
  private vmax = 0;
  private windows = 0;
  private peakHold = 0;
  /** 読出し値 nonfinite_count(測定チャンネルだけ)。COM-12 の置換カウンタ(基底の nonfiniteCount)とは別。 */
  private nfMeasured = 0;
  private readonly ring = new Float32Array(RING_MAX);
  private wp = 0;
  private prev = 0;
  private remain = -1;
  private fc = 0;
  /** 直近の完了フレーム。長さ = 現在の capture_len(整形後)。 */
  private frame = new Float32Array(0);
  private frameSeq = 0;

  constructor(fs: number) {
    super(fs);
    this.init();
  }

  /** capture_len が変わったときに初期化する状態(§5)。 */
  private initCapture(len: number): void {
    this.ring.fill(0);
    this.wp = 0;
    this.remain = -1;
    this.fc = 0;
    this.frame = new Float32Array(len);
  }

  protected resetState(): void {
    this.level = 0;
    this.cnt = 0;
    this.sum = 0;
    this.sumsq = 0;
    this.mn = Infinity;
    this.mx = -Infinity;
    this.am = 0;
    this.peak = this.rms = this.mean = this.vmin = this.vmax = 0;
    this.windows = 0;
    this.peakHold = 0;
    this.nfMeasured = 0;
    this.prev = 0;
    this.frameSeq = 0;
    this.initCapture(this.param("capture_len"));
  }

  /** 読出し値(§3)。直前に処理したサンプルの直後の値。 */
  read(withFrame = true): Record<string, number | number[]> {
    return {
      level: this.level,
      peak: this.peak,
      rms: this.rms,
      mean: this.mean,
      vmin: this.vmin,
      vmax: this.vmax,
      windows: this.windows,
      peak_hold: this.peakHold,
      nonfinite_count: this.nfMeasured,
      ...(withFrame ? { frame: Array.from(this.frame) } : {}),
      frame_seq: this.frameSeq,
    };
  }

  step(): void {
    const inp = this.inputs[0]!;
    const thru = this.outputs[0]!;
    // 0. 入力の整形。測定チャンネルの NaN/∞ は整形の前に判定する。
    const n = inp.connected ? inp.channels : 1;
    const ch = this.param("channel");
    const measured = inp.connected && ch <= n;
    if (measured && !Number.isFinite(inp.values[ch - 1]!)) this.nfMeasured = inc32(this.nfMeasured);
    this.sanitizeInput(inp, n);
    const x = measured ? inp.values[ch - 1]! : 0;
    this.level = x;

    // 1. 窓の累積
    const ax = Math.abs(x);
    this.cnt += 1;
    this.sum += x;
    this.sumsq += x * x;
    this.mn = Math.min(this.mn, x);
    this.mx = Math.max(this.mx, x);
    this.am = Math.max(this.am, ax);
    this.peakHold = Math.max(this.peakHold, ax);
    const W = Math.max(1, Math.floor((this.param("window_ms") * this.fs) / 1000 + 0.5));
    if (this.cnt >= W) {
      const rms = Math.sqrt(this.sumsq / this.cnt);
      this.peak = this.am;
      this.rms = Number.isFinite(rms) ? rms : 0; // §8
      this.mean = this.sum / this.cnt;
      this.vmin = this.mn;
      this.vmax = this.mx;
      this.windows = inc32(this.windows);
      this.cnt = 0;
      this.sum = 0;
      this.sumsq = 0;
      this.mn = Infinity;
      this.mx = -Infinity;
      this.am = 0;
    }

    // 2. 波形フレーム
    const L = this.param("capture_len");
    if (L !== this.frame.length) this.initCapture(L);
    const preRaw = this.getRawParam("pre");
    const preE = clamp(roundHalfUp(Number.isFinite(preRaw) ? preRaw : 0), 0, L - 1);
    const mode = this.param("trig_mode");
    const tl = this.param("trig_level");
    this.ring[this.wp] = x;
    this.wp = (this.wp + 1) % L;
    let done = false;
    if (mode === 0) {
      this.remain = -1;
      this.fc += 1;
      if (this.fc >= L) {
        this.fc = 0;
        done = true;
      }
    } else if (this.remain >= 0) {
      this.remain -= 1;
      if (this.remain === 0) {
        done = true;
        this.remain = -1;
      }
    } else {
      const fired = mode === 1 ? this.prev < tl && tl <= x : this.prev >= tl && tl > x;
      if (fired) {
        this.remain = L - preE - 1;
        if (this.remain === 0) {
          done = true;
          this.remain = -1;
        }
      }
    }
    this.prev = x;
    if (done) {
      for (let i = 0; i < L; i++) this.frame[i] = this.ring[(this.wp + i) % L]!;
      this.frameSeq = inc32(this.frameSeq);
    }

    // 3. 出力(全チャンネルを素通し。整形後の値なので出力側では数えない)
    thru.channels = n;
    for (let c = 0; c < n; c++) thru.values[c] = inp.connected ? inp.values[c]! : 0;
  }

  /** COM-14(§9): §5 の全変数。COM-12 の置換カウンタは保存しない。 */
  override getState(): ModuleState {
    const L = this.frame.length;
    return {
      level: encNum(this.level),
      cnt: this.cnt,
      sum: encNum(this.sum),
      sumsq: encNum(this.sumsq),
      mn: encNum(this.mn),
      mx: encNum(this.mx),
      am: encNum(this.am),
      peak: encNum(this.peak),
      rms: encNum(this.rms),
      mean: encNum(this.mean),
      vmin: encNum(this.vmin),
      vmax: encNum(this.vmax),
      windows: this.windows,
      peak_hold: encNum(this.peakHold),
      nonfinite_count: this.nfMeasured,
      ring: encArr(this.ring.subarray(0, L)),
      wp: this.wp,
      prev: encNum(this.prev),
      remain: this.remain,
      fc: this.fc,
      frame: encArr(this.frame),
      frame_seq: this.frameSeq,
    };
  }

  override setState(state: ModuleState): void {
    const s = state;
    const num = (v: unknown, d: number): number => (v === undefined ? d : decNum(v as EncNum));
    this.level = num(s.level, 0);
    this.cnt = num(s.cnt, 0);
    this.sum = num(s.sum, 0);
    this.sumsq = num(s.sumsq, 0);
    this.mn = num(s.mn, Infinity);
    this.mx = num(s.mx, -Infinity);
    this.am = num(s.am, 0);
    this.peak = num(s.peak, 0);
    this.rms = num(s.rms, 0);
    this.mean = num(s.mean, 0);
    this.vmin = num(s.vmin, 0);
    this.vmax = num(s.vmax, 0);
    this.windows = num(s.windows, 0);
    this.peakHold = num(s.peak_hold, 0);
    this.nfMeasured = num(s.nonfinite_count, 0);
    const frame = Array.isArray(s.frame) ? (s.frame as EncNum[]) : undefined;
    const L = frame ? clamp(frame.length, 4, RING_MAX) : this.param("capture_len");
    this.initCapture(L);
    if (frame) for (let i = 0; i < L; i++) this.frame[i] = i < frame.length ? decNum(frame[i]!) : 0;
    if (Array.isArray(s.ring)) {
      const ring = s.ring as EncNum[];
      for (let i = 0; i < L && i < ring.length; i++) this.ring[i] = decNum(ring[i]!);
    }
    this.wp = num(s.wp, 0);
    this.prev = num(s.prev, 0);
    this.remain = num(s.remain, -1);
    this.fc = num(s.fc, 0);
    this.frameSeq = num(s.frame_seq, 0);
  }
}
