// ラックの表示: パッチを、モジュールの板で描く。板には、パラメータの名前と値(数字)を出す。
// ジャックとケーブルは装飾(板の下の帯に小さく並べ、ケーブルは薄く描く)。docs/design/…single-hue-wash.md。
// 眺めるための絵で、編集は下のフォームで行う(板を押すと、そのモジュールのフォームへ移る)。
// このファイルは配置の計算だけ(DOM を使わない。試験できる)。描くのは src/web/rack.ts。

export interface RackParam {
  name: string;
  kind: string;
  /** 列挙型の選択肢(あれば、値の代わりに名前を出す)。 */
  values?: readonly { value: number; label: string }[];
  unit?: string;
}
export interface RackModule {
  id: string;
  type: string;
  inputs: readonly string[];
  outputs: readonly string[];
  params: readonly RackParam[];
  /** LCD(主役の表示)を持つ板か。1 画面に 1 枚(出力モジュール)。 */
  lcd?: boolean;
}
export interface RackCable {
  from: { module: string; port: string };
  to: { module: string; port: string };
}
export interface Jack {
  port: string;
  dir: "in" | "out";
  x: number;
  y: number;
}
/** 板の中の 1 行。`params` が 1 つなら「名前  値」。複数なら、配列のパラメータ(`level[1]`…)の値を横に並べた行。 */
export interface ParamRow {
  /** 行の頭に出す名前(配列の 2 行目以降は空)。 */
  label: string;
  params: string[];
  y: number;
}
export interface Panel {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rows: ParamRow[];
  jacks: Jack[];
  lcd: { x: number; y: number; w: number; h: number } | null;
}
export interface RackLayout {
  width: number;
  height: number;
  panels: Panel[];
}

/** 寸法 [px]。板の幅は一定。`perRow` は、配列のパラメータを 1 行に並べる数。 */
export const RACK = { gap: 3, pad: 6, panelW: 132, title: 16, row: 12, perRow: 4, jack: 8, jackBand: 6, lcdH: 34, sag: 18 } as const;

/**
 * パラメータを行にまとめる。ふつうのパラメータは「名前  値」の 1 行。
 * 配列(`名前[番号]`)は、名前だけの行の下に、値を `perRow` 個ずつ横に並べる(置き場所は、最初の要素の位置)。
 */
export function paramRows(params: readonly RackParam[]): { label: string; params: string[] }[] {
  const rows: { label: string; params: string[] }[] = [];
  const seen = new Set<string>();
  const base = (name: string): string | null => /^(.+)\[\d+\]$/.exec(name)?.[1] ?? null;
  for (const p of params) {
    const b = base(p.name);
    if (b === null) {
      rows.push({ label: p.name, params: [p.name] });
      continue;
    }
    if (seen.has(b)) continue;
    seen.add(b);
    const all = params.filter((q) => base(q.name) === b).map((q) => q.name);
    rows.push({ label: b, params: [] });
    for (let i = 0; i < all.length; i += RACK.perRow) rows.push({ label: "", params: all.slice(i, i + RACK.perRow) });
  }
  return rows;
}

/** 値を、板に出す短い文字にする(列挙は名前、真偽は on/off、数値は有効 3〜4 桁)。 */
export function formatParam(p: RackParam | undefined, v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "–";
  if (p?.values) return p.values.find((x) => x.value === v)?.label ?? String(v);
  if (p?.kind === "bool") return v !== 0 ? "on" : "off";
  if (p?.kind !== "float") return String(v);
  const a = Math.abs(v);
  if (a >= 1000) return String(Math.round(v));
  if (a >= 100) return v.toFixed(1);
  if (a >= 10) return v.toFixed(2);
  return v.toFixed(3);
}

/** モジュールを、同じ幅の板として列に積む(板の高さは、パラメータの数で決まる)。 */
export function layoutRack(modules: readonly RackModule[], width: number): RackLayout {
  const perBand = Math.floor((RACK.panelW - RACK.pad * 2) / RACK.jack);
  const sized = modules.map((m) => {
    const rows = paramRows(m.params);
    const ports = m.inputs.length + m.outputs.length;
    const bandRows = Math.max(1, Math.ceil(ports / perBand));
    const h = RACK.title + RACK.pad + rows.length * RACK.row + (m.lcd ? RACK.lcdH + RACK.pad : 0) + RACK.jackBand + bandRows * RACK.jack + RACK.pad;
    return { m, rows, bandRows, h };
  });
  // 列に積む: 板を順に、いちばん低い列(同じなら左)へ置く。高さの違う板でも、隙間なく面を埋める
  const columns = Math.max(1, Math.floor((width - RACK.gap) / (RACK.panelW + RACK.gap)));
  const tops = new Array<number>(Math.min(columns, Math.max(1, sized.length))).fill(RACK.gap);
  const panels: Panel[] = [];
  for (const s of sized) {
    let k = 0;
    for (let i = 1; i < tops.length; i++) if (tops[i]! < tops[k]! - 1e-9) k = i;
    const x = RACK.gap + k * (RACK.panelW + RACK.gap);
    const y = tops[k]!;
    let ry = y + RACK.title + RACK.pad;
    const rows: ParamRow[] = s.rows.map((r) => {
      const row = { ...r, y: ry + RACK.row / 2 };
      ry += RACK.row;
      return row;
    });
    const lcd = s.m.lcd ? { x: x + RACK.pad, y: ry + RACK.pad / 2, w: RACK.panelW - RACK.pad * 2, h: RACK.lcdH } : null;
    // ジャックは、板のいちばん下の帯に小さく並べる(入力 → 出力の順)
    const bandTop = y + s.h - RACK.pad - s.bandRows * RACK.jack;
    const ports = [...s.m.inputs.map((port) => ({ port, dir: "in" as const })), ...s.m.outputs.map((port) => ({ port, dir: "out" as const }))];
    const jacks: Jack[] = ports.map((p, n) => ({ ...p, x: x + RACK.pad + RACK.jack / 2 + (n % perBand) * RACK.jack, y: bandTop + RACK.jack / 2 + Math.floor(n / perBand) * RACK.jack }));
    panels.push({ id: s.m.id, type: s.m.type, x, y, w: RACK.panelW, h: s.h, rows, jacks, lcd });
    tops[k] = y + s.h + RACK.gap;
  }
  const y = Math.max(...tops);
  return { width, height: panels.length === 0 ? 0 : y + RACK.sag, panels };
}

/** 座標 (x, y) にある板(なければ null)。 */
export function panelAt(layout: RackLayout, x: number, y: number): Panel | null {
  return layout.panels.find((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) ?? null;
}

/** ケーブルの両端のジャック(どちらかがなければ null)。 */
export function cableEnds(layout: RackLayout, c: RackCable): { a: Jack; b: Jack } | null {
  const find = (id: string, port: string, dir: "in" | "out"): Jack | undefined => layout.panels.find((p) => p.id === id)?.jacks.find((j) => j.dir === dir && j.port === port);
  const a = find(c.from.module, c.from.port, "out");
  const b = find(c.to.module, c.to.port, "in");
  return a && b ? { a, b } : null;
}
