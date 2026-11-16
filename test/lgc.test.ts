// MOD-LGC-001 の検証例(specifications/modules/MOD-LGC-001.md §10)。
import assert from "node:assert/strict";
import { LgcModule } from "../src/modules/lgc.js";
import { InSpec, stepWith, tv } from "./helpers.js";

const FS = 48000;
type P = { ref?: number; hyst?: number };
type Five = readonly [number, number, number, number, number];
const OUTS = ["and", "or", "xor", "not", "cmp"] as const;

function mk(p: P = {}): LgcModule {
  const m = new LgcModule(FS);
  for (const [k, v] of Object.entries(p)) m.setParam(k, v as number);
  return m;
}

/** 1ステップ進め、チャンネル別の (and, or, xor, not, cmp) を返す。 */
function st(m: LgcModule, ins: InSpec): number[][] {
  stepWith(m, ins);
  const n = m.output("and").channels;
  const r: number[][] = [];
  for (let c = 0; c < n; c++) r.push(OUTS.map((o) => m.output(o).values[c]!));
  for (const o of OUTS) assert.equal(m.output(o).channels, n, `${o} のチャンネル数`);
  return r;
}

/** モノの1ステップ。 */
function st1(m: LgcModule, ins: InSpec): number[] {
  const r = st(m, ins);
  assert.equal(r.length, 1, "モノの出力は1ch");
  return r[0]!;
}

function eq(actual: readonly number[], want: Five, msg: string): void {
  assert.deepEqual(Array.from(actual), Array.from(want), msg);
}

const AND = 0;
const OR = 1;
const NOT = 3;
const CMP = 4;

tv("TV-MOD-LGC-001-01", () => {
  const m = mk();
  const ins: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [0, 10],
    [10, 10],
    [5, 5],
  ];
  const want: Five[] = [
    [0, 0, 0, 10, 0],
    [0, 10, 10, 0, 10],
    [0, 10, 10, 10, 0],
    [10, 10, 0, 0, 0],
    [10, 10, 0, 0, 0],
  ];
  ins.forEach(([a, b], i) => eq(st1(m, { a, b }), want[i]!, `step ${i}`));
  assert.equal(m.nonfiniteCount, 0);
});

tv("TV-MOD-LGC-001-02", () => {
  const m = mk();
  const as = [2.0, 0.5, 0.11, 0.1, 1.99, 2.0, 1.0];
  const or = [10, 10, 10, 0, 0, 10, 10];
  const not = [0, 0, 0, 10, 10, 0, 0];
  as.forEach((a, i) => {
    const r = st1(m, { a, b: 0 });
    assert.equal(r[OR], or[i], `or[${i}]`);
    assert.equal(r[NOT], not[i], `not[${i}]`);
    assert.equal(r[AND], 0, `and[${i}]`);
  });
});

tv("TV-MOD-LGC-001-03", () => {
  const m = mk({ hyst: 0.5 });
  const as = [0.4, 0.6, 0.4, -0.4, -0.6, 0.0, 0.5, 0.51];
  const cmp = [0, 10, 10, 10, 0, 0, 0, 10];
  as.forEach((a, i) => assert.equal(st1(m, { a, b: 0 })[CMP], cmp[i], `cmp[${i}]`));
});

tv("TV-MOD-LGC-001-04", () => {
  const m = mk({ ref: 3.0, hyst: 0 });
  const as = [2.9, 3.0, 3.1, 3.0, 2.9, -100];
  const cmp = [0, 0, 10, 10, 0, 0];
  const or = [10, 10, 10, 10, 10, 0];
  as.forEach((a, i) => {
    const r = st1(m, { a });
    assert.equal(r[CMP], cmp[i], `cmp[${i}]`);
    assert.equal(r[OR], or[i], `or[${i}]`);
    assert.equal(r[AND], 0, `and[${i}]`);
  });
});

tv("TV-MOD-LGC-001-05", () => {
  // (a)
  let m = mk({ hyst: -5, ref: 0 });
  [0.001, -0.001, 0.0].forEach((a, i) => assert.equal(st1(m, { a, b: 0 })[CMP], [10, 0, 0][i], `(a) cmp[${i}]`));
  // (b)
  m = mk({ hyst: 100, ref: 0 });
  [9.0, 10.5, 9.0, -9.0, -10.5].forEach((a, i) =>
    assert.equal(st1(m, { a, b: 0 })[CMP], [0, 10, 10, 10, 0][i], `(b) cmp[${i}]`),
  );
});

tv("TV-MOD-LGC-001-06", () => {
  const want: Five = [0, 0, 0, 10, 0];
  // (a)
  let m = mk();
  eq(st1(m, { a: NaN, b: NaN }), want, "(a)");
  assert.equal(m.nonfiniteCount, 2, "(a) nonfinite_count");
  // (b)
  m = mk();
  eq(st1(m, { a: Infinity, b: -Infinity }), want, "(b)");
  assert.equal(m.nonfiniteCount, 2, "(b) nonfinite_count");
  // 同じインスタンスで (a)(b) を続けた場合は累計 4
  m = mk();
  eq(st1(m, { a: NaN, b: NaN }), want, "(a)→");
  eq(st1(m, { a: Infinity, b: -Infinity }), want, "→(b)");
  assert.equal(m.nonfiniteCount, 4, "累計");
});

tv("TV-MOD-LGC-001-07", () => {
  const m = mk();
  for (let i = 0; i < 3; i++) eq(st1(m, {}), [0, 0, 0, 10, 0], `step ${i}`);
  assert.equal(m.nonfiniteCount, 0);
});

tv("TV-MOD-LGC-001-08", () => {
  // (a)
  let m = mk();
  st1(m, { a: 10, b: 10 });
  eq(st1(m, { a: 1.0, b: 10 }), [10, 10, 0, 0, 0], "(a) リセット前");
  m.reset();
  eq(st1(m, { a: 1.0, b: 10 }), [0, 10, 10, 10, 0], "(a) リセット後");
  // (b)
  m = mk();
  assert.equal(st1(m, { a: 10, b: 0 })[CMP], 10, "(b) リセット前 cmp");
  m.reset();
  eq(st1(m, { a: 0, b: 0 }), [0, 0, 0, 10, 0], "(b) リセット後");
  // パラメータは保持
  m = mk({ ref: 3, hyst: 0.5 });
  m.reset();
  assert.equal(m.param("ref"), 3);
  assert.equal(m.param("hyst"), 0.5);
});

tv("TV-MOD-LGC-001-09", () => {
  const P9: P = { ref: 1.0, hyst: 0.3 };
  // 倍精度の式から float32 へ変換した値
  const ins = (n: number): InSpec => ({
    a: Math.fround(5 * Math.sin(0.37 * n) + 2 * Math.sin(0.11 * n)),
    b: Math.fround(3 * Math.sin(0.05 * n)),
  });
  const a = mk(P9);
  for (let n = 0; n < 179; n++) st1(a, ins(n));
  const state = a.getState();
  assert.deepEqual(state, { sa: [1], sb: [1], cmp_s: [1] }, "保存時の状態");
  const b = mk(P9);
  b.setState(JSON.parse(JSON.stringify(state)) as typeof state);
  const fresh = mk(P9); // 状態を持たない新規インスタンス

  let cmpCount = 0;
  let andCount = 0;
  let freshDiff = 0;
  for (let n = 179; n <= 999; n++) {
    const ra = st1(a, ins(n));
    const rb = st1(b, ins(n));
    const rf = st1(fresh, ins(n));
    for (let i = 0; i < 5; i++) assert.ok(Object.is(ra[i], rb[i]), `${OUTS[i]}[${n}] がビット同一でない`);
    if (ra[CMP] === 10) cmpCount++;
    if (ra[AND] === 10) andCount++;
    if (ra.some((v, i) => v !== rf[i])) freshDiff++;
    if (n === 179) eq(ra, [10, 10, 0, 0, 0], "n=179");
    if (n === 999) eq(ra, [0, 0, 0, 10, 0], "n=999");
  }
  assert.equal(cmpCount, 414, "cmp=10 のステップ数");
  assert.equal(andCount, 126, "and=10 のステップ数");
  assert.equal(freshDiff, 9, "新規インスタンスとの相違サンプル数");
});

tv("TV-MOD-LGC-001-10", () => {
  // (a)
  let m = mk({ ref: Infinity, hyst: 0 });
  eq(st1(m, { a: 1.0 }), [0, 0, 0, 10, 10], "(a)");
  assert.equal(m.nonfiniteCount, 0, "(a)");
  // (b)
  m = mk({ ref: 0, hyst: Infinity });
  eq(st1(m, { a: 0.5, b: 0 }), [0, 0, 0, 10, 10], "(b) 1");
  eq(st1(m, { a: -0.5, b: 0 }), [0, 0, 0, 10, 0], "(b) 2");
  assert.equal(m.nonfiniteCount, 0, "(b)");
  // (c)
  m = mk({ ref: NaN, hyst: NaN });
  eq(st1(m, { a: 0.5 }), [0, 0, 0, 10, 10], "(c) 1");
  eq(st1(m, { a: -0.5 }), [0, 0, 0, 10, 0], "(c) 2");
  assert.equal(m.nonfiniteCount, 0, "(c)");
});

tv("TV-MOD-LGC-001-11", () => {
  const check = (r: number[][], want: readonly Five[], msg: string): void => {
    assert.equal(r.length, 3, `${msg} チャンネル数`);
    want.forEach((w, c) => eq(r[c]!, w, `${msg} ch${c}`));
  };
  // (a)
  let m = mk({ ref: 0, hyst: 0 });
  check(st(m, { a: [10, 0, 5], b: 3.0 }), [[10, 10, 0, 0, 10], [0, 10, 10, 10, 0], [10, 10, 0, 0, 10]], "(a) 1");
  check(st(m, { a: [1, 1, 1], b: 3.0 }), [[10, 10, 0, 0, 0], [0, 10, 10, 10, 0], [10, 10, 0, 0, 0]], "(a) 2");
  assert.equal(m.nonfiniteCount, 0, "(a)");
  // モノと一致
  [10, 0, 5].forEach((a0, c) => {
    const mono = mk({ ref: 0, hyst: 0 });
    const w1 = c === 1 ? [0, 10, 10, 10, 0] : [10, 10, 0, 0, 10];
    const w2 = c === 1 ? [0, 10, 10, 10, 0] : [10, 10, 0, 0, 0];
    assert.deepEqual(st1(mono, { a: a0, b: 3.0 }), w1, `(a) mono ch${c} 1`);
    assert.deepEqual(st1(mono, { a: 1, b: 3.0 }), w2, `(a) mono ch${c} 2`);
  });
  // (b)
  m = mk({ ref: 8.0, hyst: 0 });
  check(st(m, { a: [10, 0, 5], b: [0, 10] }), [[0, 10, 10, 0, 10], [0, 10, 10, 10, 0], [0, 10, 10, 0, 10]], "(b)");
  assert.equal(m.nonfiniteCount, 0, "(b)");
  // (c)
  m = mk({ ref: 0, hyst: 0 });
  check(st(m, { a: 1.0, b: [0.5, 1.5, 10] }), [[0, 0, 0, 10, 10], [0, 0, 0, 10, 0], [0, 10, 10, 10, 0]], "(c)");
  assert.equal(m.nonfiniteCount, 0, "(c)");
});
