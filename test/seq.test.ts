// MOD-SEQ-001 の検証例(specifications/modules/MOD-SEQ-001.md §10)。
import assert from "node:assert/strict";
import { SeqModule } from "../src/modules/seq.js";
import { near, stepWith, tv } from "./helpers.js";

const FS = 48000;
type Sig = number | readonly number[] | null;
type Ins = { CLOCK?: (n: number) => Sig; RESET?: (n: number) => Sig };
interface Cfg {
  length?: number;
  cv?: readonly number[];
  gate?: readonly number[];
  glide?: number;
  run?: number;
}

function mk(cfg: Cfg = {}, fs = FS): SeqModule {
  const m = new SeqModule(fs);
  if (cfg.length !== undefined) m.setParam("length", cfg.length);
  cfg.cv?.forEach((v, i) => m.setParam(`cv[${i + 1}]`, v));
  cfg.gate?.forEach((v, i) => m.setParam(`gate[${i + 1}]`, v));
  if (cfg.glide !== undefined) m.setParam("glide", cfg.glide);
  if (cfg.run !== undefined) m.setParam("run", cfg.run);
  return m;
}

interface Run {
  n0: number;
  cv: number[][];
  gate: number[][];
  trig: number[][];
  eoc: number[][];
  pos: number[][];
}

/** n0 から steps ステップ進め、チャンネル別に記録する(添字は n − n0)。pre はそのステップの直前に呼ぶ。 */
function run(m: SeqModule, steps: number, ins: Ins = {}, n0 = 0, pre?: (n: number) => void): Run {
  const r: Run = { n0, cv: [], gate: [], trig: [], eoc: [], pos: [] };
  for (let i = 0; i < steps; i++) {
    const n = n0 + i;
    if (pre) pre(n);
    const s: Record<string, Sig> = {};
    if (ins.CLOCK) s.CLOCK = ins.CLOCK(n);
    if (ins.RESET) s.RESET = ins.RESET(n);
    stepWith(m, s);
    const N = m.output("CV").channels;
    for (const name of ["GATE", "TRIG", "EOC"]) assert.equal(m.output(name).channels, N);
    assert.equal(m.engines, N);
    for (let c = 0; c < N; c++) {
      (r.cv[c] ??= [])[i] = m.output("CV").values[c]!;
      (r.gate[c] ??= [])[i] = m.output("GATE").values[c]!;
      (r.trig[c] ??= [])[i] = m.output("TRIG").values[c]!;
      (r.eoc[c] ??= [])[i] = m.output("EOC").values[c]!;
      (r.pos[c] ??= [])[i] = m.position(c);
    }
  }
  return r;
}

/** 立ち上がり位置の列から、幅 w サンプルの 10 V パルス列を作る。 */
const pulses = (rises: readonly number[], w = 4) => (n: number): number =>
  rises.some((r) => n >= r && n < r + w) ? 10 : 0;

/** [a, b] の全サンプルが v(絶対 tol)。 */
function span(ys: readonly number[], a: number, b: number, v: number, msg: string, tol = 1e-6): void {
  for (let n = a; n <= b; n++) near(ys[n]!, v, tol, 0, `${msg}[${n}]`);
}

/** パルス列: 指定区間 [a,b] だけ 10、ほかは 0(0〜end)。 */
function pulseSpans(ys: readonly number[], spans: ReadonlyArray<readonly [number, number]>, end: number, msg: string): void {
  for (let n = 0; n <= end; n++) {
    const want = spans.some(([a, b]) => n >= a && n <= b) ? 10 : 0;
    assert.equal(ys[n], want, `${msg}[${n}]`);
  }
}

function posSpan(r: Run, c: number, a: number, b: number, p: number, msg = "pos"): void {
  for (let n = a; n <= b; n++) assert.equal(r.pos[c]![n], p, `${msg}[${c}][${n}]`);
}

const CV4 = [1, 2, 3, 4];
const TV01: Cfg = { length: 4, cv: CV4, gate: [1, 0, 1, 1], glide: 0, run: 1 };
const TV01_CLOCK = pulses([10, 100, 200, 300, 400, 500], 20);

tv("TV-MOD-SEQ-001-01", () => {
  const m = mk(TV01);
  const r = run(m, 600, { CLOCK: TV01_CLOCK, RESET: () => 0 });
  const cv = r.cv[0]!;
  const g = r.gate[0]!;
  span(cv, 0, 9, 1, "CV");
  span(g, 0, 9, 10, "GATE");
  span(cv, 10, 99, 2, "CV");
  span(g, 10, 99, 0, "GATE");
  span(cv, 100, 199, 3, "CV");
  span(g, 100, 199, 10, "GATE");
  span(cv, 200, 299, 4, "CV");
  span(g, 200, 299, 10, "GATE");
  span(cv, 300, 399, 1, "CV");
  span(g, 300, 399, 10, "GATE");
  span(cv, 400, 499, 2, "CV");
  span(g, 400, 499, 0, "GATE");
  span(cv, 500, 599, 3, "CV");
  span(g, 500, 599, 10, "GATE");
  pulseSpans(
    r.trig[0]!,
    [
      [100, 147],
      [200, 247],
      [300, 347],
      [500, 547],
    ],
    599,
    "TRIG",
  );
  pulseSpans(r.eoc[0]!, [[300, 347]], 599, "EOC");
  assert.equal(m.nonfiniteCount, 0);
});

function checkGlide(cv: readonly number[], rise: number, end: number, msg: string): void {
  for (let n = 0; n < rise; n++) near(cv[n]!, 0, 1e-5, 0, `${msg}[${n}]`);
  for (let n = rise; n <= end; n++) near(cv[n]!, 1 - Math.exp(-(n - (rise - 1)) / 480), 1e-5, 0, `${msg}[${n}]`);
}

tv("TV-MOD-SEQ-001-02", () => {
  const m = mk({ length: 2, cv: [0, 1], glide: 0.01 });
  const r = run(m, 1200, { CLOCK: pulses([5]), RESET: () => 0 });
  const cv = r.cv[0]!;
  checkGlide(cv, 5, 1199, "CV");
  near(cv[5]!, 0.0020811647, 1e-5, 0, "CV[5]");
  near(cv[6]!, 0.0041579982, 1e-5, 0, "CV[6]");
  near(cv[100]!, 0.1812692469, 1e-5, 0, "CV[100]");
  near(cv[484]!, 0.6321205588, 1e-5, 0, "CV[484]");
  near(cv[1199]!, 0.9170554804, 1e-5, 0, "CV[1199]");
  assert.equal(m.position(0), 1);
});

tv("TV-MOD-SEQ-001-03", () => {
  // (a)
  {
    const r = run(mk({ length: 0, cv: [1.5] }), 300, { CLOCK: pulses([10, 110, 210]) });
    posSpan(r, 0, 0, 299, 0, "(a) pos");
    span(r.cv[0]!, 0, 299, 1.5, "(a) CV");
    const sp: Array<[number, number]> = [
      [10, 57],
      [110, 157],
      [210, 257],
    ];
    pulseSpans(r.trig[0]!, sp, 299, "(a) TRIG");
    pulseSpans(r.eoc[0]!, sp, 299, "(a) EOC");
  }
  // (b)
  {
    const cvs: number[] = [];
    for (let i = 1; i <= 16; i++) cvs.push(0.5 * (i - 1));
    const rises: number[] = [];
    for (let j = 0; j <= 16; j++) rises.push(10 + 20 * j);
    const r = run(mk({ length: 99, cv: cvs }), 400, { CLOCK: pulses(rises) });
    for (let j = 0; j <= 16; j++) {
      const p = (j + 1) % 16;
      posSpan(r, 0, 10 + 20 * j, 29 + 20 * j, p, "(b) pos");
      span(r.cv[0]!, 10 + 20 * j, 29 + 20 * j, 0.5 * p, "(b) CV");
    }
    assert.equal(r.pos[0]![270], 14);
    near(r.cv[0]![270]!, 7.0, 1e-6, 0, "(b) CV[270]");
    assert.equal(r.pos[0]![290], 15);
    near(r.cv[0]![290]!, 7.5, 1e-6, 0, "(b) CV[290]");
    assert.equal(r.pos[0]![310], 0);
    near(r.cv[0]![310]!, 0, 1e-6, 0, "(b) CV[310]");
    assert.equal(r.pos[0]![330], 1);
    near(r.cv[0]![330]!, 0.5, 1e-6, 0, "(b) CV[330]");
    pulseSpans(r.eoc[0]!, [[310, 357]], 399, "(b) EOC");
  }
  // (c)
  {
    const r = run(mk({ length: 3.5, cv: CV4 }), 130, { CLOCK: pulses([10, 30, 50, 70]) });
    const want: Array<[number, number, number]> = [
      [0, 9, 0],
      [10, 29, 1],
      [30, 49, 2],
      [50, 69, 3],
      [70, 129, 0],
    ];
    for (const [a, b, p] of want) {
      posSpan(r, 0, a, b, p, "(c) pos");
      span(r.cv[0]!, a, b, p + 1, "(c) CV");
    }
    pulseSpans(r.eoc[0]!, [[70, 117]], 129, "(c) EOC");
  }
  // (d)
  {
    const r = run(mk({ length: 2.4, cv: CV4 }), 130, { CLOCK: pulses([10, 30, 50, 70]) });
    const want: Array<[number, number, number]> = [
      [0, 9, 0],
      [10, 29, 1],
      [30, 49, 0],
      [50, 69, 1],
      [70, 129, 0],
    ];
    for (const [a, b, p] of want) {
      posSpan(r, 0, a, b, p, "(d) pos");
      span(r.cv[0]!, a, b, p + 1, "(d) CV");
    }
    pulseSpans(r.eoc[0]!, [[30, 117]], 129, "(d) EOC");
  }
});

tv("TV-MOD-SEQ-001-04", () => {
  const cfg: Cfg = { length: 4, cv: CV4 };
  {
    const r = run(mk(cfg), 200, { CLOCK: pulses([50, 100, 147, 160]), RESET: pulses([100]) });
    posSpan(r, 0, 0, 49, 0);
    posSpan(r, 0, 50, 99, 1);
    span(r.cv[0]!, 50, 99, 2, "CV");
    posSpan(r, 0, 100, 159, 0);
    span(r.cv[0]!, 100, 159, 1, "CV");
    posSpan(r, 0, 160, 199, 1);
    span(r.cv[0]!, 160, 199, 2, "CV");
  }
  {
    const r = run(mk(cfg), 200, { CLOCK: pulses([50, 100, 148, 160]), RESET: pulses([100]) });
    posSpan(r, 0, 50, 99, 1, "148版 pos");
    posSpan(r, 0, 100, 147, 0, "148版 pos");
    span(r.cv[0]!, 100, 147, 1, "148版 CV");
    posSpan(r, 0, 148, 159, 1, "148版 pos");
    span(r.cv[0]!, 148, 159, 2, "148版 CV");
    posSpan(r, 0, 160, 199, 2, "148版 pos");
    span(r.cv[0]!, 160, 199, 3, "148版 CV");
  }
});

tv("TV-MOD-SEQ-001-05", () => {
  const cfg: Cfg = { length: 4, cv: CV4 };
  // (a)
  {
    const r = run(mk(cfg, 44100), 200, { CLOCK: pulses([50]) });
    pulseSpans(r.trig[0]!, [[50, 93]], 199, "(a) TRIG");
  }
  // (b)
  {
    const r = run(mk(cfg, 44100), 200, { CLOCK: pulses([144]), RESET: pulses([100]) });
    posSpan(r, 0, 0, 199, 0, "(b) n=144 pos");
  }
  {
    const r = run(mk(cfg, 44100), 200, { CLOCK: pulses([145]), RESET: pulses([100]) });
    posSpan(r, 0, 0, 144, 0, "(b) n=145 pos");
    posSpan(r, 0, 145, 199, 1, "(b) n=145 pos");
  }
});

tv("TV-MOD-SEQ-001-06", () => {
  const m = mk({ length: 4, cv: CV4 });
  const r = run(m, 100, { CLOCK: pulses([10, 30, 50, 70]) }, 0, (n) => {
    if (n === 60) m.setParam("length", 2);
  });
  posSpan(r, 0, 50, 59, 3);
  assert.equal(r.pos[0]![60], 0);
  assert.equal(r.eoc[0]![60], 0);
  posSpan(r, 0, 60, 69, 0);
  posSpan(r, 0, 70, 99, 1);
  pulseSpans(r.eoc[0]!, [], 99, "EOC");
});

tv("TV-MOD-SEQ-001-07", () => {
  const m = mk({ length: 4, cv: CV4 });
  const clk = (n: number): number =>
    n < 10 ? 10 : n < 20 ? NaN : n < 30 ? 10 : n < 40 ? Infinity : n < 45 ? 10 : 0;
  const r = run(m, 60, { CLOCK: clk });
  posSpan(r, 0, 0, 19, 1);
  span(r.cv[0]!, 0, 19, 2, "CV");
  posSpan(r, 0, 20, 39, 2);
  span(r.cv[0]!, 20, 39, 3, "CV");
  posSpan(r, 0, 40, 59, 3);
  span(r.cv[0]!, 40, 59, 4, "CV");
  assert.equal(m.nonfiniteCount, 20);
});

tv("TV-MOD-SEQ-001-08", () => {
  const a = run(mk({ cv: [15], glide: -1 }), 1, { CLOCK: () => 0, RESET: () => 0 });
  near(a.cv[0]![0]!, 10, 1e-6, 0, "(a) CV");
  const b = run(mk({ cv: [-15] }), 1, { CLOCK: () => 0, RESET: () => 0 });
  near(b.cv[0]![0]!, -10, 1e-6, 0, "(b) CV");
});

tv("TV-MOD-SEQ-001-09", () => {
  const r = run(mk({ length: 4, cv: CV4 }), 100);
  posSpan(r, 0, 0, 99, 0);
  span(r.cv[0]!, 0, 99, 1, "CV");
  span(r.gate[0]!, 0, 99, 10, "GATE");
  pulseSpans(r.trig[0]!, [], 99, "TRIG");
  pulseSpans(r.eoc[0]!, [], 99, "EOC");
});

tv("TV-MOD-SEQ-001-10", () => {
  const cfg: Cfg = { length: 4, cv: CV4 };
  {
    const r = run(mk(cfg), 200, { CLOCK: pulses([10, 30, 50]), RESET: pulses([100]) });
    assert.equal(r.pos[0]![50], 3);
    near(r.cv[0]![50]!, 4, 1e-6, 0, "CV[50]");
    assert.equal(r.pos[0]![99], 3);
    assert.equal(r.pos[0]![100], 0);
    near(r.cv[0]![100]!, 1, 1e-6, 0, "CV[100]");
    near(r.gate[0]![100]!, 10, 1e-6, 0, "GATE[100]");
    for (let n = 100; n < 200; n++) {
      assert.equal(r.trig[0]![n], 0, `TRIG[${n}]`);
      assert.equal(r.eoc[0]![n], 0, `EOC[${n}]`);
    }
  }
  {
    const r = run(mk(cfg), 200, { CLOCK: pulses([50, 100]), RESET: pulses([100]) });
    posSpan(r, 0, 50, 99, 1, "同時 pos");
    posSpan(r, 0, 100, 148, 0, "同時 pos");
  }
});

tv("TV-MOD-SEQ-001-11", () => {
  const m = mk({ length: 4, cv: CV4, glide: 0 });
  const r0 = run(m, 60, { CLOCK: pulses([10, 30]) });
  assert.equal(r0.pos[0]![59], 2);
  const before = m.getParams();
  m.reset();
  const r = run(m, 1, { CLOCK: () => 0, RESET: () => 0 });
  assert.equal(r.pos[0]![0], 0);
  near(r.cv[0]![0]!, 1, 1e-6, 0, "CV");
  near(r.gate[0]![0]!, 10, 1e-6, 0, "GATE");
  assert.equal(r.trig[0]![0], 0);
  assert.equal(r.eoc[0]![0], 0);
  assert.deepEqual(m.getParams(), before);
});

tv("TV-MOD-SEQ-001-12", () => {
  const m = mk({ length: 4, cv: CV4 });
  const r = run(m, 160, { CLOCK: pulses([10, 50, 80, 130]) }, 0, (n) => {
    if (n === 60) m.setParam("run", 0);
    if (n === 120) m.setParam("run", 1);
  });
  posSpan(r, 0, 10, 49, 1);
  posSpan(r, 0, 50, 59, 2);
  posSpan(r, 0, 60, 119, 2);
  span(r.gate[0]!, 60, 119, 0, "GATE");
  posSpan(r, 0, 120, 129, 2);
  span(r.gate[0]!, 120, 129, 10, "GATE");
  posSpan(r, 0, 130, 159, 3);
});

tv("TV-MOD-SEQ-001-13", () => {
  const a = mk({ ...TV01, glide: 0.001 });
  const ins: Ins = { CLOCK: TV01_CLOCK, RESET: () => 0 };
  run(a, 250, ins);
  const saved = JSON.parse(JSON.stringify({ params: a.getParams(), state: a.getState() })) as {
    params: Record<string, number>;
    state: Record<string, unknown>;
  };
  const b = new SeqModule(FS);
  for (const [k, v] of Object.entries(saved.params)) b.setParam(k, v);
  b.setState(saved.state);
  const ra = run(a, 450, ins, 250);
  const rb = run(b, 450, ins, 250);
  for (const key of ["cv", "gate", "trig", "eoc"] as const) {
    assert.equal(rb[key].length, 1);
    for (let i = 0; i < 450; i++) {
      assert.ok(Object.is(ra[key][0]![i], rb[key][0]![i]), `${key}[${250 + i}]`);
    }
  }
  near(ra.cv[0]![0]!, 3.5994211839, 1e-5, 0, "CV[250]");
  near(ra.cv[0]![50]!, 3.7967958668, 1e-5, 0, "CV[300]");
  near(ra.cv[0]![449]!, 2.9832521090, 1e-5, 0, "CV[699]");
});

tv("TV-MOD-SEQ-001-14", () => {
  // (a)
  for (const length of [NaN, Infinity]) {
    const cvs: number[] = [];
    for (let i = 1; i <= 16; i++) cvs.push(i);
    const rises: number[] = [];
    for (let n = 10; n <= 170; n += 20) rises.push(n);
    const m = mk({ length, cv: cvs });
    const r = run(m, 190, { CLOCK: pulses(rises) });
    rises.forEach((n, j) => {
      const p = (j + 1) % 8;
      posSpan(r, 0, n, n + 19, p, `(a) length=${length} pos`);
      span(r.cv[0]!, n, n + 19, p + 1, `(a) length=${length} CV`);
    });
    pulseSpans(r.eoc[0]!, [[150, 189]], 189, "(a) EOC");
    assert.equal(m.nonfiniteCount, 0);
  }
  // (b)
  {
    const r = run(mk({ length: 4, cv: [NaN, 2, 3, 4] }), 1, { CLOCK: () => 0, RESET: () => 0 });
    near(r.cv[0]![0]!, 0, 1e-6, 0, "(b) CV");
    near(r.gate[0]![0]!, 10, 1e-6, 0, "(b) GATE");
  }
  // (c)
  {
    const r = run(mk({ length: 2, cv: [0, 1], glide: NaN }), 8, { CLOCK: pulses([5]) });
    span(r.cv[0]!, 0, 4, 0, "(c) CV");
    span(r.cv[0]!, 5, 7, 1.0, "(c) CV");
  }
  // (d)
  {
    const r = run(mk({ length: 4, cv: CV4, run: NaN }), 20, { CLOCK: pulses([10]) });
    posSpan(r, 0, 10, 19, 1, "(d) pos");
    span(r.cv[0]!, 10, 19, 2, "(d) CV");
    span(r.gate[0]!, 10, 19, 10, "(d) GATE");
  }
  // (e)
  {
    const m = mk({ length: 4, cv: CV4 });
    m.setParam("gate[2]", NaN);
    const r = run(m, 60, { CLOCK: pulses([10]) });
    posSpan(r, 0, 10, 59, 1, "(e) pos");
    span(r.gate[0]!, 10, 59, 10, "(e) GATE");
    pulseSpans(r.trig[0]!, [[10, 57]], 59, "(e) TRIG");
  }
});

tv("TV-MOD-SEQ-001-15", () => {
  const c0 = pulses([10, 100, 200, 300]);
  const c1 = pulses([50, 150]);
  // (a)
  {
    const m = mk(TV01);
    const r = run(m, 400, { CLOCK: (n) => [c0(n), c1(n), 0] });
    assert.equal(r.cv.length, 3);
    // ch0
    posSpan(r, 0, 0, 9, 0);
    posSpan(r, 0, 10, 99, 1);
    span(r.cv[0]!, 10, 99, 2, "(a) CV0");
    span(r.gate[0]!, 10, 99, 0, "(a) GATE0");
    posSpan(r, 0, 100, 199, 2);
    span(r.cv[0]!, 100, 199, 3, "(a) CV0");
    span(r.gate[0]!, 100, 199, 10, "(a) GATE0");
    posSpan(r, 0, 200, 299, 3);
    span(r.cv[0]!, 200, 299, 4, "(a) CV0");
    posSpan(r, 0, 300, 399, 0);
    span(r.cv[0]!, 300, 399, 1, "(a) CV0");
    pulseSpans(
      r.trig[0]!,
      [
        [100, 147],
        [200, 247],
        [300, 347],
      ],
      399,
      "(a) TRIG0",
    );
    pulseSpans(r.eoc[0]!, [[300, 347]], 399, "(a) EOC0");
    // ch1
    posSpan(r, 1, 0, 49, 0);
    span(r.cv[1]!, 0, 49, 1, "(a) CV1");
    span(r.gate[1]!, 0, 49, 10, "(a) GATE1");
    posSpan(r, 1, 50, 149, 1);
    span(r.cv[1]!, 50, 149, 2, "(a) CV1");
    span(r.gate[1]!, 50, 149, 0, "(a) GATE1");
    posSpan(r, 1, 150, 399, 2);
    span(r.cv[1]!, 150, 399, 3, "(a) CV1");
    span(r.gate[1]!, 150, 399, 10, "(a) GATE1");
    pulseSpans(r.trig[1]!, [[150, 197]], 399, "(a) TRIG1");
    pulseSpans(r.eoc[1]!, [], 399, "(a) EOC1");
    // ch2
    posSpan(r, 2, 0, 399, 0);
    span(r.cv[2]!, 0, 399, 1, "(a) CV2");
    span(r.gate[2]!, 0, 399, 10, "(a) GATE2");
    pulseSpans(r.trig[2]!, [], 399, "(a) TRIG2");
    pulseSpans(r.eoc[2]!, [], 399, "(a) EOC2");
    // モノと全サンプル一致
    [c0, c1, (): number => 0].forEach((clk, c) => {
      const mono = run(mk(TV01), 400, { CLOCK: clk });
      for (const key of ["cv", "gate", "trig", "eoc", "pos"] as const) {
        assert.deepEqual(r[key][c], mono[key][0], `(a) ch${c} ${key} がモノと一致`);
      }
    });
    assert.equal(m.nonfiniteCount, 0);
  }
  // (b)
  {
    const r = run(mk(TV01), 400, { CLOCK: (n) => [c0(n), c1(n), 0], RESET: pulses([250]) });
    const at = (n: number): number[] => [r.pos[0]![n]!, r.pos[1]![n]!, r.pos[2]![n]!];
    assert.deepEqual(at(249), [3, 2, 0], "(b) pos[249]");
    assert.deepEqual(at(250), [0, 0, 0], "(b) pos[250]");
    for (let c = 0; c < 3; c++) {
      near(r.cv[c]![250]!, 1, 1e-6, 0, `(b) CV[${c}][250]`);
      near(r.gate[c]![250]!, 10, 1e-6, 0, `(b) GATE[${c}][250]`);
      for (let n = 250; n < 300; n++) {
        assert.equal(r.trig[c]![n], 0, `(b) TRIG[${c}][${n}]`);
        assert.equal(r.eoc[c]![n], 0, `(b) EOC[${c}][${n}]`);
      }
    }
    assert.deepEqual(at(300), [1, 0, 0], "(b) pos[300]");
    near(r.cv[0]![300]!, 2, 1e-6, 0, "(b) CV[0][300]");
    near(r.gate[0]![300]!, 0, 1e-6, 0, "(b) GATE[0][300]");
    assert.deepEqual(at(399), [1, 0, 0], "(b) pos[399]");
  }
  // (c)
  {
    const r = run(mk(TV01), 400, {
      CLOCK: (n) => [c0(n), c1(n), c1(n)],
      RESET: (n) => [0, pulses([250])(n)],
    });
    const at = (n: number): number[] => [r.pos[0]![n]!, r.pos[1]![n]!, r.pos[2]![n]!];
    const cvAt = (n: number): number[] => [r.cv[0]![n]!, r.cv[1]![n]!, r.cv[2]![n]!];
    assert.deepEqual(at(249), [3, 2, 2], "(c) pos[249]");
    assert.deepEqual(at(250), [3, 0, 2], "(c) pos[250]");
    assert.deepEqual(at(300), [0, 0, 2], "(c) pos[300]");
    [1, 1, 3].forEach((v, c) => near(cvAt(300)[c]!, v, 1e-6, 0, `(c) CV[${c}][300]`));
    assert.deepEqual(at(399), [0, 0, 2], "(c) pos[399]");
    [1, 1, 3].forEach((v, c) => near(cvAt(399)[c]!, v, 1e-6, 0, `(c) CV[${c}][399]`));
  }
  // (d)
  {
    const cfg: Cfg = { length: 2, cv: [0, 1], glide: 0.01 };
    const d0 = pulses([5]);
    const d1 = pulses([105]);
    const r = run(mk(cfg), 1200, { CLOCK: (n) => [d0(n), d1(n)] });
    assert.equal(r.cv.length, 2);
    checkGlide(r.cv[0]!, 5, 1199, "(d) CV0");
    near(r.cv[0]![5]!, 0.0020811647, 1e-5, 0, "(d) CV0[5]");
    near(r.cv[0]![100]!, 0.1812692469, 1e-5, 0, "(d) CV0[100]");
    near(r.cv[0]![1199]!, 0.9170554804, 1e-5, 0, "(d) CV0[1199]");
    checkGlide(r.cv[1]!, 105, 1199, "(d) CV1");
    near(r.cv[1]![105]!, 0.0020811647, 1e-5, 0, "(d) CV1[105]");
    near(r.cv[1]![205]!, 0.1897534271, 1e-5, 0, "(d) CV1[205]");
    near(r.cv[1]![584]!, 0.6321205588, 1e-5, 0, "(d) CV1[584]");
    near(r.cv[1]![1199]!, 0.8978435687, 1e-5, 0, "(d) CV1[1199]");
    const mono = run(mk(cfg), 1200, { CLOCK: d1 });
    for (const key of ["cv", "gate", "trig", "eoc", "pos"] as const) {
      assert.deepEqual(r[key][1], mono[key][0], `(d) ch1 ${key} がモノと一致`);
    }
  }
});
