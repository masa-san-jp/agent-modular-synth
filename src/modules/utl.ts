// MOD-UTL-001 アッテヌバータ/オフセット(仕様 v0.2)。
// out[c] = clamp(gain * in[c] + offset, -12, +12)。状態なし。主入力は in。

import { ModuleDef, SynthModule } from "../engine/module.js";
import { V_LIMIT, clamp } from "../engine/util.js";

const DEF: ModuleDef = {
  specId: "MOD-UTL-001",
  specVersion: "0.2",
  title: "アッテヌバータ/オフセット",
  inputs: [{ name: "in", type: "cv", unconnected: 0 }],
  outputs: [{ name: "out", type: "cv" }],
  params: [
    { name: "gain", kind: "float", min: -1, max: 1, default: 1 },
    { name: "offset", kind: "float", min: -10, max: 10, default: 0 },
  ],
  stateful: false,
};

export class UtlModule extends SynthModule {
  readonly def = DEF;

  constructor(fs: number) {
    super(fs);
    this.init();
  }

  protected resetState(): void {}

  step(): void {
    const inp = this.inputs[0]!;
    const out = this.outputs[0]!;
    const n = inp.connected ? inp.channels : 1; // COM-08: 主入力が未接続なら N = 1
    this.sanitizeInput(inp, n);
    const g = Math.fround(this.param("gain"));
    const o = Math.fround(this.param("offset"));
    out.channels = n;
    for (let c = 0; c < n; c++) {
      const x = inp.connected ? inp.values[c]! : 0;
      // 演算は float32(仕様 §6)
      const y = Math.fround(Math.fround(g * x) + o);
      this.writeOut(out, c, clamp(y, -V_LIMIT, V_LIMIT));
    }
  }
}
