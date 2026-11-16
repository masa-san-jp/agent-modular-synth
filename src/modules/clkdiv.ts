// MOD-CLK-002 クロック分周(仕様 v0.2)。
// clock の立ち上がりを数え、1/2〜1/64 の固定分周6出力と可変分周(division)1出力をデューティ約50%のゲートで出す。
// 主入力は clock(N を決める)、副入力は reset(レベル型。high の間は全出力0、解除後 1 ms は CLOCK を無視)。

import { ModuleDef, ModuleState, SynthModule } from "../engine/module.js";
import { GATE_OFF, GATE_ON, MAX_CHANNELS, resetIgnoreSamples } from "../engine/util.js";

const DEF: ModuleDef = {
  specId: "MOD-CLK-002",
  specVersion: "0.2",
  title: "クロック分周",
  inputs: [
    { name: "clock", type: "clock", unconnected: 0 },
    { name: "reset", type: "gate", unconnected: 0 },
  ],
  outputs: [
    { name: "out2", type: "gate" },
    { name: "out4", type: "gate" },
    { name: "out8", type: "gate" },
    { name: "out16", type: "gate" },
    { name: "out32", type: "gate" },
    { name: "out64", type: "gate" },
    { name: "out_div", type: "gate" },
  ],
  params: [{ name: "division", kind: "int", min: 2, max: 64, default: 3 }],
  stateful: true,
};

const NOUT = 7;
const FIXED = [2, 4, 8, 16, 32, 64] as const;

// ポート値は float32(COM-02)。0.1 V を float32 にした値(0.100000001…)は倍精度の 0.1 より大きいので、
// OFF 閾値も float32 に丸めて比べる(「0.1 V で low」。倍精度の 0.1 と比べると 0.1 V の入力で low にならない)。
const OFF_F32 = Math.fround(GATE_OFF);

/** COM-04 のシュミット検出。新しい状態を返す。 */
function schmitt(v: number, state: number): number {
  if (state === 0) return v >= GATE_ON ? 1 : 0;
  return v <= OFF_F32 ? 0 : 1;
}

export class ClkDivModule extends SynthModule {
  readonly def = DEF;

  // エンジンごとの状態(§5)。先頭 n 組が有効。c, hi はエンジン e・出力 i を [e*7+i] に置く。
  private n = 1;
  private readonly cs = new Uint8Array(MAX_CHANNELS);
  private readonly rs = new Uint8Array(MAX_CHANNELS);
  private readonly cnt = new Int32Array(MAX_CHANNELS * NOUT);
  private readonly hi = new Uint8Array(MAX_CHANNELS * NOUT);
  private readonly guard = new Int32Array(MAX_CHANNELS);
  private readonly div: number[] = [...FIXED, 3];

  constructor(fs: number) {
    super(fs);
    this.init();
  }

  /** 現在の分周比 N = [2,4,8,16,32,64,division] を this.div に入れる。 */
  private loadDiv(): void {
    this.div[NOUT - 1] = this.param("division"); // NaN/∞ は既定3、四捨五入→クランプ(COM-12/13)
  }

  private initEngines(from: number, to: number): void {
    this.loadDiv();
    for (let e = from; e < to; e++) {
      this.cs[e] = 0;
      this.rs[e] = 0;
      this.guard[e] = 0;
      for (let i = 0; i < NOUT; i++) {
        this.cnt[e * NOUT + i] = this.div[i]! - 1;
        this.hi[e * NOUT + i] = 0;
      }
    }
  }

  protected resetState(): void {
    this.initEngines(0, MAX_CHANNELS);
    this.n = 1;
  }

  step(): void {
    const clock = this.inputs[0]!;
    const reset = this.inputs[1]!;

    // COM-08: N = 主入力 clock のチャンネル数(未接続なら 1)。増えたエンジンは初期状態。
    const n = clock.connected ? clock.channels : 1;
    if (n > this.n) this.initEngines(this.n, n);
    this.n = n;

    // COM-12: 読むチャンネルだけを整形して数える。
    this.sanitizeInput(clock, n);
    this.sanitizeInput(reset, n);

    this.loadDiv();
    const div = this.div;
    const guardLen = resetIgnoreSamples(this.fs);

    for (let i = 0; i < NOUT; i++) this.outputs[i]!.channels = n;
    for (let e = 0; e < n; e++) {
      const base = e * NOUT;
      const cp = this.cs[e]!;
      const csNew = schmitt(clock.connected ? clock.values[e]! : 0, cp);
      const rsNew = schmitt(this.chan(reset, e), this.rs[e]!);
      this.cs[e] = csNew;
      this.rs[e] = rsNew;
      const edge = cp === 0 && csNew === 1;

      // division 変更時の折り返し
      for (let i = 0; i < NOUT; i++) {
        if (this.cnt[base + i]! >= div[i]!) this.cnt[base + i] = this.cnt[base + i]! % div[i]!;
      }

      if (rsNew === 1) {
        // COM-07: RESET(レベル)が最優先
        for (let i = 0; i < NOUT; i++) {
          this.cnt[base + i] = div[i]! - 1;
          this.hi[base + i] = 0;
        }
        this.guard[e] = guardLen;
      } else if (this.guard[e]! > 0) {
        this.guard[e] = this.guard[e]! - 1; // リセット解除後の 1 ms は CLOCK を無視
      } else if (edge) {
        for (let i = 0; i < NOUT; i++) {
          const N = div[i]!;
          const c = (this.cnt[base + i]! + 1) % N;
          this.cnt[base + i] = c;
          this.hi[base + i] = c < Math.ceil(N / 2) ? 1 : 0;
        }
      }

      for (let i = 0; i < NOUT; i++) this.writeOut(this.outputs[i]!, e, 10 * this.hi[base + i]!);
    }
  }

  override getState(): ModuleState {
    const n = this.n;
    const c: number[][] = [];
    const hi: number[][] = [];
    for (let e = 0; e < n; e++) {
      c.push(Array.from(this.cnt.subarray(e * NOUT, (e + 1) * NOUT)));
      hi.push(Array.from(this.hi.subarray(e * NOUT, (e + 1) * NOUT)));
    }
    return {
      cs: Array.from(this.cs.subarray(0, n)),
      rs: Array.from(this.rs.subarray(0, n)),
      c,
      hi,
      guard: Array.from(this.guard.subarray(0, n)),
    };
  }

  override setState(state: ModuleState): void {
    // 0.1 の保存データ(1エンジン分: cs, rs, guard がスカラー、c, hi が7要素の配列)はエンジン0として読む(§9)。
    const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
    const rows = (v: unknown): unknown[][] => {
      const a = arr(v);
      return a.length > 0 && !Array.isArray(a[0]) ? [a] : (a as unknown[][]);
    };
    const cs = arr(state.cs);
    const rs = arr(state.rs);
    const gd = arr(state.guard);
    const c = rows(state.c);
    const hi = rows(state.hi);
    const n = Math.max(1, Math.min(MAX_CHANNELS, c.length));
    this.initEngines(0, MAX_CHANNELS);
    for (let e = 0; e < n; e++) {
      this.cs[e] = cs[e] ? 1 : 0;
      this.rs[e] = rs[e] ? 1 : 0;
      const g = Number(gd[e] ?? 0);
      this.guard[e] = Number.isFinite(g) && g > 0 ? Math.floor(g) : 0;
      for (let i = 0; i < NOUT; i++) {
        const v = Number(c[e]?.[i]);
        if (Number.isFinite(v) && v >= 0) this.cnt[e * NOUT + i] = Math.floor(v);
        this.hi[e * NOUT + i] = hi[e]?.[i] ? 1 : 0;
      }
    }
    this.n = n;
  }
}
