// 画面の見た目の部品のうち、DOM を使わない計算: 色相(固定・自動)と、ラックの配置。
// docs/design/20261123-ui-visual-direction-single-hue-wash.md、Issue #31。
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCatalog } from "../src/control/catalog.js";
import { REGISTRY } from "../src/modules/registry.js";
import { DEFAULT_HUE_SETTING, HUE_CHOICES, HUE_PERIODS, HUE_SWEEP, hueAt, parseHueSetting } from "../src/view/hue.js";
import { RACK, cableEnds, layoutRack, panelAt } from "../src/view/rack-layout.js";

test("色相: 固定のときは選んだ値のまま。候補に黄・橙(20〜100°)はない", () => {
  for (const c of HUE_CHOICES) {
    assert.equal(hueAt({ mode: "fixed", hue: c.hue, periodSeconds: 300 }, 123456), c.hue);
    assert.ok(c.hue >= HUE_SWEEP.from && c.hue <= HUE_SWEEP.to, `${c.label}: ${c.hue}`);
  }
  assert.equal(DEFAULT_HUE_SETTING.mode, "fixed");
  assert.equal(DEFAULT_HUE_SETTING.hue, 196);
});

test("色相: 自動のときは、選んでいた色相から連続に動き、範囲(117〜348°)の端で折り返し、周期で元に戻る。黄・橙は通らない", () => {
  for (const period of HUE_PERIODS.map((p) => p.seconds)) {
    const s = { mode: "cycle" as const, hue: 196, periodSeconds: period };
    assert.equal(hueAt(s, 5000, 5000), 196, "始まりは、選んでいた色相");
    let prev = 196;
    let min = 999;
    let max = -999;
    const step = (period * 1000) / 2000;
    for (let i = 1; i <= 2000; i++) {
      const h = hueAt(s, 5000 + i * step, 5000);
      assert.ok(h >= HUE_SWEEP.from && h <= HUE_SWEEP.to, `${h} は範囲内`);
      assert.ok(Math.abs(h - prev) <= 0.5, `跳ばない: ${prev} → ${h}`);
      prev = h;
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
    assert.equal(min, HUE_SWEEP.from);
    assert.equal(max, HUE_SWEEP.to);
    assert.equal(hueAt(s, 5000 + period * 1000, 5000), 196, "1 周期で元の色相に戻る");
    assert.equal(hueAt(s, 5000 + period * 3000, 5000), 196);
  }
});

test("色相の設定の読み込み: 壊れた値・知らない値は既定値にする", () => {
  assert.deepEqual(parseHueSetting(null), DEFAULT_HUE_SETTING);
  assert.deepEqual(parseHueSetting("{"), DEFAULT_HUE_SETTING);
  assert.deepEqual(parseHueSetting('{"mode":"cycle","hue":268,"periodSeconds":60}'), { mode: "cycle", hue: 268, periodSeconds: 60 });
  assert.deepEqual(parseHueSetting('{"mode":"rainbow","hue":55,"periodSeconds":1}'), DEFAULT_HUE_SETTING, "黄(55°)は選べない");
  assert.deepEqual(parseHueSetting("null"), DEFAULT_HUE_SETTING);
});

const CATALOG = buildCatalog(REGISTRY);
const mod = (id: string, type: string) => {
  const t = CATALOG.get(type)!;
  return { id, type, inputs: t.inputs.map((p) => p.name), outputs: t.outputs.map((p) => p.name), lcd: type === "MOD-IO-001" };
};

test("ラックの配置: 全 20 種のモジュールが、重ならず、幅に収まり、すべてのポートがジャックとして板の中にある", () => {
  const mods = [...CATALOG.keys()].map((type, i) => mod(`m${i}`, type));
  for (const width of [320, 700, 1200]) {
    const l = layoutRack(mods, width);
    assert.equal(l.panels.length, 20);
    const h = l.panels[0]!.h;
    for (const [i, p] of l.panels.entries()) {
      assert.equal(p.h, h, "板の高さは揃える");
      assert.ok(p.x >= 0 && (p.x + p.w <= width || p.x === RACK.gap), `${p.type}: 幅 ${width} に収まる(板 1 枚が幅より広い場合を除く)`);
      assert.ok(p.y + p.h <= l.height);
      const m = mods[i]!;
      assert.deepEqual(p.jacks.filter((j) => j.dir === "in").map((j) => j.port), m.inputs);
      assert.deepEqual(p.jacks.filter((j) => j.dir === "out").map((j) => j.port), m.outputs);
      for (const j of p.jacks) assert.ok(j.x - 3.5 >= p.x && j.x + 3.5 <= p.x + p.w && j.y - 3.5 >= p.y + RACK.title && j.y + 3.5 <= p.y + p.h, `${p.type}.${j.port} が板の中`);
      // ジャック同士は重ならない(間隔 14px)
      for (const a of p.jacks) for (const b of p.jacks) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= RACK.jack - 1e-9);
      // LCD は出力モジュールにだけあり、ジャックと重ならない
      assert.equal(p.lcd !== null, p.type === "MOD-IO-001");
      if (p.lcd) for (const j of p.jacks) assert.ok(j.y + 3.5 <= p.lcd.y, "LCD はジャックの下");
      for (const q of l.panels.slice(0, i)) {
        const apart = p.x >= q.x + q.w + RACK.gap - 1e-9 || q.x >= p.x + p.w + RACK.gap - 1e-9 || p.y >= q.y + q.h + RACK.gap - 1e-9 || q.y >= p.y + p.h + RACK.gap - 1e-9;
        assert.ok(apart, `${p.id} と ${q.id} が重ならない`);
      }
    }
    assert.ok(l.height - (l.panels.at(-1)!.y + h) >= RACK.sag, "いちばん下の段のケーブルが垂れる余白");
  }
  assert.ok(layoutRack(mods, 320).height > layoutRack(mods, 1200).height, "狭いと段が増える");
  assert.deepEqual(layoutRack([], 500), { width: 500, height: 0, panels: [] });
});

test("ラックの配置: 板の当たり判定と、ケーブルの両端(出力のジャック → 入力のジャック)", () => {
  const l = layoutRack([mod("out", "MOD-IO-001"), mod("vco", "MOD-OSC-001"), mod("vca", "MOD-AMP-001")], 800);
  const vco = l.panels[1]!;
  assert.equal(panelAt(l, vco.x + 1, vco.y + 1)?.id, "vco");
  assert.equal(panelAt(l, vco.x - 1, vco.y + 1), null, "板の隙間");
  assert.equal(panelAt(l, 799, 5), null);
  const e = cableEnds(l, { from: { module: "vco", port: "saw" }, to: { module: "vca", port: "in1" } })!;
  assert.deepEqual([e.a.port, e.a.dir, e.b.port, e.b.dir], ["saw", "out", "in1", "in"]);
  assert.ok(e.a.x > vco.x && e.a.x < vco.x + vco.w);
  assert.equal(cableEnds(l, { from: { module: "vco", port: "nope" }, to: { module: "vca", port: "in1" } }), null);
  assert.equal(cableEnds(l, { from: { module: "gone", port: "saw" }, to: { module: "vca", port: "in1" } }), null);
});

test("EngineBackend.activity: 各モジュールの、いまの出力の大きさ(LED 用)。音の出ていないモジュールは 0", async () => {
  const { EngineBackend } = await import("../src/control/backend.js");
  const { Session } = await import("../src/control/session.js");
  const be = new EngineBackend(48000, REGISTRY);
  const s = new Session({ catalog: CATALOG, backend: be, sessionId: "v" });
  let n = 0;
  for (const [command, args] of [["module.add", { id: "vco", type: "MOD-OSC-001" }], ["module.add", { id: "vca", type: "MOD-AMP-001" }], ["engine.start", undefined]] as [string, Record<string, unknown> | undefined][]) {
    assert.equal(s.handle({ v: 1, request_id: `v${++n}`, command, ...(args ? { args } : {}) }, "human").ok, true);
  }
  const L = new Float32Array(128);
  let peak = 0;
  for (let i = 0; i < 50; i++) {
    be.processBlock(L, new Float32Array(128));
    peak = Math.max(peak, be.activity().vco!);
  }
  const a = be.activity();
  assert.deepEqual(Object.keys(a).sort(), ["out", "vca", "vco"]);
  assert.ok(peak > 1 && peak <= 12, `発振器は出力がある: ${peak}`);
  assert.equal(a.vca, 0, "入力のないアンプは 0");
});
