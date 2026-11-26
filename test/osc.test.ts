// MOD-OSC-001 の検証例(specifications/modules/MOD-OSC-001.md §10。仕様版 0.3: 帯域制限した波形)。
import assert from "node:assert/strict";
import { OscModule } from "../src/modules/osc.js";
import { InSpec, near, nearAll, stepWith, tv } from "./helpers.js";

const FS = 48000;
const F16 = 261.6256 * 16;
const TOL = 1e-5;
const OUTS = ["saw", "pulse", "tri", "sine"] as const;

function mk(fs: number, params: Record<string, number> = {}): OscModule {
  const m = new OscModule(fs);
  for (const [k, v] of Object.entries(params)) m.setParam(k, v);
  return m;
}

/** 1ステップ進め、チャンネル c の (saw, pulse, tri, sine) を返す。 */
function st(m: OscModule, inputs: InSpec = {}, c = 0): number[] {
  stepWith(m, inputs);
  return OUTS.map((o) => m.output(o).values[c]!);
}

/** ステップごとの入力を与え、指定出力の全チャンネルの列 [c][n] を返す。 */
function run(m: OscModule, steps: number, inp: (n: number) => InSpec, out: string): number[][] {
  const r: number[][] = [];
  for (let n = 0; n < steps; n++) {
    stepWith(m, inp(n));
    const p = m.output(out);
    for (let c = 0; c < p.channels; c++) (r[c] ??= []).push(p.values[c]!);
  }
  return r;
}

const TV01 = [
  [0, 0, 0, 0],
  [-3.956396, 4, 0.109011, 0.1712],
  [-3.912791, 4, 0.218021, 0.342199],
  [-3.869187, 4, 0.327032, 0.512797],
];

function expect01(m: OscModule, inputs: InSpec): void {
  for (let n = 0; n < 4; n++) nearAll(st(m, inputs), TV01[n]!, TOL, 0, `n=${n}`);
}

tv("TV-MOD-OSC-001-01", () => {
  expect01(mk(FS), { pitch: 0 });
});

tv("TV-MOD-OSC-001-02", () => {
  const m = mk(F16);
  const exp: Record<number, number[]> = {
    0: [0, 0, 0, 0],
    2: [-3, 4, 2.5, 3.535534],
    4: [-2, 4, 4.583333, 5],
    6: [-1, 4, 2.5, 3.535534],
    8: [0, 0, 0, 0],
    12: [2, -4, -4.583333, -5],
    16: [0, 0, 0, 0],
  };
  for (let n = 0; n <= 16; n++) {
    const y = st(m, { pitch: 0 });
    if (exp[n]) nearAll(y, exp[n]!, TOL, 0, `n=${n}`);
  }
});

tv("TV-MOD-OSC-001-03", () => {
  // (a)
  const a = run(mk(F16, { pw: 0.25 }), 16, () => ({ pitch: 0 }), "pulse")[0]!;
  assert.deepEqual(a, Array.from({ length: 16 }, (_, n) => (n === 0 || n === 4 ? 0 : n <= 3 ? 4 : -4)));
  // (b)
  const b = run(mk(F16, { pw: 0.5, pwm_amt: 1 }), 16, () => ({ pitch: 0, pwm: 2.5 }), "pulse")[0]!;
  assert.deepEqual(b, Array.from({ length: 16 }, (_, n) => (n === 0 || n === 12 ? 0 : n <= 11 ? 4 : -4)));
});

tv("TV-MOD-OSC-001-04", () => {
  const m = mk(F16);
  const saw: number[] = [];
  const tri: number[] = [];
  for (let n = 0; n < 10; n++) {
    const y = st(m, { pitch: 0, sync: n < 6 ? 0 : 10 });
    saw.push(y[0]!);
    tri.push(y[2]!);
  }
  nearAll(saw, [0, -3.5, -3, -2.5, -2, -1.5, 0, -3.5, -3, -2.5], TOL);
  nearAll(tri, [0, 1.25, 2.5, 3.75, 4.583333, 3.75, 0, 1.25, 2.5, 3.75], TOL);
});

tv("TV-MOD-OSC-001-05", () => {
  // (a)(b)
  const res: number[][][] = [];
  for (const pitch of [10, 20]) {
    const m = mk(FS);
    const ys: number[][] = [];
    for (let n = 0; n < 4; n++) ys.push(st(m, { pitch }));
    for (const y of ys) for (let i = 0; i < 4; i++) assert.ok(Math.abs(y[i]!) < 1e-5, `pitch=${pitch} ${OUTS[i]}=${y[i]}`);
    res.push(ys);
  }
  assert.deepEqual(res[1], res[0]);
  // (c)
  const m = mk(FS);
  const y0 = st(m, { pitch: -10 });
  near(y0[0]!, 0, TOL);
  near(y0[1]!, 0, TOL);
  const y1 = st(m, { pitch: -10 });
  near(y1[0]!, -3.999957, TOL);
  near(y1[2]!, 0.000106, TOL);
  near(y1[3]!, 0.000167, TOL);
  const y2 = st(m, { pitch: -10 });
  near(y2[0]!, -3.999915, TOL);
  near(y2[2]!, 0.000213, TOL);
  near(y2[3]!, 0.000334, TOL);
});

tv("TV-MOD-OSC-001-06", () => {
  const p = run(mk(F16, { pw: 0.0 }), 16, () => ({ pitch: 0 }), "pulse")[0]!;
  nearAll(p, [-1.8496, -3.5904, ...Array(14).fill(-4)], TOL);
});

tv("TV-MOD-OSC-001-07", () => {
  const m = mk(FS);
  assert.equal(m.nonfiniteCount, 0);
  expect01(m, { pitch: NaN, fm: Infinity, pwm: -Infinity, sync: NaN });
  assert.equal(m.nonfiniteCount, 16);
});

tv("TV-MOD-OSC-001-08", () => {
  const m = mk(FS);
  expect01(m, { pitch: null, fm: null, pwm: null, sync: null });
  assert.equal(m.output("saw").channels, 1);
});

tv("TV-MOD-OSC-001-09", () => {
  const m = mk(F16);
  for (let n = 0; n < 10; n++) st(m, { pitch: 0 });
  m.reset();
  nearAll(st(m, { pitch: 0 }), [0, 0, 0, 0], TOL);
  nearAll(st(m, { pitch: 0 }), [-3.5, 4, 1.25, 1.913417], TOL);
  nearAll(st(m, { pitch: 0 }), [-3, 4, 2.5, 3.535534], TOL);
  assert.equal(m.param("range"), 0);
  assert.equal(m.param("pw"), 0.5);
});

tv("TV-MOD-OSC-001-10", () => {
  const a = mk(FS);
  for (let n = 0; n < 7; n++) st(a, { pitch: 0.3 });
  const snap = JSON.parse(JSON.stringify({ state: a.getState(), params: a.getParams() })) as {
    state: Record<string, unknown>;
    params: Record<string, number>;
  };
  near((snap.state.phase as number[])[0]!, 0.04697276, 1e-8);
  const b = mk(FS, snap.params);
  b.setState(snap.state);
  for (let n = 1; n <= 10; n++) {
    const ya = st(a, { pitch: 0.3 });
    const yb = st(b, { pitch: 0.3 });
    for (let i = 0; i < 4; i++) assert.ok(Object.is(ya[i], yb[i]), `n=${n} ${OUTS[i]}`);
    if (n === 1) nearAll(ya, [-3.624218, 4, 0.939455, 1.454362], TOL);
    if (n === 10) nearAll(ya, [-3.14107, 4, 2.147326, 3.122934], TOL);
  }
});

tv("TV-MOD-OSC-001-11", () => {
  const pitches = [0, 1, -1];
  const m = mk(F16);
  const got: number[][][] = [[], [], []]; // [c][n][出力]
  for (let n = 0; n < 6; n++) {
    stepWith(m, { pitch: pitches });
    for (const o of OUTS) assert.equal(m.output(o).channels, 3);
    for (let c = 0; c < 3; c++) got[c]!.push(OUTS.map((o) => m.output(o).values[c]!));
  }
  nearAll(got[0]!.map((y) => y[0]!), [0, -3.5, -3, -2.5, -2, -1.5], TOL);
  nearAll(got[1]!.map((y) => y[0]!), [0, -3, -2, -1, 0, 1], TOL);
  nearAll(got[2]!.map((y) => y[0]!), [0, -3.75, -3.5, -3.25, -3, -2.75], TOL);
  nearAll(got[0]![4]!, [-2, 4, 4.583333, 5], TOL);
  nearAll(got[1]![4]!, [0, 0, 0, 0], TOL);
  nearAll(got[2]![4]!, [-3, 4, 2.5, 3.535534], TOL);
  // モノとの一致(ビット同一)
  for (let c = 0; c < 3; c++) {
    const mono = mk(F16);
    for (let n = 0; n < 6; n++) {
      const y = st(mono, { pitch: pitches[c]! });
      for (let i = 0; i < 4; i++) assert.ok(Object.is(y[i], got[c]![n]![i]), `c=${c} n=${n} ${OUTS[i]}`);
    }
  }
});

tv("TV-MOD-OSC-001-12", () => {
  // (a)
  {
    const m = mk(F16, { fm_amt: 1, pwm_amt: 1, pw: 0.5 });
    const saw: number[][] = [[], [], []];
    const pulse: number[][] = [[], [], []];
    for (let n = 0; n < 10; n++) {
      stepWith(m, { pitch: [0, 0, 0], fm: [1, -1], pwm: 2.5, sync: n < 7 ? 0 : 10 });
      assert.equal(m.output("saw").channels, 3);
      for (let c = 0; c < 3; c++) {
        saw[c]!.push(m.output("saw").values[c]!);
        pulse[c]!.push(m.output("pulse").values[c]!);
      }
    }
    nearAll(saw[0]!, [0, -3, -2, -1, 0, 1, 2, 0, -3, -2], TOL);
    nearAll(saw[1]!, [0, -3.75, -3.5, -3.25, -3, -2.75, -2.5, 0, -3.75, -3.5], TOL);
    nearAll(saw[2]!, [0, -3.5, -3, -2.5, -2, -1.5, -1, 0, -3.5, -3], TOL);
    assert.deepEqual(pulse[0], Array.from({ length: 10 }, (_, n) => (n === 0 || n === 6 || n === 7 ? 0 : 4)));
    assert.deepEqual(pulse[1], Array.from({ length: 10 }, (_, n) => (n === 0 || n === 7 ? 0 : 4)));
    assert.deepEqual(pulse[2], Array.from({ length: 10 }, (_, n) => (n === 0 || n === 7 ? 0 : 4)));
  }
  // (b)
  {
    const m = mk(F16, { fm_amt: 0, pwm_amt: 0, pw: 0.5 });
    const saw = run(m, 8, (n) => ({ pitch: [0, 0, 0], sync: [0, n < 4 ? 0 : 10] }), "saw");
    assert.equal(saw.length, 3);
    const free = [0, -3.5, -3, -2.5, -2, -1.5, -1, -0.5];
    nearAll(saw[0]!, free, TOL);
    nearAll(saw[2]!, free, TOL);
    nearAll(saw[1]!, [0, -3.5, -3, -2.5, 0, -3.5, -3, -2.5], TOL);
  }
});

tv("TV-MOD-OSC-001-13", () => {
  const m = mk(F16, { fm_amt: 1 });
  const exp = [
    [0, 0, 0, 0],
    [-3, 4, 2.5, 3.535534],
    [-2, 4, 4.166667, 5],
    [-1, 4, 2.5, 3.535534],
  ];
  for (let n = 0; n < 4; n++) {
    nearAll(st(m, { fm: [1, -1] }), exp[n]!, TOL, 0, `n=${n}`);
    for (const o of OUTS) assert.equal(m.output(o).channels, 1);
  }
});

tv("TV-MOD-OSC-001-14", () => {
  const m = mk(F16);
  const e0 = [
    [0, 0, 0, 0],
    [-3.5, 4, 1.25, 1.913417],
  ];
  const e1 = [
    [0, 0, 0, 0],
    [-3, 4, 2.5, 3.535534],
  ];
  for (let n = 0; n < 2; n++) {
    stepWith(m, { pitch: [NaN, 1], pwm: NaN });
    assert.equal(m.output("saw").channels, 2);
    nearAll(OUTS.map((o) => m.output(o).values[0]!), e0[n]!, TOL, 0, `c=0 n=${n}`);
    nearAll(OUTS.map((o) => m.output(o).values[1]!), e1[n]!, TOL, 0, `c=1 n=${n}`);
  }
  assert.equal(m.nonfiniteCount, 4);
});

tv("TV-MOD-OSC-001-15", () => {
  const m = mk(FS);
  const exp: Record<number, number[]> = {
    45: [-2.037808, 4, 4.905395, 4.997796],
    46: [-1.994204, 4, 4.961822, 4.999948],
    91: [-0.032012, 3.717279, 0.080029, 0.125697],
    92: [0.011593, -1.844141, -0.028981, -0.045523],
    183: [2.848695, -2.869114, -0.051048, -0.080183],
    184: [-3.099654, 3.122839, 0.057963, 0.091043],
  };
  for (let n = 0; n <= 184; n++) {
    const y = st(m, { pitch: 0 });
    if (exp[n]) nearAll(y, exp[n]!, TOL, 0, `n=${n}`);
  }
});
