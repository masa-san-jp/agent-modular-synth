// 画面の見た目の部品のうち、DOM を使わない計算: 色相(固定・自動)と、ラックの配置。
// docs/design/20261123-ui-visual-direction-single-hue-wash.md、Issue #31。
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCatalog } from "../src/control/catalog.js";
import { EngineBackend } from "../src/control/backend.js";
import { Session } from "../src/control/session.js";
import { REGISTRY } from "../src/modules/registry.js";
import { fillId, fillOps } from "../src/view/fill.js";
import { DEFAULT_HUE_SETTING, HUE_CHOICES, HUE_PERIODS, HUE_SWEEP, hueAt, parseHueSetting } from "../src/view/hue.js";
import { VALUE_LABEL, valueLabel } from "../src/view/labels.js";
import { RACK, cableEnds, formatParam, layoutRack, panelAt, paramRows } from "../src/view/rack-layout.js";

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
  return { id, type, inputs: t.inputs.map((p) => p.name), outputs: t.outputs.map((p) => p.name), params: t.params.map((p) => ({ name: p.name, kind: p.kind, values: p.values, unit: p.unit })), lcd: type === "MOD-IO-001" };
};

test("ラックの配置: 全 20 種のモジュールが、重ならず、幅に収まり、すべてのパラメータとポートが板の中にある", () => {
  const mods = [...CATALOG.keys()].map((type, i) => mod(`m${i}`, type));
  for (const width of [320, 700, 1200]) {
    const l = layoutRack(mods, width);
    assert.equal(l.panels.length, 20);
    for (const [i, p] of l.panels.entries()) {
      const m = mods[i]!;
      assert.equal(p.w, RACK.panelW, "板の幅は一定");
      assert.ok(p.x >= 0 && (p.x + p.w <= width || p.x === RACK.gap), `${p.type}: 幅 ${width} に収まる`);
      assert.ok(p.y + p.h <= l.height);
      // すべてのパラメータが、どこかの行に 1 回ずつ出る
      assert.deepEqual(p.rows.flatMap((r) => r.params).sort(), m.params.map((x) => x.name).sort(), `${p.type} のパラメータ`);
      for (const [k, r] of p.rows.entries()) {
        assert.ok(r.params.length <= RACK.perRow);
        assert.ok(r.y - RACK.row / 2 >= p.y + RACK.title && r.y + RACK.row / 2 <= p.y + p.h, "行が板の中");
        if (k > 0) assert.equal(r.y - p.rows[k - 1]!.y, RACK.row, "行は詰めて並ぶ");
      }
      assert.deepEqual(p.jacks.filter((j) => j.dir === "in").map((j) => j.port), m.inputs);
      assert.deepEqual(p.jacks.filter((j) => j.dir === "out").map((j) => j.port), m.outputs);
      const lastRow = p.rows.at(-1);
      for (const j of p.jacks) {
        assert.ok(j.x - 2.4 >= p.x && j.x + 2.4 <= p.x + p.w && j.y + 2.4 <= p.y + p.h, `${p.type}.${j.port} が板の中`);
        if (lastRow) assert.ok(j.y - 2.4 >= lastRow.y + RACK.row / 2, "ジャックの帯は、パラメータの下");
        if (p.lcd) assert.ok(j.y - 2.4 >= p.lcd.y + p.lcd.h, "ジャックの帯は、LCD の下");
      }
      assert.equal(p.lcd !== null, p.type === "MOD-IO-001");
      if (p.lcd && lastRow) assert.ok(p.lcd.y >= lastRow.y + RACK.row / 2, "LCD はパラメータの下");
      for (const q of l.panels.slice(0, i)) {
        const apart = p.x >= q.x + q.w + RACK.gap - 1e-9 || q.x >= p.x + p.w + RACK.gap - 1e-9 || p.y >= q.y + q.h + RACK.gap - 1e-9 || q.y >= p.y + p.h + RACK.gap - 1e-9;
        assert.ok(apart, `${p.id} と ${q.id} が重ならない`);
      }
    }
  }
  assert.ok(layoutRack(mods, 320).height > layoutRack(mods, 1200).height, "狭いと段が増える");
  assert.deepEqual(layoutRack([], 500), { width: 500, height: 0, panels: [] });
});

test("パラメータの行: ふつうは 1 行に 1 つ。配列(名前[番号])は、名前の行の下に 4 個ずつ並べる", () => {
  const p = (name: string) => ({ name, kind: "float" });
  assert.deepEqual(paramRows([p("cutoff"), p("res")]), [{ label: "cutoff", params: ["cutoff"] }, { label: "res", params: ["res"] }]);
  const rows = paramRows([p("length"), ...[1, 2, 3, 4, 5, 6].map((i) => p(`cv[${i}]`)), p("glide"), ...[1, 2].map((i) => p(`gate[${i}]`))]);
  assert.deepEqual(rows, [
    { label: "length", params: ["length"] },
    { label: "cv", params: [] },
    { label: "", params: ["cv[1]", "cv[2]", "cv[3]", "cv[4]"] },
    { label: "", params: ["cv[5]", "cv[6]"] },
    { label: "glide", params: ["glide"] },
    { label: "gate", params: [] },
    { label: "", params: ["gate[1]", "gate[2]"] },
  ]);
  // ミキサー卓(42 個)も、すべて出る
  const desk = mod("d", "MOD-MIX-002");
  assert.equal(paramRows(desk.params).flatMap((r) => r.params).length, 42);
});

test("値の書式: 数値は 4 桁前後、列挙は名前、真偽は on/off", () => {
  const f = { name: "x", kind: "float" };
  assert.equal(formatParam(f, 0.8), "0.800");
  assert.equal(formatParam(f, -1.5), "-1.500");
  assert.equal(formatParam(f, 12.3456), "12.35");
  assert.equal(formatParam(f, 440), "440.0");
  assert.equal(formatParam(f, 12000), "12000");
  assert.equal(formatParam({ name: "n", kind: "int" }, 16), "16");
  assert.equal(formatParam({ name: "b", kind: "bool" }, 1), "on");
  assert.equal(formatParam({ name: "b", kind: "bool" }, 0), "off");
  assert.equal(formatParam({ name: "m", kind: "int", values: [{ value: 0, label: "soft" }, { value: 1, label: "hard" }] }, 1), "hard");
  assert.equal(formatParam(f, undefined), "–");
  assert.equal(formatParam(undefined, 3), "3");
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
  // 楽譜が動かしているパラメータの、音声側のいまの値
  assert.deepEqual(be.overrideValues(), {});
  be.scheduleMidi([{ at: be.sampleNow() + 10, param: { module: "vco", name: "tune", value: 0.25, ramp: 0 } }]);
  be.processBlock(L, new Float32Array(128));
  assert.deepEqual(be.overrideValues(), { vco: { tune: 0.25 } });
  be.clearSchedule();
  assert.deepEqual(be.overrideValues(), {}, "演奏が終われば、なくなる(パッチの値へ戻る)");
});

test("画面に出す値の名前: 仕様の列挙型の値の名前は、すべて画面用の短い語(英数字)に対応している", () => {
  const labels = new Set<string>();
  for (const t of CATALOG.values()) for (const p of t.params) for (const v of p.values ?? []) labels.add(v.label);
  assert.ok(labels.size >= 8);
  for (const l of labels) {
    assert.ok(l in VALUE_LABEL, `「${l}」の画面用の名前がない(src/view/labels.ts に足す)`);
    assert.match(valueLabel(l), /^[A-Z0-9]{1,8}$/, l);
  }
  assert.equal(valueLabel("未知"), "未知");
});

// ---- 人の画面(PANEL)の「一式を置く」(Issue #59、DEC-029、product-spec §4.1) ----

test("一式を置く: 空のパッチ(out だけ)なら、out 以外の 19 種類を 1 台ずつ、読みやすい ID で足す。配線はしない", () => {
  const catalog = buildCatalog(REGISTRY);
  assert.equal(catalog.size, 20);
  const ops = fillOps(catalog.keys(), [{ id: "out", type: "MOD-IO-001" }]);
  assert.equal(ops.length, 19);
  assert.ok(ops.every((o) => o.command === "module.add"));
  assert.equal(new Set(ops.map((o) => o.args.type)).size, 19);
  assert.ok(!ops.some((o) => o.args.type === "MOD-IO-001"));
  assert.deepEqual(
    ops.map((o) => o.args.id),
    ["amp", "clk", "clk2", "dly", "env", "flt", "fnc", "io2", "io3", "lfo", "lgc", "mix", "mix2", "nse", "osc", "rnd", "sat", "seq", "utl"],
  );
});

test("一式を置く: 既にある種類は足さない。ID が別の種類に使われていれば、ID を指定しない(自動採番)", () => {
  const catalog = buildCatalog(REGISTRY);
  const modules = [
    { id: "out", type: "MOD-IO-001" },
    { id: "vco", type: "MOD-OSC-001" },
    { id: "vco2", type: "MOD-OSC-001" },
    { id: "env", type: "MOD-AMP-001" }, // 読みやすい ID「env」を、別の種類が使っている
  ];
  const ops = fillOps(catalog.keys(), modules);
  assert.equal(ops.length, 17);
  assert.ok(!ops.some((o) => o.args.type === "MOD-OSC-001" || o.args.type === "MOD-AMP-001"));
  const env = ops.find((o) => o.args.type === "MOD-ENV-001");
  assert.equal(env?.args.id, undefined);
  // 全種類がそろっていれば、足すものはない
  const all = [...catalog.keys()].map((type, i) => ({ id: `x${i}`, type }));
  assert.equal(fillOps(catalog.keys(), all).length, 0);
  assert.equal(fillId("MOD-CLK-002"), "clk2");
  assert.equal(fillId("bad"), null);
});

test("一式を置く: batch 1 回で足し、取り消し 1 回で元に戻る。エージェントのモジュールと配線は残り、その後のエージェントの操作も通る", () => {
  const catalog = buildCatalog(REGISTRY);
  const s = new Session({ catalog, backend: new EngineBackend(48000, REGISTRY), sessionId: "s-fill" });
  let n = 0;
  const send = (command: string, args: Record<string, unknown> | undefined, actor: "human" | "agent") =>
    s.handle({ v: 1, request_id: `f-${++n}`, command, ...(args ? { args } : {}) }, actor);
  // 空のパッチ
  let r = send("batch", { ops: fillOps(catalog.keys(), s.getPatch().modules) }, "human");
  assert.equal(r.ok, true);
  assert.equal(s.getPatch().modules.length, 20);
  assert.equal(new Set(s.getPatch().modules.map((m) => m.type)).size, 20);
  assert.equal(s.getPatch().cables.length, 0);
  assert.equal(fillOps(catalog.keys(), s.getPatch().modules).length, 0);
  r = send("history.undo", undefined, "human");
  assert.equal(r.ok, true);
  assert.deepEqual(s.getPatch().modules.map((m) => m.id), ["out"]);
  // エージェントが組んだパッチがあるとき
  r = send(
    "batch",
    {
      ops: [
        { command: "module.add", args: { id: "vco", type: "MOD-OSC-001" } },
        { command: "module.add", args: { id: "vco2", type: "MOD-OSC-001" } },
        { command: "cable.connect", args: { from: { module: "vco", port: "saw" }, to: { module: "out", port: "IN_L" } } },
      ],
    },
    "agent",
  );
  assert.equal(r.ok, true);
  const before = s.revision;
  r = send("batch", { ops: fillOps(catalog.keys(), s.getPatch().modules) }, "human");
  assert.equal(r.ok, true);
  assert.equal(s.revision, before + 1);
  const p = s.getPatch();
  assert.equal(p.modules.length, 21);
  assert.equal(p.modules.filter((m) => m.type === "MOD-OSC-001").length, 2);
  assert.equal(p.cables.length, 1);
  r = send("param.set", { module_id: "vco2", param: "tune", value: 0.1 }, "agent");
  assert.equal(r.ok, true, JSON.stringify(r));
});
