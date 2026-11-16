// MOD-FLT-001 の検証例(specifications/modules/MOD-FLT-001.md §10)。
import assert from "node:assert/strict";
import { FltModule } from "../src/modules/flt.js";
import { near, stepWith, tv } from "./helpers.js";

const FS = 48000;
type P = { cutoff?: number; res?: number; cv2_level?: number; cv3_level?: number };
type Sig = number | readonly number[] | null;
type Ins = Record<string, Sig>;

function mk(p: P = {}, fs = FS): FltModule {
  const m = new FltModule(fs);
  for (const [k, v] of Object.entries(p)) m.setParam(k, v as number);
  return m;
}

/** steps ステップ進め、out をチャンネル別に記録する。 */
function run(m: FltModule, steps: number, ins: (n: number) => Ins, n0 = 0): number[][] {
  const ys: number[][] = [];
  for (let i = 0; i < steps; i++) {
    stepWith(m, ins(n0 + i));
    const o = m.output("out");
    for (let c = 0; c < o.channels; c++) (ys[c] ??= []).push(o.values[c]!);
  }
  return ys;
}

const run1 = (m: FltModule, steps: number, x: (n: number) => number, n0 = 0): number[] =>
  run(m, steps, (n) => ({ in: x(n) }), n0)[0]!;

function rel(ys: readonly number[], exp: readonly number[], msg: string, off = 0): void {
  for (let i = 0; i < exp.length; i++) near(ys[off + i]!, exp[i]!, 0, 1e-5, `${msg}[${off + i}]`);
}

function maxAbs(ys: readonly number[], a: number, b: number): number {
  let m = 0;
  for (let i = a; i <= b; i++) m = Math.max(m, Math.abs(ys[i]!));
  return m;
}

function states(m: FltModule): number[][] {
  return m.getState().s as number[][];
}

tv("TV-MOD-FLT-001-01", () => {
  const g = Math.tan((Math.PI * 261.6256) / FS);
  const G = g / (1 + g);
  near(g, 0.017125029, 0, 1e-7, "g");
  near(G, 0.0168367, 0, 1e-7, "G");
  const m = mk({ cutoff: 0, res: 0 });
  const y = run1(m, 5000, () => 5);
  rel(y, [4.01788892e-7, 3.56198164e-6, 1.59367165e-5, 4.91205369e-5, 1.19511724e-4], "y");
  near(y[0]!, 5 * G ** 4, 0, 1e-5, "y[0] = 5·G^4");
  near(y[999]!, 4.99999999995, 1e-4, 0, "y[999]");
  near(y[4999]!, 5.0, 1e-4, 0, "y[4999]");
  assert.equal(m.nonfiniteCount, 0);
});

const TV02 = [4.01788812e-7, 3.16019148e-6, 1.23747249e-5, 3.31837679e-5, 7.03909776e-5, 1.28072563e-4];

tv("TV-MOD-FLT-001-02", () => {
  const y = run1(mk({ cutoff: 0, res: 0.5 }), 2000, (n) => (n === 0 ? 5 : 0));
  rel(y, TV02, "y");
  near(y[100]!, 0.0226978146, 1e-6, 0, "y[100]");
  near(maxAbs(y, 1000, 1999), 9.52905e-4, 1e-6, 0, "max|y| n=1000..1999");
});

tv("TV-MOD-FLT-001-03", () => {
  const cases: Array<[string, P, Ins]> = [
    ["(a)", { cutoff: 0, res: 0 }, { in: 5, cv1: 1.0 }],
    ["(b)", { cutoff: 1.0, res: 0 }, { in: 5 }],
    ["(c)", { cutoff: 0, res: 0, cv2_level: 0.5 }, { in: 5, cv2: 2.0 }],
    ["(d)", { cutoff: 0, res: 0, cv3_level: -1.0 }, { in: 5, cv3: -1.0 }],
  ];
  for (const [name, p, ins] of cases) {
    const y = run(mk(p), 10, () => ins)[0]!;
    near(y[9]!, 0.0227863228, 0, 1e-5, `${name} y[9]`);
    if (name === "(a)") rel(y, [6.02012783e-6, 5.25858055e-5, 2.31136022e-4], "(a) y");
  }
});

tv("TV-MOD-FLT-001-04", () => {
  const amp = (f: number): number => {
    const m = mk({ cutoff: Math.log2(1000 / 261.6256), res: 0 });
    const w = (2 * Math.PI * f) / FS;
    const y = run1(m, 48000, (n) => Math.sin(w * n));
    let re = 0;
    let im = 0;
    for (let n = 40000; n <= 44799; n++) {
      re += y[n]! * Math.cos(w * n);
      im -= y[n]! * Math.sin(w * n);
    }
    return (2 * Math.hypot(re, im)) / 4800;
  };
  const a1 = amp(1000);
  const a2 = amp(2000);
  const a4 = amp(4000);
  near(a1, 0.25, 0, 1e-4, "f=1000");
  near(a2, 0.0394522458, 0, 1e-4, "f=2000");
  near(a4, 0.00318736183, 0, 1e-4, "f=4000");
  near(a2 / a4, 12.38, 0.005, 0, "振幅比");
});

tv("TV-MOD-FLT-001-05", () => {
  // (a) 自己発振
  {
    const y = run1(mk({ cutoff: 3.0, res: 1.0 }), 48000, (n) => (n === 0 ? 1.0 : 0));
    near(maxAbs(y, 40000, 47999), 4.1696, 0.01, 0, "(a) 振幅");
    const zc: number[] = [];
    for (let n = 40001; n <= 47999; n++) {
      const a = y[n - 1]!;
      const b = y[n]!;
      if (a < 0 && b >= 0) zc.push(n - 1 + -a / (b - a));
    }
    assert.ok(zc.length > 2, "ゼロ交差がない");
    const f = ((zc.length - 1) * FS) / (zc[zc.length - 1]! - zc[0]!);
    const fc = 261.6256 * 8;
    near(fc, 2093.0048, 1e-3, 0, "fc");
    near(f, fc, 0, 0.01, "(a) 周波数(fc の ±1%)");
    near(f, 2092.4, 0.5, 0, "(a) 周波数");
  }
  // (b) 減衰
  {
    const y = run1(mk({ cutoff: 3.0, res: 0.5 }), 48000, (n) => (n === 0 ? 1.0 : 0));
    assert.ok(maxAbs(y, 40000, 47999) < 1e-6, "(b) 減衰していない");
  }
  // (c) DC 利得 1/(1+k)
  {
    const y = run1(mk({ cutoff: 3.0, res: 0.5 }), 48000, () => 0.1);
    near(y[47999]!, 0.0285715154, 1e-6, 0, "(c) y[47999]");
  }
});

tv("TV-MOD-FLT-001-06", () => {
  near(Math.tan((Math.PI * 20000) / 48000), 3.73205081, 0, 1e-8, "(a) g");
  near(Math.tan((Math.PI * 8) / 48000), 5.23598823e-4, 0, 1e-8, "(b) g");
  near(Math.tan((Math.PI * 3600) / 8000), 6.31375151, 0, 1e-8, "(c) g");
  near(Math.tan((Math.PI * 261.6256) / 44100), 0.0186398241, 0, 1e-8, "(d) g");
  near(261.6256 * 64, 16744.0384, 1e-6, 0, "(e) fc");
  const cases: Array<[string, number, P, Ins, number[]]> = [
    ["(a)", 48000, { cutoff: 6.0 }, { in: 5, cv1: 10.0 }, [1.93447267, 5.20489009, 5.39007527]],
    ["(b)", 48000, { cutoff: -5.0 }, { in: 5, cv1: -10.0 }, [3.75020757e-13, 3.37361675e-12, 1.53601545e-11]],
    ["(c)", 8000, { cutoff: 6.0 }, { in: 5 }, [2.77689298, 5.81434152, 4.85342548]],
    ["(d)", 44100, { cutoff: 0.0 }, { in: 5 }, [5.60601999e-7, 4.96335151e-6, 2.21715258e-5]],
    ["(e)", 48000, { cutoff: 7.0 }, { in: 5 }, [0.951255279, 3.53533973, 5.3385453]],
  ];
  for (const [name, fs, p, ins, exp] of cases) {
    const m = mk({ res: 0, ...p }, fs);
    const y = run(m, 3, () => ins)[0]!;
    rel(y, exp, `${name} y`);
    assert.equal(m.nonfiniteCount, 0, `${name} nonfinite_count`);
  }
});

tv("TV-MOD-FLT-001-07", () => {
  // (a)
  {
    const m = mk({ cutoff: 0, res: 0 });
    const y = run1(m, 3, () => NaN);
    for (let n = 0; n < 3; n++) near(y[n]!, 0, 1e-6, 0, `(a) y[${n}]`);
    assert.equal(m.nonfiniteCount, 3, "(a) nonfinite_count");
  }
  // (b)
  {
    const m = mk({ cutoff: 0, res: 0 });
    const y = run1(m, 3, (n) => (n === 0 ? 5 : Infinity));
    rel(y, [4.01788892e-7, 3.16019274e-6, 1.23747349e-5], "(b) y");
    assert.equal(m.nonfiniteCount, 2, "(b) nonfinite_count");
  }
  // (c)
  {
    const m = mk({ cutoff: 0, res: 2.0 });
    const ref = mk({ cutoff: 0, res: 1.0 });
    const y = run1(m, 3, () => 5);
    const yr = run1(ref, 3, () => 5);
    for (let n = 0; n < 3; n++) assert.ok(Object.is(y[n], yr[n]), `(c) y[${n}] が res=1.0 とビット同一でない`);
    rel(y, [4.01788731e-7, 3.56197894e-6, 1.59366939e-5], "(c) y");
    assert.equal(m.nonfiniteCount, 0, "(c) nonfinite_count");
  }
  // (d)
  {
    const m = mk({ cutoff: 0, res: 0 });
    const y = run1(m, 3000, () => 1e6);
    rel(y, [0.0803577784, 0.712396327], "(d) y");
    for (let n = 1; n < 3000; n++) assert.ok(y[n]! >= y[n - 1]!, `(d) y[${n}] が単調でない`);
    assert.equal(y[2999], 12.0, "(d) y[2999]");
    assert.equal(m.nonfiniteCount, 0, "(d) nonfinite_count");
  }
  // (e)
  {
    const m = mk({ cutoff: Infinity, res: NaN });
    const ref = mk();
    const y = run1(m, 3, () => 5);
    const yr = run1(ref, 3, () => 5);
    for (let n = 0; n < 3; n++) assert.ok(Object.is(y[n], yr[n]), `(e) y[${n}] が既定値と同一でない`);
    rel(y, [1.07710787e-3, 8.65004054e-3, 3.43544791e-2], "(e) y");
    assert.equal(m.nonfiniteCount, 0, "(e) nonfinite_count");
  }
});

tv("TV-MOD-FLT-001-08", () => {
  // (a)
  {
    const m = mk();
    const y = run(m, 3, () => ({ in: null, cv1: null, cv2: null, cv3: null, res_cv: null }))[0]!;
    for (let n = 0; n < 3; n++) assert.equal(y[n], 0, `(a) y[${n}]`);
    assert.equal(m.nonfiniteCount, 0);
  }
  // (b)
  {
    const y = run(mk({ cutoff: 0 }), 10, () => ({ in: 5 }))[0]!;
    near(y[9]!, 0.00185331632, 0, 1e-5, "(b) y[9]");
    const y2 = run(mk({ cutoff: 0 }), 10, () => ({ in: 5, cv1: 0, cv2: 0, cv3: 0, res_cv: 0 }))[0]!;
    for (let n = 0; n < 10; n++) assert.ok(Object.is(y[n], y2[n]), `(b) y[${n}] が 0 V 明示と同値でない`);
  }
});

tv("TV-MOD-FLT-001-09", () => {
  const m = mk({ cutoff: 0, res: 0.5 });
  const imp = (n: number): number => (n === 0 ? 5 : 0);
  const y1 = run1(m, 10, imp);
  run1(m, 100, () => 3.0);
  m.reset();
  assert.deepEqual(states(m), [[0, 0, 0, 0]]);
  assert.deepEqual(m.getParams(), { cutoff: 0, res: 0.5, cv2_level: 1.0, cv3_level: 1.0 });
  const y4 = run1(m, 10, imp);
  for (let n = 0; n < 10; n++) assert.ok(Object.is(y1[n], y4[n]), `y[${n}] が一致しない`);
  rel(y1, TV02.slice(0, 4), "y");
});

tv("TV-MOD-FLT-001-10", () => {
  const x = (n: number): number => 3 * Math.sin(0.05 * n);
  const a = mk({ cutoff: 2.0, res: 0.9 });
  run1(a, 300, x);
  const saved = JSON.parse(JSON.stringify({ params: a.getParams(), state: a.getState() })) as {
    params: Record<string, number>;
    state: Record<string, unknown>;
  };
  const b = new FltModule(FS);
  for (const [k, v] of Object.entries(saved.params)) b.setParam(k, v);
  b.setState(saved.state);

  const ya = run1(a, 300, x, 300);
  const yb = run1(b, 300, x, 300);
  for (let i = 0; i < 300; i++) assert.ok(Object.is(ya[i], yb[i]), `y[${300 + i}] がビット同一でない`);
  near(yb[0]!, 0.847510065, 1e-5, 0, "y[300]");
  near(yb[1]!, 0.895053283, 1e-5, 0, "y[301]");
  near(yb[2]!, 0.933858483, 1e-5, 0, "y[302]");
  near(yb[299]!, -2.19323899, 1e-5, 0, "y[599]");
  const exp = [0.676783536, 0.0118616667, -0.38023264, -0.436389349];
  for (const mod of [a, b]) {
    const s = states(mod)[0]!;
    for (let i = 0; i < 4; i++) near(s[i]!, exp[i]!, 1e-5, 0, `s[${i}]`);
  }
  assert.deepEqual(states(a), states(b));
});

tv("TV-MOD-FLT-001-11", () => {
  const p: P = { cutoff: 0, res: 0.5, cv2_level: 1.0 };
  const xs = (n: number): number[] => [5.0, n === 0 ? 5.0 : 0, -2.5];
  const m = mk(p);
  const y = run(m, 2000, (n) => ({ in: xs(n), cv1: 1.0, cv2: [1.0, -1.0] }));
  assert.equal(m.output("out").channels, 3);
  assert.equal(y.length, 3);

  rel(y[0]!, [8.4918966e-5, 7.20631503e-4, 3.05922607e-3, 8.87865445e-3], "y[0]");
  near(y[0]![9]!, 0.217656012, 0, 1e-5, "y[0][9]");
  near(y[0]![1999]!, 1.43952765, 1e-5, 0, "y[0][1999]");
  rel(y[1]!, TV02, "y[1]");
  near(y[1]![100]!, 0.0226978146, 1e-5, 0, "y[1][100]");
  rel(y[2]!, [-3.01005486e-6, -2.62927535e-5, -1.15566782e-4, -3.4904592e-4], "y[2]");
  near(y[2]![9]!, -0.0113894933, 0, 1e-5, "y[2][9]");
  near(y[2]![1999]!, -0.715644849, 1e-5, 0, "y[2][1999]");

  // モノで cutoff=V・同じ in を与えた列と同一(同じ和になるよう cv で V を与える)
  const V = [2, 0, 1];
  for (let c = 0; c < 3; c++) {
    const mono = run(mk({ ...p, cutoff: V[c]! }), 2000, (n) => ({ in: xs(n)[c]! }))[0]!;
    for (let n = 0; n < 2000; n++) assert.ok(Object.is(y[c]![n], mono[n]), `y[${c}][${n}] がモノと不一致`);
  }

  const s = states(m);
  assert.equal(s.length, 3);
  near(s[0]![0]!, 0.28790553, 1e-5, 0, "s[0](エンジン0)");
  near(s[2]![0]!, -0.143129028, 1e-5, 0, "s[0](エンジン2)");
  assert.equal(m.nonfiniteCount, 0);
});
