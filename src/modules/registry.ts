// 実装済みモジュールの一覧(仕様ID → 生成関数)。
import { ModuleFactory } from "../engine/module.js";
import { UtlModule } from "./utl.js";

export const REGISTRY: ReadonlyMap<string, ModuleFactory> = new Map<string, ModuleFactory>([
  ["MOD-UTL-001", (fs) => new UtlModule(fs)],
]);
