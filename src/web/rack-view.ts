// ラックの表示を画面につなぐ: キャンバスの大きさ、色相の設定(固定・自動)、状態の帯、板を押したときの移動。
import type { TypeCatalog } from "../control/catalog.js";
import type { Patch } from "../control/types.js";
import { DEFAULT_HUE_SETTING, HUE_CHOICES, HUE_PERIODS, HueSetting, hueAt, parseHueSetting } from "../view/hue.js";
import { RackLayout, RackParam, layoutRack, panelAt } from "../view/rack-layout.js";
import { drawRack } from "./rack.js";

const HUE_KEY = "agent-modular-synth.hue";
const OUT_TYPE = "MOD-IO-001";
/** LCD に出す履歴の数(1 件 = 状態の通知 1 回 = 約 50 ms)。 */
const LEVEL_HISTORY = 48;
/** 描く倍率の候補(大きい順)と、その倍率を選ぶ高さの上限 [px]。 */
const SCALES = [1.75, 1.5, 1.25, 1];
const MAX_HEIGHT = 900;

export interface RackViewDeps {
  canvas: HTMLCanvasElement;
  hud: HTMLElement;
  hueSelect: HTMLSelectElement;
  periodSelect: HTMLSelectElement;
  catalog: TypeCatalog;
  getPatch: () => Patch;
  /** パッチのリビジョン(変わったときだけ、パッチを読み直す)。 */
  getRevision: () => number;
  /** 状態の帯に出す項目(短い文字。等幅・大文字で出す)。 */
  hudItems: () => string[];
  /** 板を押したとき(そのモジュールのフォームへ移る)。 */
  onPick: (moduleId: string) => void;
}
export interface RackView {
  /** 状態が変わったら呼ぶ(音声の状態の通知ごと)。 */
  update(status: { activity: Record<string, number> | null; overrides: Record<string, Record<string, number>>; peak: number; panic: boolean }): void;
  /** 変わったモジュールを短く明滅させる。 */
  markChanged(ids: readonly string[]): void;
  /** いまの色相(自動試験用)。 */
  readonly hue: number;
  readonly setting: HueSetting;
  readonly layout: RackLayout;
  /** 描く倍率(板が少ないときは大きく描く)。 */
  readonly scale: number;
}

export function createRackView(d: RackViewDeps): RackView {
  let setting: HueSetting = { ...DEFAULT_HUE_SETTING };
  try {
    setting = parseHueSetting(localStorage.getItem(HUE_KEY));
  } catch {
    // 保存領域が使えない: 既定値のまま
  }
  let cycleStart = Date.now();
  let hue = hueAt(setting, Date.now(), cycleStart);
  let layout: RackLayout = { width: 0, height: 0, panels: [] };
  let layoutKey = "";
  let scale = 1;
  const changed = new Map<string, number>();
  const levels: number[] = [];
  let last = { activity: null as Record<string, number> | null, overrides: {} as Record<string, Record<string, number>>, peak: 0, panic: false };
  // 種別 → パラメータの定義(値の書式のため)
  const defs = new Map<string, Map<string, RackParam>>();
  for (const [type, info] of d.catalog) defs.set(type, new Map(info.params.map((p) => [p.name, { name: p.name, kind: p.kind, ...(p.values ? { values: p.values } : {}), ...(p.unit ? { unit: p.unit } : {}) }])));
  let patch = d.getPatch();
  let patchRev = d.getRevision();
  const currentPatch = (): Patch => {
    const rev = d.getRevision();
    if (rev !== patchRev) {
      patchRev = rev;
      patch = d.getPatch();
    }
    return patch;
  };

  // 色相の選択: 固定の色相、または「自動」
  for (const c of HUE_CHOICES) d.hueSelect.append(new Option(`${c.label} ${c.hue}`, String(c.hue)));
  d.hueSelect.append(new Option("AUTO", "cycle"));
  for (const p of HUE_PERIODS) d.periodSelect.append(new Option(p.label, String(p.seconds)));
  const showSetting = (): void => {
    d.hueSelect.value = setting.mode === "cycle" ? "cycle" : String(setting.hue);
    d.periodSelect.value = String(setting.periodSeconds);
    d.periodSelect.disabled = setting.mode !== "cycle";
  };
  const save = (): void => {
    try {
      localStorage.setItem(HUE_KEY, JSON.stringify(setting));
    } catch {
      // 保存できなくても、この回の表示は変える
    }
  };
  d.hueSelect.addEventListener("change", () => {
    if (d.hueSelect.value === "cycle") {
      // いまの色相の位置から動き始める(色が跳ばない)
      setting = { ...setting, mode: "cycle" };
      cycleStart = Date.now();
    } else setting = { ...setting, mode: "fixed", hue: Number(d.hueSelect.value) };
    save();
    showSetting();
    paint();
  });
  d.periodSelect.addEventListener("change", () => {
    // 周期を変えても、色は今の位置から続ける
    const now = Date.now();
    const nearest = HUE_CHOICES.reduce((a, c) => (Math.abs(c.hue - hue) < Math.abs(a.hue - hue) ? c : a));
    setting = { ...setting, hue: setting.mode === "cycle" ? nearest.hue : setting.hue, periodSeconds: Number(d.periodSelect.value) };
    cycleStart = now;
    save();
    showSetting();
    paint();
  });
  showSetting();

  const relayout = (): void => {
    const patch = currentPatch();
    const width = Math.max(120, Math.floor(d.canvas.clientWidth));
    const key = `${width}|${patch.modules.map((m) => `${m.id}:${m.type}`).join(",")}`;
    if (key === layoutKey) return;
    layoutKey = key;
    const mods = patch.modules.map((m) => {
      const t = d.catalog.get(m.type);
      return { id: m.id, type: m.type, inputs: t ? t.inputs.map((p) => p.name) : [], outputs: t ? t.outputs.map((p) => p.name) : [], params: [...(defs.get(m.type)?.values() ?? [])], lcd: m.type === OUT_TYPE };
    });
    // 板が少ないときは大きく描く(画面を埋める密度に近づける)。高さが MAX_HEIGHT を超えない、いちばん大きい倍率
    scale = 1;
    for (const s of SCALES) {
      const l = layoutRack(mods, width / s);
      layout = l;
      scale = s;
      if (l.height * s <= MAX_HEIGHT) break;
    }
    const ratio = window.devicePixelRatio || 1;
    d.canvas.style.height = `${Math.round(layout.height * scale)}px`;
    d.canvas.width = Math.round(width * ratio);
    d.canvas.height = Math.round(layout.height * scale * ratio);
    const patchText = `${patch.modules.length} 個のモジュールと ${patch.cables.length} 本のケーブル`;
    d.canvas.setAttribute("aria-label", `ラックの表示: ${patchText}。内容は下の「モジュール」「ケーブル」の欄で読める`);
  };

  const paint = (): void => {
    relayout();
    const now = Date.now();
    hue = hueAt(setting, now, cycleStart);
    // ページ全体の色も、同じ色相から作る(CSS の --h)
    document.documentElement.style.setProperty("--h", String(hue));
    for (const [id, t] of changed) if (now - t > 2000) changed.delete(id);
    const ctx = d.canvas.getContext("2d");
    if (ctx && layout.height > 0) {
      const ratio = (d.canvas.width / Math.max(1, d.canvas.clientWidth)) * scale;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      // 値: パッチの値。楽譜が動かしているパラメータは、音声側のいまの値
      const p = currentPatch();
      const values = new Map<string, Record<string, number>>();
      const moving = new Map<string, Set<string>>();
      for (const m of p.modules) {
        const o = last.overrides[m.id];
        values.set(m.id, o ? { ...m.params, ...o } : m.params);
        if (o) moving.set(m.id, new Set(Object.keys(o)));
      }
      drawRack(ctx, layout, { hue, cables: p.cables, values, moving, params: defs, activity: last.activity, changed, levels, panic: last.panic, now });
    }
    const items = [...d.hudItems(), `hue ${Math.round(hue)}°${setting.mode === "cycle" ? " auto" : ""}`];
    if (d.hud.children.length !== items.length) d.hud.replaceChildren(...items.map(() => document.createElement("div")));
    items.forEach((text, i) => {
      const cell = d.hud.children[i]!;
      if (cell.textContent !== text) cell.textContent = text;
    });
  };

  d.canvas.addEventListener("click", (ev) => {
    const r = d.canvas.getBoundingClientRect();
    const p = panelAt(layout, (ev.clientX - r.left) / scale, (ev.clientY - r.top) / scale);
    if (p) d.onPick(p.id);
  });
  window.addEventListener("resize", paint);
  // 音声が止まっていても、色相の自動変化と明滅は進める
  window.setInterval(paint, 200);
  paint();

  return {
    update(status) {
      last = status;
      levels.push(status.activity === null ? 0 : Math.min(1, status.peak));
      if (levels.length > LEVEL_HISTORY) levels.shift();
      paint();
    },
    markChanged(ids) {
      const now = Date.now();
      for (const id of ids) changed.set(id, now);
    },
    get hue() {
      return hue;
    },
    get setting() {
      return setting;
    },
    get layout() {
      return layout;
    },
    get scale() {
      return scale;
    },
  };
}
