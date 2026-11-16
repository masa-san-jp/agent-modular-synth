// MOD-CLK-002 の検証例(specifications/modules/MOD-CLK-002.md §10)。
import assert from "node:assert/strict";
import { ClkDivModule } from "../src/modules/clkdiv.js";
import { InSpec, stepWith, tv } from "./helpers.js";

const FS = 48000;
const OUTS = ["out2", "out4", "out8", "out16", "out32", "out64", "out_div"] as const;
const DIV = 6; // out_div の桁

function mk(division?: number, fs = FS): ClkDivModule {
  const m = new ClkDivModule(fs);
  if (division !== undefined) {
    m.setParam("division", division);
    // 前提「division=…」は、その値での初期状態から始めること。out_div のカウンタの初期値 N−1 は
    // division に依存するので(§5、COM-10: リセット時点のパラメータで初期化)、設定後に reset() する。
    m.reset();
  }
  return m;
}

/** 1ステップ進め、チャンネル別の7桁(1=10 V, 0=0 V)を返す。値は 0 か 10 のみ(厳密)。 */
function st(m: ClkDivModule, ins: InSpec): string[] {
  stepWith(m, ins);
  const n = m.output("out2").channels;
  const r: string[] = [];
  for (let c = 0; c < n; c++) {
    let s = "";
    for (const o of OUTS) {
      const p = m.output(o);
      assert.equal(p.channels, n, `${o} のチャンネル数`);
      const v = p.values[c]!;
      assert.ok(v === 0 || v === 10, `${o}[${c}] = ${v}`);
      s += v === 10 ? "1" : "0";
    }
    r.push(s);
  }
  return r;
}

/** 周期 p サンプル、先頭 w サンプルが high(10 V)。 */
const clk = (n: number, p = 10, w = 5): number => (n % p < w ? 10 : 0);

/** n=0 から steps ステップ進め、各ステップの7桁をチャンネル別に返す(r[c][n])。 */
function run(m: ClkDivModule, steps: number, ins: (n: number) => InSpec, n0 = 0): string[][] {
  const r: string[][] = [];
  for (let i = 0; i < steps; i++) {
    const s = st(m, ins(n0 + i));
    s.forEach((v, c) => (r[c] ??= []).push(v));
  }
  return r;
}

/** 既定クロック(周期10)で k 個目(1始まり)の立ち上がりのステップは n=10(k−1)。 */
function mono(m: ClkDivModule, steps: number, ins: (n: number) => InSpec = (n) => ({ clock: clk(n) })): string[] {
  const r = run(m, steps, ins);
  assert.equal(r.length, 1, "モノの出力は1ch");
  return r[0]!;
}

tv("TV-MOD-CLK-002-01", () => {
  const m = mk();
  const r = mono(m, 80);
  const want = ["1111111", "0111111", "1011110", "0011111", "1101111", "0101110", "1001111", "0001111"];
  want.forEach((w, k) => {
    assert.equal(r[10 * k], w, `${k + 1}番目`);
    // 次の立ち上がりまで保持
    for (let j = 1; j < 10; j++) assert.equal(r[10 * k + j], w, `${k + 1}番目 +${j}`);
  });
  assert.equal(m.nonfiniteCount, 0);
});

tv("TV-MOD-CLK-002-02", () => {
  const r = mono(mk(), 650);
  const want: Array<[number, string]> = [
    [9, "1110110"],
    [16, "0000111"],
    [17, "1111011"],
    [32, "0000011"],
    [33, "1111100"],
    [64, "0000001"],
    [65, "1111111"],
  ];
  for (const [k, w] of want) assert.equal(r[10 * (k - 1)], w, `${k}番目`);
});

/** クロック1〜12個目の out_div の列。 */
function divSeq(division: number): number[] {
  const r = mono(mk(division), 120);
  const s: number[] = [];
  for (let k = 0; k < 12; k++) s.push(Number(r[10 * k]![DIV]));
  return s;
}

const SEQ2 = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
const SEQ3 = [1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0];

tv("TV-MOD-CLK-002-03", () => {
  assert.deepEqual(divSeq(5), [1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1], "division=5");
  assert.deepEqual(divSeq(2), SEQ2, "division=2");
});

tv("TV-MOD-CLK-002-04", () => {
  const ones = new Array<number>(12).fill(1);
  assert.deepEqual(divSeq(64), ones, "64");
  assert.deepEqual(divSeq(100), ones, "100");
  assert.deepEqual(divSeq(1), SEQ2, "1");
  assert.deepEqual(divSeq(2.5), SEQ3, "2.5");
  assert.deepEqual(divSeq(3.5), [1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0], "3.5");
  assert.deepEqual(divSeq(NaN), SEQ3, "NaN");
  assert.deepEqual(divSeq(Infinity), SEQ3, "+∞");
  assert.deepEqual(divSeq(-Infinity), SEQ3, "−∞");
});

tv("TV-MOD-CLK-002-05", () => {
  const cDiv = (m: ClkDivModule): number => (m.getState().c as number[][])[0]![DIV]!;
  // 変更する場合
  const m = mk(5);
  let r = mono(m, 33); // n=0〜32(4個目は n=30)
  assert.equal(r[32]![DIV], "0", "変更前(4個目の直後)");
  assert.equal(cDiv(m), 3);
  m.setParam("division", 3);
  r = run(m, 7, (n) => ({ clock: clk(n) }), 33)[0]!; // n=33〜39
  for (const s of r) assert.equal(s[DIV], "0", "変更直後・クロック前");
  assert.equal(cDiv(m), 0, "c=3 mod 3");
  r = run(m, 1, (n) => ({ clock: clk(n) }), 40)[0]!;
  assert.equal(r[0]![DIV], "1", "5個目(n=40)");
  assert.equal(cDiv(m), 1);
  // 変更しなかった場合
  const m2 = mk(5);
  const r2 = mono(m2, 41);
  assert.equal(r2[40]![DIV], "0", "変更なしの5個目");
  assert.equal(cDiv(m2), 4);
});

tv("TV-MOD-CLK-002-06", () => {
  const r = mono(mk(), 5, () => ({ clock: 10 }));
  for (let n = 0; n < 5; n++) assert.equal(r[n], "1111111", `n=${n}`);
});

tv("TV-MOD-CLK-002-07", () => {
  // 前者
  let m = mk();
  const out2 = (v: number): string => st(m, { clock: v })[0]![0]!;
  assert.equal(out2(2.0), "1", "2.0 V(立ち上がり)");
  assert.equal(out2(1.0), "1", "1.0 V");
  assert.equal(out2(0.1), "1", "0.1 V");
  assert.equal(out2(1.99), "1", "1.99 V");
  assert.equal(out2(2.0), "0", "2.0 V(2回目)");
  // 後者
  m = mk();
  assert.equal(out2(2.0), "1", "2.0 V");
  assert.equal(out2(0.5), "1", "0.5 V");
  assert.equal(out2(2.0), "1", "2.0 V(立ち上がりでない)");
});

tv("TV-MOD-CLK-002-08", () => {
  // (a)
  let m = mk();
  let r = mono(m, 5, () => ({ clock: NaN }));
  for (let n = 0; n < 5; n++) assert.equal(r[n], "0000000", `(a) n=${n}`);
  assert.equal(m.nonfiniteCount, 5, "(a) nonfinite_count");
  // (b)
  m = mk();
  r = mono(m, 3, (n) => ({ clock: clk(n), reset: NaN }));
  for (let n = 0; n < 3; n++) assert.equal(r[n], "1111111", `(b) n=${n}`);
  assert.equal(m.nonfiniteCount, 3, "(b) nonfinite_count");
});

tv("TV-MOD-CLK-002-09", () => {
  const m = mk();
  const r = mono(m, 1000, () => ({}));
  for (let n = 0; n < 1000; n++) assert.equal(r[n], "0000000", `n=${n}`);
  assert.equal(m.nonfiniteCount, 0);
});

tv("TV-MOD-CLK-002-10", () => {
  const m = mk();
  const r = mono(m, 50);
  assert.equal(r[49], "1101111", "5個目の後");
  m.reset();
  assert.deepEqual(st(m, { clock: 0 }), ["0000000"], "reset() 直後");
  assert.deepEqual(st(m, { clock: 10 }), ["1111111"], "クロック1個目");
  assert.equal(m.param("division"), 3);
  // division を変えた場合も保持
  const m2 = mk(5);
  mono(m2, 50);
  m2.reset();
  assert.equal(m2.param("division"), 5);
  assert.deepEqual((m2.getState().c as number[][])[0], [1, 3, 7, 15, 31, 63, 4]);
});

/** n=0〜49 でクロック5個、reset=10 V を n=100〜109、立ち上がりを n=x に(5サンプル high)与えて n=299 まで。 */
function resetRun(fs: number, x: number): string[] {
  return mono(mk(undefined, fs), 300, (n) => ({
    clock: n < 50 ? clk(n) : n >= x && n < x + 5 ? 10 : 0,
    reset: n >= 100 && n < 110 ? 10 : 0,
  }));
}

tv("TV-MOD-CLK-002-11", () => {
  for (const x of [105, 120, 157]) {
    const r = resetRun(FS, x);
    assert.equal(r[99], "1101111", `x=${x} リセット前`);
    for (let n = 100; n < 300; n++) assert.equal(r[n], "0000000", `x=${x} n=${n}`);
  }
  const r = resetRun(FS, 158);
  for (let n = 100; n < 158; n++) assert.equal(r[n], "0000000", `x=158 n=${n}`);
  for (let n = 158; n < 300; n++) assert.equal(r[n], "1111111", `x=158 n=${n}`);
});

tv("TV-MOD-CLK-002-12", () => {
  let r = resetRun(44100, 154);
  for (let n = 100; n < 300; n++) assert.equal(r[n], "0000000", `x=154 n=${n}`);
  r = resetRun(44100, 155);
  for (let n = 100; n < 155; n++) assert.equal(r[n], "0000000", `x=155 n=${n}`);
  for (let n = 155; n < 300; n++) assert.equal(r[n], "1111111", `x=155 n=${n}`);
});

tv("TV-MOD-CLK-002-13", () => {
  const ins = (n: number): InSpec => ({ clock: n % 7 < 3 ? 10 : 0, reset: n >= 500 && n < 510 ? 10 : 0 });
  const a = mk(5);
  run(a, 300, ins);
  const state = a.getState();
  assert.deepEqual(state.c, [[0, 2, 2, 10, 10, 42, 2]], "保存時 c");
  assert.deepEqual(state.hi, [[1, 0, 1, 0, 1, 0, 1]], "保存時 hi");
  assert.deepEqual(state.guard, [0], "保存時 guard");
  const b = mk(5);
  b.setState(JSON.parse(JSON.stringify(state)) as typeof state);
  const seq: string[] = [];
  for (let n = 300; n < 1500; n++) {
    stepWith(a, ins(n));
    stepWith(b, ins(n));
    let s = "";
    for (const o of OUTS) {
      const va = a.output(o).values[0]!;
      const vb = b.output(o).values[0]!;
      assert.equal(b.output(o).channels, 1);
      assert.ok(Object.is(va, vb), `${o}[${n}] がビット同一でない`);
      s += va === 10 ? "1" : "0";
    }
    seq.push(s);
  }
  assert.equal(seq[0], "1010101", "n=300");
  assert.equal(seq[499 - 300], "0001111", "n=499");
  for (let n = 500; n <= 540; n++) assert.equal(seq[n - 300], "0000000", `n=${n}`);
  assert.equal(seq[1499 - 300], "1001110", "n=1499");
});

tv("TV-MOD-CLK-002-14", () => {
  const same = (poly: string[], monoSeq: string[], msg: string): void => {
    assert.equal(poly.length, monoSeq.length, msg);
    for (let n = 0; n < poly.length; n++) assert.equal(poly[n], monoSeq[n], `${msg} n=${n}`);
  };
  const pt = (r: string[][], n: number, want: readonly string[], msg: string): void => {
    assert.equal(r.length, 3, `${msg} チャンネル数`);
    want.forEach((w, c) => assert.equal(r[c]![n], w, `${msg} n=${n} ch${c}`));
  };
  const rst = (n: number): number => (n >= 100 && n < 110 ? 10 : 0);

  // (a)
  let m = mk();
  let r = run(m, 200, (n) => ({ clock: [clk(n, 10), clk(n, 20), 0] }));
  assert.equal(r.length, 3);
  assert.equal(r[0]![0], "1111111");
  assert.equal(r[0]![10], "0111111");
  assert.equal(r[0]![20], "1011110");
  assert.equal(r[0]![30], "0011111");
  assert.equal(r[1]![0], "1111111");
  assert.equal(r[1]![10], "1111111");
  assert.equal(r[1]![20], "0111111");
  assert.equal(r[1]![40], "1011110");
  assert.equal(r[1]![60], "0011111");
  assert.equal(r[1]![80], "1101111");
  for (let n = 0; n < 200; n++) assert.equal(r[2]![n], "0000000", `(a) ch2 n=${n}`);
  same(r[0]!, mono(mk(), 200, (n) => ({ clock: clk(n, 10) })), "(a) ch0 とモノ");
  same(r[1]!, mono(mk(), 200, (n) => ({ clock: clk(n, 20) })), "(a) ch1 とモノ");
  assert.equal(m.nonfiniteCount, 0, "(a)");

  // (b)
  m = mk();
  r = run(m, 200, (n) => ({ clock: [clk(n, 10), clk(n, 20), clk(n, 40)], reset: rst(n) }));
  pt(r, 99, ["0110111", "1101111", "1011110"], "(b)");
  for (let n = 100; n < 160; n++) pt(r, n, ["0000000", "0000000", "0000000"], "(b)");
  pt(r, 160, ["1111111", "1111111", "1111111"], "(b)");
  pt(r, 170, ["0111111", "1111111", "1111111"], "(b)");
  pt(r, 180, ["1011110", "0111111", "1111111"], "(b)");
  pt(r, 199, ["0011111", "0111111", "1111111"], "(b)");
  [10, 20, 40].forEach((p, c) =>
    same(r[c]!, mono(mk(), 200, (n) => ({ clock: clk(n, p), reset: rst(n) })), `(b) ch${c} とモノ`),
  );
  assert.equal(m.nonfiniteCount, 0, "(b)");

  // (c)
  m = mk();
  r = run(m, 200, (n) => ({ clock: [clk(n, 10), clk(n, 20), clk(n, 40)], reset: [0, rst(n)] }));
  pt(r, 100, ["1010111", "0000000", "1011110"], "(c)");
  pt(r, 160, ["1111011", "1111111", "1101111"], "(c)");
  same(r[0]!, mono(mk(), 200, (n) => ({ clock: clk(n, 10) })), "(c) ch0 とモノ(reset なし)");
  same(r[1]!, mono(mk(), 200, (n) => ({ clock: clk(n, 20), reset: rst(n) })), "(c) ch1 とモノ(reset あり)");
  same(r[2]!, mono(mk(), 200, (n) => ({ clock: clk(n, 40) })), "(c) ch2 とモノ(reset なし)");
  assert.equal(m.nonfiniteCount, 0, "(c)");

  // (d)
  m = mk();
  r = run(m, 60, (n) => ({
    clock: [clk(n, 10), n >= 20 && n < 25 ? NaN : clk(n, 20), 0],
    reset: n < 3 ? NaN : 0,
  }));
  assert.equal(r.length, 3);
  assert.equal(r[0]![0], "1111111", "(d) n=0 ch0");
  assert.equal(r[1]![0], "1111111", "(d) n=0 ch1");
  assert.equal(r[0]![20], "1011110", "(d) n=20 ch0");
  assert.equal(r[1]![20], "1111111", "(d) n=20 ch1");
  assert.equal(r[0]![40], "1101111", "(d) n=40 ch0");
  assert.equal(r[1]![40], "0111111", "(d) n=40 ch1");
  assert.equal(m.nonfiniteCount, 8, "(d) nonfinite_count");
});
