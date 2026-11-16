// MOD-MIX-001 の検証例(specifications/modules/MOD-MIX-001.md §10)。
import assert from "node:assert/strict";
import { MixModule } from "../src/modules/mix.js";
import { InSpec, near, nearAll, outVals, stepWith, tv } from "./helpers.js";

const FS = 48000;
type P = { level1?: number; level2?: number; level3?: number; level4?: number; master?: number };

function mk(p: P = {}): MixModule {
  const m = new MixModule(FS);
  for (const [k, v] of Object.entries(p)) m.setParam(k, v as number);
  return m;
}

/** 1ステップ進めて out の全チャンネルを返す。 */
function one(m: MixModule, ins: InSpec): number[] {
  stepWith(m, ins);
  return outVals(m, "out");
}

tv("TV-MOD-MIX-001-01", () => {
  const m = mk({ level1: 0.5, level2: 0.25, level3: 1.0, level4: 0.0, master: 0.8 });
  const y = one(m, { in1: 4.0, in2: 8.0, in3: -2.0, in4: 100.0 });
  assert.equal(y.length, 1);
  near(y[0]!, 1.6);
});

tv("TV-MOD-MIX-001-02", () => {
  nearAll(one(mk(), { in1: 1, in2: 2, in3: 3, in4: 4 }), [10.0]);
});

tv("TV-MOD-MIX-001-03", () => {
  nearAll(one(mk(), { in1: 0.1, in2: 0.2, in3: 0.3, in4: 0.4 }), [1.0]);
});

tv("TV-MOD-MIX-001-04", () => {
  const a = one(mk(), { in1: 5, in2: 5, in3: 5, in4: 5 });
  assert.equal(a[0], 12);
  const b = one(mk(), { in1: -5, in2: -5, in3: -5, in4: -5 });
  assert.equal(b[0], -12);
});

tv("TV-MOD-MIX-001-05", () => {
  const m = mk({ level1: 2.0, level2: -1.0, master: 1.5 });
  nearAll(one(m, { in1: 3.0, in2: 3.0, in3: 0.0, in4: 0.0 }), [3.0]);
});

tv("TV-MOD-MIX-001-06", () => {
  const m = mk();
  assert.equal(m.nonfiniteCount, 0);
  nearAll(one(m, { in1: NaN, in2: 3.0, in3: -Infinity, in4: 1.0 }), [4.0]);
  assert.equal(m.nonfiniteCount, 2);
  m.reset();
  assert.equal(m.nonfiniteCount, 0);
});

tv("TV-MOD-MIX-001-07", () => {
  const a = one(mk(), { in1: null, in2: null, in3: null, in4: null });
  assert.equal(a.length, 1);
  near(a[0]!, 0.0, 1e-6, 0, "(a)");
  const b = one(mk({ level2: 0.5 }), { in2: 2.5 });
  assert.equal(b.length, 1);
  near(b[0]!, 1.25, 1e-6, 0, "(b)");
});

tv("TV-MOD-MIX-001-08", () => {
  const y = one(mk(), { in1: [1.0, 2.0], in2: [10.0] });
  assert.equal(y.length, 2);
  nearAll(y, [11.0, 2.0]);
});

tv("TV-MOD-MIX-001-09", () => {
  const y = one(mk({ level2: 0.5 }), { in1: [1.0, 2.0, 3.0], in2: [4.0, -6.0], in3: [0.5] });
  assert.equal(y.length, 3);
  nearAll(y, [3.5, -1.0, 3.0]);
  // 各チャンネルは同じ値をモノで与えたときと一致
  const mono: InSpec[] = [
    { in1: 1.0, in2: 4.0, in3: 0.5 },
    { in1: 2.0, in2: -6.0 },
    { in1: 3.0 },
  ];
  for (let c = 0; c < 3; c++) {
    const v = one(mk({ level2: 0.5 }), mono[c]!);
    assert.equal(v.length, 1);
    assert.ok(Object.is(v[0], y[c]), `ch${c + 1}: モノ ${v[0]} / ポリ ${y[c]}`);
  }
});

tv("TV-MOD-MIX-001-10", () => {
  const m = mk();
  const y = one(m, { in1: [NaN, 1.0], in2: [2.0, Infinity] });
  assert.equal(y.length, 2);
  nearAll(y, [2.0, 1.0]);
  assert.equal(m.nonfiniteCount, 2);
});
