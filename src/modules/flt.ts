// MOD-FLT-001 ローパスフィルタ(ラダー系)(仕様 v0.2)。
// TPT の1極ローパス4段 + 零遅延フィードバック(§6)。フィードバック量にだけ 4·tanh(k·y4/4) の飽和。
// 主入力は in(N を決める)、副入力は cv1/cv2/cv3/res_cv。状態 s[0..3] はエンジンごと(倍精度で保持)。

import { EncNum, decNum, encArr } from "../engine/codec.js";
import { ModuleDef, ModuleState, SynthModule } from "../engine/module.js";
import { MAX_CHANNELS, V_LIMIT, clamp } from "../engine/util.js";

const DEF: ModuleDef = {
  specId: "MOD-FLT-001",
  specVersion: "0.2",
  title: "ローパスフィルタ(ラダー系)",
  inputs: [
    { name: "in", type: "audio", unconnected: 0 },
    { name: "cv1", type: "pitch", unconnected: 0 },
    { name: "cv2", type: "cv", unconnected: 0 },
    { name: "cv3", type: "cv", unconnected: 0 },
    { name: "res_cv", type: "cv", unconnected: 0 },
  ],
  outputs: [{ name: "out", type: "audio" }],
  params: [
    { name: "cutoff", kind: "float", min: -5, max: 6, default: 3.0 },
    { name: "res", kind: "float", min: 0, max: 1, default: 0.0 },
    { name: "cv2_level", kind: "float", min: -1, max: 1, default: 1.0 },
    { name: "cv3_level", kind: "float", min: -1, max: 1, default: 1.0 },
  ],
  stateful: true,
};

const F_C4 = 261.6256;
const STAGES = 4;

export class FltModule extends SynthModule {
  readonly def = DEF;

  // エンジンごとの状態(§5)。s[c*4 + i]。先頭 n 組が有効。
  private n = 1;
  // カットオフ → 係数 g の控え(同じカットオフが続く間は、べき乗と tan を計算し直さない。結果は同じ)
  private readonly lastV = new Float64Array(MAX_CHANNELS).fill(NaN);
  private readonly lastG = new Float64Array(MAX_CHANNELS);
  private readonly s = new Float64Array(MAX_CHANNELS * STAGES);

  constructor(fs: number) {
    super(fs);
    this.init();
  }

  private initEngines(from: number, to: number): void {
    this.s.fill(0, from * STAGES, to * STAGES);
  }

  protected resetState(): void {
    this.initEngines(0, MAX_CHANNELS);
  }

  step(): void {
    const inp = this.inputs[0]!;
    const cv1 = this.inputs[1]!;
    const cv2 = this.inputs[2]!;
    const cv3 = this.inputs[3]!;
    const rcv = this.inputs[4]!;
    const out = this.outputs[0]!;

    // COM-08: N = 主入力 in のチャンネル数(未接続なら 1)。増えたエンジンは初期状態。
    const n = inp.connected ? inp.channels : 1;
    if (n > this.n) this.initEngines(this.n, n);
    this.n = n;

    // COM-12: 読むチャンネルだけを整形して数える。
    this.sanitizeInput(inp, n);
    this.sanitizeInput(cv1, n);
    this.sanitizeInput(cv2, n);
    this.sanitizeInput(cv3, n);
    this.sanitizeInput(rcv, n);

    const fs = this.fs;
    const cutoff = this.param("cutoff");
    const res = this.param("res");
    const l2 = this.param("cv2_level");
    const l3 = this.param("cv3_level");
    const fcMax = Math.min(20000, 0.45 * fs);
    const s = this.s;

    out.channels = n;
    for (let c = 0; c < n; c++) {
      // 1) 入力
      const x = inp.connected ? inp.values[c]! : 0;
      const v1 = this.chan(cv1, c);
      const v2 = this.chan(cv2, c);
      const v3 = this.chan(cv3, c);
      const vr = this.chan(rcv, c);

      // 2) 係数
      const V = clamp(cutoff + v1 + l2 * v2 + l3 * v3, -10, 10);
      if (V !== this.lastV[c]) {
        this.lastV[c] = V;
        this.lastG[c] = Math.tan((Math.PI * clamp(F_C4 * Math.pow(2, V), 8, fcMax)) / fs);
      }
      const g = this.lastG[c]!;
      const G = g / (1 + g);
      const r = clamp(res + 0.1 * vr, 0, 1);
      const k = 5.0 * r;

      // 3) 状態更新(零遅延フィードバックの解)
      const b = c * STAGES;
      const d = 1 + g;
      const sg0 = s[b]! / d;
      const sg1 = s[b + 1]! / d;
      const sg2 = s[b + 2]! / d;
      const sg3 = s[b + 3]! / d;
      const G2 = G * G;
      const G3 = G2 * G;
      const G4 = G3 * G;
      const S = G3 * sg0 + G2 * sg1 + G * sg2 + sg3;
      const xn = x / 5.0;
      const y4e = (G4 * xn + S) / (1 + k * G4);
      const fb = 4.0 * Math.tanh((k * y4e) / 4.0);
      const u = xn - fb;

      const y1 = G * u + sg0;
      const y2 = G * y1 + sg1;
      const y3 = G * y2 + sg2;
      const y4 = G * y3 + sg3;
      const n0 = 2 * y1 - s[b]!;
      const n1 = 2 * y2 - s[b + 1]!;
      const n2 = 2 * y3 - s[b + 2]!;
      const n3 = 2 * y4 - s[b + 3]!;

      // 4) 出力
      const y = 5.0 * y4;
      if (
        !Number.isFinite(n0) ||
        !Number.isFinite(n1) ||
        !Number.isFinite(n2) ||
        !Number.isFinite(n3) ||
        !Number.isFinite(y)
      ) {
        // COM-12: 出力保護。状態を 0 に戻し、0 を出力して1回数える。
        s[b] = 0;
        s[b + 1] = 0;
        s[b + 2] = 0;
        s[b + 3] = 0;
        out.values[c] = 0;
        this.nonfiniteCount++;
      } else {
        s[b] = n0;
        s[b + 1] = n1;
        s[b + 2] = n2;
        s[b + 3] = n3;
        out.values[c] = clamp(y, -V_LIMIT, V_LIMIT);
      }
    }
  }

  override getState(): ModuleState {
    const s: EncNum[][] = [];
    for (let c = 0; c < this.n; c++) s.push(encArr(this.s.subarray(c * STAGES, (c + 1) * STAGES)));
    return { s };
  }

  override setState(state: ModuleState): void {
    const raw = Array.isArray(state.s) ? (state.s as unknown[]) : [];
    // 0.1 の保存データ(状態1組 = 数の配列)はエンジン0として読む(§9)。
    const sets: EncNum[][] = raw.length > 0 && !Array.isArray(raw[0]) ? [raw as EncNum[]] : (raw as EncNum[][]);
    const n = Math.max(1, Math.min(MAX_CHANNELS, sets.length));
    this.initEngines(0, MAX_CHANNELS);
    for (let c = 0; c < Math.min(n, sets.length); c++) {
      const a = sets[c]!;
      for (let i = 0; i < STAGES; i++) this.s[c * STAGES + i] = i < a.length ? decNum(a[i]!) : 0;
    }
    this.n = n;
  }
}
