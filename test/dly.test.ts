// MOD-DLY-001 の検証例(specifications/modules/MOD-DLY-001.md §10)。
import assert from "node:assert/strict";
import { DlyModule } from "../src/modules/dly.js";
import { near, stepWith, tv } from "./helpers.js";

type P = { time?: number; feedback?: number; mix?: number };
type Sig = number | readonly number[] | null;
type Ins = Record<string, Sig>;

function mk(fs: number, p: P = {}): DlyModule {
  const m = new DlyModule(fs);
  for (const [k, v] of Object.entries(p)) m.setParam(k, v as number);
  return m;
}

/** steps ステップ進め、out をチャンネル別に記録する。 */
function run(m: DlyModule, steps: number, ins: (n: number) => Ins, n0 = 0): number[][] {
  const ys: number[][] = [];
  for (let i = 0; i < steps; i++) {
    stepWith(m, ins(n0 + i));
    const o = m.output("out");
    for (let c = 0; c < o.channels; c++) (ys[c] ??= []).push(o.values[c]!);
  }
  return ys;
}

const run1 = (m: DlyModule, steps: number, x: (n: number) => number): number[] =>
  run(m, steps, (n) => ({ in: x(n) }))[0]!;

const imp = (n: number): number => (n === 0 ? 1.0 : 0);

/** 指定した n の値と、それ以外がすべて 0.0 であること(絶対 1e-6)。 */
function sparse(ys: readonly number[], steps: number, pts: Record<number, number>, msg: string): void {
  assert.equal(ys.length, steps, `${msg} 長さ`);
  for (let n = 0; n < steps; n++) near(ys[n]!, pts[n] ?? 0, 1e-6, 0, `${msg}[${n}]`);
}

function seq(ys: readonly number[], exp: readonly number[], msg: string): void {
  assert.equal(ys.length, exp.length, `${msg} 長さ`);
  for (let n = 0; n < exp.length; n++) near(ys[n]!, exp[n]!, 1e-6, 0, `${msg}[${n}]`);
}

const TV01: P = { time: 0.00125, feedback: 0.5, mix: 1.0 };
const TV01_EXP = { 10: 1.0, 20: 0.5, 30: 0.25, 40: 0.125 };
const TV06_EXP = [0.0, 0.0, 10.0, 10.0, 12.0, 12.0, 12.0, 12.0, 12.0];

interface St {
  fs: number;
  w: number[];
  buf: unknown[][];
}
const st = (m: DlyModule): St => m.getState() as unknown as St;

tv("TV-MOD-DLY-001-01", () => {
  const m = mk(8000, TV01);
  sparse(run1(m, 45, imp), 45, TV01_EXP, "y");
  assert.equal(m.nonfiniteCount, 0);
});

tv("TV-MOD-DLY-001-02", () => {
  seq(run1(mk(8000, { time: 0.0003125, feedback: 0, mix: 1.0 }), 6, imp), [0, 0, 0.5, 0.5, 0, 0], "y");
});

tv("TV-MOD-DLY-001-03", () => {
  sparse(run1(mk(8000, { time: 0.00125, feedback: 0, mix: 0.5 }), 12, imp), 12, { 0: 0.5, 10: 0.5 }, "(a) y");
  seq(run1(mk(8000, { time: 0.00125, feedback: 0, mix: 0.0 }), 3, (n) => 2.0 + n), [2.0, 3.0, 4.0], "(b) y");
});

tv("TV-MOD-DLY-001-04", () => {
  const y = run(mk(8000, { time: 0.00125, feedback: 0, mix: 1.0 }), 14, (n) => ({ in: imp(n), time_cv: 0.0025 }))[0]!;
  sparse(y, 14, { 12: 1.0 }, "y");
});

tv("TV-MOD-DLY-001-05", () => {
  const a = run1(mk(8000, { time: 0.0, feedback: 0, mix: 1.0 }), 4, imp);
  seq(a, [0, 1.0, 0, 0], "(a) y");
  const b = run(mk(8000, { time: 0.0, feedback: 0, mix: 1.0 }), 4, (n) => ({ in: imp(n), time_cv: -5.0 }))[0]!;
  seq(b, [0, 1.0, 0, 0], "(b) y");
  const c = run1(mk(1000, { time: 3.0, feedback: 0, mix: 1.0 }), 2005, imp);
  sparse(c, 2005, { 2000: 1.0 }, "(c) y");
  const d = run(mk(1000, { time: 1.0, feedback: 0, mix: 1.0 }), 2005, (n) => ({ in: imp(n), time_cv: 20.0 }))[0]!;
  sparse(d, 2005, { 2000: 1.0 }, "(d) y");
});

tv("TV-MOD-DLY-001-06", () => {
  const y = run1(mk(1000, { time: 0.002, feedback: 1.0, mix: 1.0 }), 9, () => 10.0);
  seq(y, TV06_EXP, "y");
  for (let n = 4; n < 9; n++) assert.equal(y[n], 12.0, `y[${n}] は厳密に 12.0`);
});

tv("TV-MOD-DLY-001-07", () => {
  assert.equal(run1(mk(1000, { time: 0.002, feedback: 0.5, mix: 0.0 }), 1, () => 50.0)[0], 12.0, "(a)");
  assert.equal(run1(mk(1000, { time: 0.002, feedback: 0.5, mix: 0.5 }), 1, () => 50.0)[0], 12.0, "(b)");
});

tv("TV-MOD-DLY-001-08", () => {
  {
    const m = mk(1000, { time: 0.002, feedback: 0.5, mix: 1.0 });
    const xs = [NaN, 1, 1, 1, 1, 1, 1];
    seq(run1(m, 7, (n) => xs[n]!), [0, 0, 0, 1.0, 1.0, 1.5, 1.5], "(a) y");
    assert.equal(m.nonfiniteCount, 1, "(a) nonfinite_count");
  }
  {
    const m = mk(1000, { time: 0.002, feedback: 2.0, mix: 1.0 });
    const y = run1(m, 9, () => 10.0);
    seq(y, TV06_EXP, "(b) y");
    const ref = run1(mk(1000, { time: 0.002, feedback: 1.0, mix: 1.0 }), 9, () => 10.0);
    for (let n = 0; n < 9; n++) assert.ok(Object.is(y[n], ref[n]), `(b) y[${n}] が feedback=1.0 と不一致`);
    assert.equal(m.nonfiniteCount, 0, "(b) nonfinite_count");
  }
});

tv("TV-MOD-DLY-001-09", () => {
  {
    const m = mk(1000, { time: 0.002, feedback: 0.5, mix: 1.0 });
    const y = run(m, 3, () => ({ in: null }))[0]!;
    assert.equal(y.length, 3);
    for (let n = 0; n < 3; n++) assert.equal(y[n], 0, `(a) y[${n}]`);
    assert.equal(m.nonfiniteCount, 0);
  }
  {
    const y1 = run(mk(8000, TV01), 45, (n) => ({ in: imp(n), time_cv: null }))[0]!;
    const y2 = run(mk(8000, TV01), 45, (n) => ({ in: imp(n), time_cv: 0.0 }))[0]!;
    sparse(y1, 45, TV01_EXP, "(b) 未接続 y");
    sparse(y2, 45, TV01_EXP, "(b) 0 V 明示 y");
    for (let n = 0; n < 45; n++) assert.ok(Object.is(y1[n], y2[n]), `(b) y[${n}] が同一でない`);
  }
});

tv("TV-MOD-DLY-001-10", () => {
  const m = mk(8000, TV01);
  const y1 = run1(m, 30, imp);
  run1(m, 50, () => 1.0);
  assert.equal(st(m).w[0], 80);
  m.reset();
  const s = st(m);
  assert.deepEqual(s.w, [0]);
  assert.equal(s.buf.length, 1);
  assert.equal(s.buf[0]!.length, 16002);
  assert.ok(
    s.buf[0]!.every((v) => Object.is(v, 0)),
    "reset() 後の buf が全要素 0.0 でない",
  );
  assert.deepEqual(m.getParams(), { time: 0.00125, feedback: 0.5, mix: 1.0 });
  const y4 = run1(m, 30, imp);
  for (let n = 0; n < 30; n++) assert.ok(Object.is(y1[n], y4[n]), `y[${n}] が一致しない`);
  sparse(y1, 30, { 10: 1.0, 20: 0.5 }, "y");
});

tv("TV-MOD-DLY-001-11", () => {
  const ins = (n: number): Ins => ({ in: 4 * Math.sin(0.3 * n), time_cv: 0.5 * Math.sin(0.02 * n) });
  const a = mk(8000, { time: 0.01, feedback: 0.7, mix: 0.5 });
  run(a, 150, ins);
  const saved = JSON.parse(JSON.stringify({ params: a.getParams(), state: a.getState() })) as {
    params: Record<string, number>;
    state: Record<string, unknown>;
  };
  assert.equal((saved.state.buf as unknown[][])[0]!.length, 16002, "buf の全要素を保存する");
  const b = new DlyModule(8000);
  for (const [k, v] of Object.entries(saved.params)) b.setParam(k, v);
  b.setState(saved.state);

  const ya = run(a, 250, ins, 150)[0]!;
  const yb = run(b, 250, ins, 150)[0]!;
  for (let i = 0; i < 250; i++) assert.ok(Object.is(ya[i], yb[i]), `y[${150 + i}] がビット同一でない`);
  near(yb[0]!, 0.123350103, 1e-5, 0, "y[150]");
  near(yb[1]!, 2.81703027, 1e-5, 0, "y[151]");
  near(yb[2]!, 1.98808075, 1e-5, 0, "y[152]");
  near(yb[249]!, 0.628144243, 1e-5, 0, "y[399]");
  assert.deepEqual(st(a).w, [400]);
  assert.deepEqual(st(b).w, [400]);
});

tv("TV-MOD-DLY-001-12", () => {
  const y = run1(mk(48000, { time: 0.25, feedback: 0.5, mix: 1.0 }), 36100, imp);
  sparse(y, 36100, { 12000: 1.0, 24000: 0.5, 36000: 0.25 }, "y");
});

tv("TV-MOD-DLY-001-13", () => {
  const cases: Array<[string, P]> = [
    ["(a)", { time: Infinity, feedback: NaN, mix: NaN }],
    ["(b)", { time: NaN, feedback: -Infinity, mix: Infinity }],
  ];
  for (const [name, p] of cases) {
    const m = mk(8000, p);
    sparse(run1(m, 2001, imp), 2001, { 0: 0.5, 2000: 0.5 }, `${name} y`);
    assert.equal(m.nonfiniteCount, 0, `${name} nonfinite_count`);
  }
});

tv("TV-MOD-DLY-001-14", () => {
  const xs = (n: number): number[] => [n === 0 ? 1.0 : 0, n === 3 ? 2.0 : 0, n === 0 ? -1.0 : 0];
  const check = (name: string, tcv: readonly number[], perEngine: number[], exp: Array<Record<number, number>>): void => {
    const m = mk(8000, TV01);
    const y = run(m, 48, (n) => ({ in: xs(n), time_cv: tcv.length === 1 ? tcv[0]! : tcv }));
    assert.equal(m.output("out").channels, 3, `${name} out のチャンネル数`);
    assert.equal(y.length, 3);
    for (let c = 0; c < 3; c++) {
      sparse(y[c]!, 48, exp[c]!, `${name} y[${c}]`);
      // モノで同じ in と同じ time_cv 値を与えた列と同一
      const mono = run(mk(8000, TV01), 48, (n) => ({ in: xs(n)[c]!, time_cv: perEngine[c]! }))[0]!;
      for (let n = 0; n < 48; n++) assert.ok(Object.is(y[c]![n], mono[n]), `${name} y[${c}][${n}] がモノと不一致`);
    }
    assert.deepEqual(st(m).w, [48, 48, 48], `${name} w`);
    assert.equal(m.nonfiniteCount, 0, `${name} nonfinite_count`);
  };
  check(
    "(a)",
    [0.0025],
    [0.0025, 0.0025, 0.0025],
    [
      { 12: 1.0, 24: 0.5, 36: 0.25 },
      { 15: 2.0, 27: 1.0, 39: 0.5 },
      { 12: -1.0, 24: -0.5, 36: -0.25 },
    ],
  );
  check(
    "(b)",
    [0.0025, 0.005],
    [0.0025, 0.005, 0],
    [
      { 12: 1.0, 24: 0.5, 36: 0.25 },
      { 17: 2.0, 31: 1.0, 45: 0.5 },
      { 10: -1.0, 20: -0.5, 30: -0.25, 40: -0.125 },
    ],
  );
});
