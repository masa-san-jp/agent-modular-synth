// MOD-AMP-001 VCA(電圧制御アンプ)(仕様 v0.2)。
// x = clamp(gain + (cv1 + cv2_level*cv2)/5, 0, 1)、g = 線形 x / 指数 (1000^x - 1)/999、
// out[c] = clamp((in1_level*in1[c] + in2_level*in2[c]) * g * out_level, -12, +12)。状態なし。
// 主入力は in1/in2(加算系の例外: 1チャンネルをコピーしない)、副入力は cv1/cv2。

import { InPort, ModuleDef, SynthModule } from "../engine/module.js";
import { V_LIMIT, clamp } from "../engine/util.js";

const DEF: ModuleDef = {
  specId: "MOD-AMP-001",
  specVersion: "0.2",
  title: "VCA(電圧制御アンプ)",
  inputs: [
    { name: "in1", type: "audio", unconnected: 0 },
    { name: "in2", type: "audio", unconnected: 0 },
    { name: "cv1", type: "cv", unconnected: 0 },
    { name: "cv2", type: "cv", unconnected: 0 },
  ],
  outputs: [{ name: "out", type: "audio" }],
  params: [
    { name: "gain", kind: "float", min: 0, max: 1, default: 0 },
    { name: "in1_level", kind: "float", min: 0, max: 1, default: 1 },
    { name: "in2_level", kind: "float", min: 0, max: 1, default: 1 },
    { name: "cv2_level", kind: "float", min: 0, max: 1, default: 1 },
    { name: "out_level", kind: "float", min: 0, max: 1, default: 1 },
    // 0=線形, 1=指数。0/1 以外は 0(クランプではない。step() で設定値を直接判定する)
    { name: "response", kind: "int", min: 0, max: 1, default: 0 },
  ],
  stateful: false,
};

const f = Math.fround;

/** 加算系の例外(§7): チャンネル c がなければ 0 V(1チャンネルをコピーしない)。 */
function addChan(port: InPort, c: number): number {
  return port.connected && c < port.channels ? port.values[c]! : 0;
}

export class AmpModule extends SynthModule {
  readonly def = DEF;

  constructor(fs: number) {
    super(fs);
    this.init();
  }

  protected resetState(): void {}

  step(): void {
    const in1 = this.inputs[0]!;
    const in2 = this.inputs[1]!;
    const cv1 = this.inputs[2]!;
    const cv2 = this.inputs[3]!;
    const out = this.outputs[0]!;
    // COM-08: N = 主入力(in1, in2)のチャンネル数の最大値。両方未接続なら 1
    const n = Math.max(1, this.chCount(in1), this.chCount(in2));
    this.sanitizeInput(in1, n);
    this.sanitizeInput(in2, n);
    this.sanitizeInput(cv1, n); // N 以上の番号のチャンネルは読まない(§8)
    this.sanitizeInput(cv2, n);

    const gain = f(this.param("gain"));
    const l1 = f(this.param("in1_level"));
    const l2 = f(this.param("in2_level"));
    const lc2 = f(this.param("cv2_level"));
    const lo = f(this.param("out_level"));
    const expo = this.getRawParam("response") === 1; // 0/1 以外(NaN 含む)は線形

    out.channels = n;
    for (let c = 0; c < n; c++) {
      const a = addChan(in1, c);
      const b = addChan(in2, c);
      const v1 = this.chan(cv1, c);
      const v2 = this.chan(cv2, c);
      // 演算は float32
      const x = clamp(f(gain + f(f(v1 + f(lc2 * v2)) / 5)), 0, 1);
      const g = expo ? f((Math.pow(1000, x) - 1) / 999) : x;
      const y = f(f(f(f(l1 * a) + f(l2 * b)) * g) * lo);
      this.writeOut(out, c, clamp(y, -V_LIMIT, V_LIMIT));
    }
  }
}
