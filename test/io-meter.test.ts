// MOD-IO-003 の検証例(specifications/modules/MOD-IO-003.md §10、仕様 v0.2)。
import assert from "node:assert/strict";
import { IoMeterModule } from "../src/modules/io-meter.js";
import { near, nearAll, outVals, stepWith, tv } from "./helpers.js";

type Read = Record<string, number | number[]>;

/** 「生成時」のパラメータで作る。 */
function mk(params: Record<string, number> = {}, fs = 48000): IoMeterModule {
  const m = new IoMeterModule(fs);
  for (const [k, v] of Object.entries(params)) m.setParam(k, v);
  m.reset();
  return m;
}

/** モノの入力列を与え、各サンプルの直後の読出し値と THRU(全チャンネル)を返す。 */
function feed(m: IoMeterModule, xs: readonly (number | readonly number[] | null)[]): { rd: Read[]; thru: number[][] } {
  const rd: Read[] = [];
  const thru: number[][] = [];
  for (const x of xs) {
    stepWith(m, { IN: x });
    rd.push(m.read());
    thru.push(outVals(m, "THRU"));
  }
  return { rd, thru };
}

/** 数値の読出し値(絶対1e-6)。カウンタは完全一致。 */
function chk(r: Read, exp: Record<string, number>, msg = ""): void {
  for (const [k, e] of Object.entries(exp)) {
    const a = r[k] as number;
    if (k === "windows" || k === "frame_seq" || k === "nonfinite_count") assert.equal(a, e, `${msg} ${k}`);
    else near(a, e, 1e-6, 0, `${msg} ${k}`);
  }
}
function frame(r: Read, exp: readonly number[], msg = ""): void {
  const f = r.frame as number[];
  assert.equal(f.length, exp.length, `${msg} frame の長さ`);
  nearAll(f, exp, 1e-6, 0, `${msg} frame`);
}
const seq = (n: number, f: (i: number) => number): number[] => Array.from({ length: n }, (_, i) => f(i));
const ZERO5 = { peak: 0, rms: 0, mean: 0, vmin: 0, vmax: 0 };

tv("TV-MOD-IO-003-01", () => {
  const xs = seq(96, (n) => 3 * Math.sin((2 * Math.PI * 1000 * n) / 48000));
  const { rd, thru } = feed(mk({ window_ms: 1, capture_len: 16, trig_mode: 1 }), xs);
  chk(rd[46]!, { ...ZERO5, windows: 0, peak_hold: 3.0 }, "n=46");
  const w = { peak: 3.0, rms: 2.1213203436, mean: 0, vmin: -3.0, vmax: 3.0 };
  chk(rd[47]!, { ...w, windows: 1 }, "n=47");
  chk(rd[95]!, { ...w, windows: 2 }, "n=95");
  xs.forEach((x, n) => assert.deepEqual(thru[n], [Math.fround(x)], `THRU[${n}]`));
});

tv("TV-MOD-IO-003-02", () => {
  const p = { window_ms: 1, capture_len: 16 };
  const a = feed(mk(p), seq(48, () => 2.0)).rd;
  chk(a[47]!, { peak: 2, rms: 2, mean: 2, vmin: 2, vmax: 2, windows: 1 }, "(a)");
  const b = feed(mk(p), seq(96, (n) => (n < 48 ? 2.0 : -3.0))).rd;
  chk(b[95]!, { peak: 3, rms: 3, mean: -3, vmin: -3, vmax: -3, windows: 2, peak_hold: 3 }, "(b)");
});

const X03 = [0, 0.2, 0.4, 0.6, 0.8, 1.0, 0.9, 0.7, 0.5, 0.3, 0.1, 0.2, 0.4, 0.6, 0.8, 0.9];

tv("TV-MOD-IO-003-03", () => {
  const { rd } = feed(mk({ window_ms: 100, capture_len: 8, trig_mode: 1, trig_level: 0.5, pre: 2 }), X03);
  for (let n = 0; n <= 7; n++) assert.equal(rd[n]!.frame_seq, 0, `n=${n}`);
  for (let n = 8; n <= 15; n++) {
    assert.equal(rd[n]!.frame_seq, 1, `n=${n}`);
    frame(rd[n]!, [0.2, 0.4, 0.6, 0.8, 1.0, 0.9, 0.7, 0.5], `n=${n}`);
  }
  near((rd[8]!.frame as number[])[2]!, 0.6);
});

tv("TV-MOD-IO-003-04", () => {
  const { rd } = feed(mk({ window_ms: 100, capture_len: 8, trig_mode: 2, trig_level: 0.5, pre: 2 }), X03);
  for (let n = 0; n <= 13; n++) assert.equal(rd[n]!.frame_seq, 0, `n=${n}`);
  for (let n = 14; n <= 15; n++) {
    assert.equal(rd[n]!.frame_seq, 1, `n=${n}`);
    frame(rd[n]!, [0.7, 0.5, 0.3, 0.1, 0.2, 0.4, 0.6, 0.8], `n=${n}`);
  }
  near((rd[14]!.frame as number[])[2]!, 0.3);
});

tv("TV-MOD-IO-003-05", () => {
  const { rd } = feed(
    mk({ capture_len: 4, trig_mode: 0 }),
    seq(10, (n) => n + 1),
  );
  assert.equal(rd[2]!.frame_seq, 0);
  frame(rd[3]!, [1, 2, 3, 4]);
  assert.equal(rd[3]!.frame_seq, 1);
  assert.equal(rd[6]!.frame_seq, 1);
  frame(rd[7]!, [5, 6, 7, 8]);
  assert.equal(rd[7]!.frame_seq, 2);
  frame(rd[9]!, [5, 6, 7, 8]);
  assert.equal(rd[9]!.frame_seq, 2);
});

tv("TV-MOD-IO-003-06", () => {
  const base = { capture_len: 4, trig_mode: 1, trig_level: 0.5 };
  /** 完了サンプル doneAt より前は frame_seq=0、以後は1で frame が一致。 */
  const one = (p: Record<string, number>, xs: number[], doneAt: number, fr: number[], msg: string): void => {
    const { rd } = feed(mk(p), xs);
    rd.forEach((r, n) => {
      assert.equal(r.frame_seq, n < doneAt ? 0 : 1, `${msg} n=${n} frame_seq`);
      if (n >= doneAt) frame(r, fr, `${msg} n=${n}`);
    });
  };
  one({ ...base, pre: 0 }, [0, 0, 0, 1, 2, 3, 4, 5, 6], 6, [1, 2, 3, 4], "(a)");
  one({ ...base, pre: 10 }, [0, 0, 0, 1, 2, 3, 4, 5], 3, [0, 0, 0, 1], "(b)");
  // (c) n=2 で完了。n=3 以降は再発火しない(prev<0.5 が成立しない)
  one({ ...base, pre: 1 }, [1, 2, 3, 4, 5], 2, [0, 1, 2, 3], "(c)");
  one({ ...base, capture_len: 6, pre: 1 }, [0, 1, 0, 1, 0, 1, 0, 0, 0, 0], 5, [0, 1, 0, 1, 0, 1], "(d)");
});

tv("TV-MOD-IO-003-07", () => {
  const { rd } = feed(
    mk({ window_ms: 1, capture_len: 4 }, 44100),
    seq(50, () => 1.0),
  );
  assert.equal(rd[42]!.windows, 0);
  chk(rd[43]!, { windows: 1, peak: 1, rms: 1 });
});

tv("TV-MOD-IO-003-08", () => {
  const xs = seq(48, () => 1.0);
  xs[40] = NaN;
  xs[41] = Infinity;
  xs[42] = -Infinity;
  const m = mk({ window_ms: 1, capture_len: 4, trig_mode: 1, trig_level: 0 });
  const { rd, thru } = feed(m, xs);
  for (const n of [40, 41, 42]) assert.deepEqual(thru[n], [0]);
  assert.deepEqual(thru[39], [1]);
  assert.deepEqual(thru[43], [1]);
  chk(rd[47]!, {
    nonfinite_count: 3,
    peak: 1.0,
    rms: 0.9682458366,
    mean: 0.9375,
    vmin: 0,
    vmax: 1.0,
    windows: 1,
    frame_seq: 0,
  });
  frame(rd[47]!, [0, 0, 0, 0]);
  assert.equal(m.nonfiniteCount, 3);
});

tv("TV-MOD-IO-003-09", () => {
  for (const tl of [0.5, -0.5]) {
    const m = mk({ window_ms: 1, capture_len: 4, trig_mode: 1, trig_level: tl });
    const { rd, thru } = feed(
      m,
      seq(96, () => null as unknown as number),
    );
    thru.forEach((t) => assert.deepEqual(t, [0]));
    chk(rd[95]!, { windows: 2, ...ZERO5, peak_hold: 0, nonfinite_count: 0, frame_seq: 0 }, `tl=${tl}`);
    frame(rd[95]!, [0, 0, 0, 0]);
    assert.equal(m.nonfiniteCount, 0);
  }
});

tv("TV-MOD-IO-003-10", () => {
  const p = { window_ms: 1, capture_len: 4, trig_mode: 0 };
  const m = mk(p);
  const { rd } = feed(
    m,
    seq(60, () => 2.0),
  );
  chk(rd[59]!, { windows: 1, peak: 2, rms: 2, mean: 2, frame_seq: 15, peak_hold: 2 }, "reset前");
  const before = m.getParams();
  m.reset();
  const r = feed(m, [2.0]).rd[0]!;
  chk(r, { windows: 0, ...ZERO5, peak_hold: 2.0, nonfinite_count: 0, frame_seq: 0 }, "reset直後");
  frame(r, [0, 0, 0, 0]);
  assert.deepEqual(m.getParams(), before);
});

tv("TV-MOD-IO-003-11", () => {
  const m = mk({ window_ms: 1000, capture_len: 4, trig_mode: 1 });
  for (let n = 0; n < 47999; n++) stepWith(m, { IN: 0.5 });
  assert.equal(m.read().windows, 0);
  stepWith(m, { IN: 0.5 });
  chk(m.read(), { windows: 1, peak: 0.5, rms: 0.5, mean: 0.5 });
});

tv("TV-MOD-IO-003-12", () => {
  const p = { window_ms: 2, capture_len: 32, trig_mode: 1, trig_level: 0.5, pre: 5 };
  const xs = seq(2000, (n) => 3 * Math.sin((2 * Math.PI * 997 * n) / 48000) + 0.1 * Math.cos(n));
  const a = mk(p);
  feed(a, xs.slice(0, 777));
  const snap = JSON.parse(JSON.stringify(a.getState())) as Record<string, unknown>;
  const b = mk(p);
  b.setState(snap);
  for (let n = 777; n < 2000; n++) {
    stepWith(a, { IN: xs[n]! });
    stepWith(b, { IN: xs[n]! });
    assert.ok(Object.is(a.output("THRU").values[0], b.output("THRU").values[0]), `THRU[${n}]`);
    const ra = a.read();
    const rb = b.read();
    assert.deepEqual(Object.keys(rb), Object.keys(ra));
    for (const k of Object.keys(ra)) {
      const x = ra[k]!;
      const y = rb[k]!;
      if (Array.isArray(x)) {
        assert.equal((y as number[]).length, x.length);
        x.forEach((v, i) => assert.ok(Object.is(v, (y as number[])[i]), `${k}[${i}] n=${n}`));
      } else assert.ok(Object.is(x, y), `${k} n=${n}: ${x} / ${String(y)}`);
    }
  }
  for (const m of [a, b]) {
    const r = m.read();
    chk(r, {
      windows: 20,
      frame_seq: 41,
      peak: 3.0929368214,
      rms: 2.1233103635,
      mean: 0.005430641,
      vmin: -3.083342814,
      vmax: 3.0929368214,
      peak_hold: 3.0935907455,
    });
    nearAll(r.frame as number[], [-0.969632, -0.66728, -0.373756], 1e-6);
  }
});

tv("TV-MOD-IO-003-13", () => {
  // (a)
  const a = mk({ capture_len: 7.5, trig_mode: 0 });
  const ra = feed(
    a,
    seq(8, (n) => n + 1),
  ).rd;
  assert.equal(ra[6]!.frame_seq, 0);
  frame(ra[7]!, [1, 2, 3, 4, 5, 6, 7, 8], "(a)");
  chk(ra[7]!, { frame_seq: 1, nonfinite_count: 0 }, "(a)");
  // (b)
  const rb = feed(
    mk({ capture_len: 3.4, trig_mode: 0 }),
    seq(4, (n) => n + 1),
  ).rd;
  frame(rb[3]!, [1, 2, 3, 4], "(b)");
  chk(rb[3]!, { frame_seq: 1, nonfinite_count: 0 }, "(b)");
  // (c)
  const c = mk({ window_ms: NaN, capture_len: NaN });
  for (let n = 0; n < 4799; n++) stepWith(c, { IN: 1.0 });
  assert.equal(c.read().windows, 0);
  stepWith(c, { IN: 1.0 });
  chk(c.read(), { windows: 1, peak: 1, rms: 1, mean: 1, nonfinite_count: 0 }, "(c)");
  assert.equal((c.read().frame as number[]).length, 512);
  assert.equal(c.nonfiniteCount, 0);
  // (d)
  const rd = feed(
    mk({ trig_mode: NaN, trig_level: 0.5, pre: NaN, capture_len: 4 }),
    [0, 0, 0, 1, 2, 3, 4, 5, 6],
  ).rd;
  rd.forEach((r, n) => assert.equal(r.frame_seq, n < 6 ? 0 : 1, `(d) n=${n}`));
  frame(rd[6]!, [1, 2, 3, 4], "(d)");
  assert.equal(rd[8]!.nonfinite_count, 0);
  // (e)
  const re = feed(mk({ pre: 1.5, trig_mode: 1, trig_level: 0.5, capture_len: 4 }), [0, 0, 0, 1, 2, 3]).rd;
  re.forEach((r, n) => assert.equal(r.frame_seq, n < 4 ? 0 : 1, `(e) n=${n}`));
  frame(re[4]!, [0, 0, 1, 2], "(e)");
  near((re[4]!.frame as number[])[2]!, 1);
  assert.equal(re[5]!.nonfinite_count, 0);
});

tv("TV-MOD-IO-003-14", () => {
  const base = { window_ms: 1, capture_len: 4, trig_mode: 1, trig_level: 0.5, pre: 0 };
  const in0 = seq(96, () => 1.0);
  const in1 = seq(96, (n) => (n === 10 ? NaN : n < 48 ? 2.0 : -3.0));
  const in2 = seq(96, (n) => (n === 20 || n === 21 ? Infinity : 0.5 * ((n % 4) - 1.5)));
  const poly = seq(96, (n) => [in0[n]!, in1[n]!, in2[n]!] as unknown as number) as unknown as number[][];
  const runPoly = (channel: number): { rd: Read[]; m: IoMeterModule } => {
    const m = mk({ ...base, channel });
    const { rd, thru } = feed(m, poly);
    thru.forEach((t, n) => {
      const e = [1.0, n === 10 ? 0 : in1[n]!, n === 20 || n === 21 ? 0 : in2[n]!];
      assert.deepEqual(t, e, `channel=${channel} THRU[n=${n}]`);
    });
    assert.equal(m.nonfiniteCount, 3, `channel=${channel} 置換カウンタ`);
    return { rd, m };
  };
  const mono = (xs: number[]): Read[] => feed(mk(base), xs).rd;

  // (a)
  const a = runPoly(1).rd;
  const a47 = { peak: 1, rms: 1, mean: 1, vmin: 1, vmax: 1, frame_seq: 1, nonfinite_count: 0 };
  chk(a[47]!, { ...a47, windows: 1 }, "(a) n=47");
  frame(a[47]!, [1, 1, 1, 1], "(a) n=47");
  chk(a[95]!, { ...a47, windows: 2 }, "(a) n=95");
  frame(a[95]!, [1, 1, 1, 1], "(a) n=95");
  // (b)
  const b = runPoly(2).rd;
  chk(
    b[47]!,
    {
      level: 2.0,
      peak: 2.0,
      rms: 1.9790570145,
      mean: 1.9583333333,
      vmin: 0,
      vmax: 2.0,
      windows: 1,
      frame_seq: 2,
      nonfinite_count: 1,
    },
    "(b) n=47",
  );
  chk(
    b[95]!,
    { level: -3, peak: 3, rms: 3, mean: -3, vmin: -3, vmax: -3, windows: 2, peak_hold: 3, frame_seq: 2, nonfinite_count: 1 },
    "(b) n=95",
  );
  frame(b[95]!, [2, 2, 2, 2], "(b) n=95");
  assert.deepEqual(b, mono(in1), "(b) モノと一致");
  // (c)
  const c = runPoly(3).rd;
  const chkC = (r: Read[], msg: string): void => {
    chk(
      r[47]!,
      { peak: 0.75, rms: 0.5472468974, mean: 0.0208333333, vmin: -0.75, vmax: 0.75, windows: 1, frame_seq: 11, nonfinite_count: 2 },
      `${msg} n=47`,
    );
    chk(r[95]!, { rms: 0.5590169944, mean: 0, windows: 2, frame_seq: 23, nonfinite_count: 2 }, `${msg} n=95`);
    frame(r[95]!, [0.75, -0.75, -0.25, 0.25], `${msg} n=95`);
  };
  chkC(c, "(c)");
  assert.deepEqual(c, mono(in2), "(c) モノと一致");
  // (d)
  const d = runPoly(5).rd;
  chk(d[95]!, { ...ZERO5, peak_hold: 0, windows: 2, frame_seq: 0, nonfinite_count: 0 }, "(d)");
  frame(d[95]!, [0, 0, 0, 0], "(d)");
  // (e)
  const e = runPoly(2.5).rd;
  chkC(e, "(e)");
  assert.deepEqual(e, c, "(e) は (c) と同じ");
  // (f)
  const f = mk({ ...base, trig_mode: 0, channel: 1 });
  const rf: Read[] = [];
  for (let n = 0; n < 96; n++) {
    if (n === 24) f.setParam("channel", 2);
    stepWith(f, { IN: [1.0, 2.0] });
    assert.deepEqual(outVals(f, "THRU"), [1, 2]);
    rf.push(f.read());
  }
  chk(rf[23]!, { level: 1.0, frame_seq: 6 }, "(f) n=23");
  frame(rf[23]!, [1, 1, 1, 1], "(f) n=23");
  chk(rf[24]!, { level: 2.0 }, "(f) n=24");
  chk(rf[27]!, { frame_seq: 7 }, "(f) n=27");
  frame(rf[27]!, [2, 2, 2, 2], "(f) n=27");
  chk(rf[47]!, { peak: 2.0, rms: 1.5811388301, mean: 1.5, vmin: 1.0, vmax: 2.0, windows: 1 }, "(f) n=47");
  chk(rf[95]!, { peak: 2, rms: 2, mean: 2, vmin: 2, vmax: 2, windows: 2, peak_hold: 2 }, "(f) n=95");
});
