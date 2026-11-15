// MOD-ENV-001 ADSRエンベロープ(仕様 v0.2)。
// Attack 線形、Decay/Release 指数(残差 1/1000 の時間、満値基準 0.001 でスナップ)。
// 主入力は gate(N を決める)、副入力は retrig。状態 x は倍精度(COM-05)。

import { EncNum, decNum, encArr } from "../engine/codec.js";
import { ModuleDef, ModuleState, SynthModule } from "../engine/module.js";
import { GATE_OFF, GATE_ON, MAX_CHANNELS } from "../engine/util.js";

const DEF: ModuleDef = {
  specId: "MOD-ENV-001",
  specVersion: "0.2",
  title: "ADSRエンベロープ",
  inputs: [
    { name: "gate", type: "gate", unconnected: 0 },
    { name: "retrig", type: "trigger", unconnected: 0 },
  ],
  outputs: [
    { name: "env", type: "cv" },
    { name: "inv", type: "cv" },
  ],
  params: [
    { name: "attack", kind: "float", min: 0.001, max: 60, default: 0.01, unit: "s" },
    { name: "decay", kind: "float", min: 0.001, max: 60, default: 0.1, unit: "s" },
    { name: "sustain", kind: "float", min: 0, max: 1, default: 0.5 },
    { name: "release", kind: "float", min: 0.001, max: 60, default: 0.1, unit: "s" },
  ],
  stateful: true,
};

const IDLE = 0;
const ATT = 1;
const DEC = 2;
const SUS = 3;
const REL = 4;
const LN1000 = Math.log(1000);
const SNAP = 0.001;

/** COM-04 のシュミット検出。新しい状態を返す。 */
function schmitt(v: number, state: number): number {
  if (state === 0) return v >= GATE_ON ? 1 : 0;
  return v <= GATE_OFF ? 0 : 1;
}

export class EnvModule extends SynthModule {
  readonly def = DEF;

  // エンジンごとの状態(§5)。先頭 n 組が有効。
  private n = 1;
  private readonly x = new Float64Array(MAX_CHANNELS);
  private readonly stage = new Uint8Array(MAX_CHANNELS);
  private readonly g = new Uint8Array(MAX_CHANNELS);
  private readonly r = new Uint8Array(MAX_CHANNELS);

  constructor(fs: number) {
    super(fs);
    this.init();
  }

  private initEngines(from: number, to: number): void {
    for (let c = from; c < to; c++) {
      this.x[c] = 0;
      this.stage[c] = IDLE;
      this.g[c] = 0;
      this.r[c] = 0;
    }
  }

  protected resetState(): void {
    this.initEngines(0, MAX_CHANNELS);
  }

  step(): void {
    const gate = this.inputs[0]!;
    const retrig = this.inputs[1]!;
    const envOut = this.outputs[0]!;
    const invOut = this.outputs[1]!;

    // COM-08: N = 主入力 gate のチャンネル数(未接続なら 1)。増えたエンジンは初期状態。
    const n = gate.connected ? gate.channels : 1;
    if (n > this.n) this.initEngines(this.n, n);
    this.n = n;

    // COM-12: 読むチャンネルだけを整形して数える。
    this.sanitizeInput(gate, n);
    this.sanitizeInput(retrig, n);

    const fs = this.fs;
    const A = this.param("attack");
    const D = this.param("decay");
    const S = this.param("sustain");
    const R = this.param("release");

    envOut.channels = n;
    invOut.channels = n;
    for (let c = 0; c < n; c++) {
      // 1. シュミット検出
      const gPrev = this.g[c]!;
      const rPrev = this.r[c]!;
      const rNew = schmitt(this.chan(retrig, c), rPrev);
      const gNew = schmitt(gate.connected ? gate.values[c]! : 0, gPrev);
      this.r[c] = rNew;
      this.g[c] = gNew;
      const redge = rPrev === 0 && rNew === 1;
      const gup = gPrev === 0 && gNew === 1;
      const gdn = gPrev === 1 && gNew === 0;

      // 2. イベント(RETRIG → GATE)
      let stage = this.stage[c]!;
      if (redge && gPrev === 1) stage = ATT;
      if (gup) stage = ATT;
      if (gdn && stage !== IDLE) stage = REL;

      // 3. 時間進行
      let x = this.x[c]!;
      switch (stage) {
        case ATT: {
          const rate = 1 / (A * fs);
          x = x + rate;
          if (x >= 1 - rate / 2) {
            x = 1;
            stage = DEC;
          }
          break;
        }
        case DEC: {
          const kd = Math.exp(-LN1000 / (D * fs));
          x = S + (x - S) * kd;
          if (x - S <= SNAP) {
            x = S;
            stage = SUS;
          }
          break;
        }
        case SUS:
          x = S;
          break;
        case REL: {
          const kr = Math.exp(-LN1000 / (R * fs));
          x = x * kr;
          if (x <= SNAP) {
            x = 0;
            stage = IDLE;
          }
          break;
        }
        default:
          break;
      }
      this.x[c] = x;
      this.stage[c] = stage;

      // 4. 出力
      const env = 10 * x;
      this.writeOut(envOut, c, env);
      this.writeOut(invOut, c, env === 0 ? 0 : -env);
    }
  }

  override getState(): ModuleState {
    const n = this.n;
    return {
      x: encArr(this.x.subarray(0, n)),
      stage: Array.from(this.stage.subarray(0, n)),
      g: Array.from(this.g.subarray(0, n)),
      r: Array.from(this.r.subarray(0, n)),
    };
  }

  override setState(state: ModuleState): void {
    // 0.1 の保存データ(状態1組のスカラー)はエンジン0として読む(§9)。
    const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v === undefined ? [] : [v as T]);
    const xs = arr<EncNum>(state.x);
    const st = arr<number>(state.stage);
    const gs = arr<number>(state.g);
    const rs = arr<number>(state.r);
    const n = Math.max(1, Math.min(MAX_CHANNELS, xs.length));
    this.initEngines(0, MAX_CHANNELS);
    for (let c = 0; c < n; c++) {
      this.x[c] = c < xs.length ? decNum(xs[c]!) : 0;
      this.stage[c] = st[c] ?? IDLE;
      this.g[c] = gs[c] ? 1 : 0;
      this.r[c] = rs[c] ? 1 : 0;
    }
    this.n = n;
  }
}
