// 実装済みモジュールの一覧(仕様ID → 生成関数)。
import { ModuleFactory } from "../engine/module.js";
import { AmpModule } from "./amp.js";
import { ClkModule } from "./clk.js";
import { ClkDivModule } from "./clkdiv.js";
import { DlyModule } from "./dly.js";
import { EnvModule } from "./env.js";
import { FltModule } from "./flt.js";
import { FncModule } from "./fnc.js";
import { IoMeterModule } from "./io-meter.js";
import { IoMidiModule } from "./io-midi.js";
import { IoOutModule } from "./io-out.js";
import { LfoModule } from "./lfo.js";
import { LgcModule } from "./lgc.js";
import { MixModule } from "./mix.js";
import { NseModule } from "./nse.js";
import { OscModule } from "./osc.js";
import { RndModule } from "./rnd.js";
import { SeqModule } from "./seq.js";
import { UtlModule } from "./utl.js";

export const REGISTRY: ReadonlyMap<string, ModuleFactory> = new Map<string, ModuleFactory>([
  ["MOD-AMP-001", (fs) => new AmpModule(fs)],
  ["MOD-CLK-001", (fs) => new ClkModule(fs)],
  ["MOD-CLK-002", (fs) => new ClkDivModule(fs)],
  ["MOD-DLY-001", (fs) => new DlyModule(fs)],
  ["MOD-ENV-001", (fs) => new EnvModule(fs)],
  ["MOD-FLT-001", (fs) => new FltModule(fs)],
  ["MOD-FNC-001", (fs) => new FncModule(fs)],
  ["MOD-IO-001", (fs) => new IoOutModule(fs)],
  ["MOD-IO-002", (fs) => new IoMidiModule(fs)],
  ["MOD-IO-003", (fs) => new IoMeterModule(fs)],
  ["MOD-LFO-001", (fs) => new LfoModule(fs)],
  ["MOD-LGC-001", (fs) => new LgcModule(fs)],
  ["MOD-MIX-001", (fs) => new MixModule(fs)],
  ["MOD-NSE-001", (fs) => new NseModule(fs)],
  ["MOD-OSC-001", (fs) => new OscModule(fs)],
  ["MOD-RND-001", (fs) => new RndModule(fs)],
  ["MOD-SEQ-001", (fs) => new SeqModule(fs)],
  ["MOD-UTL-001", (fs) => new UtlModule(fs)],
]);
