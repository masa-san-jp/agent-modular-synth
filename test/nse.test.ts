// MOD-NSE-001 の検証例(specifications/modules/MOD-NSE-001.md §10)。
import assert from "node:assert/strict";
import { NseModule } from "../src/modules/nse.js";
import { near, nearAll, tv } from "./helpers.js";

const FS = 48000;
const SEED1 = [0.686059594, 2.539288402, 3.893939257];

function mk(seed?: number, level?: number): NseModule {
  const m = new NseModule(FS);
  if (seed !== undefined) m.setParam("seed", seed);
  if (level !== undefined) m.setParam("level", level);
  if (seed !== undefined) m.reset(); // 「新規生成」: 与えた seed で初期化した個体
  return m;
}

function run(m: NseModule, steps: number): number[] {
  const ys: number[] = [];
  for (let i = 0; i < steps; i++) {
    m.step();
    assert.equal(m.output("out").channels, 1);
    ys.push(m.output("out").values[0]!);
  }
  return ys;
}

tv("TV-MOD-NSE-001-01", () => {
  nearAll(run(mk(), 3), SEED1);
});

tv("TV-MOD-NSE-001-02", () => {
  nearAll(run(mk(0, 2), 3), [1.547415733, -0.944164276, -1.950100183]);
});

tv("TV-MOD-NSE-001-03", () => {
  const y = run(mk(1, 5), 100000);
  const n = y.length;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of y) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / n;
  let ss = 0;
  for (const v of y) ss += (v - mean) * (v - mean);
  const sd = Math.sqrt(ss / n);
  let num = 0;
  for (let i = 0; i < n - 1; i++) num += (y[i]! - mean) * (y[i + 1]! - mean);
  const corr = num / ss;
  near(mean, -0.015281, 1e-6, 0, "平均");
  near(sd, 2.886345, 1e-6, 0, "標準偏差");
  near(min, -4.999812, 1e-6, 0, "最小");
  near(max, 4.999973, 1e-6, 0, "最大");
  near(corr, 0.006657, 1e-6, 0, "相関");
  // 統計としての妥当性
  assert.ok(Math.abs(mean) < 0.05);
  assert.ok(Math.abs(sd - 2.886751) <= 0.02);
  assert.ok(Math.abs(corr) < 0.02);
});

tv("TV-MOD-NSE-001-04", () => {
  const m = mk(1, 0);
  const ys = run(m, 2);
  m.setParam("level", 5);
  ys.push(...run(m, 1));
  assert.equal(ys[0], 0);
  assert.equal(ys[1], 0);
  near(ys[2]!, 3.893939257);
});

tv("TV-MOD-NSE-001-05", () => {
  const m = mk(1, 5);
  const out = m.output("out").values;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < 1000000; i++) {
    m.step();
    const v = out[0]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  assert.ok(min >= -5, `最小 ${min}`);
  assert.ok(max < 5, `最大 ${max}`);
  near(min, -4.999991, 1e-6, 0, "最小");
  near(max, 4.999973, 1e-6, 0, "最大");
});

tv("TV-MOD-NSE-001-06", () => {
  const a = mk(1, 100);
  nearAll(run(a, 3), [1.372119188, 5.078576803, 7.787878513], 1e-6, 0, "(a)");
  assert.equal(a.nonfiniteCount, 0);
  const b = mk(1, NaN);
  nearAll(run(b, 3), SEED1, 1e-6, 0, "(b)");
  assert.equal(b.nonfiniteCount, 0);
});

tv("TV-MOD-NSE-001-07", () => {
  // モジュール単体では出力の接続状態を持たない(未接続でも同じ計算)。2ステップ進めてから3番目を読む。
  const m = mk(1, 5);
  assert.equal(m.inputs.length, 0);
  m.step();
  m.step();
  m.step();
  near(m.output("out").values[0]!, 3.893939257);
});

tv("TV-MOD-NSE-001-08", () => {
  const m = mk(1, 5);
  run(m, 5);
  m.reset();
  nearAll(run(m, 3), SEED1);
  assert.equal(m.getRawParam("level"), 5);
  assert.equal(m.getRawParam("seed"), 1);
});

tv("TV-MOD-NSE-001-09", () => {
  const a = mk(1, 5);
  run(a, 100);
  const snap = JSON.parse(JSON.stringify({ params: a.getParams(), state: a.getState() })) as {
    params: Record<string, number>;
    state: Record<string, unknown>;
  };
  const b = new NseModule(FS);
  for (const [k, v] of Object.entries(snap.params)) b.setParam(k, v);
  b.setState(snap.state);
  const ya = run(a, 5);
  const yb = run(b, 5);
  for (let i = 0; i < 5; i++) assert.ok(Object.is(ya[i], yb[i]), `[${i}] ${ya[i]} / ${yb[i]}`);
  nearAll(yb, [4.175336361, 4.105371237, 1.790069938, 1.976030469, -4.833589196]);
});

tv("TV-MOD-NSE-001-10", () => {
  const m = mk(1, 5);
  const ys = run(m, 3);
  m.setParam("seed", 12345);
  ys.push(...run(m, 2));
  nearAll(ys, [...SEED1, -3.792383671, -3.974510431]);
  // seed=12345 を新規に与えた場合の最初の2つと同じ
  const fresh = run(mk(12345, 5), 2);
  assert.ok(Object.is(ys[3], fresh[0]) && Object.is(ys[4], fresh[1]));
});

tv("TV-MOD-NSE-001-11", () => {
  const cases: Array<[string, number, number[]]> = [
    ["(a)", NaN, SEED1],
    ["(b)", -3, [3.868539333, -2.36041069, -4.875250459]],
    ["(c)", 4294967297, SEED1],
    ["(d)", 7.9, [-2.661722898, 0.122323632, -0.510854721]],
  ];
  for (const [name, seed, want] of cases) {
    const m = mk(seed, 5);
    nearAll(run(m, 3), want, 1e-6, 0, name);
    assert.equal(m.nonfiniteCount, 0, name);
  }
});
