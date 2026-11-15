// MOD-ENV-001 の検証例(specifications/modules/MOD-ENV-001.md §10)。
import assert from "node:assert/strict";
import { EnvModule } from "../src/modules/env.js";
import { near, stepWith, tv } from "./helpers.js";

const FS = 48000;
type P = { attack?: number; decay?: number; sustain?: number; release?: number };
type Sig = number | readonly number[] | null;

function mk(p: P = {}, fs = FS): EnvModule {
  const m = new EnvModule(fs);
  for (const [k, v] of Object.entries(p)) m.setParam(k, v as number);
  return m;
}

interface Run {
  env: number[][];
  inv: number[][];
}

/** n0〜n1-1 のステップを進め、env/inv をチャンネル別に記録する(添字は n − n0)。 */
function run(
  m: EnvModule,
  steps: number,
  gate: (n: number) => Sig,
  retrig?: (n: number) => Sig,
  n0 = 0,
): Run {
  const env: number[][] = [];
  const inv: number[][] = [];
  for (let i = 0; i < steps; i++) {
    const n = n0 + i;
    const ins: Record<string, Sig> = { gate: gate(n) };
    if (retrig) ins.retrig = retrig(n);
    stepWith(m, ins);
    const e = m.output("env");
    const v = m.output("inv");
    assert.equal(v.channels, e.channels);
    for (let c = 0; c < e.channels; c++) {
      (env[c] ??= []).push(e.values[c]!);
      (inv[c] ??= []).push(v.values[c]!);
    }
  }
  return { env, inv };
}

/** inv = −env(0 は +0)を全サンプルで確認する。 */
function checkInv(r: Run): void {
  for (let c = 0; c < r.env.length; c++) {
    for (let n = 0; n < r.env[c]!.length; n++) {
      const e = r.env[c]![n]!;
      const want = e === 0 ? 0 : -e;
      assert.ok(Object.is(r.inv[c]![n]!, want), `inv[${c}][${n}] = ${r.inv[c]![n]}、期待 ${want}`);
      assert.ok(e >= 0 && e <= 10, `env[${c}][${n}] = ${e} が範囲外`);
    }
  }
}

function at(ys: readonly number[], pts: ReadonlyArray<readonly [number, number]>, msg = "env"): void {
  for (const [n, v] of pts) near(ys[n]!, v, 1e-6, 0, `${msg}[${n}]`);
}

const TV01_GATE = (n: number): number => (n < 23000 ? 10 : 0);

function checkTv01(m: EnvModule, msg: string): void {
  const r = run(m, 29001, TV01_GATE);
  const e = r.env[0]!;
  at(
    e,
    [
      [0, 0.0208333],
      [239, 5.0],
      [479, 10.0],
      [480, 9.9928096],
      [1000, 7.3623541],
      [5000, 5.0],
      [22999, 5.0],
      [23000, 4.9928096],
      [23001, 4.9856295],
      [26000, 0.0665802],
      [29000, 0],
    ],
    msg,
  );
  checkInv(r);
  // Sustain 開始 n=4798、IDLE n=27318
  assert.ok(e[4797]! > 5, `${msg} env[4797] は Decay 中`);
  assert.equal(e[4798], 5, `${msg} env[4798]`);
  assert.ok(e[27317]! > 0, `${msg} env[27317] は Release 中`);
  assert.equal(e[27318], 0, `${msg} env[27318]`);
  assert.equal(m.nonfiniteCount, 0);
}

tv("TV-MOD-ENV-001-01", () => {
  checkTv01(mk(), "env");
});

const FAST: P = { attack: 0.001, decay: 0.01, sustain: 0.5, release: 0.01 };

tv("TV-MOD-ENV-001-02", () => {
  const r = run(
    mk(FAST),
    3000,
    () => 10,
    (n) => (n === 2000 ? 10 : 0),
  );
  const e = r.env[0]!;
  at(e, [
    [1999, 5.0],
    [2000, 5.2083333],
    [2001, 5.4166667],
    [2023, 10.0],
    [2024, 9.9285595],
  ]);
  for (let n = 2455; n < 3000; n++) near(e[n]!, 5.0, 1e-6, 0, `env[${n}]`);
  checkInv(r);
});

tv("TV-MOD-ENV-001-03", () => {
  const r = run(mk(), 200, (n) => (n < 100 ? 10 : 0));
  at(r.env[0]!, [
    [99, 2.0833333],
    [100, 2.0803373],
    [101, 2.0773456],
    [199, 1.8040923],
  ]);
  checkInv(r);
});

tv("TV-MOD-ENV-001-04", () => {
  const r = run(mk({ sustain: 1.0 }), 600, () => 10);
  const e = r.env[0]!;
  at(e, [
    [478, 9.9791667],
    [479, 10.0],
  ]);
  for (let n = 480; n <= 599; n++) near(e[n]!, 10.0, 1e-6, 0, `env[${n}]`);
  checkInv(r);
});

tv("TV-MOD-ENV-001-05", () => {
  const r = run(mk({ attack: 0.001, decay: 0.001, sustain: 0, release: 0.1 }), 300, () => 10);
  at(r.env[0]!, [
    [47, 10.0],
    [48, 8.6596432],
    [49, 7.4989421],
    [299, 0.0],
  ]);
  checkInv(r);
});

tv("TV-MOD-ENV-001-06", () => {
  const r = run(mk(), 1200, (n) => (n >= 1000 && n <= 1099 ? 0 : 10));
  at(r.env[0]!, [
    [999, 7.3657563],
    [1000, 7.3551637],
    [1099, 6.3784822],
    [1100, 6.3993155],
    [1101, 6.4201488],
  ]);
  checkInv(r);
});

tv("TV-MOD-ENV-001-07", () => {
  const r = run(
    mk(),
    3,
    () => 10,
    () => 10,
  );
  at(r.env[0]!, [
    [0, 0.0208333],
    [1, 0.0416667],
    [2, 0.0625],
  ]);
  checkInv(r);
});

tv("TV-MOD-ENV-001-08", () => {
  const r = run(
    mk(),
    5001,
    (n) => (n < 5000 ? 10 : 0),
    (n) => (n === 5000 ? 10 : 0),
  );
  at(r.env[0]!, [
    [4999, 5.0],
    [5000, 4.9928096],
  ]);
  checkInv(r);
});

tv("TV-MOD-ENV-001-09", () => {
  const m = mk();
  const r = run(m, 22, (n) => (n < 10 ? NaN : n < 20 ? 1.99 : n === 20 ? 2.0 : 10));
  const e = r.env[0]!;
  for (let n = 0; n <= 19; n++) assert.equal(e[n], 0, `env[${n}]`);
  at(e, [
    [20, 0.0208333],
    [21, 0.0416667],
  ]);
  assert.equal(m.nonfiniteCount, 10);
  checkInv(r);
});

tv("TV-MOD-ENV-001-10", () => {
  const r = run(mk({ attack: 0, decay: 0, sustain: 1.5, release: -1 }), 201, (n) => (n < 200 ? 10 : 0));
  at(r.env[0]!, [
    [0, 0.2083333],
    [47, 10.0],
    [100, 10.0],
    [199, 10.0],
    [200, 8.6596432],
  ]);
  checkInv(r);
});

tv("TV-MOD-ENV-001-11", () => {
  const m = mk();
  const r = run(m, 5, () => Infinity);
  for (let n = 0; n < 5; n++) assert.equal(r.env[0]![n], 0, `env[${n}]`);
  assert.equal(m.nonfiniteCount, 5);
  checkInv(r);
});

tv("TV-MOD-ENV-001-12", () => {
  const m = mk();
  const r = run(
    m,
    1000,
    () => null,
    () => null,
  );
  for (let n = 0; n < 1000; n++) {
    assert.ok(Object.is(r.env[0]![n], 0), `env[${n}]`);
    assert.ok(Object.is(r.inv[0]![n], 0), `inv[${n}]`);
  }
  assert.equal(m.nonfiniteCount, 0);
});

tv("TV-MOD-ENV-001-13", () => {
  const r = run(
    mk(FAST),
    1000,
    () => 0,
    (n) => (n === 10 ? 10 : 0),
  );
  assert.equal(Math.max(...r.env[0]!), 0);
  checkInv(r);
});

tv("TV-MOD-ENV-001-14", () => {
  const r = run(mk({}, 44100), 441, () => 10);
  at(r.env[0]!, [
    [0, 0.0226757],
    [439, 9.9773243],
    [440, 10.0],
  ]);
  checkInv(r);
});

tv("TV-MOD-ENV-001-15", () => {
  const m = mk();
  run(m, 1000, () => 10);
  m.reset();
  const r = run(m, 2, () => 10);
  at(r.env[0]!, [
    [0, 0.0208333],
    [1, 0.0416667],
  ]);
});

tv("TV-MOD-ENV-001-16", () => {
  const m = mk({ attack: 0.02, decay: 0.2, sustain: 0.7, release: 0.3 });
  const d = mk();
  run(m, 1000, () => 10);
  run(d, 1000, () => 10);
  m.reset();
  d.reset();
  for (const mod of [m, d]) {
    const r = run(mod, 2, () => 0);
    assert.ok(Object.is(r.env[0]![0], 0));
    assert.ok(Object.is(r.env[0]![1], 0));
  }
  assert.deepEqual(m.getParams(), { attack: 0.02, decay: 0.2, sustain: 0.7, release: 0.3 });
  assert.deepEqual(d.getParams(), { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 });
  assert.equal(d.param("attack"), 0.01);
});

tv("TV-MOD-ENV-001-17", () => {
  const gate = (n: number): number => (n < 6000 ? 10 : 0);
  const a = mk();
  run(a, 700, gate);
  const state = a.getState();
  assert.deepEqual(state.stage, [2]); // DEC
  near((state.x as number[])[0]!, 0.8643091, 1e-7, 0, "保存時の x");
  const saved = JSON.parse(JSON.stringify({ params: a.getParams(), state })) as {
    params: Record<string, number>;
    state: Record<string, unknown>;
  };
  const b = new EnvModule(FS);
  for (const [k, v] of Object.entries(saved.params)) b.setParam(k, v);
  b.setState(saved.state);

  const ra = run(a, 7300, gate, undefined, 700);
  const rb = run(b, 7300, gate, undefined, 700);
  for (let i = 0; i < 7300; i++) {
    assert.ok(Object.is(ra.env[0]![i], rb.env[0]![i]), `env[${700 + i}] がビット同一でない`);
    assert.ok(Object.is(ra.inv[0]![i], rb.inv[0]![i]), `inv[${700 + i}] がビット同一でない`);
  }
  at(rb.env[0]!, [
    [0, 8.6378518],
    [5999 - 700, 5.0],
    [6000 - 700, 4.9928096],
    [7999 - 700, 0.2811707],
  ]);
});

tv("TV-MOD-ENV-001-18", () => {
  const m1 = mk({ attack: NaN, decay: Infinity, sustain: Infinity, release: NaN });
  checkTv01(m1, "env(a)");
  const m2 = mk({ attack: -Infinity, decay: NaN, sustain: -Infinity, release: Infinity });
  checkTv01(m2, "env(b)"); // nonfiniteCount = 0 も確認(§8)
});

tv("TV-MOD-ENV-001-19", () => {
  const r = run(mk({ attack: 0.001, decay: 0.1, sustain: 0.8, release: 0.1 }), 9700, (n) => (n < 5000 ? 10 : 0));
  const e = r.env[0]!;
  at(e, [
    [47, 10.0],
    [48, 9.9971238],
    [3728, 8.0100093],
    [3729, 8.0],
    [4999, 8.0],
    [5000, 7.9884954],
    [9643, 0.0100136],
    [9644, 0],
  ]);
  // ステップ番号は厳密
  assert.ok(e[3728]! > Math.fround(8), "n=3728 は Decay 中");
  assert.equal(e[3729], Math.fround(8), "Sustain 開始 n=3729");
  assert.ok(e[9643]! > 0, "n=9643 は Release 中");
  assert.equal(e[9644], 0, "IDLE n=9644");
  checkInv(r);
});

tv("TV-MOD-ENV-001-20", () => {
  /** 各チャンネルが、モノで同じ gate・retrig を与えた列とビット同一であること。 */
  const checkMono = (r: Run, steps: number, gate: (n: number) => number[], retrig: (n: number, c: number) => number): void => {
    for (let c = 0; c < 3; c++) {
      const mono = run(
        mk(FAST),
        steps,
        (n) => gate(n)[c]!,
        (n) => retrig(n, c),
      );
      for (let n = 0; n < steps; n++) {
        assert.ok(Object.is(r.env[c]![n], mono.env[0]![n]), `env[${c}][${n}] がモノと不一致`);
        assert.ok(Object.is(r.inv[c]![n], mono.inv[0]![n]), `inv[${c}][${n}] がモノと不一致`);
      }
    }
  };

  // (a) retrig 1ch を全エンジンへコピー
  {
    const m = mk(FAST);
    const gate = (n: number): number[] => [10, n >= 1990 ? 10 : 0, 0];
    const r = run(m, 3000, gate, (n) => (n === 2000 ? 10 : 0));
    assert.equal(r.env.length, 3);
    assert.equal(m.output("env").channels, 3);
    assert.equal(m.output("inv").channels, 3);
    checkInv(r);
    at(
      r.env[0]!,
      [
        [1999, 5.0],
        [2000, 5.2083333],
        [2023, 10.0],
        [2024, 9.9285595],
      ],
      "(a) env[0]",
    );
    for (let n = 2455; n < 3000; n++) near(r.env[0]![n]!, 5.0, 1e-6, 0, `(a) env[0][${n}]`);
    at(
      r.env[1]!,
      [
        [1989, 0.0],
        [1990, 0.2083333],
        [1999, 2.0833333],
        [2000, 2.2916667],
        [2001, 2.5],
        [2037, 10.0],
        [2038, 9.9285595],
      ],
      "(a) env[1]",
    );
    for (let n = 2469; n < 3000; n++) near(r.env[1]![n]!, 5.0, 1e-6, 0, `(a) env[1][${n}]`);
    for (let n = 0; n < 3000; n++) assert.equal(r.env[2]![n], 0, `(a) env[2][${n}]`);
    assert.equal(m.nonfiniteCount, 0);
    checkMono(r, 3000, gate, (n) => (n === 2000 ? 10 : 0));
  }

  // (b) retrig 2ch(エンジン2は不足チャンネルで 0 V)
  {
    const m = mk(FAST);
    const gate = (): number[] => [10, 10, 10];
    const rt = (n: number, c: number): number => (c === 0 && n === 2000) || (c === 1 && n === 3000) ? 10 : 0;
    const r = run(m, 4000, gate, (n) => [rt(n, 0), rt(n, 1)]);
    assert.equal(r.env.length, 3);
    checkInv(r);
    at(
      r.env[0]!,
      [
        [1999, 5.0],
        [2000, 5.2083333],
        [2023, 10.0],
        [2455, 5.0],
        [3000, 5.0],
      ],
      "(b) env[0]",
    );
    at(
      r.env[1]!,
      [
        [2000, 5.0],
        [2999, 5.0],
        [3000, 5.2083333],
        [3023, 10.0],
        [3024, 9.9285595],
        [3455, 5.0],
      ],
      "(b) env[1]",
    );
    for (let n = 500; n < 4000; n++) near(r.env[2]![n]!, 5.0, 1e-6, 0, `(b) env[2][${n}]`);
    assert.equal(m.nonfiniteCount, 0);
    checkMono(r, 4000, gate, rt);
  }
});
