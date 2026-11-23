// MOD-CLK-001 クロック(仕様 v0.2)。
// 倍精度の位相累積器+イベントカウンタ。主入力なし(N = 1)。run 停止中は位置保持(DEC-006)。

import { EncNum, decNum, encNum } from "../engine/codec.js";
import { ModuleDef, ModuleState, SynthModule } from "../engine/module.js";
import { GATE_OFF, GATE_ON, clamp, roundHalfUp, triggerSamples } from "../engine/util.js";

const DEF: ModuleDef = {
  specId: "MOD-CLK-001",
  specVersion: "0.2",
  title: "クロック",
  inputs: [
    { name: "reset", type: "trigger", unconnected: 0 },
    { name: "run", type: "gate", unconnected: 10 },
    { name: "bpm_cv", type: "pitch", unconnected: 0 },
  ],
  outputs: [
    { name: "clock", type: "clock" },
    { name: "gate", type: "gate" },
  ],
  params: [
    { name: "bpm", kind: "float", min: 20, max: 1000, default: 120 },
    { name: "ppqn", kind: "int", min: 1, max: 96, default: 1 },
    { name: "swing", kind: "float", min: 0, max: 0.5, default: 0 },
    { name: "duty", kind: "float", min: 0.01, max: 0.99, default: 0.5 },
    { name: "run", kind: "bool", min: 0, max: 1, default: 1 },
  ],
  stateful: true,
};

function schmitt(v: number, state: number): number {
  if (state === 0) return v >= GATE_ON ? 1 : 0;
  return v <= GATE_OFF ? 0 : 1;
}

export class ClkModule extends SynthModule {
  readonly def = DEF;

  private phase = 1.0;
  private k = 0;
  private pending = 0;
  private pulse = 0;
  private gateRem = 0;
  private rs = 0;
  private us = 0;

  constructor(fs: number) {
    super(fs);
    this.init();
  }

  protected resetState(): void {
    this.phase = 1.0;
    this.k = 0;
    this.pending = 0;
    this.pulse = 0;
    this.gateRem = 0;
    this.rs = 0;
    this.us = 0;
  }

  step(): void {
    const reset = this.inputs[0]!;
    const run = this.inputs[1]!;
    const bpmCv = this.inputs[2]!;
    const clockOut = this.outputs[0]!;
    const gateOut = this.outputs[1]!;

    // N = 1。副入力は1チャンネル目だけを読む(§7、§8)。
    this.sanitizeInput(reset, 1);
    this.sanitizeInput(run, 1);
    this.sanitizeInput(bpmCv, 1);

    const fs = this.fs;
    const bpm = this.param("bpm");
    const ppqn = this.param("ppqn");
    const swing = this.param("swing");
    const duty = this.param("duty");
    const runP = this.param("run");

    const rp = this.rs;
    this.rs = schmitt(reset.connected ? reset.values[0]! : 0, rp);
    const risingReset = rp === 0 && this.rs === 1;

    let runGate = true;
    if (run.connected) {
      this.us = schmitt(run.values[0]!, this.us);
      runGate = this.us === 1;
    }
    const running = runP >= 0.5 && runGate;

    const cv = bpmCv.connected ? bpmCv.values[0]! : 0;
    const bpmEff = clamp(bpm * Math.pow(2, clamp(cv, -10, 10)), 20, 1000);
    const dphi = Math.min(0.5, (bpmEff * ppqn) / (60 * fs));
    const P = 1 / dphi;
    let fire = false;

    if (risingReset) {
      this.phase = 1.0;
      this.k = 0;
      this.pending = 0;
    }
    if (!running) {
      this.pulse = 0;
      this.gateRem = 0;
    } else {
      if (this.pending > 0) {
        this.pending -= 1;
        if (this.pending === 0) fire = true;
      }
      if (this.phase >= 1 - 1e-9) {
        this.phase -= 1;
        const kc = this.k;
        this.k += 1;
        if (kc % 2 === 1 && swing > 0) this.pending = Math.max(1, roundHalfUp(swing * P));
        else fire = true;
      }
      this.phase += dphi;
      if (fire) {
        this.pulse = Math.min(triggerSamples(fs), Math.max(1, Math.floor(P / 2)));
        this.gateRem = Math.max(1, roundHalfUp(duty * P));
      }
    }

    clockOut.channels = 1;
    gateOut.channels = 1;
    clockOut.values[0] = this.pulse > 0 ? 10 : 0;
    gateOut.values[0] = this.gateRem > 0 ? 10 : 0;
    if (this.pulse > 0) this.pulse -= 1;
    if (this.gateRem > 0) this.gateRem -= 1;
  }

  override getState(): ModuleState {
    return {
      phase: encNum(this.phase),
      k: this.k,
      pending: this.pending,
      pulse: this.pulse,
      gate_rem: this.gateRem,
      rs: this.rs,
      us: this.us,
    };
  }

  override setState(state: ModuleState): void {
    const num = (v: unknown, d: number): number => (v === undefined || v === null ? d : decNum(v as EncNum));
    this.phase = num(state.phase, 1.0);
    this.k = num(state.k, 0);
    this.pending = num(state.pending, 0);
    this.pulse = num(state.pulse, 0);
    this.gateRem = num(state.gate_rem, 0);
    this.rs = num(state.rs, 0) ? 1 : 0;
    this.us = num(state.us, 0) ? 1 : 0;
  }
}
