// ラックを描く(キャンバス)。配置の計算は src/view/rack-layout.ts。見た目の方針は docs/design/…single-hue-wash.md。
// 主役は、板の上のパラメータの値(数字)。ジャックとケーブルは装飾として薄く描く。
import { RACK, RackCable, RackLayout, RackParam, cableEnds, formatParam } from "../view/rack-layout.js";

export interface RackState {
  hue: number;
  cables: readonly RackCable[];
  /** モジュールID → パラメータ名 → 値(パッチの値。楽譜が動かしている間は、音声側のいまの値)。 */
  values: ReadonlyMap<string, Record<string, number>>;
  /** 楽譜が今動かしているパラメータ(モジュールID → 名前の集合)。値を明るく出す。 */
  moving: ReadonlyMap<string, ReadonlySet<string>>;
  /** 種別 → パラメータの定義(値の書式のため)。 */
  params: ReadonlyMap<string, ReadonlyMap<string, RackParam>>;
  /** モジュールID → いまの出力の大きさ [V]。音声が動いていなければ null。 */
  activity: Record<string, number> | null;
  /** 最近変わったモジュールID → 変わった時刻 [ms]。 */
  changed: ReadonlyMap<string, number>;
  /** 出力の大きさの履歴(0〜1。新しいものが後)。LCD に出す。 */
  levels: readonly number[];
  panic: boolean;
  now: number;
}

/** LED が点く出力の大きさ [V](±5 V が基準なので、その 1/10)。 */
export const LED_ON_VOLTS = 0.5;
/** 変わった箇所の明滅: 0.2 秒周期で 1 秒間(資料の周期の 1 つ)。 */
export const CHANGE_BLINK_MS = 1000;
const MONO = 'ui-monospace, "IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace';

/** ラックを描く。色は 1 つの色相だけ(緊急停止の枠だけ、例外で赤)。 */
export function drawRack(ctx: CanvasRenderingContext2D, layout: RackLayout, s: RackState): void {
  const { width: w, height: h } = layout;
  const c = (l: number, a = 1, sat = 83): string => `hsla(${s.hue},${sat}%,${l}%,${a})`;
  // 地: 中央下寄りが少し明るく、周辺は暗い
  const g = ctx.createRadialGradient(w * 0.5, h * 0.65, 0, w * 0.5, h * 0.65, Math.max(w, h) * 0.8);
  g.addColorStop(0, c(20));
  g.addColorStop(0.55, c(9, 1, 88));
  g.addColorStop(1, c(3, 1, 80));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = 1;
  ctx.textBaseline = "middle";

  // 板の面と、名前の帯
  for (const p of layout.panels) {
    ctx.fillStyle = c(34);
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = c(9);
    ctx.fillRect(p.x, p.y, p.w, RACK.title);
  }
  // ケーブル(装飾): 板の面の上、文字の下に、薄く細く
  ctx.lineWidth = 1;
  s.cables.forEach((cable, i) => {
    const e = cableEnds(layout, cable);
    if (!e) return;
    const dist = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
    ctx.strokeStyle = i % 4 === 0 ? c(62, 0.5) : c(52, 0.38);
    ctx.beginPath();
    ctx.moveTo(e.a.x, e.a.y);
    ctx.quadraticCurveTo((e.a.x + e.b.x) / 2, Math.max(e.a.y, e.b.y) + 8 + Math.min(40, dist * 0.08), e.b.x, e.b.y);
    ctx.stroke();
  });

  const ink = `hsl(${s.hue},90%,4%)`;
  for (const p of layout.panels) {
    const t = s.changed.get(p.id);
    const blink = t !== undefined && s.now - t < CHANGE_BLINK_MS && Math.floor((s.now - t) / 100) % 2 === 0;
    ctx.strokeStyle = blink ? c(74, 1, 95) : c(50, 0.9); // 明滅は色相の明るい色で(白にしない。パッチ全体が変わっても、白い画素は増えない)
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
    // 名前(暗い帯に、明るい等幅の文字)
    ctx.font = `9px ${MONO}`;
    ctx.textAlign = "left";
    ctx.fillStyle = c(78, 1, 70);
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x + 2, p.y, p.w - 14, RACK.title);
    ctx.clip();
    ctx.fillText(p.id.toUpperCase(), p.x + 4, p.y + RACK.title / 2 + 1);
    ctx.restore();

    // パラメータ: 名前(左)と値(右)。板の面は明るいので、文字は暗い色で書く
    const vals = s.values.get(p.id) ?? {};
    const moving = s.moving.get(p.id);
    const defs = s.params.get(p.type);
    const left = p.x + RACK.pad;
    const right = p.x + p.w - RACK.pad;
    for (const row of p.rows) {
      if (row.label) {
        ctx.font = `9px ${MONO}`;
        ctx.textAlign = "left";
        ctx.fillStyle = ink;
        ctx.fillText(row.label, left, row.y);
      }
      if (row.params.length === 0) continue;
      ctx.font = `bold 10px ${MONO}`;
      ctx.textAlign = "right";
      const cellW = row.params.length === 1 ? 0 : (right - left) / RACK.perRow;
      row.params.forEach((name, i) => {
        const text = formatParam(defs?.get(name), vals[name]);
        const x = row.params.length === 1 ? right : left + cellW * (i + 1);
        if (moving?.has(name)) {
          // 楽譜が動かしている値: 暗い地に明るい文字で反転させる(色相は足さない)
          const tw = ctx.measureText(text).width;
          ctx.fillStyle = c(8);
          ctx.fillRect(x - tw - 2, row.y - RACK.row / 2 + 0.5, tw + 4, RACK.row - 1);
          ctx.fillStyle = `hsl(${s.hue},100%,90%)`;
        } else ctx.fillStyle = ink;
        ctx.fillText(row.params.length === 1 ? text : shorten(text), x, row.y);
      });
    }
    ctx.textAlign = "left";

    if (p.lcd) {
      // LCD: 発光する面に、出力の大きさの履歴を暗い棒で出す
      ctx.shadowColor = c(55, 0.7, 95);
      ctx.shadowBlur = 14;
      ctx.fillStyle = c(50, 1, 92);
      ctx.fillRect(p.lcd.x, p.lcd.y, p.lcd.w, p.lcd.h);
      ctx.shadowBlur = 0;
      ctx.fillStyle = c(14, 0.85, 90);
      const n = Math.floor(p.lcd.w / 4);
      const recent = s.levels.slice(-n);
      recent.forEach((v, i) => {
        const bh = Math.round(Math.min(1, Math.max(0, v)) * (p.lcd!.h - 4));
        if (bh > 0) ctx.fillRect(p.lcd!.x + (n - recent.length + i) * 4 + 1, p.lcd!.y + p.lcd!.h - 2 - bh, 3, bh);
      });
      ctx.strokeStyle = c(30, 0.3, 90);
      for (let gx = 8; gx < p.lcd.w; gx += 8) {
        ctx.beginPath();
        ctx.moveTo(p.lcd.x + gx + 0.5, p.lcd.y);
        ctx.lineTo(p.lcd.x + gx + 0.5, p.lcd.y + p.lcd.h);
        ctx.stroke();
      }
    }
    // ジャック(装飾): 板の下の帯に、小さな穴
    for (const j of p.jacks) {
      ctx.fillStyle = c(6);
      ctx.beginPath();
      ctx.arc(j.x, j.y, j.dir === "out" ? 2.4 : 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // LED: いちばん明るい点。出力が出ているモジュールだけ点く(階段状: 点く / 消える)
  for (const p of layout.panels) {
    const on = s.activity !== null && (s.activity[p.id] ?? 0) >= LED_ON_VOLTS;
    const x = p.x + p.w - 7;
    const y = p.y + RACK.title / 2 + 1;
    // にじみは色相の色で(白くしない)。白い画素は、点の芯だけにする(画面の 2.4% 以内)
    ctx.shadowColor = c(55, 0.9, 95);
    ctx.shadowBlur = on ? 9 : 0;
    ctx.fillStyle = on ? `hsl(${s.hue},100%,94%)` : c(20);
    ctx.beginPath();
    ctx.arc(x, y, on ? 2.6 : 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  if (s.panic) {
    // 緊急停止だけは、色相の規則の例外(見落とせない)
    ctx.strokeStyle = "hsl(348,90%,55%)";
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
    ctx.lineWidth = 1;
  }
}

/** 横に並べる値は幅が狭いので、長い数字を縮める(0.800 → .80、-12.00 → -12)。 */
function shorten(text: string): string {
  if (!/^-?\d/.test(text)) return text.slice(0, 4);
  const v = Number(text);
  if (!Number.isFinite(v)) return text.slice(0, 4);
  const a = Math.abs(v);
  if (a >= 100) return String(Math.round(v));
  if (a >= 10) return v.toFixed(1);
  const t = v.toFixed(2);
  return t.replace(/^(-?)0\./, "$1.");
}
