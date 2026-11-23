// MOD-MIX-002 の検証例(specifications/modules/MOD-MIX-002.md §10)。
import assert from "node:assert/strict";
import { Mix2Module } from "../src/modules/mix2.js";
import { near, nearAll, stepWith, tv } from "./helpers.js";

const TOL = 1e-5;
type P = Record<string, number>;
/** パラメータを設定してから reset() した状態(仕様 §10 の前提)。 */
function mk(params: P = {}, fs = 48000): Mix2Module {
  const m = new Mix2Module(fs);
  for (const [k, v] of Object.entries(params)) m.setParam(k, v);
  m.reset();
  return m;
}
const outs = (m: Mix2Module): [number, number, number] => [m.output("L").values[0]!, m.output("R").values[0]!, m.output("SEND").values[0]!];
const one = (params: P, inputs: Record<string, number | number[]>): [number, number, number] => {
  const m = mk(params);
  stepWith(m, inputs);
  return outs(m);
};
const read = (m: Mix2Module) => m.read() as Record<string, number[]> & { windows: number; out_low: number; out_mid: number; out_high: number; send_peak: number; send_rms: number };
const CH1 = { "level[1]": 1, "pan[1]": -1 };

tv("TV-MOD-MIX-002-01", () => {
  const m = mk();
  stepWith(m, { in1: 5 });
  nearAll(outs(m), [2.474874, 2.474874, 0], TOL);
  for (const n of ["L", "R", "SEND"]) assert.equal(m.output(n).channels, 1);
});

tv("TV-MOD-MIX-002-02", () => {
  nearAll(one({ "pan[1]": -1 }, { in1: 5 }), [3.5, 0, 0], TOL);
  nearAll(one({ "pan[1]": 1 }, { in1: 5 }), [0, 3.5, 0], TOL);
  nearAll(one({ "pan[1]": 0.5 }, { in1: 5 }), [1.339392, 3.233578, 0], TOL);
});

tv("TV-MOD-MIX-002-03", () => {
  nearAll(one({ "level[1]": 1, "pan[1]": -1, "level[2]": 0.5, "pan[2]": 1 }, { in1: 2, in2: 4 }), [2, 2, 0], TOL);
});

tv("TV-MOD-MIX-002-04", () => {
  const m = mk(CH1);
  stepWith(m, { in1: 1 });
  near(outs(m)[0], 1, 1e-6);
  m.setParam("mute[1]", 1);
  const expected: Record<number, number> = { 1: 0.995842, 2: 0.99170129, 240: 0.36787944, 2400: 0.0000454 };
  for (let n = 1; n <= 2400; n++) {
    stepWith(m, { in1: 1 });
    if (expected[n] !== undefined) near(outs(m)[0], expected[n]!, 1e-6, 0, `n=${n}`);
  }
});

tv("TV-MOD-MIX-002-05", () => {
  const base = { "level[1]": 1, "level[2]": 1, "pan[1]": -1, "pan[2]": -1 };
  const a = mk({ ...base, "solo[2]": 1 });
  stepWith(a, { in1: 1, in2: 2 });
  near(outs(a)[0], 2, TOL);
  assert.deepEqual(read(a).ch_audible, [0, 1, 0, 0, 0, 0, 0, 0]);
  const b = mk({ ...base, "solo[2]": 1, "mute[2]": 1 });
  stepWith(b, { in1: 1, in2: 2 });
  near(outs(b)[0], 0, TOL);
  assert.deepEqual(read(b).ch_audible, [0, 0, 0, 0, 0, 0, 0, 0]);
});

tv("TV-MOD-MIX-002-06", () => {
  nearAll(one({ "level[1]": 1, "send[1]": 0.5 }, { in1: 4 }), [2.828427, 2.828427, 2], TOL);
  nearAll(one({ "level[1]": 1, "send[1]": 0.5, master: 0.5 }, { in1: 4 }), [1.414214, 1.414214, 2], TOL);
  nearAll(one({ "level[1]": 0.5, "send[1]": 0.5, master: 0.5 }, { in1: 4 }), [0.707107, 0.707107, 1], TOL);
});

tv("TV-MOD-MIX-002-07", () => {
  const m = mk(CH1);
  stepWith(m, { in1: 2 });
  m.setParam("master", 0);
  for (let n = 1; n <= 240; n++) {
    stepWith(m, { in1: 2 });
    if (n === 1) near(outs(m)[0], 1.991684, 1e-6);
    if (n === 240) near(outs(m)[0], 0.73575888, 1e-6);
  }
});

tv("TV-MOD-MIX-002-08", () => {
  const p: P = {};
  const inputs: Record<string, number> = {};
  for (let i = 1; i <= 8; i++) {
    p[`level[${i}]`] = 1;
    p[`pan[${i}]`] = -1;
    p[`send[${i}]`] = 1;
    inputs[`in${i}`] = 5;
  }
  nearAll(one(p, inputs), [12, 0, 12], TOL);
});

tv("TV-MOD-MIX-002-09", () => {
  const m = mk(CH1);
  stepWith(m, { in1: [1, 2, 3] });
  near(outs(m)[0], 6, TOL);
  for (const n of ["L", "R", "SEND"]) assert.equal(m.output(n).channels, 1);
});

tv("TV-MOD-MIX-002-10", () => {
  const m = mk();
  for (let n = 0; n < 3; n++) {
    stepWith(m);
    assert.deepEqual(outs(m), [0, 0, 0]);
    for (const p of ["L", "R", "SEND"]) assert.equal(m.output(p).channels, 1);
  }
});

tv("TV-MOD-MIX-002-11", () => {
  const m = mk(CH1);
  stepWith(m, { in1: [NaN, 2] });
  near(outs(m)[0], 2, TOL);
  assert.equal(m.nonfiniteCount, 1);
  const d = mk({ "level[1]": NaN, "pan[1]": NaN, master: NaN, window_ms: NaN });
  stepWith(d, { in1: 5 });
  nearAll(outs(d), [2.474874, 2.474874, 0], TOL);
  assert.equal(d.nonfiniteCount, 0);
});

tv("TV-MOD-MIX-002-12", () => {
  nearAll(one({ "level[1]": 3, "pan[1]": -5 }, { in1: 5 }), [5, 0, 0], TOL);
});

tv("TV-MOD-MIX-002-13", () => {
  const m = mk({ ...CH1, window_ms: 10 });
  for (let n = 0; n < 479; n++) stepWith(m, { in1: 2 });
  assert.equal(read(m).windows, 0);
  assert.equal(read(m).ch_rms[0], 0);
  stepWith(m, { in1: 2 });
  let r = read(m);
  assert.equal(r.windows, 1);
  nearAll([r.ch_peak[0]!, r.ch_rms[0]!, r.ch_low[0]!, r.ch_mid[0]!, r.ch_high[0]!], [2, 2, 1.877952, 0.342337, 0.110049], TOL);
  nearAll(r.out_peak, [2, 0], TOL);
  nearAll(r.out_rms, [2, 0], TOL);
  nearAll([r.out_low, r.out_mid, r.out_high, r.send_peak], [0.938976, 0.171169, 0.055025, 0], TOL);
  for (let n = 0; n < 480; n++) stepWith(m, { in1: 2 });
  r = read(m);
  assert.equal(r.windows, 2);
  nearAll([r.ch_low[0]!, r.ch_mid[0]!], [1.999999, 0.000001], TOL);
});

tv("TV-MOD-MIX-002-14", () => {
  const run = (f: number) => {
    const m = mk({ "level[1]": 1, "pan[1]": 0, "send[1]": 0.25, window_ms: 100 });
    for (let n = 0; n < 9600; n++) stepWith(m, { in1: 4 * Math.sin((2 * Math.PI * f * n) / 48000) });
    const r = read(m);
    assert.equal(r.windows, 2);
    nearAll(r.out_rms, [2, 2], 1e-4);
    near(r.send_rms, 0.707107, 1e-4);
    return r;
  };
  const a = run(100);
  nearAll([a.ch_rms[0]!, a.ch_low[0]!, a.ch_mid[0]!, a.ch_high[0]!, a.out_low], [2.828427, 2.52984, 1.136359, 0.123562, 1.788867], 1e-4);
  const b = run(1000);
  nearAll([b.ch_low[0]!, b.ch_mid[0]!, b.ch_high[0]!], [0.555096, 2.23294, 1.106548], 1e-4);
  const c = run(8000);
  nearAll([c.ch_peak[0]!, c.ch_low[0]!, c.ch_mid[0]!, c.ch_high[0]!], [3.464102, 0.074025, 0.645857, 2.400054], 1e-4);
  // どの帯域が最大か
  assert.ok(a.ch_low[0]! > a.ch_mid[0]! && a.ch_mid[0]! > a.ch_high[0]!);
  assert.ok(b.ch_mid[0]! > b.ch_high[0]! && b.ch_mid[0]! > b.ch_low[0]!);
  assert.ok(c.ch_high[0]! > c.ch_mid[0]! && c.ch_mid[0]! > c.ch_low[0]!);
});

tv("TV-MOD-MIX-002-15", () => {
  const m = mk({ ...CH1, window_ms: 10 });
  stepWith(m, { in1: [NaN, 1] });
  for (let n = 0; n < 499; n++) stepWith(m, { in1: 1 });
  m.setParam("mute[1]", 1);
  for (let n = 0; n < 100; n++) stepWith(m, { in1: 1 });
  assert.equal(read(m).windows, 1);
  assert.equal(m.nonfiniteCount, 1);
  m.reset();
  const r = read(m);
  assert.equal(r.windows, 0);
  assert.equal(m.nonfiniteCount, 0);
  for (const k of ["ch_peak", "ch_rms", "ch_low", "ch_mid", "ch_high", "out_peak", "out_rms"]) assert.ok(r[k]!.every((v) => v === 0), k);
  assert.deepEqual([r.out_low, r.out_mid, r.out_high, r.send_peak, r.send_rms], [0, 0, 0, 0, 0]);
  m.setParam("mute[1]", 0);
  m.reset();
  stepWith(m, { in1: 1 });
  near(outs(m)[0], 1, TOL);
  assert.equal(m.param("level[1]"), 1);
});

tv("TV-MOD-MIX-002-16", () => {
  const start = (): Mix2Module => {
    const m = mk({ ...CH1, window_ms: 10 });
    stepWith(m, { in1: 1 });
    m.setParam("mute[1]", 1);
    for (let n = 0; n < 100; n++) stepWith(m, { in1: 1 });
    return m;
  };
  const a = start();
  near(outs(a)[0], 0.65924063, 1e-6);
  // 保存(JSON を経由)→ 新しいインスタンスへ復元
  const saved = JSON.parse(JSON.stringify({ params: a.getParams(), state: a.getState() })) as { params: P; state: Record<string, unknown> };
  const b = new Mix2Module(48000);
  for (const [k, v] of Object.entries(saved.params)) b.setParam(k, v);
  b.setState(saved.state);
  for (let n = 0; n < 500; n++) {
    stepWith(a, { in1: 1 });
    stepWith(b, { in1: 1 });
    if (n === 0) near(outs(b)[0], 0.65649949, 1e-6);
    for (const p of ["L", "R", "SEND"]) assert.ok(Object.is(a.output(p).values[0], b.output(p).values[0]), `n=${n} ${p}`);
    if (n % 100 === 99) assert.deepEqual(b.read(), a.read(), `n=${n}`);
  }
  assert.ok(read(b).windows >= 1);
});

tv("TV-MOD-MIX-002-17", () => {
  const m = mk(CH1, 96000);
  stepWith(m, { in1: 1 });
  m.setParam("mute[1]", 1);
  for (let n = 0; n < 480; n++) stepWith(m, { in1: 1 });
  near(outs(m)[0], 0.36787944, 1e-6);
});
