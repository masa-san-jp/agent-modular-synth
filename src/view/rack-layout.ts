// ラックの表示: パッチを、モジュールの板・ジャック・ケーブルの曲線・LED で描く(docs/design/…single-hue-wash.md)。
// 眺めるための絵で、編集は下のフォームで行う(板を押すと、そのモジュールのフォームへ移る)。
// このファイルは配置の計算だけ(DOM を使わない。試験できる)。描くのは src/web/rack.ts。

export interface RackModule {
  id: string;
  type: string;
  inputs: readonly string[];
  outputs: readonly string[];
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
export interface Panel {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  jacks: Jack[];
  lcd: { x: number; y: number; w: number; h: number } | null;
}
export interface RackLayout {
  width: number;
  height: number;
  panels: Panel[];
}

/** 寸法 [px]。`sag` は、いちばん下の段のケーブルが垂れる分の余白(資料: 板の間 2〜4、ジャックの間隔 6〜12 より少し広め。押せる・読める大きさを優先)。 */
export const RACK = { sag: 26, gap: 3, pad: 8, jack: 14, title: 16, divider: 8, led: 10, lcdW: 96, lcdH: 40, minCols: 2, maxCols: 6 } as const;

function columns(m: RackModule): number {
  const n = Math.max(m.inputs.length, m.outputs.length, 1);
  return Math.min(RACK.maxCols, Math.max(RACK.minCols, Math.ceil(Math.sqrt(n))));
}

/** モジュールを、縦長の板として横に詰めて並べる(幅に収まらなければ、次の段へ)。板の高さは全体で揃える。 */
export function layoutRack(modules: readonly RackModule[], width: number): RackLayout {
  const sized = modules.map((m) => {
    const cols = columns(m);
    const rowsIn = Math.ceil(m.inputs.length / cols);
    const rowsOut = Math.ceil(m.outputs.length / cols);
    const w = Math.max(cols * RACK.jack + RACK.pad * 2, m.lcd ? RACK.lcdW + RACK.pad * 2 : 0);
    const h = RACK.title + RACK.led + (rowsIn + rowsOut) * RACK.jack + RACK.divider + (m.lcd ? RACK.lcdH + RACK.pad : 0) + RACK.pad;
    return { m, cols, rowsIn, w, h };
  });
  const panelH = sized.reduce((a, s) => Math.max(a, s.h), 0);
  const panels: Panel[] = [];
  let x = RACK.gap;
  let y = RACK.gap;
  for (const s of sized) {
    if (x > RACK.gap && x + s.w + RACK.gap > width) {
      x = RACK.gap;
      y += panelH + RACK.gap;
    }
    const jacks: Jack[] = [];
    const left = x + (s.w - s.cols * RACK.jack) / 2 + RACK.jack / 2;
    const top = y + RACK.title + RACK.led + RACK.jack / 2;
    s.m.inputs.forEach((port, i) => jacks.push({ port, dir: "in", x: left + (i % s.cols) * RACK.jack, y: top + Math.floor(i / s.cols) * RACK.jack }));
    const outTop = top + s.rowsIn * RACK.jack + RACK.divider;
    s.m.outputs.forEach((port, i) => jacks.push({ port, dir: "out", x: left + (i % s.cols) * RACK.jack, y: outTop + Math.floor(i / s.cols) * RACK.jack }));
    const lcd = s.m.lcd ? { x: x + (s.w - RACK.lcdW) / 2, y: y + panelH - RACK.pad - RACK.lcdH, w: RACK.lcdW, h: RACK.lcdH } : null;
    panels.push({ id: s.m.id, type: s.m.type, x, y, w: s.w, h: panelH, jacks, lcd });
    x += s.w + RACK.gap;
  }
  return { width, height: panels.length === 0 ? 0 : y + panelH + RACK.gap + RACK.sag, panels };
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

