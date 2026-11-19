// MOD-IO-001 オーディオ出力(仕様 v0.2)。
// IN_L/IN_R の全チャンネルを加算(倍精度、チャンネル昇順)→ 音量 g(時定数 5 ms の1次平滑)→
// PRE = clamp(g·v/5, ±100)(クリップ前、FS値)→ DEV = clamp(PRE, ±1)、CLIP、clip_count。
// チャンネルをまとめるモジュール(COM-08 の例外): エンジンは常に1つ、出力はすべて1チャンネル。

import { InPort, ModuleDef, ModuleState, SynthModule } from "../engine/module.js";
import { clamp } from "../engine/util.js";
import { EncNum, decNum, encNum } from "../engine/codec.js";

const VFS = 5; // フルスケール電圧(±5 V = ±1.0 FS)
const TAU = 0.005; // 音量の平滑時定数 [s]
const PRE_MAX = 100; // PRE の飽和値(S-15)
const CLIP_COUNT_MAX = 4294967295; // uint32 の飽和加算

const DEF: ModuleDef = {
  specId: "MOD-IO-001",
  specVersion: "0.2",
  title: "オーディオ出力",
  inputs: [
    { name: "IN_L", type: "audio", unconnected: 0 },
    { name: "IN_R", type: "audio" }, // 未接続は normal=IN_L(step で処理)
  ],
  outputs: [
    { name: "PRE_L", type: "audio", connectable: false },
    { name: "PRE_R", type: "audio", connectable: false },
    { name: "DEV_L", type: "audio", connectable: false },
    { name: "DEV_R", type: "audio", connectable: false },
    { name: "CLIP", type: "gate" },
  ],
  params: [
    { name: "level", kind: "float", min: 0, max: 2, default: 1 },
    { name: "mute", kind: "bool", min: 0, max: 1, default: 0 },
  ],
  stateful: true,
};

export class IoOutModule extends SynthModule {
  readonly def = DEF;
  /** 平滑後の音量(倍率)。時間を積分する状態なので倍精度。 */
  private g = 1;
  private clipCnt = 0;

  constructor(fs: number) {
    super(fs);
    this.init();
  }

  /** PRE_L または PRE_R の絶対値が 1.0 を超えたサンプルの累計(読出し値)。 */
  get clipCount(): number {
    return this.clipCnt;
  }

  /** 平滑後の音量 g(読出し値)。 */
  get gain(): number {
    return this.g;
  }

  /** 目標値 mute_e ? 0 : level_e(§4)。mute は「有限の0以外は1、NaN/∞は既定0」。 */
  private target(): number {
    const mute = this.getRawParam("mute");
    const muteE = Number.isFinite(mute) && mute !== 0;
    return muteE ? 0 : this.param("level");
  }

  protected resetState(): void {
    this.g = this.target();
    this.clipCnt = 0;
  }

  /** 接続された入力の全チャンネルを昇順に加算(倍精度)。非有限のチャンネルは 0 V として数える。 */
  private sum(port: InPort): number {
    this.sanitizeInput(port, port.channels);
    let s = 0;
    for (let c = 0; c < port.channels; c++) s += port.values[c]!;
    return s;
  }

  step(): void {
    const inL = this.inputs[0]!;
    const inR = this.inputs[1]!;
    // 0. 入力の読出しとポリの加算
    const l = inL.connected ? this.sum(inL) : 0;
    const r = inR.connected ? this.sum(inR) : l;
    // 1. 音量の平滑
    const a = 1 - Math.exp(-1 / (TAU * this.fs));
    this.g = this.g + a * (this.target() - this.g);
    // 2. スケール → クリップ前の値(倍精度で計算し、ポートの float32 へ丸める)
    const preL = Math.fround(clamp((this.g * l) / VFS, -PRE_MAX, PRE_MAX));
    const preR = Math.fround(clamp((this.g * r) / VFS, -PRE_MAX, PRE_MAX));
    // 3. 参照出力と過大の表示(ポートに出す PRE の値で判定する)
    const clipped = Math.abs(preL) > 1 || Math.abs(preR) > 1;
    const o = this.outputs;
    for (const p of o) p.channels = 1;
    this.writeOut(o[0]!, 0, preL);
    this.writeOut(o[1]!, 0, preR);
    this.writeOut(o[2]!, 0, clamp(preL, -1, 1));
    this.writeOut(o[3]!, 0, clamp(preR, -1, 1));
    o[4]!.values[0] = clipped ? 10 : 0;
    if (clipped) this.clipCnt = Math.min(this.clipCnt + 1, CLIP_COUNT_MAX);
  }

  /** COM-14: 保存するのは g と clip_count(nonfinite_count は保存しない)。 */
  override getState(): ModuleState {
    return { g: encNum(this.g), clip_count: this.clipCnt };
  }

  override setState(state: ModuleState): void {
    if (state.g !== undefined) this.g = decNum(state.g as EncNum);
    if (typeof state.clip_count === "number") this.clipCnt = state.clip_count;
  }
}
