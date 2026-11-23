// モジュール種別の定義の一覧(module.list_types の元)。実装(ModuleDef)から作るので、実装と食い違わない。
// 仕様 §3・§4 との一致は test/catalog.test.ts が機械的に確認する。
import { ModuleFactory, ParamKind, SignalType } from "../engine/module.js";
import { MODULE_META } from "../modules/meta.generated.js";

export interface PortInfo {
  name: string;
  type: SignalType;
  /** ケーブルを接続できるか(製品内部の出力や MIDI 入力は false)。 */
  connectable: boolean;
  /** 単位(仕様 §3)。 */
  unit: string;
  /** 入力だけ。未接続時の値: 定数なら value [V]、他の信号へ内部接続されるなら normal(その名前)。出力は null。 */
  unconnected: { value: number | null; normal: string | null } | null;
}

export interface ParamInfo {
  name: string;
  kind: ParamKind;
  min: number;
  max: number;
  default: number;
  /** 単位(仕様 §4)。真偽・列挙・seed は持たない。 */
  unit?: string;
  /** 列挙型の選択肢(仕様 §4)。あれば、module.list_types では kind が "enum" になる。 */
  values?: { value: number; label: string }[];
}

export interface TypeInfo {
  /** 種別ID = 仕様ID(例: MOD-OSC-001)。 */
  type: string;
  specVersion: string;
  title: string;
  /** 機能分類(仕様のフロントマター category)。 */
  category: string;
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
    // 分類・単位・未接続時の値・列挙の選択肢は、仕様から生成した表(meta.generated.ts)から取る
    const meta = MODULE_META[type];
    if (!meta) throw new Error(`${type}: 仕様から生成した付随情報がない(python3 tools/build_module_meta.py)`);
    const port = (p: { name: string; type: SignalType; connectable?: boolean }, input: boolean): PortInfo => {
      const m = meta.ports[p.name];
      if (!m) throw new Error(`${type}.${p.name}: 仕様 §3 にポートがない`);
      return { name: p.name, type: p.type, connectable: p.connectable !== false, unit: m.unit, unconnected: input ? (m.unconnected ?? { value: 0, normal: null }) : null };
    };
    out.set(type, {
      type,
      specVersion: def.specVersion,
      title: def.title,
      category: meta.category,
      inputs: def.inputs.map((p) => port(p, true)),
      outputs: def.outputs.map((p) => port(p, false)),
      params: def.params.map((p) => {
        const m = meta.params[p.name];
        if (!m) throw new Error(`${type}.${p.name}: 仕様 §4 にパラメータがない`);
        return { name: p.name, kind: p.kind, min: p.min, max: p.max, default: p.default, ...(m.unit !== null ? { unit: m.unit } : {}), ...(m.values ? { values: m.values } : {}) };
      }),
    });
  }
  return out;
}
