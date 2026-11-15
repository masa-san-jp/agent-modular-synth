// MOD-IO-001 の検証例(specifications/modules/MOD-IO-001.md §10、仕様 v0.2)。
import assert from "node:assert/strict";
import { IoOutModule } from "../src/modules/io-out.js";
import { InSpec, near, stepWith, tv } from "./helpers.js";

const FS = 48000;
const A = 1 - Math.exp(-1 / 240);
const OUTS = ["PRE_L", "PRE_R", "DEV_L", "DEV_R", "CLIP"] as const;
type OutName = (typeof OUTS)[number];
type Rec = Record<OutName, number[]>;

/** 「生成時」のパラメータで作る(g はその目標値で初期化: 仕様 §5)。 */
function mk(params: Record<string, number> = {}): IoOutModule {
  const m = new IoOutModule(FS);
  for (const [k, v] of Object.entries(params)) m.setParam(k, v);
  m.reset();
  return m;
}

function run(m: IoOutModule, steps: readonly InSpec[], rec?: Rec): Rec {
  const r: Rec = rec ?? { PRE_L: [], PRE_R: [], DEV_L: [], DEV_R: [], CLIP: [] };
  for (const s of steps) {
    stepWith(m, s);
    for (const o of OUTS) {
      assert.equal(m.output(o).channels, 1, `${o} は1チャンネル`);
      const v = m.output(o).values[0]!;
      assert.ok(Number.isFinite(v), `${o} は有限`);
      r[o].push(v);
    }
  }
  return r;
}

const mono = (xs: readonly number[]): InSpec[] => xs.map((x) => ({ IN_L: x }));
/** PRE: max(絶対1e-6, 相対1e-6)。 */
function pre(actual: readonly number[], expected: readonly number[], msg: string): void {
  assert.equal(actual.length, expected.length, `${msg} 長さ`);
  expected.forEach((e, i) => near(actual[i]!, e, 1e-6, 1e-6, `${msg}[${i}]`));
}
/** DEV: 絶対1e-6。 */
function dev(actual: readonly number[], expected: readonly number[], msg: string): void {
  assert.equal(actual.length, expected.length, `${msg} 長さ`);
  expected.forEach((e, i) => near(actual[i]!, e, 1e-6, 0, `${msg}[${i}]`));
}
const fill = (n: number, v: number): number[] => new Array<number>(n).fill(v);

tv("TV-MOD-IO-001-01", () => {
  const m = mk({ level: 1, mute: 0 });
  const r = run(
    m,
    Array.from({ length: 37 }, (_, n) => ({ IN_L: 4 * Math.sin((2 * Math.PI * 1000 * n) / 48000) })),
  );
  for (const [n, e] of [
    [0, 0],
    [1, 0.1044209538],
    [12, 0.8],
    [24, 0],
    [36, -0.8],
  ] as const) {
    near(r.DEV_L[n]!, e, 1e-6, 0, `DEV_L[${n}]`);
    near(r.DEV_R[n]!, e, 1e-6, 0, `DEV_R[${n}]`);
    near(r.PRE_L[n]!, e, 1e-6, 1e-6, `PRE_L[${n}]`);
  }
  assert.ok(r.CLIP.every((c) => c === 0));
  assert.equal(m.clipCount, 0);
});

tv("TV-MOD-IO-001-02", () => {
  const r = run(mk({ level: 0.5, mute: 0 }), mono([5, -5, 2.5]));
  dev(r.DEV_L, [0.5, -0.5, 0.25], "DEV_L");
  dev(r.DEV_R, [0.5, -0.5, 0.25], "DEV_R");
  assert.deepEqual(r.CLIP, [0, 0, 0]);
});

tv("TV-MOD-IO-001-03", () => {
  const a = run(mk({ level: 1 }), [{ IN_L: 6, IN_R: 1 }]);
  dev(a.DEV_L, [1.0], "(a) DEV_L");
  dev(a.DEV_R, [0.2], "(a) DEV_R");
  assert.deepEqual(a.CLIP, [10]);
  pre(a.PRE_L, [1.2], "(a) PRE_L");
  pre(a.PRE_R, [0.2], "(a) PRE_R");
  const b = run(mk({ level: 1 }), [{ IN_L: 1, IN_R: 6 }]);
  dev(b.DEV_L, [0.2], "(b) DEV_L");
  dev(b.DEV_R, [1.0], "(b) DEV_R");
  assert.deepEqual(b.CLIP, [10]);
  pre(b.PRE_L, [0.2], "(b) PRE_L");
  pre(b.PRE_R, [1.2], "(b) PRE_R");
});

tv("TV-MOD-IO-001-04", () => {
  const a = run(mk({ level: 1 }), mono([5, -5, 5.001, -5.001, 0]));
  dev(a.DEV_L, [1, -1, 1, -1, 0], "(a) DEV_L");
  assert.deepEqual(a.CLIP, [0, 0, 10, 10, 0]);
  const b = run(mk({ level: 2 }), mono([1, 2.5, 3]));
  dev(b.DEV_L, [0.4, 1.0, 1.0], "(b) DEV_L");
  assert.deepEqual(b.CLIP, [0, 0, 10]);
});

tv("TV-MOD-IO-001-05", () => {
  const a = run(mk({ level: 3 }), mono([2.5, 3.0]));
  dev(a.DEV_L, [1.0, 1.0], "(a) DEV_L");
  assert.deepEqual(a.CLIP, [0, 10]);
  const b = run(mk({ level: -1 }), mono([5]));
  dev(b.DEV_L, [0], "(b) DEV_L");
  assert.deepEqual(b.CLIP, [0]);
  for (const [name, params] of [
    ["(c) level=NaN", { level: NaN }],
    ["(c) level=+∞", { level: Infinity }],
    ["(d) mute=NaN", { mute: NaN }],
  ] as const) {
    const m = mk(params);
    const r = run(m, mono([5, 2.5]));
    dev(r.DEV_L, [1.0, 0.5], `${name} DEV_L`);
    assert.deepEqual(r.CLIP, [0, 0], name);
    assert.equal(m.nonfiniteCount, 0, `${name} パラメータの NaN/∞ は数えない`);
  }
});

tv("TV-MOD-IO-001-06", () => {
  const m = mk({ level: 1 });
  m.setParam("mute", 1);
  const g: number[] = [];
  const r: Rec = { PRE_L: [], PRE_R: [], DEV_L: [], DEV_R: [], CLIP: [] };
  for (let n = 0; n < 240; n++) {
    run(m, [{ IN_L: 5 }], r);
    g.push(m.gain);
  }
  for (let n = 0; n < 240; n++) {
    near(g[n]!, Math.pow(1 - A, n + 1), 1e-6, 0, `g[${n}]`);
    near(r.DEV_L[n]!, g[n]!, 1e-6, 0, `DEV_L[${n}]`);
  }
  for (const [n, e] of [
    [0, 0.9958420018],
    [1, 0.991701293],
    [7, 0.9672161],
    [239, 0.3678794412],
  ] as const) {
    near(g[n]!, e, 1e-6, 0, `g[${n}]`);
    near(r.DEV_L[n]!, e, 1e-6, 0, `DEV_L[${n}]`);
  }
  assert.ok(r.CLIP.every((c) => c === 0));
});

tv("TV-MOD-IO-001-07", () => {
  // (a)
  const ma = mk({ level: 1 });
  const a = run(ma, mono([NaN, Infinity, -Infinity]));
  dev(a.DEV_L, [0, 0, 0], "(a) DEV_L");
  dev(a.DEV_R, [0, 0, 0], "(a) DEV_R");
  pre(a.PRE_L, [0, 0, 0], "(a) PRE_L");
  pre(a.PRE_R, [0, 0, 0], "(a) PRE_R");
  assert.deepEqual(a.CLIP, [0, 0, 0]);
  assert.equal(ma.nonfiniteCount, 3);
  assert.equal(ma.clipCount, 0);
  // (b)
  const mb = mk({ level: 1 });
  const b = run(mb, [{ IN_L: 1, IN_R: NaN }]);
  dev(b.DEV_L, [0.2], "(b) DEV_L");
  dev(b.DEV_R, [0], "(b) DEV_R");
  pre(b.PRE_L, [0.2], "(b) PRE_L");
  pre(b.PRE_R, [0], "(b) PRE_R");
  assert.deepEqual(b.CLIP, [0]);
  assert.equal(mb.nonfiniteCount, 1);
  assert.equal(mb.clipCount, 0);
  // (c)
  const mc = mk({ level: 1 });
  const c = run(mc, mono([1e30, -1e30]));
  dev(c.DEV_L, [1, -1], "(c) DEV_L");
  dev(c.DEV_R, [1, -1], "(c) DEV_R");
  pre(c.PRE_L, [100, -100], "(c) PRE_L");
  pre(c.PRE_R, [100, -100], "(c) PRE_R");
  assert.deepEqual(c.CLIP, [10, 10]);
  assert.equal(mc.clipCount, 2);
  assert.equal(mc.nonfiniteCount, 0);
});

tv("TV-MOD-IO-001-08", () => {
  const a = run(mk({ level: 1 }), [{ IN_L: null, IN_R: null }]);
  dev(a.DEV_L, [0], "(a) DEV_L");
  dev(a.DEV_R, [0], "(a) DEV_R");
  assert.deepEqual(a.CLIP, [0]);
  const b = run(mk({ level: 1 }), [{ IN_L: 2.5, IN_R: null }]);
  dev(b.DEV_L, [0.5], "(b) DEV_L");
  dev(b.DEV_R, [0.5], "(b) DEV_R");
});

tv("TV-MOD-IO-001-09", () => {
  const m = mk({ level: 1 });
  m.setParam("mute", 1);
  run(m, mono(fill(10, 5)));
  near(m.gain, 0.9591894571, 1e-6, 0, "reset前の g(n=9)");
  m.reset();
  assert.equal(m.gain, 0);
  assert.equal(m.clipCount, 0);
  const r = run(m, mono([5]));
  dev(r.DEV_L, [0], "DEV_L");
  assert.equal(m.gain, 0);
  assert.equal(m.clipCount, 0);
  assert.deepEqual(m.getParams(), { level: 1, mute: 1 });
});

/** 保存(JSON 経由)して新インスタンスへ復元する。 */
function restore(src: IoOutModule): IoOutModule {
  const saved = JSON.parse(JSON.stringify({ params: src.getParams(), state: src.getState() })) as {
    params: Record<string, number>;
    state: Record<string, unknown>;
  };
  const b = new IoOutModule(FS);
  for (const [k, v] of Object.entries(saved.params)) b.setParam(k, v);
  b.setState(saved.state);
  return b;
}

function bitSame(ra: Rec, rb: Rec, names: readonly OutName[], from: number): void {
  for (const o of names) {
    assert.equal(ra[o].length, rb[o].length);
    for (let i = 0; i < ra[o].length; i++) {
      assert.ok(Object.is(ra[o][i], rb[o][i]), `${o}[${from + i}] がビット同一でない`);
    }
  }
}

tv("TV-MOD-IO-001-10", () => {
  const x = (n: number): InSpec => ({ IN_L: 6 * Math.sin((2 * Math.PI * 440 * n) / 48000) });
  const a = mk({ level: 1.2 });
  let last: Rec | undefined;
  for (let n = 0; n < 600; n++) {
    if (n === 500) a.setParam("mute", 1);
    last = run(a, [x(n)]);
  }
  near(a.gain, 0.7910887562, 1e-6, 0, "保存時の g");
  assert.equal(a.clipCount, 288);
  near(last!.DEV_L[0]!, 0.0546459054, 1e-6, 0, "DEV_L[599]");
  const b = restore(a);
  assert.equal(b.param("level"), 1.2);
  assert.equal(b.getRawParam("mute"), 1);
  const steps = Array.from({ length: 2400 }, (_, i) => x(600 + i));
  const ra = run(a, steps);
  const rb = run(b, steps);
  bitSame(ra, rb, ["DEV_L", "DEV_R", "CLIP", "PRE_L", "PRE_R"], 600);
  near(rb.DEV_L[2999 - 600]!, 2.48092e-6, 1e-6, 0, "DEV_L[2999]");
  assert.equal(a.clipCount, 288);
  assert.equal(b.clipCount, 288);
});

tv("TV-MOD-IO-001-11", () => {
  const ma = mk({ level: 1 });
  const a = run(ma, [
    { IN_L: 6, IN_R: 1 },
    { IN_L: -8, IN_R: 2.5 },
    { IN_L: 5, IN_R: -5 },
    { IN_L: 2.5, IN_R: 0 },
  ]);
  pre(a.PRE_L, [1.2, -1.6, 1.0, 0.5], "(a) PRE_L");
  pre(a.PRE_R, [0.2, 0.5, -1.0, 0], "(a) PRE_R");
  dev(a.DEV_L, [1.0, -1.0, 1.0, 0.5], "(a) DEV_L");
  dev(a.DEV_R, [0.2, 0.5, -1.0, 0], "(a) DEV_R");
  assert.deepEqual(a.CLIP, [10, 10, 0, 0]);
  assert.equal(ma.clipCount, 2);
  const mb = mk({ level: 2 });
  const b = run(mb, mono([12, -12, 2.5]));
  pre(b.PRE_L, [4.8, -4.8, 1.0], "(b) PRE_L");
  pre(b.PRE_R, [4.8, -4.8, 1.0], "(b) PRE_R");
  dev(b.DEV_L, [1.0, -1.0, 1.0], "(b) DEV_L");
  dev(b.DEV_R, [1.0, -1.0, 1.0], "(b) DEV_R");
  assert.deepEqual(b.CLIP, [10, 10, 0]);
  assert.equal(mb.clipCount, 2);
});

tv("TV-MOD-IO-001-12", () => {
  const m = mk({ level: 1 });
  const r = run(m, [{ IN_L: [1, 2, -0.5, 0.25] }, { IN_L: [5, 5, 5, 5] }, { IN_L: [3, -3, 1.5, 1] }]);
  pre(r.PRE_L, [0.55, 4.0, 0.5], "PRE_L");
  pre(r.PRE_R, [0.55, 4.0, 0.5], "PRE_R");
  dev(r.DEV_L, [0.55, 1.0, 0.5], "DEV_L");
  dev(r.DEV_R, [0.55, 1.0, 0.5], "DEV_R");
  assert.deepEqual(r.CLIP, [0, 10, 0]);
  assert.equal(m.clipCount, 1);
  // 線形性: 各チャンネルを単独のモノ入力として与えたときの PRE_L とその和
  const singles = [1, 2, -0.5, 0.25].map((v) => run(mk({ level: 1 }), mono([v])).PRE_L[0]!);
  pre(singles, [0.2, 0.4, -0.1, 0.05], "単独の PRE_L");
  near(
    singles.reduce((s, v) => s + v, 0),
    0.55,
    1e-6,
    1e-6,
    "単独の PRE_L の和",
  );
  near(
    singles.reduce((s, v) => s + v, 0),
    r.PRE_L[0]!,
    1e-6,
    1e-6,
    "和とポリの PRE_L",
  );
});

tv("TV-MOD-IO-001-13", () => {
  const m = mk({ level: 1 });
  const r = run(m, [
    { IN_L: [1, 2, 3], IN_R: [0.5, -2] },
    { IN_L: [2.5], IN_R: [1, 1, 1, 1] },
    { IN_L: [1, 1], IN_R: [4] },
  ]);
  pre(r.PRE_L, [1.2, 0.5, 0.4], "PRE_L");
  pre(r.PRE_R, [-0.3, 0.8, 0.8], "PRE_R");
  dev(r.DEV_L, [1.0, 0.5, 0.4], "DEV_L");
  dev(r.DEV_R, [-0.3, 0.8, 0.8], "DEV_R");
  assert.deepEqual(r.CLIP, [10, 0, 0]);
  assert.equal(m.clipCount, 1);
});

tv("TV-MOD-IO-001-14", () => {
  const F = [220, 330, 440];
  const ch = (c: number, n: number): number => 2 * Math.sin((2 * Math.PI * F[c]! * n) / 48000);
  const m = mk({ level: 1 });
  const r: Rec = { PRE_L: [], PRE_R: [], DEV_L: [], DEV_R: [], CLIP: [] };
  const g: number[] = [];
  for (let n = 0; n < 300; n++) {
    if (n === 100) m.setParam("mute", 1);
    run(m, [{ IN_L: F.map((_, c) => ch(c, n)) }], r);
    g.push(m.gain);
  }
  for (const [n, e] of [
    [1, 0.0518165782],
    [25, 1.0130847763],
    [99, -0.4675961472],
    [100, -0.4640864672],
    [299, 0.0123881878],
  ] as const) {
    near(r.PRE_L[n]!, e, 1e-6, 1e-6, `PRE_L[${n}]`);
    near(r.PRE_R[n]!, e, 1e-6, 1e-6, `PRE_R[${n}]`);
  }
  assert.equal(g[1], 1);
  near(g[100]!, 0.9958420018, 1e-6, 0, "g[100]");
  near(g[299]!, 0.4345982085, 1e-6, 0, "g[299]");
  near(r.DEV_L[25]!, 1.0, 1e-6, 0, "DEV_L[25]");
  // n=25 の各チャンネル単独はどれも過大でない
  const singles = F.map((_, c) => {
    const s = mk({ level: 1 });
    let v = 0;
    for (let n = 0; n <= 25; n++) v = run(s, mono([ch(c, n)])).PRE_L[0]!;
    assert.equal(s.clipCount, 0);
    return v;
  });
  pre(singles, [0.263738326, 0.3527685057, 0.3965779445], "n=25 の単独 PRE_L");
  for (let n = 0; n < 300; n++) assert.equal(r.CLIP[n], n >= 25 && n <= 43 ? 10 : 0, `CLIP[${n}]`);
  assert.equal(m.clipCount, 19);
});

tv("TV-MOD-IO-001-15", () => {
  const a = run(mk({ level: 1 }), [{ IN_L: fill(16, 5) }, { IN_L: fill(16, -5) }]);
  pre(a.PRE_L, [16, -16], "(a) PRE_L");
  pre(a.PRE_R, [16, -16], "(a) PRE_R");
  dev(a.DEV_L, [1, -1], "(a) DEV_L");
  dev(a.DEV_R, [1, -1], "(a) DEV_R");
  assert.deepEqual(a.CLIP, [10, 10]);
  const b = run(mk({ level: 2 }), [{ IN_L: fill(16, 12) }, { IN_L: fill(16, -12) }]);
  pre(b.PRE_L, [76.8, -76.8], "(b) PRE_L");
  pre(b.PRE_R, [76.8, -76.8], "(b) PRE_R");
  dev(b.DEV_L, [1, -1], "(b) DEV_L");
  dev(b.DEV_R, [1, -1], "(b) DEV_R");
  assert.deepEqual(b.CLIP, [10, 10]);
  const mc = mk({ level: 1 });
  const c = run(mc, [{ IN_L: [5, -5] }, { IN_L: [2.5, 2.5] }, { IN_L: [2.5, 2.5, 0.001] }, { IN_L: fill(16, 0.3125) }]);
  pre(c.PRE_L, [0, 1.0, 1.0002, 1.0], "(c) PRE_L");
  pre(c.PRE_R, [0, 1.0, 1.0002, 1.0], "(c) PRE_R");
  dev(c.DEV_L, [0, 1.0, 1.0, 1.0], "(c) DEV_L");
  dev(c.DEV_R, [0, 1.0, 1.0, 1.0], "(c) DEV_R");
  assert.deepEqual(c.CLIP, [0, 0, 10, 0]);
  assert.equal(mc.clipCount, 1);
});

tv("TV-MOD-IO-001-16", () => {
  // (a)
  const ma = mk({ level: 1 });
  const a: Rec = { PRE_L: [], PRE_R: [], DEV_L: [], DEV_R: [], CLIP: [] };
  const nf: number[] = [];
  for (const s of [
    { IN_L: [1, NaN, 2], IN_R: null },
    { IN_L: [Infinity, 1, -Infinity], IN_R: [NaN, 0.5] },
    { IN_L: fill(16, NaN), IN_R: null },
  ] as InSpec[]) {
    run(ma, [s], a);
    nf.push(ma.nonfiniteCount);
  }
  pre(a.PRE_L, [0.6, 0.2, 0], "(a) PRE_L");
  pre(a.PRE_R, [0.6, 0.1, 0], "(a) PRE_R");
  dev(a.DEV_L, [0.6, 0.2, 0], "(a) DEV_L");
  dev(a.DEV_R, [0.6, 0.1, 0], "(a) DEV_R");
  assert.deepEqual(a.CLIP, [0, 0, 0]);
  assert.deepEqual(nf, [1, 4, 20]);
  assert.equal(ma.clipCount, 0);
  // (b)
  const mb = mk({ level: 1 });
  const b = run(mb, [
    { IN_L: fill(16, 1e30), IN_R: null },
    { IN_L: fill(16, -3e38), IN_R: [3e38] },
    { IN_L: [600], IN_R: null },
  ]);
  pre(b.PRE_L, [100, -100, 100], "(b) PRE_L");
  pre(b.PRE_R, [100, 100, 100], "(b) PRE_R");
  dev(b.DEV_L, [1, -1, 1], "(b) DEV_L");
  dev(b.DEV_R, [1, 1, 1], "(b) DEV_R");
  assert.deepEqual(b.CLIP, [10, 10, 10]);
  assert.equal(mb.clipCount, 3);
  assert.equal(mb.nonfiniteCount, 0);
});

tv("TV-MOD-IO-001-17", () => {
  const m = mk({ level: 1 });
  const r = run(m, [{ IN_L: [NaN, 6, 6] }, { IN_L: [6, 6, 6] }]);
  pre(r.PRE_L, [2.4, 3.6], "reset前 PRE_L");
  assert.deepEqual(r.CLIP, [10, 10]);
  assert.equal(m.clipCount, 2);
  assert.equal(m.nonfiniteCount, 1);
  m.reset();
  assert.equal(m.clipCount, 0);
  assert.equal(m.nonfiniteCount, 0);
  assert.equal(m.gain, 1.0);
  const s = run(m, [{ IN_L: [1, 1, 1] }]);
  pre(s.PRE_L, [0.6], "PRE_L");
  pre(s.PRE_R, [0.6], "PRE_R");
  dev(s.DEV_L, [0.6], "DEV_L");
  dev(s.DEV_R, [0.6], "DEV_R");
  assert.deepEqual(s.CLIP, [0]);
  assert.deepEqual(m.getParams(), { level: 1, mute: 0 });
});

tv("TV-MOD-IO-001-18", () => {
  const w = (f: number, n: number): number => 3 * Math.sin((2 * Math.PI * f * n) / 48000);
  const x = (n: number): InSpec => ({
    IN_L: [w(220, n), w(330, n), w(440, n)],
    IN_R: [w(550, n), 1.0],
  });
  const a = mk({ level: 1 });
  let last: Rec | undefined;
  for (let n = 0; n < 300; n++) {
    if (n === 200) a.setParam("level", 0.25);
    last = run(a, [x(n)]);
  }
  near(a.gain, 0.7444304727, 1e-6, 0, "保存時の g");
  assert.equal(a.clipCount, 42);
  near(last!.PRE_L[0]!, 0.0318298982, 1e-6, 0, "PRE_L[299]");
  near(last!.PRE_R[0]!, 0.3490556441, 1e-6, 0, "PRE_R[299]");
  const state = a.getState();
  assert.deepEqual(Object.keys(state).sort(), ["clip_count", "g"]);
  const b = restore(a);
  assert.equal(b.param("level"), 0.25);
  const steps = Array.from({ length: 700 }, (_, i) => x(300 + i));
  const ra = run(a, steps);
  const rb = run(b, steps);
  bitSame(ra, rb, OUTS, 300);
  near(rb.PRE_L[0]!, 0.039994786, 1e-6, 0, "PRE_L[300]");
  near(rb.PRE_R[0]!, 0.3189316096, 1e-6, 0, "PRE_R[300]");
  near(rb.PRE_L[699]!, -0.0624412726, 1e-6, 0, "PRE_L[999]");
  near(rb.PRE_R[699]!, 0.1097551705, 1e-6, 0, "PRE_R[999]");
  assert.equal(a.clipCount, 42);
  assert.equal(b.clipCount, 42);
  assert.equal(b.nonfiniteCount, 0);
});
