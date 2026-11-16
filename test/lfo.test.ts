// MOD-LFO-001 の検証例(specifications/modules/MOD-LFO-001.md §10)。
import assert from "node:assert/strict";
import { LfoModule } from "../src/modules/lfo.js";
import { InSpec, near, nearAll, stepWith, tv } from "./helpers.js";

const FS = 48000;
const TOL = 1e-5;
const OUTS = ["saw", "saw_inv", "tri", "sine", "square"] as const;
type P = { freq?: number; cv_amt?: number; depth?: number };
type Sig = number | readonly number[] | null;

function mk(p: P = {}): LfoModule {
  const m = new LfoModule(FS);
  for (const [k, v] of Object.entries(p)) m.setParam(k, v as number);
  return m;
}

/** rec[n][c] = [saw, saw_inv, tri, sine, square] */
type Rec = number[][][];

function run(m: LfoModule, steps: number, ins: (n: number) => InSpec = () => ({}), wantCh?: number): Rec {
  const rec: Rec = [];
  for (let n = 0; n < steps; n++) {
    stepWith(m, ins(n));
    const ch = m.output("saw").channels;
    if (wantCh !== undefined) assert.equal(ch, wantCh, "出力チャンネル数");
    const row: number[][] = [];
    for (let c = 0; c < ch; c++) {
      row.push(
        OUTS.map((o) => {
          const p = m.output(o);
          assert.equal(p.channels, ch, `${o} のチャンネル数`);
          const v = p.values[c]!;
          assert.ok(Number.isFinite(v), `${o}[${c}][${n}] が非有限`);
          return v;
        }),
      );
    }
    rec.push(row);
  }
  return rec;
}

function col(rec: Rec, out: (typeof OUTS)[number], c = 0): number[] {
  const i = OUTS.indexOf(out);
  return rec.map((r) => r[c]![i]!);
}

const S2 = 2.828427; // 4·sin(π/4)
const TV01: Record<number, number[]> = {
  0: [0, 0, 0, 0, 4],
  1: [0.5, -0.5, 1, 1.530734, 4],
  2: [1, -1, 2, S2, 4],
  3: [1.5, -1.5, 3, 3.695518, 4],
  4: [2, -2, 4, 4, 4],
  6: [3, -3, 2, S2, 4],
  8: [-4, 4, 0, 0, -4],
  12: [-2, 2, -4, -4, -4],
  16: [0, 0, 0, 0, 4],
};

function checkTv01(rec: Rec, ns: readonly number[], msg = ""): void {
  for (const n of ns) nearAll(rec[n]![0]!, TV01[n]!, TOL, 0, `${msg}n=${n}`);
}

tv("TV-MOD-LFO-001-01", () => {
  const rec = run(mk({ freq: 3000, cv_amt: 1, depth: 1 }), 17, () => ({}), 1);
  checkTv01(rec, [0, 2, 4, 6, 8, 12, 16]);
});

tv("TV-MOD-LFO-001-02", () => {
  const a = run(mk({ freq: 1500, cv_amt: 1 }), 5, () => ({ rate: 1 }));
  nearAll(a[4]![0]!, TV01[4]!, TOL, 0, "(a)");
  const b = run(mk({ freq: 1500, cv_amt: 0.5 }), 5, () => ({ rate: 2 }));
  nearAll(b[4]![0]!, TV01[4]!, TOL, 0, "(b)");
});

tv("TV-MOD-LFO-001-03", () => {
  const rec = run(mk({ freq: 3000 }), 10, (n) => ({ reset: n < 6 ? 0 : 10 }));
  nearAll(col(rec, "tri"), [0, 1, 2, 3, 4, 3, 0, 1, 2, 3], TOL, 0, "tri");
  nearAll(
    col(rec, "sine"),
    [0, 1.530734, 2.828427, 3.695518, 4, 3.695518, 0, 1.530734, 2.828427, 3.695518],
    TOL,
    0,
    "sine",
  );
  nearAll(col(rec, "saw"), [0, 0.5, 1, 1.5, 2, 2.5, 0, 0.5, 1, 1.5], TOL, 0, "saw");
  nearAll(col(rec, "square"), new Array<number>(10).fill(4), TOL, 0, "square");
});

function phase0(m: LfoModule): number {
  return (m.getState().phase as number[])[0]!;
}

tv("TV-MOD-LFO-001-04", () => {
  // (a) 4500 Hz へクランプ
  const a = run(mk({ freq: 1e6 }), 3);
  nearAll(a[2]![0]!, [1.5, -1.5, 3, 3.695518, 4], TOL, 0, "(a)");
  // (c) f = 2·2^20 → 4500 Hz
  const c = mk({ freq: 2.0 });
  run(c, 1, () => ({ rate: 20 }));
  near(phase0(c), 0.09375, 1e-12, 0, "(c) phase");
  // (b) 0.005 Hz へクランプ
  const b = mk({ freq: 0.0 });
  run(b, 1);
  near(phase0(b), 1.0416666667e-7, 1e-12, 0, "(b) phase");
});

tv("TV-MOD-LFO-001-05", () => {
  const rec = run(mk({ freq: 3000 }), 3, () => ({ reset: 10 }));
  nearAll(col(rec, "tri"), [0, 1, 2], TOL);
});

tv("TV-MOD-LFO-001-06", () => {
  const m = mk({ freq: 3000 });
  assert.equal(m.nonfiniteCount, 0);
  const rec = run(m, 4, () => ({ rate: NaN, reset: NaN }));
  checkTv01(rec, [0, 1, 2, 3]);
  assert.equal(m.nonfiniteCount, 8);
});

tv("TV-MOD-LFO-001-07", () => {
  const rec = run(mk({ freq: 3000, depth: 0.5 }), 4);
  nearAll(rec[0]![0]!, [0, 0, 0, 0, 2], TOL, 0, "n=0");
  nearAll(rec[3]![0]!, [0.75, -0.75, 1.5, 1.847759, 2], TOL, 0, "n=3");
});

tv("TV-MOD-LFO-001-08", () => {
  const m = mk({ freq: 3000 });
  const rec = run(m, 4, () => ({ rate: null, reset: null }), 1);
  checkTv01(rec, [0, 1, 2, 3]);
  assert.equal(m.nonfiniteCount, 0);
});

tv("TV-MOD-LFO-001-09", () => {
  const m = mk({ freq: 3000 });
  run(m, 5);
  m.reset();
  const rec = run(m, 2);
  nearAll(rec[0]![0]!, [0, 0, 0, 0, 4], TOL, 0, "n=0");
  nearAll(rec[1]![0]!, [0.5, -0.5, 1, 1.530734, 4], TOL, 0, "n=1");
  assert.equal(m.getRawParam("freq"), 3000);
});

tv("TV-MOD-LFO-001-10", () => {
  const a = mk({ freq: 3000 });
  run(a, 7, () => ({ rate: 0.1 }));
  near(phase0(a), 0.46890089, 1e-8, 0, "保存時の phase");
  const snap = JSON.parse(JSON.stringify({ params: a.getParams(), state: a.getState() })) as {
    params: Record<string, number>;
    state: Record<string, unknown>;
  };
  const b = new LfoModule(FS);
  for (const [k, v] of Object.entries(snap.params)) b.setParam(k, v);
  b.setState(snap.state);
  const ins = (k: number): InSpec => ({ rate: 0.1, reset: k >= 3 ? 10 : 0 });
  const ra = run(a, 10, ins);
  const rb = run(b, 10, ins);
  for (let k = 0; k < 10; k++) {
    for (let i = 0; i < 5; i++) {
      assert.ok(Object.is(ra[k]![0]![i], rb[k]![0]![i]), `k=${k} ${OUTS[i]}: ${ra[k]![0]![i]} / ${rb[k]![0]![i]}`);
    }
  }
  nearAll(rb[2]![0]!, [-3.177019, 3.177019, -1.645961, -2.409162, -4], TOL, 0, "k=2");
  nearAll(rb[3]![0]!, [0, 0, 0, 0, 4], TOL, 0, "k=3");
  nearAll(rb[9]![0]!, [3.21532, -3.21532, 1.569359, 2.312033, 4], TOL, 0, "k=9");
});

tv("TV-MOD-LFO-001-11", () => {
  const a = mk({ freq: NaN, depth: NaN });
  const ra = run(a, 6001);
  nearAll(ra[6000]![0]!, [2, -2, 4, 4, 4], TOL, 0, "(a)");
  assert.equal(a.nonfiniteCount, 0);
  const rb = run(mk({ freq: 2.0, depth: -0.5 }), 6001);
  nearAll(rb[6000]![0]!, [0, 0, 0, 0, 0], TOL, 0, "(b)");
});

tv("TV-MOD-LFO-001-12", () => {
  const rates = [0, 1, -1];
  const rec = run(mk({ freq: 1500, cv_amt: 1, depth: 1 }), 9, () => ({ rate: rates }), 3);
  nearAll(col(rec, "tri", 0), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4], TOL, 0, "tri[0]");
  nearAll(col(rec, "tri", 1), [0, 1, 2, 3, 4, 3, 2, 1, 0], TOL, 0, "tri[1]");
  nearAll(col(rec, "tri", 2), [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2], TOL, 0, "tri[2]");
  nearAll(rec[4]![0]!, [1, -1, 2, 2.828427, 4], TOL, 0, "n=4 c=0");
  nearAll(rec[4]![1]!, [2, -2, 4, 4, 4], TOL, 0, "n=4 c=1");
  nearAll(rec[4]![2]!, [0.5, -0.5, 1, 1.530734, 4], TOL, 0, "n=4 c=2");
  // モノとの一致(ビット同一)
  for (let c = 0; c < 3; c++) {
    const mono = run(mk({ freq: 1500, cv_amt: 1, depth: 1 }), 9, () => ({ rate: rates[c]! }), 1);
    for (let n = 0; n < 9; n++) {
      for (let i = 0; i < 5; i++) {
        assert.ok(Object.is(rec[n]![c]![i], mono[n]![0]![i]), `c=${c} n=${n} ${OUTS[i]}`);
      }
    }
  }
});

const RATE3 = [0, -1, -2];

tv("TV-MOD-LFO-001-13", () => {
  const a = run(mk({ freq: 3000, cv_amt: 1 }), 6, (n) => ({ rate: RATE3, reset: n < 3 ? 0 : 10 }), 3);
  nearAll(col(a, "tri", 0), [0, 1, 2, 0, 1, 2], TOL, 0, "(a) tri[0]");
  nearAll(col(a, "tri", 1), [0, 0.5, 1, 0, 0.5, 1], TOL, 0, "(a) tri[1]");
  nearAll(col(a, "tri", 2), [0, 0.25, 0.5, 0, 0.25, 0.5], TOL, 0, "(a) tri[2]");
  const b = run(mk({ freq: 3000, cv_amt: 1 }), 6, (n) => ({ rate: RATE3, reset: [0, n < 3 ? 0 : 10] }), 3);
  nearAll(col(b, "tri", 0), [0, 1, 2, 3, 4, 3], TOL, 0, "(b) tri[0]");
  nearAll(col(b, "tri", 1), [0, 0.5, 1, 0, 0.5, 1], TOL, 0, "(b) tri[1]");
  nearAll(col(b, "tri", 2), [0, 0.25, 0.5, 0.75, 1, 1.25], TOL, 0, "(b) tri[2]");
});

tv("TV-MOD-LFO-001-14", () => {
  const rec = run(mk({ freq: 3000 }), 6, (n) => ({ rate: null, reset: [0, n < 3 ? 0 : 10] }), 1);
  nearAll(col(rec, "tri"), [0, 1, 2, 3, 4, 3], TOL);
});

tv("TV-MOD-LFO-001-15", () => {
  const m = mk({ freq: 3000 });
  const rec = run(m, 3, () => ({ rate: [NaN, -1], reset: [Infinity] }), 2);
  nearAll(col(rec, "tri", 0), [0, 1, 2], TOL, 0, "tri[0]");
  nearAll(col(rec, "tri", 1), [0, 0.5, 1], TOL, 0, "tri[1]");
  assert.equal(m.nonfiniteCount, 6);
  m.reset();
  assert.equal(m.nonfiniteCount, 0);
});
