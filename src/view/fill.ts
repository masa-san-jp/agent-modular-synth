// 人の画面(PANEL)の「一式を置く」ボタン(FILL)の中身。Issue #59、DEC-029、product-spec §4.1。
// 今のパッチにない種類のモジュールを、1 台ずつ足す操作の並び(batch の ops)を作る。配線はしない。既にあるものは変えない。
// DOM を使わない計算なので、単体試験で確かめる(test/view.test.ts)。

/** 常設の出力。追加できない(operation-contract §2.2、ERR-105)。 */
const OUTPUT_TYPE = "MOD-IO-001";
/** モジュールIDの書式(operation-contract §2.2)。 */
const MODULE_ID = /^[a-z][a-z0-9_]{0,31}$/;

export interface FillOp {
  command: "module.add";
  args: { type: string; id?: string };
}

/**
 * 種別から読みやすい ID を作る: `MOD-OSC-001` → `osc`、`MOD-CLK-002` → `clk2`、`MOD-IO-003` → `io3`。
 * 作れないときは null(ID を指定せず、自動採番に任せる)。
 */
export function fillId(type: string): string | null {
  const m = /^MOD-([A-Z]+)-(\d{3})$/.exec(type);
  if (!m) return null;
  const n = Number(m[2]);
  const id = m[1]!.toLowerCase() + (n > 1 ? String(n) : "");
  return MODULE_ID.test(id) ? id : null;
}

/**
 * 足す操作の並び。種別の順は `types` の順(カタログは種別IDの昇順)。
 * 読みやすい ID が既に使われている(別の種別のモジュールが使っている)ときは、ID を指定しない(自動採番 `m<N>`)。
 */
export function fillOps(types: Iterable<string>, modules: readonly { id: string; type: string }[]): FillOp[] {
  const present = new Set(modules.map((m) => m.type));
  const used = new Set(modules.map((m) => m.id));
  const ops: FillOp[] = [];
  for (const type of types) {
    if (type === OUTPUT_TYPE || present.has(type)) continue;
    const id = fillId(type);
    if (id !== null && !used.has(id)) {
      used.add(id);
      ops.push({ command: "module.add", args: { type, id } });
    } else {
      ops.push({ command: "module.add", args: { type } });
    }
  }
  return ops;
}
