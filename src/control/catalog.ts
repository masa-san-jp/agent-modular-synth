// モジュール種別の定義の一覧(module.list_types の元)。実装(ModuleDef)から作るので、実装と食い違わない。
// 仕様 §3・§4 との一致は test/catalog.test.ts が機械的に確認する。
import { ModuleFactory, ParamKind, SignalType } from "../engine/module.js";

export interface PortInfo {
  name: string;
  type: SignalType;
  /** ケーブルを接続できるか(製品内部の出力や MIDI 入力は false)。 */
  connectable: boolean;
}

export interface ParamInfo {
  name: string;
  kind: ParamKind;
  min: number;
  max: number;
  default: number;
  unit?: string;
}

export interface TypeInfo {
  /** 種別ID = 仕様ID(例: MOD-OSC-001)。 */
  type: string;
  specVersion: string;
  title: string;
  inputs: PortInfo[];
  outputs: PortInfo[];
  params: ParamInfo[];
}

export type TypeCatalog = ReadonlyMap<string, TypeInfo>;

/** 生成関数の一覧から種別の定義を作る(種別IDの昇順)。 */
export function buildCatalog(registry: ReadonlyMap<string, ModuleFactory>, fs = 48000): TypeCatalog {
  const out = new Map<string, TypeInfo>();
  for (const type of [...registry.keys()].sort()) {
    const def = registry.get(type)!(fs).def;
    out.set(type, {
      type,
      specVersion: def.specVersion,
      title: def.title,
      inputs: def.inputs.map((p) => ({ name: p.name, type: p.type, connectable: p.connectable !== false })),
      outputs: def.outputs.map((p) => ({ name: p.name, type: p.type, connectable: p.connectable !== false })),
      params: def.params.map((p) => ({ name: p.name, kind: p.kind, min: p.min, max: p.max, default: p.default, ...(p.unit ? { unit: p.unit } : {}) })),
    });
  }
  return out;
}
