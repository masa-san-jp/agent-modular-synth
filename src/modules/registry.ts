// 実装済みモジュールの一覧(仕様ID → 生成関数)。
import { ModuleFactory } from "../engine/module.js";
import { AmpModule } from "./amp.js";
import { EnvModule } from "./env.js";
import { OscModule } from "./osc.js";
import { UtlModule } from "./utl.js";

export const REGISTRY: ReadonlyMap<string, ModuleFactory> = new Map<string, ModuleFactory>([
  ["MOD-AMP-001", (fs) => new AmpModule(fs)],
  ["MOD-ENV-001", (fs) => new EnvModule(fs)],
  ["MOD-OSC-001", (fs) => new OscModule(fs)],
  ["MOD-UTL-001", (fs) => new UtlModule(fs)],
]);
