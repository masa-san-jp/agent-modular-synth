// MOD-RND-001 の検証例(specifications/modules/MOD-RND-001.md §10)。
import assert from "node:assert/strict";
import { RndModule } from "../src/modules/rnd.js";
import { near, nearAll, stepWith, tv } from "./helpers.js";

const FS = 48000;
type Sig = number | readonly number[] | null;
type Ins = { IN?: (n: number) => Sig; TRIG?: (n: number) => Sig };
type P = { seed?: number; level?: number; scale?: number; offset?: number };

function mk(p: P = {}): RndModule {
  const m = new RndModule(FS);
  for (const [k, v] of Object.entries(p)) m.setParam(k, v as number);
  return m;
}

interface Run {
  out: number[][];
  noise: number[][];
}

function run(m: RndModule, steps: number, ins: Ins = {}, n0 = 0, pre?: (n: number) => void): Run {
  const r: Run = { out: [], noise: [] };
  for (let i = 0; i < steps; i++) {
    const n = n0 + i;
    if (pre) pre(n);
    const s: Record<string, Sig> = {};
    if (ins.IN) s.IN = ins.IN(n);
    if (ins.TRIG) s.TRIG = ins.TRIG(n);
    stepWith(m, s);
    const o = m.output("OUT");
    const z = m.output("NOISE");
    assert.equal(z.channels, o.channels);
    for (let c = 0; c < o.channels; c++) {
      (r.out[c] ??= [])[i] = o.values[c]!;
      (r.noise[c] ??= [])[i] = z.values[c]!;
    }
  }
  return r;
}

const pulses = (rises: readonly number[], w = 2) => (n: number): number =>
  rises.some((r) => n >= r && n < r + w) ? 10 : 0;

// seed=1, level=5 の NOISE[0..5](TV-01)
const N1 = [0.6860595942, 2.5392884016, 3.8939392567, -0.0997954607, -0.2941763401, 4.8336863518];
const OUT1 = [0, 2.5392884016, 2.5392884016, 2.5392884016, -0.2941763401, -0.2941763401];
const TRIG14 = pulses([1, 4]);

tv("TV-MOD-RND-001-01", () => {
  const m = mk({ seed: 1, level: 5, scale: 1, offset: 0 });
  const r = run(m, 6, { TRIG: TRIG14 });
  nearAll(r.noise[0]!, N1, 1e-6, 0, "NOISE");
  nearAll(r.out[0]!, OUT1, 1e-6, 0, "OUT");
  assert.equal(r.out.length, 1);
  assert.equal(m.nonfiniteCount, 0);
});

tv("TV-MOD-RND-001-02", () => {
  const xs = [0, 0, 3.0, 0, 0, 0, -2.5, 9];
  const r = run(mk({ seed: 1, level: 5 }), 8, { IN: (n) => xs[n]!, TRIG: pulses([2, 6]) });
  nearAll(r.out[0]!, [0, 0, 3.0, 3.0, 3.0, 3.0, -2.5, -2.5], 1e-6, 0, "OUT");
  nearAll(r.noise[0]!, N1, 1e-6, 0, "NOISE");
});

tv("TV-MOD-RND-001-03", () => {
  // (a)
  {
    const r = run(mk({ seed: 1, level: 5, scale: -2, offset: 1 }), 2, { TRIG: pulses([1]) });
    near(r.out[0]![0]!, 1.0, 1e-6, 0, "(a) OUT[0]");
    near(r.out[0]![1]!, -4.0785768032, 1e-6, 0, "(a) OUT[1]");
  }
  // (b)
  {
    const r = run(mk({ seed: 1, level: 10, scale: 2, offset: 10 }), 4, { TRIG: pulses([2]) });
    nearAll(r.noise[0]!, [1.3721191883, 5.0785768032, 7.7878785133, -0.1995909214], 1e-6, 0, "(b) NOISE");
    nearAll(r.out[0]!, [10, 10, 12, 12], 1e-6, 0, "(b) OUT");
  }
});

tv("TV-MOD-RND-001-04", () => {
  {
    const ts = [0, 1.9, 2.0, 2.5, 0.2, 0.1, 2.0];
    const r = run(mk({ seed: 1, level: 5 }), 7, { TRIG: (n) => ts[n]! });
    nearAll(r.out[0]!, [0, 0, 3.8939392567, 3.8939392567, 3.8939392567, 3.8939392567, -1.470323205], 1e-6, 0, "OUT");
    near(r.noise[0]![2]!, 3.8939392567, 1e-6, 0, "NOISE[2]");
    near(r.noise[0]![6]!, -1.470323205, 1e-6, 0, "NOISE[6]");
  }
  {
    const r = run(mk({ seed: 1, level: 5 }), 12, { TRIG: (n) => (n >= 1 && n <= 10 ? 10 : 0) });
    near(r.out[0]![0]!, 0, 1e-6, 0, "別設定 OUT[0]");
    for (let n = 1; n <= 11; n++) near(r.out[0]![n]!, 2.5392884016, 1e-6, 0, `別設定 OUT[${n}]`);
  }
});

tv("TV-MOD-RND-001-05", () => {
  {
    const m = mk({ seed: 1, level: 0 });
    const r = run(m, 5, { TRIG: () => 0 }, 0, (n) => {
      if (n === 3) m.setParam("level", 5);
    });
    nearAll(r.noise[0]!, [0, 0, 0, -0.0997954607, -0.2941763401], 1e-6, 0, "NOISE");
  }
  {
    const r = run(mk({ seed: 1, level: 20 }), 1, { TRIG: () => 0 });
    near(r.noise[0]![0]!, 1.3721191883, 1e-6, 0, "level=20 NOISE[0]");
  }
});

tv("TV-MOD-RND-001-06", () => {
  const trig = pulses([1]);
  // (a)
  {
    const m = mk({ seed: 1, level: 5 });
    const r = run(m, 4, { TRIG: trig, IN: (n) => (n === 1 ? NaN : 0) });
    near(r.out[0]![1]!, 0, 1e-6, 0, "(a) OUT[1]");
    assert.equal(m.nonfiniteCount, 1, "(a) nonfinite_count");
  }
  // (b)
  {
    const m = mk({ seed: 1, level: 5 });
    const r = run(m, 4, { TRIG: trig, IN: (n) => (n === 1 ? -1e30 : 0) });
    near(r.out[0]![1]!, -12, 1e-6, 0, "(b) OUT[1]");
    assert.equal(m.nonfiniteCount, 0, "(b) nonfinite_count");
  }
  // (c)
  {
    const m = mk({ seed: 1, level: 5, scale: 5 });
    const r = run(m, 4, { TRIG: trig, IN: (n) => (n === 1 ? 1.5 : 0) });
    near(r.out[0]![1]!, 3.0, 1e-6, 0, "(c) OUT[1]");
    assert.equal(m.nonfiniteCount, 0, "(c) nonfinite_count");
  }
  // (d)
  {
    const m = mk({ seed: 1, level: 5 });
    const r = run(m, 4, { TRIG: trig, IN: () => NaN });
    nearAll(r.out[0]!, [0, 0, 0, 0], 1e-6, 0, "(d) OUT");
    assert.equal(m.nonfiniteCount, 4, "(d) nonfinite_count");
  }
});

tv("TV-MOD-RND-001-07", () => {
  {
    const r = run(mk({ seed: 1 }), 100);
    for (let n = 0; n < 100; n++) near(r.out[0]![n]!, 0, 1e-6, 0, `OUT[${n}]`);
    nearAll(r.noise[0]!, N1.slice(0, 3), 1e-6, 0, "NOISE");
    // 乱数は進み続ける(同じ値が続かない)
    assert.ok(new Set(r.noise[0]).size > 90);
  }
  {
    const r = run(mk({ seed: 1 }), 1, { TRIG: pulses([0]) });
    near(r.out[0]![0]!, 0.6860595942, 1e-6, 0, "別設定 OUT[0]");
    near(r.noise[0]![0]!, 0.6860595942, 1e-6, 0, "別設定 NOISE[0]");
  }
});

tv("TV-MOD-RND-001-08", () => {
  // (a)
  {
    const m = mk({ seed: 1 });
    const trig = pulses([1]);
    const r0 = run(m, 5, { TRIG: trig });
    near(r0.out[0]![4]!, 2.5392884016, 1e-6, 0, "(a) reset前 OUT[4]");
    m.reset();
    const r = run(m, 3, { TRIG: trig });
    nearAll(r.noise[0]!, N1.slice(0, 3), 1e-6, 0, "(a) NOISE");
    near(r.out[0]![0]!, 0, 1e-6, 0, "(a) reset直後 OUT[0]");
    assert.equal(m.param("seed"), 1);
  }
  // (b)
  {
    const m = mk({ seed: 1 });
    const r = run(m, 5, { TRIG: () => 0 }, 0, (n) => {
      if (n === 2) m.setParam("seed", 12345);
    });
    nearAll(r.noise[0]!, [0.6860595942, 2.5392884016, -3.792383671, -3.974510431, 4.855471849], 1e-6, 0, "(b) NOISE");
  }
});

tv("TV-MOD-RND-001-09", () => {
  const a = mk({ seed: 7, level: 5 });
  const ins: Ins = { TRIG: pulses([3, 50, 200, 333], 4) };
  const r0 = run(a, 120, ins);
  near(r0.noise[0]![119]!, 3.363943696, 1e-6, 0, "NOISE[119]");
  near(r0.out[0]![119]!, -4.6816599369, 1e-6, 0, "OUT[119]");
  const saved = JSON.parse(JSON.stringify({ params: a.getParams(), state: a.getState() })) as {
    params: Record<string, number>;
    state: Record<string, unknown>;
  };
  const b = new RndModule(FS);
  for (const [k, v] of Object.entries(saved.params)) b.setParam(k, v);
  b.setState(saved.state);
  const ra = run(a, 380, ins, 120);
  const rb = run(b, 380, ins, 120);
  assert.equal(rb.out.length, 1);
  for (let i = 0; i < 380; i++) {
    assert.ok(Object.is(ra.out[0]![i], rb.out[0]![i]), `OUT[${120 + i}]`);
    assert.ok(Object.is(ra.noise[0]![i], rb.noise[0]![i]), `NOISE[${120 + i}]`);
  }
  near(ra.noise[0]![379]!, 2.168828249, 1e-6, 0, "NOISE[499]");
  near(ra.out[0]![379]!, 4.4330346584, 1e-6, 0, "OUT[499]");
});

tv("TV-MOD-RND-001-10", () => {
  const same = (p: P, msg: string): void => {
    const m = mk(p);
    const r = run(m, 6, { TRIG: TRIG14 });
    nearAll(r.noise[0]!, N1, 1e-6, 0, `${msg} NOISE`);
    nearAll(r.out[0]!, OUT1, 1e-6, 0, `${msg} OUT`);
    assert.equal(m.nonfiniteCount, 0, `${msg} nonfinite_count`);
  };
  // (a)
  same({ seed: NaN }, "(a) seed=NaN");
  same({ seed: Infinity }, "(a) seed=+∞");
  // (b)
  {
    const r = run(mk({ seed: -5 }), 6, { TRIG: TRIG14 });
    nearAll(r.noise[0]!, [3.8685393333, -2.3604106903, -4.8752504587], 1e-6, 0, "(b) NOISE");
    nearAll(
      r.out[0]!,
      [0, -2.3604106903, -2.3604106903, -2.3604106903, -4.6747785807, -4.6747785807],
      1e-6,
      0,
      "(b) OUT",
    );
  }
  // (c)
  same({ seed: 1.9 }, "(c)");
  // (d)
  same({ seed: 4294967297 }, "(d)");
  // (e)
  {
    const r = run(mk({ seed: 4294979641 }), 6, { TRIG: TRIG14 });
    nearAll(r.noise[0]!, [-3.7923836708, -3.9745104313, 4.8554718494], 1e-6, 0, "(e) NOISE");
    const ref = run(mk({ seed: 12345 }), 6, { TRIG: TRIG14 });
    assert.deepEqual(r, ref, "(e) seed=12345 と同じ");
  }
  // (f)
  same({ level: NaN }, "(f) level=NaN");
  same({ scale: NaN }, "(f) scale=NaN");
  same({ offset: NaN }, "(f) offset=NaN");
});

tv("TV-MOD-RND-001-11", () => {
  const NA1 = [-0.1148796082, 4.8060929775, 2.4827134609, 0.8625525236, -1.4169943333, 2.7205914259];
  const NA2 = [2.1914803982, 1.4391708374, -1.1688381433, 4.9488574266, 0.8383357525, -0.8988457918];
  // (a)
  {
    const t0 = TRIG14;
    const t1 = pulses([2]);
    const m = mk({ seed: 1 });
    const r = run(m, 6, { TRIG: (n) => [t0(n), t1(n), 0] });
    assert.equal(r.out.length, 3);
    nearAll(r.noise[0]!, N1, 1e-6, 0, "(a) NOISE[0]");
    nearAll(r.noise[1]!, NA1, 1e-6, 0, "(a) NOISE[1]");
    nearAll(r.noise[2]!, NA2, 1e-6, 0, "(a) NOISE[2]");
    nearAll(r.out[0]!, OUT1, 1e-6, 0, "(a) OUT[0]");
    nearAll(r.out[1]!, [0, 0, 2.4827134609, 2.4827134609, 2.4827134609, 2.4827134609], 1e-6, 0, "(a) OUT[1]");
    nearAll(r.out[2]!, [0, 0, 0, 0, 0, 0], 1e-6, 0, "(a) OUT[2]");
    // チャンネル c は、モノで seed=1+c・同じ TRIG を与えた結果と一致
    [t0, t1, (): number => 0].forEach((t, c) => {
      const mono = run(mk({ seed: 1 + c }), 6, { TRIG: t });
      assert.deepEqual(r.noise[c], mono.noise[0], `(a) NOISE[${c}] がモノ seed=${1 + c} と一致`);
      assert.deepEqual(r.out[c], mono.out[0], `(a) OUT[${c}] がモノと一致`);
    });
    assert.equal(m.nonfiniteCount, 0);
  }
  // (b)
  {
    const r = run(mk({ seed: 4294967295 }), 3, { TRIG: () => [0, 0] });
    assert.equal(r.noise.length, 2);
    nearAll(r.noise[0]!, [-3.0538159609, -0.5266565084, 0.4859668016], 1e-6, 0, "(b) NOISE[0]");
    nearAll(r.noise[1]!, [3.8685393333, -2.3604106903, -4.8752504587], 1e-6, 0, "(b) NOISE[1]");
  }
  // (c)
  {
    const r = run(mk({ seed: 1 }), 4, { IN: (n) => [1 + n, -2, 0.5 * n], TRIG: pulses([1]) });
    assert.equal(r.out.length, 3);
    nearAll(r.out[0]!, [0, 2, 2, 2], 1e-6, 0, "(c) OUT[0]");
    nearAll(r.out[1]!, [0, -2, -2, -2], 1e-6, 0, "(c) OUT[1]");
    nearAll(r.out[2]!, [0, 0.5, 0.5, 0.5], 1e-6, 0, "(c) OUT[2]");
    nearAll(r.noise[0]!, N1.slice(0, 4), 1e-6, 0, "(c) NOISE[0]");
    nearAll(r.noise[1]!, NA1.slice(0, 4), 1e-6, 0, "(c) NOISE[1]");
    nearAll(r.noise[2]!, NA2.slice(0, 4), 1e-6, 0, "(c) NOISE[2]");
  }
  // (d)
  {
    const t = pulses([1]);
    const r = run(mk({ seed: 1 }), 4, { IN: () => [3.0, -1.5], TRIG: (n) => [t(n), t(n), t(n)] });
    assert.equal(r.out.length, 3);
    nearAll(r.out[0]!, [0, 3, 3, 3], 1e-6, 0, "(d) OUT[0]");
    nearAll(r.out[1]!, [0, -1.5, -1.5, -1.5], 1e-6, 0, "(d) OUT[1]");
    nearAll(r.out[2]!, [0, 0, 0, 0], 1e-6, 0, "(d) OUT[2]");
  }
  // (e)
  {
    const r = run(mk({ seed: 1 }), 5, {
      IN: (n) => n,
      TRIG: (n) => [pulses([1])(n), pulses([2])(n), pulses([3])(n)],
    });
    nearAll(r.out[0]!, [0, 1, 1, 1, 1], 1e-6, 0, "(e) OUT[0]");
    nearAll(r.out[1]!, [0, 0, 2, 2, 2], 1e-6, 0, "(e) OUT[1]");
    nearAll(r.out[2]!, [0, 0, 0, 3, 3], 1e-6, 0, "(e) OUT[2]");
  }
  // (f)
  {
    const m = mk({ seed: 1 });
    const r = run(m, 4, { TRIG: () => [0, 0, 0] }, 0, (n) => {
      if (n === 2) m.setParam("seed", 12345);
    });
    nearAll(r.noise[0]!, [0.6860595942, 2.5392884016, -3.7923836708, -3.9745104313], 1e-6, 0, "(f) NOISE[0]");
    nearAll(r.noise[1]!, [-0.1148796082, 4.8060929775, -3.0636715889, 1.0761326551], 1e-6, 0, "(f) NOISE[1]");
    nearAll(r.noise[2]!, [2.1914803982, 1.4391708374, -2.9864376783, 0.0868546963], 1e-6, 0, "(f) NOISE[2]");
  }
});
