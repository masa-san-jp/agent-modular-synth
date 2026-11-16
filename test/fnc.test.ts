// MOD-FNC-001 の検証例(specifications/modules/MOD-FNC-001.md §10)。
import assert from "node:assert/strict";
import { FncModule } from "../src/modules/fnc.js";
import { InSpec, near, stepWith, tv } from "./helpers.js";

const FS = 48000;
type P = { rise?: number; fall?: number; response?: number };

/** 共通前提: rise=0.01, fall=0.02, response=0(線形)。 */
function mk(p: P = {}, base: P = { rise: 0.01, fall: 0.02, response: 0 }): FncModule {
  const m = new FncModule(FS);
  for (const [k, v] of Object.entries({ ...base, ...p })) m.setParam(k, v as number);
  return m;
}

interface Run {
  out: number[][];
  eor: number[][];
  eoc: number[][];
}

/** steps ステップ進め、3出力をチャンネル別に記録する(添字は n − n0)。 */
function run(m: FncModule, steps: number, ins: (n: number) => InSpec, n0 = 0, expectCh?: number): Run {
  const r: Run = { out: [], eor: [], eoc: [] };
  for (let i = 0; i < steps; i++) {
    stepWith(m, ins(n0 + i));
    const o = m.output("out");
    const a = m.output("eor");
    const b = m.output("eoc");
    assert.equal(a.channels, o.channels);
    assert.equal(b.channels, o.channels);
    if (expectCh !== undefined) assert.equal(o.channels, expectCh, "出力チャンネル数");
    for (let c = 0; c < o.channels; c++) {
      (r.out[c] ??= []).push(o.values[c]!);
      (r.eor[c] ??= []).push(a.values[c]!);
      (r.eoc[c] ??= []).push(b.values[c]!);
    }
  }
  return r;
}

function at(ys: readonly number[], pts: ReadonlyArray<readonly [number, number]>, msg = "out", abs = 1e-6): void {
  for (const [n, v] of pts) near(ys[n]!, v, abs, 0, `${msg}[${n}]`);
}

/** ys[n] が区間 [lo, hi] で hiV、他で loV であること(厳密)。 */
function gateIs(ys: readonly number[], lo: number, hi: number, inV: number, outV: number, msg: string): void {
  for (let n = 0; n < ys.length; n++) {
    const want = n >= lo && n <= hi ? inV : outV;
    assert.equal(ys[n], want, `${msg}[${n}]`);
  }
}

function allEq(ys: readonly number[], v: number, msg: string): void {
  for (let n = 0; n < ys.length; n++) assert.equal(ys[n], v, `${msg}[${n}]`);
}

/** 最初に v に達する添字。 */
function firstAt(ys: readonly number[], v: number, from = 0): number {
  for (let n = from; n < ys.length; n++) if (ys[n] === v) return n;
  return -1;
}

const TV01_IN = (n: number): InSpec => ({ trig: n < 48 ? 10 : 0 });

function checkTv01(o: readonly number[], eor: readonly number[], eoc: readonly number[], msg: string): void {
  at(
    o,
    [
      [0, 0.0208333],
      [239, 5.0],
      [478, 9.9791667],
      [479, 10.0],
      [480, 9.9895833],
      [959, 5.0],
      [1438, 0.0104167],
      [1439, 0.0],
      [1440, 0.0],
    ],
    msg,
  );
  gateIs(eor.slice(0, 1600), 479, 1438, 10, 0, `${msg} eor`);
  gateIs(eoc.slice(0, 1600), 0, 478, 0, 10, `${msg} eoc`);
}

tv("TV-MOD-FNC-001-01", () => {
  const m = mk();
  const r = run(m, 1600, TV01_IN, 0, 1);
  checkTv01(r.out[0]!, r.eor[0]!, r.eoc[0]!, "out");
  assert.equal(r.out[0]![479], 10);
  assert.equal(r.out[0]![1439], 0);
  assert.equal(m.nonfiniteCount, 0);
});

tv("TV-MOD-FNC-001-02", () => {
  const r = run(mk(), 1100, (n) => ({ in: n < 500 ? 5 : 0 }));
  at(r.out[0]!, [
    [0, 0.0208333],
    [238, 4.9791667],
    [239, 5.0],
    [499, 5.0],
    [500, 4.9895833],
    [979, 0.0],
    [1000, 0.0],
  ]);
  // オーバーシュートしない
  for (const v of r.out[0]!) assert.ok(v >= 0 && v <= 5, `out=${v} が範囲外`);
  allEq(r.eor[0]!, 0, "eor");
  allEq(r.eoc[0]!, 10, "eoc");
});

tv("TV-MOD-FNC-001-03", () => {
  const r = run(mk({ response: 1 }), 1000, (n) => ({ in: n < 600 ? 10 : 0 }));
  const o = r.out[0]!;
  at(o, [
    [0, 0.142881],
    [1, 0.2837205],
    [100, 7.6625087],
    [239, 9.6837722],
    [599, 10.0],
    [600, 9.9283025],
    [601, 9.8571190],
    [700, 4.8347609],
  ]);
  // out[478]=9.9898550 だがスナップ位置(n=479)は ±1 ステップ許容: 478 はスナップ済みでもよい
  const snap = firstAt(o, 10);
  assert.ok(snap >= 478 && snap <= 480, `スナップ位置 ${snap}`);
  if (snap > 478) near(o[478]!, 9.989855, 1e-6, 0, "out[478]");
  for (let n = 480; n < 600; n++) assert.equal(o[n], 10, `out[${n}]`);
  // 式との一致(スナップ前)
  const kr = Math.exp(-Math.log(1000) / 480);
  for (let n = 0; n < 477; n++) near(o[n]!, 10 * (1 - Math.pow(kr, n + 1)), 1e-6, 0, `out[${n}]`);
  const kf = Math.exp(-Math.log(1000) / 960);
  for (let j = 0; j < 400; j++) near(o[600 + j]!, 10 * Math.pow(kf, j + 1), 1e-6, 0, `out[${600 + j}]`);
});

tv("TV-MOD-FNC-001-04", () => {
  const hi = (n: number): boolean => n < 10 || (n >= 100 && n < 110) || (n >= 700 && n < 710);
  const r = run(mk(), 2500, (n) => ({ trig: hi(n) ? 10 : 0 }));
  const o = r.out[0]!;
  at(o, [
    [99, 2.0833333],
    [100, 2.1041667],
    [479, 10.0],
    [699, 7.7083333],
    [700, 7.7291667],
    [809, 10.0],
    [1769, 0.0],
  ]);
  // 2回目のピークは n=809、0到達は n=1769
  assert.equal(firstAt(o, 10, 480), 809);
  assert.equal(firstAt(o, 0, 810), 1769);
  for (let n = 1769; n < 2500; n++) assert.equal(o[n], 0, `out[${n}]`);
});

tv("TV-MOD-FNC-001-05", () => {
  const r = run(mk(), 5200, (n) => ({ cycle: n < 3000 ? 10 : 0 }));
  const o = r.out[0]!;
  const peaks: number[] = [];
  for (let n = 0; n < o.length; n++) if (o[n] === 10) peaks.push(n);
  assert.deepEqual(peaks, [479, 1919, 3359]);
  at(o, [
    [1439, 0.0],
    [1440, 0.0208333],
    [2999, 2.5],
    [3000, 2.5208333],
  ]);
  assert.equal(r.eoc[0]![1439], 0, "eoc[1439]");
  assert.equal(firstAt(o, 0, 3360), 4319);
  for (let n = 4319; n < 5200; n++) {
    assert.equal(o[n], 0, `out[${n}]`);
    assert.equal(r.eoc[0]![n], 10, `eoc[${n}]`);
    assert.equal(r.eor[0]![n], 0, `eor[${n}]`);
  }
});

tv("TV-MOD-FNC-001-06", () => {
  // (a)
  let r = run(mk(), 2, () => ({ trig: 10, rise_cv: 8 }));
  at(r.out[0]!, [
    [0, 0.0104167],
    [1, 0.0208333],
  ], "(a)");
  // (b)
  r = run(mk(), 1, () => ({ trig: 10, rise_cv: -8 }));
  at(r.out[0]!, [[0, 0.2083333]], "(b)");
  // (c)
  r = run(mk(), 1, () => ({ trig: 10, rise_cv: -20 }));
  at(r.out[0]!, [[0, 0.2083333]], "(c)");
  // (d) ピーク(n=479)まで進め、fall_cv=−8 V で次の2ステップ
  const m = mk();
  const pre = run(m, 480, TV01_IN);
  assert.equal(pre.out[0]![479], 10);
  r = run(m, 2, () => ({ trig: 0, fall_cv: -8 }), 480);
  at(r.out[0]!, [
    [0, 9.7916667],
    [1, 9.5833333],
  ], "(d)");
});

tv("TV-MOD-FNC-001-07", () => {
  // (a)
  let m = mk();
  let r = run(m, 5, () => ({ in: NaN }));
  allEq(r.out[0]!, 0, "(a) out");
  allEq(r.eor[0]!, 0, "(a) eor");
  allEq(r.eoc[0]!, 10, "(a) eoc");
  assert.equal(m.nonfiniteCount, 5, "(a) nonfinite_count");
  // (b)
  m = mk();
  r = run(m, 5, () => ({ trig: NaN, cycle: Infinity }));
  allEq(r.out[0]!, 0, "(b) out");
  allEq(r.eor[0]!, 0, "(b) eor");
  allEq(r.eoc[0]!, 10, "(b) eoc");
  assert.equal(m.nonfiniteCount, 10, "(b) nonfinite_count");
  // (c)
  m = mk({ rise: 0 });
  r = run(m, 1, () => ({ trig: 10 }));
  at(r.out[0]!, [[0, 0.2083333]], "(c)");
  assert.equal(m.nonfiniteCount, 0, "(c)");
  // (d)
  m = mk({ rise: 1e9 });
  r = run(m, 1, () => ({ trig: 10 }));
  at(r.out[0]!, [[0, 2.0833e-6]], "(d)", 1e-7);
  assert.equal(m.nonfiniteCount, 0, "(d)");
  // (e)
  m = mk({ response: 0.7 });
  r = run(m, 1, () => ({ trig: 10 }));
  at(r.out[0]!, [[0, 0.142881]], "(e)");
  assert.equal(m.nonfiniteCount, 0, "(e)");
  // (f)
  m = mk();
  r = run(m, 700, () => ({ in: 20 }));
  at(r.out[0]!, [
    [574, 11.9791667],
    [575, 12.0],
    [699, 12.0],
  ], "(f)");
  assert.equal(m.nonfiniteCount, 0, "(f)");
  // (g)
  m = mk({ rise: NaN, fall: Infinity, response: NaN });
  r = run(m, 1, () => ({ trig: 10 }));
  at(r.out[0]!, [[0, 0.0020833]], "(g)");
  assert.equal(m.nonfiniteCount, 0, "(g)");
  // (h)
  m = mk({ rise: Infinity, fall: -Infinity, response: Infinity });
  r = run(m, 1, () => ({ trig: 10 }));
  at(r.out[0]!, [[0, 0.0020833]], "(h)");
  assert.equal(m.nonfiniteCount, 0, "(h)");
});

tv("TV-MOD-FNC-001-08", () => {
  const m = new FncModule(FS); // 既定パラメータ
  assert.equal(m.param("rise"), 0.1);
  assert.equal(m.param("fall"), 0.1);
  assert.equal(m.param("response"), 0);
  const r = run(m, 100, () => ({}), 0, 1);
  allEq(r.out[0]!, 0, "out");
  allEq(r.eor[0]!, 0, "eor");
  allEq(r.eoc[0]!, 10, "eoc");
  assert.equal(m.nonfiniteCount, 0);
});

tv("TV-MOD-FNC-001-09", () => {
  // (a)
  let m = mk();
  let r = run(m, 300, () => ({ trig: 10 }));
  near(r.out[0]![299]!, 6.25, 1e-6, 0, "(a) リセット前");
  m.reset();
  r = run(m, 2, () => ({ trig: 10 }));
  at(r.out[0]!, [
    [0, 0.0208333],
    [1, 0.0416667],
  ], "(a)");
  assert.equal(m.param("rise"), 0.01);
  assert.equal(m.param("fall"), 0.02);
  // (b)
  m = mk();
  r = run(m, 300, () => ({ in: 3 }));
  near(r.out[0]![299]!, 3.0, 1e-6, 0, "(b) リセット前");
  m.reset();
  r = run(m, 1, () => ({ in: 3 }));
  at(r.out[0]!, [[0, 0.0208333]], "(b)");
});

tv("TV-MOD-FNC-001-10", () => {
  const P10: P = { response: 1 };
  const ins = (n: number): InSpec => ({ in: 3, trig: n < 10 ? 10 : 0 });
  const a = mk(P10);
  run(a, 300, ins);
  const st = a.getState();
  // 参考値: 保存時 y=9.866648, stage=RISE(1)
  near((st.y as number[])[0]!, 9.866648, 1e-6, 0, "保存時 y");
  assert.deepEqual(st.stage, [1]);
  const b = mk(P10);
  b.setState(JSON.parse(JSON.stringify(st)) as typeof st);
  const ra = run(a, 2200, ins, 300);
  const rb = run(b, 2200, ins, 300);
  for (const k of ["out", "eor", "eoc"] as const) {
    assert.equal(rb[k].length, 1);
    for (let i = 0; i < 2200; i++) {
      assert.ok(Object.is(ra[k][0]![i], rb[k][0]![i]), `${k}[${300 + i}] がビット同一でない`);
    }
  }
  near(ra.out[0]![0]!, 9.8685532, 1e-6, 0, "out[300]");
  near(ra.out[0]![2199]!, 3.0, 1e-6, 0, "out[2499]");
  assert.equal(ra.eor[0]![2199], 0);
  assert.equal(ra.eoc[0]![2199], 10);
});

tv("TV-MOD-FNC-001-11", () => {
  // (a)
  let r = run(mk({ response: 1 }), 1000, () => ({ in: 5 }));
  let o = r.out[0]!;
  at(o, [
    [0, 0.0714405],
    [100, 3.8312544],
    [430, 4.9898791],
    [431, 5.0],
  ], "(a)");
  assert.equal(firstAt(o, 5), 431, "(a) スナップ位置");
  for (let n = 431; n < 1000; n++) assert.equal(o[n], 5, `(a) out[${n}]`);
  // (b)
  r = run(mk({ response: 1 }), 1000, () => ({ in: 12 }));
  o = r.out[0]!;
  at(o, [
    [0, 0.1714572],
    [491, 11.9899033],
    [492, 12.0],
  ], "(b)");
  assert.equal(firstAt(o, 12), 492, "(b) スナップ位置");
  for (let n = 492; n < 1000; n++) assert.equal(o[n], 12, `(b) out[${n}]`);
});

tv("TV-MOD-FNC-001-12", () => {
  // (a) スルー
  const insA = (c: number | null) => (): InSpec =>
    c === null
      ? { in: [5, -5, -2], rise_cv: 8, fall_cv: [0, -8] }
      : { in: [5, -5, -2][c]!, rise_cv: 8, fall_cv: [0, -8, 0][c]! };
  let m = mk();
  let r = run(m, 1200, insA(null), 0, 3);
  at(r.out[0]!, [
    [0, 0.0104167],
    [478, 4.9895833],
    [479, 5.0],
  ], "(a) out[0]");
  at(r.out[1]!, [
    [0, -0.2083333],
    [22, -4.7916667],
    [23, -5.0],
  ], "(a) out[1]");
  at(r.out[2]!, [
    [0, -0.0104167],
    [190, -1.9895833],
    [191, -2.0],
  ], "(a) out[2]");
  for (let c = 0; c < 3; c++) {
    allEq(r.eor[c]!, 0, `(a) eor[${c}]`);
    allEq(r.eoc[c]!, 10, `(a) eoc[${c}]`);
  }
  assert.equal(m.nonfiniteCount, 0, "(a) nonfinite_count");
  // 各チャンネルはモノで同じ入力を与えた列とビット同一
  for (let c = 0; c < 3; c++) {
    const mono = run(mk(), 1200, insA(c), 0, 1);
    for (const k of ["out", "eor", "eoc"] as const) {
      for (let n = 0; n < 1200; n++) assert.ok(Object.is(mono[k][0]![n], r[k][c]![n]), `(a) ${k}[${c}][${n}] モノと不一致`);
    }
  }

  // (b) 関数
  const trigB = (c: number, n: number): number => (c === 0 ? (n < 10 ? 10 : 0) : c === 1 ? (n >= 600 && n < 610 ? 10 : 0) : 0);
  m = mk();
  r = run(m, 3200, (n) => ({ in: 3, trig: [trigB(0, n), trigB(1, n), trigB(2, n)] }), 0, 3);
  // エンジン0
  at(r.out[0]!, [
    [0, 0.0208333],
    [479, 10.0],
    [480, 9.9895833],
    [1439, 0.0],
    [1440, 0.0208333],
    [1583, 3.0],
  ], "(b) out[0]");
  gateIs(r.eor[0]!, 479, 1438, 10, 0, "(b) eor[0]");
  gateIs(r.eoc[0]!, 0, 478, 0, 10, "(b) eoc[0]");
  // n≤1439 は TV-01 と同じ列(trig の high 区間だけが違う: 10 サンプルと 48 サンプル。立ち上がりは同じ)
  const tv01 = run(mk(), 1440, TV01_IN);
  for (let n = 0; n < 1440; n++) assert.ok(Object.is(tv01.out[0]![n], r.out[0]![n]), `(b) out[0][${n}] が TV-01 と不一致`);
  // エンジン1
  at(r.out[1]!, [
    [143, 3.0],
    [599, 3.0],
    [600, 3.0208333],
    [935, 10.0],
    [936, 9.9895833],
    [1895, 0.0],
    [1896, 0.0208333],
    [2039, 3.0],
  ], "(b) out[1]");
  gateIs(r.eor[1]!, 935, 1894, 10, 0, "(b) eor[1]");
  gateIs(r.eoc[1]!, 600, 934, 0, 10, "(b) eoc[1]");
  // エンジン2
  at(r.out[2]!, [
    [0, 0.0208333],
    [142, 2.9791667],
    [143, 3.0],
  ], "(b) out[2]");
  for (let n = 143; n < 3200; n++) near(r.out[2]![n]!, 3.0, 1e-6, 0, `(b) out[2][${n}]`);
  allEq(r.eor[2]!, 0, "(b) eor[2]");
  allEq(r.eoc[2]!, 10, "(b) eoc[2]");
  assert.equal(m.nonfiniteCount, 0, "(b) nonfinite_count");
  for (let c = 0; c < 3; c++) {
    const mono = run(mk(), 3200, (n) => ({ in: 3, trig: trigB(c, n) }), 0, 1);
    for (const k of ["out", "eor", "eoc"] as const) {
      for (let n = 0; n < 3200; n++) assert.ok(Object.is(mono[k][0]![n], r[k][c]![n]), `(b) ${k}[${c}][${n}] モノと不一致`);
    }
  }
});
