// 画面の色相(docs/design/…single-hue-wash.md)。画面はいつも 1 つの色相で塗る。
// 色相は人が選ぶ(固定)か、周期的にゆっくり変わる(自動)。黄・橙(資料の実測で 0 件)は通らない。

/** 人が選べる色相(資料の単色の回の実測値)。 */
export const HUE_CHOICES: readonly { hue: number; label: string }[] = [
  { hue: 196, label: "シアン" },
  { hue: 173, label: "ティール" },
  { hue: 141, label: "緑" },
  { hue: 117, label: "黄緑寄りの緑" },
  { hue: 227, label: "青" },
  { hue: 268, label: "紫" },
  { hue: 297, label: "マゼンタ" },
  { hue: 345, label: "赤" },
];
export const DEFAULT_HUE = 196;
/** 自動で変わるときの範囲(緑 117° 〜 赤 348°。この外側の黄・橙は使わない)。 */
export const HUE_SWEEP = { from: 117, to: 348 } as const;
/** 自動の周期 [秒](範囲を行って戻るまで)。 */
export const HUE_PERIODS: readonly { seconds: number; label: string }[] = [
  { seconds: 60, label: "1 分" },
  { seconds: 300, label: "5 分" },
  { seconds: 1200, label: "20 分" },
];
export const DEFAULT_PERIOD = 300;

export interface HueSetting {
  mode: "fixed" | "cycle";
  hue: number;
  periodSeconds: number;
}
export const DEFAULT_HUE_SETTING: HueSetting = { mode: "fixed", hue: DEFAULT_HUE, periodSeconds: DEFAULT_PERIOD };

/**
 * 時刻 t [ms] の色相。自動のときは、範囲の端から端へ行って戻る(三角波)。始まりは、選んでいた色相の位置から。
 * 途中で色が跳ばないよう、連続に動く。
 */
export function hueAt(s: HueSetting, tMs: number, startMs = 0): number {
  if (s.mode === "fixed") return s.hue;
  const span = HUE_SWEEP.to - HUE_SWEEP.from;
  const start = Math.min(1, Math.max(0, (s.hue - HUE_SWEEP.from) / span)); // 選んでいた色相の位置(0〜1)
  // 位相 0〜2 の三角波: 0→1 で上り、1→2 で下り
  const phase = (start + ((tMs - startMs) / 1000 / s.periodSeconds) * 2) % 2;
  const pos = phase <= 1 ? phase : 2 - phase;
  return Math.round((HUE_SWEEP.from + span * pos) * 10) / 10;
}

/** 保存された設定(文字列)を読む。壊れていれば既定値。 */
export function parseHueSetting(raw: string | null): HueSetting {
  try {
    const v = JSON.parse(raw ?? "") as Partial<HueSetting>;
    const hue = HUE_CHOICES.some((c) => c.hue === v.hue) ? (v.hue as number) : DEFAULT_HUE;
    const periodSeconds = HUE_PERIODS.some((p) => p.seconds === v.periodSeconds) ? (v.periodSeconds as number) : DEFAULT_PERIOD;
    return { mode: v.mode === "cycle" ? "cycle" : "fixed", hue, periodSeconds };
  } catch {
    return { ...DEFAULT_HUE_SETTING };
  }
}
