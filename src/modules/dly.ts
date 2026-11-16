// MOD-DLY-001 ディレイ(仕様 v0.2)。
// 循環バッファ(L = round(2.0·fs) + 2)を書き込みより前に線形補間で読み、フィードバックを足して書く(§6)。
// 主入力は in(N を決める)、副入力は time_cv。buf と w はエンジンごと(バッファは使うエンジンの分だけ確保)。

import { EncNum, decNum, encArr } from "../engine/codec.js";
import { ModuleDef, ModuleState, SynthModule } from "../engine/module.js";
import { MAX_CHANNELS, V_LIMIT, clamp } from "../engine/util.js";

const DEF: ModuleDef = {
  specId: "MOD-DLY-001",
  specVersion: "0.2",
  title: "ディレイ",
  inputs: [
    { name: "in", type: "audio", unconnected: 0 },
    { name: "time_cv", type: "cv", unconnected: 0 },
  ],
  outputs: [{ name: "out", type: "audio" }],
  params: [
    { name: "time", kind: "float", min: 0, max: 2.0, default: 0.25, unit: "s" },
    { name: "feedback", kind: "float", min: 0, max: 1, default: 0.0 },
    { name: "mix", kind: "float", min: 0, max: 1, default: 0.5 },
  ],
  stateful: true,
};

const T_MAX = 2.0;

export class DlyModule extends SynthModule {
  readonly def = DEF;

  // エンジンごとの状態(§5)。先頭 n 組が有効。bufs[c] は必要になったときに確保する。
  private n = 1;
  private len = 0;
  private bufs: (Float32Array | null)[] = [];
  private readonly w = new Int32Array(MAX_CHANNELS);

  constructor(fs: number) {
    super(fs);
    this.init();
  }

  /** バッファ長 L(§5)。 */
  get bufferLength(): number {
    return this.len;
  }

  protected resetState(): void {
    // fs 変更時もここを通る(L を再計算して確保し直す)。
    this.len = Math.round(T_MAX * this.fs) + 2;
    this.bufs = new Array<Float32Array | null>(MAX_CHANNELS).fill(null);
    this.w.fill(0);
    for (let c = 0; c < this.n; c++) this.bufs[c] = new Float32Array(this.len);
  }

  /** エンジン数を n にする。増えたエンジンは初期状態、減ったエンジンのバッファは破棄(COM-08)。 */
  private setEngines(n: number): void {
    for (let c = this.n; c < n; c++) {
      this.bufs[c] = new Float32Array(this.len);
      this.w[c] = 0;
    }
    for (let c = n; c < this.n; c++) {
      this.bufs[c] = null;
      this.w[c] = 0;
    }
    this.n = n;
  }

  step(): void {
    const inp = this.inputs[0]!;
    const tcvIn = this.inputs[1]!;
    const out = this.outputs[0]!;

    // COM-08: N = 主入力 in のチャンネル数(未接続なら 1)。
    const n = inp.connected ? inp.channels : 1;
    if (n !== this.n) this.setEngines(n);

    // COM-12: 読むチャンネルだけを整形して数える。
    this.sanitizeInput(inp, n);
    this.sanitizeInput(tcvIn, n);

    const fs = this.fs;
    const L = this.len;
    const time = this.param("time");
    const fb = this.param("feedback");
    const m = this.param("mix");
    const dMax = T_MAX * fs;

    out.channels = n;
    for (let c = 0; c < n; c++) {
      // 1) 入力
      const x = inp.connected ? inp.values[c]! : 0;
      const tcv = this.chan(tcvIn, c);

      // 2) 有効値
      const t = clamp(time + 0.1 * tcv, 1 / fs, T_MAX);
      const d = clamp(t * fs, 1, dMax);
      const i = Math.floor(d);
      const fr = d - i;

      // 3) 遅延出力を読む(書き込みより前)
      const buf = this.bufs[c]!;
      const w = this.w[c]!;
      let r0 = w - i;
      if (r0 < 0) r0 += L;
      let r1 = r0 - 1;
      if (r1 < 0) r1 += L;
      const yd = buf[r0]! * (1 - fr) + buf[r1]! * fr;

      // 4) バッファへ書く、書き込み位置を進める
      buf[w] = clamp(x + fb * yd, -V_LIMIT, V_LIMIT);
      this.w[c] = w + 1 === L ? 0 : w + 1;

      // 5) 出力
      this.writeOut(out, c, clamp((1 - m) * x + m * yd, -V_LIMIT, V_LIMIT));
    }
  }

  override getState(): ModuleState {
    const buf: EncNum[][] = [];
    for (let c = 0; c < this.n; c++) buf.push(encArr(this.bufs[c]!));
    return { fs: this.fs, w: Array.from(this.w.subarray(0, this.n)), buf };
  }

  override setState(state: ModuleState): void {
    this.n = 1;
    this.resetState();
    // fs が保存時と異なる場合は復元せず初期化する(§9)。
    if (typeof state.fs === "number" && state.fs !== this.fs) return;
    const raw = Array.isArray(state.buf) ? (state.buf as unknown[]) : [];
    // 0.1 の保存データ(バッファ1本 = 数の配列、w はスカラー)はエンジン0として読む(§9)。
    const sets: EncNum[][] = raw.length > 0 && !Array.isArray(raw[0]) ? [raw as EncNum[]] : (raw as EncNum[][]);
    const ws: number[] = Array.isArray(state.w) ? (state.w as number[]) : state.w === undefined ? [] : [state.w as number];
    const n = Math.max(1, Math.min(MAX_CHANNELS, sets.length));
    this.setEngines(n);
    const L = this.len;
    for (let c = 0; c < Math.min(n, sets.length); c++) {
      const a = sets[c]!;
      const b = this.bufs[c]!;
      const k = Math.min(L, a.length);
      for (let j = 0; j < k; j++) b[j] = decNum(a[j]!);
      const w = Math.floor(Number(ws[c] ?? 0));
      this.w[c] = Number.isFinite(w) ? ((w % L) + L) % L : 0;
    }
  }
}
