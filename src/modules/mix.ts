// MOD-MIX-001 ミキサー(仕様 v0.2)。
// out[c] = clamp((((level1*in1[c] + level2*in2[c]) + level3*in3[c]) + level4*in4[c]) * master, -12, +12)。状態なし。
// 主入力は in1〜in4(加算系の例外: 1チャンネルをコピーしない)。副入力なし。

import { InPort, ModuleDef, SynthModule } from "../engine/module.js";
import { V_LIMIT, clamp } from "../engine/util.js";

const DEF: ModuleDef = {
  specId: "MOD-MIX-001",
  specVersion: "0.2",
  title: "ミキサー",
  inputs: [
    { name: "in1", type: "audio", unconnected: 0 },
    { name: "in2", type: "audio", unconnected: 0 },
    { name: "in3", type: "audio", unconnected: 0 },
    { name: "in4", type: "audio", unconnected: 0 },
  ],
  outputs: [{ name: "out", type: "audio" }],
  params: [
    { name: "level1", kind: "float", min: 0, max: 1, default: 1 },
    { name: "level2", kind: "float", min: 0, max: 1, default: 1 },
    { name: "level3", kind: "float", min: 0, max: 1, default: 1 },
    { name: "level4", kind: "float", min: 0, max: 1, default: 1 },
    { name: "master", kind: "float", min: 0, max: 1, default: 1 },
  ],
  stateful: false,
};

const f = Math.fround;

/** 加算系の例外(§7): チャンネル c がなければ 0 V(1チャンネルをコピーしない)。 */
function addChan(port: InPort, c: number): number {
  return port.connected && c < port.channels ? port.values[c]! : 0;
}

export class MixModule extends SynthModule {
  readonly def = DEF;

  constructor(fs: number) {
    super(fs);
    this.init();
  }

  protected resetState(): void {}

  step(): void {
    const in1 = this.inputs[0]!;
    const in2 = this.inputs[1]!;
    const in3 = this.inputs[2]!;
    const in4 = this.inputs[3]!;
    const out = this.outputs[0]!;
    // COM-08: N = 接続された入力のチャンネル数の最大値。すべて未接続なら 1
    const n = Math.max(1, this.chCount(in1), this.chCount(in2), this.chCount(in3), this.chCount(in4));
    this.sanitizeInput(in1, n);
    this.sanitizeInput(in2, n);
    this.sanitizeInput(in3, n);
    this.sanitizeInput(in4, n);

    const l1 = f(this.param("level1"));
    const l2 = f(this.param("level2"));
    const l3 = f(this.param("level3"));
    const l4 = f(this.param("level4"));
    const master = f(this.param("master"));

    out.channels = n;
    for (let c = 0; c < n; c++) {
      // 演算は float32。加算順序は ((in1+in2)+in3)+in4(S-08)
      let a = f(f(l1 * addChan(in1, c)) + f(l2 * addChan(in2, c)));
      a = f(a + f(l3 * addChan(in3, c)));
      a = f(a + f(l4 * addChan(in4, c)));
      const y = f(a * master);
      // クリップ前が非有限なら writeOut が 0 に置換して数える(§8)
      this.writeOut(out, c, Number.isFinite(y) ? clamp(y, -V_LIMIT, V_LIMIT) : y);
    }
  }
}
