// MOD-SAT-001 サチュレータ(歪み・波形整形)(仕様 v0.1)。
// out[c] = clamp((1−mix)·in[c] + mix·5·level·(f(g·in[c]/5 + bias) − f(bias)), −12, +12)、g = 10^(drive/20)。
// f は mode で選ぶ: 0 = ソフト(tanh)、1 = ハード(±1 でクリップ)、2 = フォールド(±1 で折り返す)。状態なし。主入力は in。

import { ModuleDef, SynthModule } from "../engine/module.js";
import { V_LIMIT, clamp } from "../engine/util.js";

const DEF: ModuleDef = {
  specId: "MOD-SAT-001",
  specVersion: "0.1",
  title: "サチュレータ(歪み・波形整形)",
  inputs: [
    { name: "in", type: "audio", unconnected: 0 },
    { name: "drive_cv", type: "cv", unconnected: 0 },
  ],
  outputs: [{ name: "out", type: "audio" }],
  params: [
    { name: "drive", kind: "float", min: 0, max: 36, default: 12 },
    { name: "bias", kind: "float", min: -1, max: 1, default: 0 },
    { name: "mode", kind: "int", min: 0, max: 2, default: 0 },
    { name: "mix", kind: "float", min: 0, max: 1, default: 1 },
    { name: "level", kind: "float", min: 0, max: 1, default: 1 },
  ],
  stateful: false,
};

/** CV の感度 [dB/V](仕様 §4。固定)。 */
const DRIVE_DB_PER_VOLT = 3;

/** 波形を曲げる関数(仕様 §6)。 */
function shape(s: number, mode: number): number {
  if (mode === 0) return Math.tanh(s);
  if (mode === 1) return s > 1 ? 1 : s < -1 ? -1 : s;
  // フォールド: 周期 4 の三角形。剰余は 0 以上 4 未満
  const r = (s - 1) % 4;
  return Math.abs((r < 0 ? r + 4 : r) - 2) - 1;
}

export class SatModule extends SynthModule {
  readonly def = DEF;

  constructor(fs: number) {
    super(fs);
    this.init();
  }

  protected resetState(): void {}

  step(): void {
    const inp = this.inputs[0]!;
    const cvIn = this.inputs[1]!;
    const out = this.outputs[0]!;
    const n = inp.connected ? inp.channels : 1; // COM-08: 主入力が未接続なら N = 1
    this.sanitizeInput(inp, n);
    this.sanitizeInput(cvIn, n);
    const drive = this.param("drive");
    const bias = this.param("bias");
    const mode = this.param("mode");
    const mix = this.param("mix");
    const level = this.param("level");
    const zero = shape(bias, mode); // 入力 0 V のとき出力 0 V になるよう引く値
    out.channels = n;
    for (let c = 0; c < n; c++) {
      const x = inp.connected ? inp.values[c]! : 0;
      const d = clamp(drive + DRIVE_DB_PER_VOLT * this.chan(cvIn, c), 0, 36);
      const g = Math.pow(10, d / 20);
      const w = 5 * level * (shape((g * x) / 5 + bias, mode) - zero);
      this.writeOut(out, c, clamp((1 - mix) * x + mix * w, -V_LIMIT, V_LIMIT));
    }
  }
}
