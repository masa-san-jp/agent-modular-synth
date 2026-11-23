// MOD-LGC-001 論理・比較(仕様 v0.2)。
// a/b をシュミットで2値化した AND/OR/XOR/NOT と、a と基準(b または ref)のヒステリシス付き比較。
// 主入力は a と b(N を決める)。状態 sa, sb, cmp_s はエンジンごと。

import { ModuleDef, ModuleState, SynthModule } from "../engine/module.js";
import { GATE_OFF, GATE_ON, MAX_CHANNELS } from "../engine/util.js";

const DEF: ModuleDef = {
  specId: "MOD-LGC-001",
  specVersion: "0.2",
  title: "論理・比較",
  inputs: [
    { name: "a", type: "gate", unconnected: 0 },
    // 論理では未接続 0 V。比較の基準は未接続時パラメータ ref(normal=ref)。
    { name: "b", type: "gate", unconnected: 0 },
  ],
  outputs: [
    { name: "and", type: "gate" },
    { name: "or", type: "gate" },
    { name: "xor", type: "gate" },
    { name: "not", type: "gate" },
    { name: "cmp", type: "gate" },
  ],
  params: [
    { name: "ref", kind: "float", min: -12, max: 12, default: 0 },
    { name: "hyst", kind: "float", min: 0, max: 10, default: 0 },
  ],
  stateful: true,
};

// ポート値は float32(COM-02)。0.1 V を float32 にした値(0.100000001…)は倍精度の 0.1 より大きいので、
// OFF 閾値も float32 に丸めて比べる(「0.1 V で low」。倍精度の 0.1 と比べると 0.1 V の入力で low にならない)。
const OFF_F32 = Math.fround(GATE_OFF);

/** COM-04 のシュミット検出。新しい状態を返す。 */
function schmitt(v: number, state: number): number {
  if (state === 0) return v >= GATE_ON ? 1 : 0;
  return v <= OFF_F32 ? 0 : 1;
}

export class LgcModule extends SynthModule {
  readonly def = DEF;

  // エンジンごとの状態(§5)。先頭 n 組が有効。
  private n = 1;
  private readonly sa = new Uint8Array(MAX_CHANNELS);
  private readonly sb = new Uint8Array(MAX_CHANNELS);
  private readonly cmpS = new Uint8Array(MAX_CHANNELS);

  constructor(fs: number) {
    super(fs);
    this.init();
  }

  private initEngines(from: number, to: number): void {
    for (let e = from; e < to; e++) {
      this.sa[e] = 0;
      this.sb[e] = 0;
      this.cmpS[e] = 0;
    }
  }

  protected resetState(): void {
    this.initEngines(0, MAX_CHANNELS);
    this.n = 1;
  }

  step(): void {
    const aP = this.inputs[0]!;
    const bP = this.inputs[1]!;
    const o = this.outputs;

    // COM-08: N = 主入力 a, b のチャンネル数の最大値(両方未接続なら 1)。増えたエンジンは初期状態。
    const n = Math.max(1, this.chCount(aP), this.chCount(bP));
    if (n > this.n) this.initEngines(this.n, n);
    this.n = n;

    // COM-12: 読むチャンネルだけを整形して数える(論理と比較で使っても1回)。
    this.sanitizeInput(aP, n);
    this.sanitizeInput(bP, n);

    const ref = this.param("ref");
    const h = this.param("hyst");
    const bConnected = bP.connected;

    for (let i = 0; i < 5; i++) o[i]!.channels = n;
    for (let e = 0; e < n; e++) {
      const a = this.chan(aP, e);
      const b = this.chan(bP, e); // 未接続は 0 V

      // 1. 論理
      const sa = schmitt(a, this.sa[e]!);
      const sb = schmitt(b, this.sb[e]!);
      this.sa[e] = sa;
      this.sb[e] = sb;

      // 2. 比較(b の接続判定はポート単位。不足チャンネルは 0 V で ref ではない)
      const base = bConnected ? b : ref;
      const d = a - base;
      let cs = this.cmpS[e]!;
      if (d > h) cs = 1;
      else if (d < -h) cs = 0;
      this.cmpS[e] = cs;

      this.writeOut(o[0]!, e, 10 * (sa & sb));
      this.writeOut(o[1]!, e, 10 * (sa | sb));
      this.writeOut(o[2]!, e, 10 * (sa ^ sb));
      this.writeOut(o[3]!, e, 10 * (1 - sa));
      this.writeOut(o[4]!, e, 10 * cs);
    }
  }

  override getState(): ModuleState {
    const n = this.n;
    return {
      sa: Array.from(this.sa.subarray(0, n)),
      sb: Array.from(this.sb.subarray(0, n)),
      cmp_s: Array.from(this.cmpS.subarray(0, n)),
    };
  }

  override setState(state: ModuleState): void {
    // 0.1 の保存データ(状態1組のスカラー)はエンジン0として読む(§9)。
    const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
    const sa = arr(state.sa);
    const sb = arr(state.sb);
    const cs = arr(state.cmp_s);
    const n = Math.max(1, Math.min(MAX_CHANNELS, sa.length));
    this.initEngines(0, MAX_CHANNELS);
    for (let e = 0; e < n; e++) {
      this.sa[e] = sa[e] ? 1 : 0;
      this.sb[e] = sb[e] ? 1 : 0;
      this.cmpS[e] = cs[e] ? 1 : 0;
    }
    this.n = n;
  }
}
