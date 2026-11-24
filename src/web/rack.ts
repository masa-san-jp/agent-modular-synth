// ラックを描く(キャンバス)。配置の計算は src/view/rack-layout.ts。見た目の方針は docs/design/…single-hue-wash.md。
import { RACK, RackCable, RackLayout, cableEnds } from "../view/rack-layout.js";

export interface RackState {
  hue: number;
  cables: readonly RackCable[];
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

/** ラックを描く。色は 1 つの色相だけ(緊急停止の枠だけ、例外で赤)。 */
export function drawRack(ctx: CanvasRenderingContext2D, layout: RackLayout, s: RackState): void {
  const { width: w, height: h } = layout;
  const c = (l: number, a = 1, sat = 83): string => `hsla(${s.hue},${sat}%,${l}%,${a})`;
  // 地: 中央下寄りが少し明るく、周辺は暗い
  const g = ctx.createRadialGradient(w * 0.5, h * 0.65, 0, w * 0.5, h * 0.65, Math.max(w, h) * 0.8);
  g.addColorStop(0, c(22));
  g.addColorStop(0.55, c(10, 1, 88));
  g.addColorStop(1, c(3, 1, 80));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = 1;
  ctx.font = '9px ui-monospace, "IBM Plex Mono", monospace';
  ctx.textBaseline = "middle";
  for (const p of layout.panels) {
    // 板の面は、資料の「面」(明るさ 25〜36%)。暗部が画面の 2/3 を超えないようにする
    ctx.fillStyle = c(35);
    ctx.fillRect(p.x, p.y, p.w, p.h);
    // 名前の帯は暗くして、文字を読めるようにする
    ctx.fillStyle = c(9);
    ctx.fillRect(p.x, p.y, p.w, RACK.title);
    const t = s.changed.get(p.id);
    const blink = t !== undefined && s.now - t < CHANGE_BLINK_MS && Math.floor((s.now - t) / 100) % 2 === 0;
    ctx.strokeStyle = blink ? `hsl(${s.hue},100%,94%)` : c(50, 0.9);
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
    // 名前(板の上の帯。等幅・大文字)
    ctx.fillStyle = c(82, 1, 70);
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x + 2, p.y, p.w - 14, RACK.title);
    ctx.clip();
    ctx.fillText(p.id.toUpperCase(), p.x + 4, p.y + RACK.title / 2 + 1);
    ctx.restore();
    // 入力と出力の境
    const firstOut = p.jacks.find((j) => j.dir === "out");
    if (firstOut && p.jacks[0]?.dir === "in") {
      ctx.strokeStyle = c(24, 0.8);
      ctx.beginPath();
      ctx.moveTo(p.x + 4, firstOut.y - RACK.jack / 2 - RACK.divider / 2 + 0.5);
      ctx.lineTo(p.x + p.w - 4, firstOut.y - RACK.jack / 2 - RACK.divider / 2 + 0.5);
      ctx.stroke();
    }
    for (const j of p.jacks) {
      ctx.fillStyle = c(4);
      ctx.strokeStyle = j.dir === "out" ? c(68, 0.95) : c(56, 0.95);
      ctx.beginPath();
      ctx.arc(j.x, j.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (p.lcd) {
      // LCD: 発光する面に、出力の大きさの履歴を暗い棒で出す
      ctx.shadowColor = c(55, 0.7, 95);
      ctx.shadowBlur = 18;
      ctx.fillStyle = c(52, 1, 92);
      ctx.fillRect(p.lcd.x, p.lcd.y, p.lcd.w, p.lcd.h);
      ctx.shadowBlur = 0;
      ctx.fillStyle = c(18, 0.85, 90);
      const n = Math.floor(p.lcd.w / 4);
      const recent = s.levels.slice(-n);
      recent.forEach((v, i) => {
        const bh = Math.round(Math.min(1, Math.max(0, v)) * (p.lcd!.h - 4));
        if (bh > 0) ctx.fillRect(p.lcd!.x + (n - recent.length + i) * 4 + 1, p.lcd!.y + p.lcd!.h - 2 - bh, 3, bh);
      });
      ctx.strokeStyle = c(30, 0.35, 90);
      for (let gx = 8; gx < p.lcd.w; gx += 8) {
        ctx.beginPath();
        ctx.moveTo(p.lcd.x + gx + 0.5, p.lcd.y);
        ctx.lineTo(p.lcd.x + gx + 0.5, p.lcd.y + p.lcd.h);
        ctx.stroke();
      }
      for (let gy = 8; gy < p.lcd.h; gy += 8) {
        ctx.beginPath();
        ctx.moveTo(p.lcd.x, p.lcd.y + gy + 0.5);
        ctx.lineTo(p.lcd.x + p.lcd.w, p.lcd.y + gy + 0.5);
        ctx.stroke();
      }
    }
  }
  // ケーブル: 垂れた曲線。4 本に 1 本を明るく
  s.cables.forEach((cable, i) => {
    const e = cableEnds(layout, cable);
    if (!e) return;
    const hi = i % 4 === 0;
    const dist = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
    ctx.strokeStyle = hi ? c(70, 0.95) : c(58, 0.9);
    ctx.lineWidth = hi ? 1.6 : 1.2;
    ctx.beginPath();
    ctx.moveTo(e.a.x, e.a.y);
    ctx.quadraticCurveTo((e.a.x + e.b.x) / 2, Math.max(e.a.y, e.b.y) + 14 + dist * 0.22, e.b.x, e.b.y);
    ctx.stroke();
  });
  ctx.lineWidth = 1;
  // LED: いちばん明るい点。出力が出ているモジュールだけ点く(階段状: 点く / 消える)
  for (const p of layout.panels) {
    const on = s.activity !== null && (s.activity[p.id] ?? 0) >= LED_ON_VOLTS;
    const x = p.x + p.w - 7;
    const y = p.y + RACK.title / 2 + 1;
    // にじみは色相の色で(白くしない)。白い画素は、点の芯だけにする(画面の 2.4% 以内)
    ctx.shadowColor = c(55, 0.9, 95);
    ctx.shadowBlur = on ? 9 : 0;
    ctx.fillStyle = on ? `hsl(${s.hue},100%,94%)` : c(14);
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
