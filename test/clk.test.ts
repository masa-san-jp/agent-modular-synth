// MOD-CLK-001 の検証例(specifications/modules/MOD-CLK-001.md §10)。
import assert from "node:assert/strict";
import { ClkModule } from "../src/modules/clk.js";
import { near, stepWith, tv } from "./helpers.js";

const FS = 48000;
type P = { bpm?: number; ppqn?: number; swing?: number; duty?: number; run?: number };
type Sig = number | readonly number[] | null;
type Ins = { reset?: (n: number) => Sig; run?: (n: number) => Sig; bpm_cv?: (n: number) => Sig };

function mk(p: P = {}, fs = FS): ClkModule {
  const m = new ClkModule(fs);
  for (const [k, v] of Object.entries(p)) m.setParam(k, v as number);
  return m;
}

interface Run {
  clock: number[];
  gate: number[];
}

/** n0〜n0+steps-1 を進める。pre はそのステップの直前に呼ぶ。添字は n − n0。 */
function run(m: ClkModule, steps: number, ins: Ins = {}, n0 = 0, pre?: (n: number) => void): Run {
  const clock: number[] = [];
  const gate: number[] = [];
  const co = m.output("clock");
  const go = m.output("gate");
  for (let i = 0; i < steps; i++) {
    const n = n0 + i;
    if (pre) pre(n);
    const s: Record<string, Sig> = {};
    if (ins.reset) s.reset = ins.reset(n);
    if (ins.run) s.run = ins.run(n);
    if (ins.bpm_cv) s.bpm_cv = ins.bpm_cv(n);
    stepWith(m, s);
    assert.equal(co.channels, 1);
    assert.equal(go.channels, 1);
    const c = co.values[0]!;
    const g = go.values[0]!;
    assert.ok(c === 0 || c === 10, `clock[${n}] = ${c}`);
    assert.ok(g === 0 || g === 10, `gate[${n}] = ${g}`);
    clock.push(c);
    gate.push(g);
  }
  return { clock, gate };
}

/** 立ち上がり位置(0→10 V。先頭が 10 V なら n0 も立ち上がり)と各パルスの幅(終端で切れる場合はそこまで)。 */
function edges(ys: readonly number[], n0 = 0): { rises: number[]; widths: number[] } {
  const rises: number[] = [];
  const widths: number[] = [];
  let prev = 0;
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i]!;
    if (y !== 0 && prev === 0) {
      rises.push(n0 + i);
      widths.push(0);
    }
    if (y !== 0) widths[widths.length - 1]!++;
    prev = y;
  }
  return { rises, widths };
}

function checkRises(ys: readonly number[], want: readonly number[], width?: number, msg = "clock", n0 = 0): void {
  const e = edges(ys, n0);
  assert.deepEqual(e.rises, want, `${msg} の立ち上がり`);
  if (width !== undefined) assert.deepEqual(e.widths, want.map(() => width), `${msg} の幅`);
}

const pulse = (a: number, b: number) => (n: number): number => (n >= a && n <= b ? 10 : 0);

tv("TV-MOD-CLK-001-01", () => {
  const r = run(mk(), 100000);
  checkRises(r.clock, [0, 24000, 48000, 72000, 96000], 48);
  const g = edges(r.gate);
  assert.deepEqual(g.rises, [0, 24000, 48000, 72000, 96000]);
  assert.deepEqual(g.widths, [12000, 12000, 12000, 12000, 4000]);
});

tv("TV-MOD-CLK-001-02", () => {
  const r = run(mk({ ppqn: 4 }), 30000);
  checkRises(r.clock, [0, 6000, 12000, 18000, 24000], 48);
});

tv("TV-MOD-CLK-001-03", () => {
  const r = run(mk({ bpm: 127, ppqn: 4 }), 30000);
  checkRises(r.clock, [0, 5670, 11339, 17008, 22678, 28347], 48);
});

tv("TV-MOD-CLK-001-04", () => {
  const r = run(mk({ bpm: 120, ppqn: 4, swing: 0.25 }), 40000);
  checkRises(r.clock, [0, 7500, 12000, 19500, 24000, 31500, 36000]);
});

tv("TV-MOD-CLK-001-05", () => {
  const r = run(mk({}, 44100), 120000);
  checkRises(r.clock, [0, 22050, 44100, 66150, 88200, 110250], 44);
});

tv("TV-MOD-CLK-001-06", () => {
  // (a)
  checkRises(run(mk({ bpm: 10 }), 200000).clock, [0, 144000]);
  // (b)
  checkRises(run(mk({ bpm: 5000, ppqn: 96 }), 200).clock, [0, 30, 60, 90, 120, 150, 180], 15);
  // (c)
  const want: number[] = [];
  for (let n = 0; n <= 28; n += 2) want.push(n);
  checkRises(run(mk({ bpm: 1000, ppqn: 96 }, 1000), 30).clock, want, 1);
});

tv("TV-MOD-CLK-001-07", () => {
  checkRises(run(mk(), 30000, { bpm_cv: () => 1 }).clock, [0, 12000, 24000]);
  checkRises(run(mk(), 60000, { bpm_cv: () => -1 }).clock, [0, 48000]);
});

tv("TV-MOD-CLK-001-08", () => {
  const r = run(mk({ bpm: 120, ppqn: 4, swing: 0.9 }), 40000);
  checkRises(r.clock, [0, 9000, 12000, 21000, 24000, 33000, 36000]);
  const r2 = run(mk({ bpm: 120, ppqn: 4, swing: 0.5, duty: 0.99 }), 40000);
  checkRises(r2.gate, [0, 9000, 21000, 33000], undefined, "gate");
});

tv("TV-MOD-CLK-001-09", () => {
  // (a)
  {
    const m = mk();
    checkRises(run(m, 30000, { bpm_cv: () => NaN }).clock, [0, 24000], undefined, "(a)");
    assert.equal(m.nonfiniteCount, 30000, "(a) nonfinite_count");
  }
  // (b)
  checkRises(run(mk({ ppqn: 0 }), 30000).clock, [0, 24000], undefined, "(b)");
  // (c)
  checkRises(run(mk({ ppqn: 2.6 }), 30000).clock, [0, 8000, 16000, 24000], undefined, "(c)");
  // (d)
  {
    const g = edges(run(mk({ duty: 0 }), 30000).gate);
    assert.deepEqual(g.rises, [0, 24000], "(d)");
    assert.deepEqual(g.widths, [240, 240], "(d) gate の幅");
  }
  // (e)
  {
    const m = mk();
    checkRises(run(m, 30000, { reset: () => NaN }).clock, [0, 24000], undefined, "(e)");
    assert.equal(m.nonfiniteCount, 30000, "(e) nonfinite_count");
  }
  // (f)
  for (const bpm of [NaN, Infinity]) {
    const m = mk({ bpm });
    checkRises(run(m, 30000).clock, [0, 24000], undefined, `(f) bpm=${bpm}`);
    assert.equal(m.nonfiniteCount, 0, "(f) nonfinite_count");
  }
  // (g)
  {
    const g = edges(run(mk({ duty: NaN }), 30000).gate);
    assert.equal(g.rises[0], 0, "(g)");
    assert.equal(g.widths[0], 12000, "(g) gate の最初の幅");
  }
  // (h)
  checkRises(run(mk({ run: NaN }), 30000).clock, [0, 24000], undefined, "(h)");
  // (i)
  checkRises(run(mk({ ppqn: NaN }), 30000).clock, [0, 24000], undefined, "(i) ppqn");
  checkRises(run(mk({ swing: NaN }), 30000).clock, [0, 24000], undefined, "(i) swing");
  // (j)
  checkRises(run(mk({ ppqn: 2.5 }), 30000).clock, [0, 8000, 16000, 24000], undefined, "(j)");
});

tv("TV-MOD-CLK-001-10", () => {
  // (a)
  {
    const r = run(mk(), 5000, { run: () => 0 });
    assert.ok(r.clock.every((v) => v === 0) && r.gate.every((v) => v === 0), "(a)");
  }
  // (b)
  {
    const r = run(mk(), 50000, { run: (n) => (n < 1000 ? 0 : 10) });
    for (let n = 0; n < 1000; n++) assert.ok(r.clock[n] === 0 && r.gate[n] === 0, `(b) n=${n}`);
    checkRises(r.clock, [1000, 25000, 49000], undefined, "(b)");
  }
  // (c)
  {
    const r = run(mk(), 50000, { run: (n) => (n < 30000 ? 10 : 0) });
    checkRises(r.clock, [0, 24000], undefined, "(c)");
    assert.equal(r.gate[29999], 10, "(c) gate[29999]");
    for (let n = 30000; n < 50000; n++) assert.ok(r.clock[n] === 0 && r.gate[n] === 0, `(c) n=${n}`);
  }
});

tv("TV-MOD-CLK-001-11", () => {
  const rst = pulse(10000, 10009);
  checkRises(run(mk(), 60000, { reset: rst }).clock, [0, 10000, 34000, 58000], 48, "(a)");
  checkRises(
    run(mk({ ppqn: 4, swing: 0.25 }), 60000, { reset: rst }).clock.slice(0, 34001),
    [0, 7500, 10000, 17500, 22000, 29500, 34000],
    undefined,
    "(b)",
  );
  const c = edges(run(mk(), 300, { reset: pulse(20, 29) }).clock);
  assert.deepEqual(c.rises, [0], "(c)");
  assert.deepEqual(c.widths, [68], "(c)");
});

tv("TV-MOD-CLK-001-12", () => {
  const m = mk();
  run(m, 30000);
  m.reset();
  const r = run(m, 100);
  for (let n = 0; n < 100; n++) {
    assert.equal(r.clock[n], n < 48 ? 10 : 0, `clock[${n}]`);
    assert.equal(r.gate[n], 10, `gate[${n}]`);
  }
  assert.equal(m.param("bpm"), 120);
});

function restore(a: ClkModule): ClkModule {
  const saved = JSON.parse(JSON.stringify({ params: a.getParams(), state: a.getState() })) as {
    params: Record<string, number>;
    state: Record<string, unknown>;
  };
  const b = new ClkModule(FS);
  for (const [k, v] of Object.entries(saved.params)) b.setParam(k, v);
  b.setState(saved.state);
  return b;
}

function bitEqual(a: Run, b: Run): void {
  assert.equal(a.clock.length, b.clock.length);
  for (let i = 0; i < a.clock.length; i++) {
    assert.ok(Object.is(a.clock[i], b.clock[i]), `clock[${i}]`);
    assert.ok(Object.is(a.gate[i], b.gate[i]), `gate[${i}]`);
  }
}

tv("TV-MOD-CLK-001-13", () => {
  const a = mk({ bpm: 127, ppqn: 4, swing: 0.25, duty: 0.3 });
  const ins: Ins = { reset: pulse(40000, 40009) };
  run(a, 15000, ins);
  const st = a.getState();
  near(st.phase as number, 0.6458333333, 1e-9, 0, "phase");
  assert.equal(st.k, 3);
  assert.equal(st.pending, 0);
  assert.equal(st.pulse, 0);
  const b = restore(a);
  const ra = run(a, 85000, ins, 15000);
  const rb = run(b, 85000, ins, 15000);
  bitEqual(ra, rb);
  const want = [18425, 22678, 29764, 34016, 40000, 47087];
  assert.deepEqual(edges(ra.clock, 15000).rises.slice(0, want.length), want);
});

tv("TV-MOD-CLK-001-14", () => {
  // (a)
  {
    const r = run(mk(), 100000, { run: (n) => (n >= 30000 && n < 40000 ? 0 : 10) });
    checkRises(r.clock, [0, 24000, 58000, 82000], 48, "(a) clock");
    for (let n = 30000; n < 40000; n++) assert.ok(r.clock[n] === 0 && r.gate[n] === 0, `(a) n=${n}`);
    const g = edges(r.gate);
    assert.deepEqual(g.rises, [0, 24000, 58000, 82000], "(a) gate");
    assert.deepEqual(g.widths, [12000, 6000, 12000, 12000], "(a) gate の幅");
    assert.equal(r.gate[29999], 10);
    assert.equal(r.gate[30000], 0);
  }
  // (b)
  {
    const m = mk();
    const r = run(m, 60000, {}, 0, (n) => {
      if (n === 20) m.setParam("run", 0);
      if (n === 100) m.setParam("run", 1);
    });
    const c = edges(r.clock);
    assert.deepEqual(c.rises, [0, 24080, 48080], "(b) clock");
    assert.deepEqual(c.widths, [20, 48, 48], "(b) clock の幅");
    const g = edges(r.gate);
    assert.deepEqual(g.rises, [0, 24080, 48080], "(b) gate");
    assert.equal(g.widths[0], 20, "(b) gate の最初の幅");
  }
  // (c)
  {
    const m = mk({ ppqn: 4, swing: 0.25 });
    const runIn = (n: number): number => (n >= 6500 && n <= 7499 ? 0 : 10);
    run(m, 6500, { run: runIn });
    const st = m.getState();
    assert.equal(st.k, 2, "(c) k");
    assert.equal(st.pending, 1001, "(c) pending");
    const m2 = mk({ ppqn: 4, swing: 0.25 });
    checkRises(run(m2, 40000, { run: runIn }).clock, [0, 8500, 13000, 20500, 25000, 32500, 37000], undefined, "(c)");
  }
  // (d)
  checkRises(
    run(mk(), 60000, { run: (n) => (n >= 24000 && n <= 24099 ? 0 : 10) }).clock,
    [0, 24100, 48100],
    undefined,
    "(d)",
  );
});

tv("TV-MOD-CLK-001-15", () => {
  const runIn = (n: number): number => (n >= 30000 && n < 40000 ? 0 : 10);
  const want = [0, 24000, 40000, 64000, 88000];
  // (a)
  {
    const m = mk();
    const ins: Ins = { run: runIn, reset: pulse(35000, 35009) };
    const r1 = run(m, 36000, ins);
    const st = m.getState();
    assert.equal(st.phase, 1.0, "(a) phase");
    assert.equal(st.k, 0, "(a) k");
    assert.equal(st.pending, 0, "(a) pending");
    const r2 = run(m, 64000, ins, 36000);
    const clock = r1.clock.concat(r2.clock);
    const gate = r1.gate.concat(r2.gate);
    checkRises(clock, want, undefined, "(a)");
    for (let n = 30000; n < 40000; n++) assert.ok(clock[n] === 0 && gate[n] === 0, `(a) n=${n}`);
  }
  // (b)
  checkRises(run(mk(), 100000, { run: runIn, reset: pulse(40000, 40009) }).clock, want, undefined, "(b)");
  // (c)
  checkRises(
    run(mk(), 50000, { run: (n) => (n < 1000 ? 0 : 10), reset: pulse(500, 509) }).clock,
    [1000, 25000, 49000],
    undefined,
    "(c)",
  );
});

tv("TV-MOD-CLK-001-16", () => {
  const a = mk({ bpm: 127, ppqn: 4, swing: 0.25, duty: 0.3 });
  const ins: Ins = { run: (n) => (n >= 20000 && n < 26000 ? 0 : 10), reset: pulse(40000, 40009) };
  const pre = run(a, 23000, ins);
  checkRises(pre.clock, [0, 7087, 11339, 18425], undefined, "保存前");
  const st = a.getState();
  near(st.phase as number, 0.5277777778, 1e-9, 0, "phase");
  assert.equal(st.k, 4);
  assert.equal(st.pending, 0);
  assert.equal(st.pulse, 0);
  assert.equal(st.gate_rem, 0);
  assert.equal(st.us, 0);
  const b = restore(a);
  const ra = run(a, 37000, ins, 23000);
  const rb = run(b, 37000, ins, 23000);
  bitEqual(ra, rb);
  checkRises(ra.clock, [28678, 35764, 40000, 47087, 51339, 58425], undefined, "保存後", 23000);
});

tv("TV-MOD-CLK-001-17", () => {
  // (a)
  {
    const m = mk();
    const r = run(m, 60000, {
      bpm_cv: () => [0, 1, -1],
      run: () => [10, 0],
      reset: (n) => [0, n >= 10000 && n <= 10009 ? 10 : 0],
    });
    const mono = run(mk(), 60000);
    bitEqual(r, mono);
    checkRises(r.clock, [0, 24000, 48000], undefined, "(a)");
    assert.equal(m.nonfiniteCount, 0, "(a) nonfinite_count");
  }
  // (b)
  {
    const runIn = (n: number): number => (n >= 30000 && n <= 39999 ? 0 : 10);
    const m = mk();
    const r = run(m, 60000, { bpm_cv: () => [1, 0, NaN], run: (n) => [runIn(n), 10] });
    const mono = run(mk(), 60000, { bpm_cv: () => 1, run: runIn });
    bitEqual(r, mono);
    checkRises(r.clock, [0, 12000, 24000, 46000, 58000], undefined, "(b)");
    assert.equal(m.nonfiniteCount, 0, "(b) nonfinite_count");
  }
});
