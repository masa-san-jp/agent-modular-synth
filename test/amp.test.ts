// MOD-AMP-001 の検証例(specifications/modules/MOD-AMP-001.md §10)。
import assert from "node:assert/strict";
import { AmpModule } from "../src/modules/amp.js";
import { near, nearAll, outVals, runSeq, stepWith, tv } from "./helpers.js";

const FS = 48000;
function mk(params: Record<string, number> = {}): AmpModule {
  const m = new AmpModule(FS);
  for (const [k, v] of Object.entries(params)) m.setParam(k, v);
  return m;
}
function one(m: AmpModule, inputs: Parameters<typeof stepWith>[1]): number {
  stepWith(m, inputs);
  assert.equal(m.output("out").channels, 1);
  return m.output("out").values[0]!;
}

tv("TV-MOD-AMP-001-01", () => {
  near(one(mk({ gain: 0.5, response: 0 }), { in1: 4.0 }), 2.0);
});

tv("TV-MOD-AMP-001-02", () => {
  const m = mk({ gain: 0.0, response: 0 });
  stepWith(m, { in1: 4.0 });
  nearAll(runSeq(m, "cv1", [0, 1, 2.5, 5, 7.5, -3], "out"), [0.0, 0.8, 2.0, 4.0, 4.0, 0.0]);
});

tv("TV-MOD-AMP-001-03", () => {
  const m = mk({ gain: 0.0, response: 1 });
  stepWith(m, { in1: 4.0 });
  // 相対 1e-6
  nearAll(runSeq(m, "cv1", [0, 1, 2.5, 5, 7.5], "out"), [0.0, 0.011936223, 0.12261372, 4.0, 4.0], 0, 1e-6);
});

tv("TV-MOD-AMP-001-04", () => {
  near(one(mk({ gain: 0.2, cv2_level: 0.5, response: 0 }), { in1: 5.0, cv1: 1.0, cv2: 2.0 }), 3.0);
});

tv("TV-MOD-AMP-001-05", () => {
  near(one(mk({ gain: 1.0, in1_level: 1.0, in2_level: 0.5, out_level: 0.5 }), { in1: 4.0, in2: 8.0 }), 4.0);
  near(one(mk({ gain: 1.0, in1_level: 0.5, in2_level: 0.25, out_level: 0.5 }), { in1: 4.0, in2: -8.0 }), 0.0);
});

tv("TV-MOD-AMP-001-06", () => {
  const m = mk({ gain: 0.0, response: 0 });
  const ys: number[] = [];
  for (let n = 0; n < 4; n++) {
    ys.push(
      one(m, {
        in1: 5 * Math.sin((2 * Math.PI * n) / 8),
        cv1: 2.5 + 2.5 * Math.sin((2 * Math.PI * n) / 32),
      }),
    );
  }
  nearAll(ys, [0.0, 2.11264118, 3.45670858, 2.74988565]);
});

tv("TV-MOD-AMP-001-07", () => {
  // (a) クリップは厳密に ±12.0
  const a = runSeq(mk({ gain: 1.0, response: 0 }), "in1", [20.0, -20.0], "out");
  assert.deepEqual(a, [12.0, -12.0]);
  // (b)
  near(one(mk({ gain: 2.0, response: 0 }), { in1: 4.0 }), 4.0);
  // (c)
  near(one(mk({ gain: -1.0, response: 0 }), { in1: 4.0 }), 0.0);
});

tv("TV-MOD-AMP-001-08", () => {
  const p = { gain: 0.5, response: 0 };
  const a = mk(p);
  near(one(a, { in1: NaN }), 0.0);
  assert.equal(a.nonfiniteCount, 1);
  const b = mk(p);
  near(one(b, { in1: Infinity }), 0.0);
  assert.equal(b.nonfiniteCount, 1);
  const c = mk(p);
  near(one(c, { in1: 4.0, cv1: NaN }), 2.0);
  assert.equal(c.nonfiniteCount, 1);
  const d = mk({ gain: 0.5, response: 7 });
  near(one(d, { in1: 4.0 }), 2.0);
  assert.equal(d.nonfiniteCount, 0);
  // §8: reset() でカウンタは 0 に戻る
  c.reset();
  assert.equal(c.nonfiniteCount, 0);
});

tv("TV-MOD-AMP-001-09", () => {
  near(one(mk({ gain: 0.5 }), {}), 0.0);
  near(one(mk({ gain: 0.5 }), { in1: 4.0 }), 2.0);
  near(one(mk(), { in1: 4.0 }), 0.0);
});

tv("TV-MOD-AMP-001-10", () => {
  const p = { gain: 0.0, in2_level: 0.5, response: 0 };
  const a = mk(p);
  stepWith(a, { in1: [4.0, 2.0], in2: [8.0], cv1: [5.0, 2.5] });
  assert.equal(a.output("out").channels, 2);
  nearAll(outVals(a, "out"), [8.0, 1.0]);
  const b = mk(p);
  stepWith(b, { in1: [4.0, 2.0], in2: [8.0], cv1: [5.0] });
  assert.equal(b.output("out").channels, 2);
  nearAll(outVals(b, "out"), [8.0, 2.0]);
});

tv("TV-MOD-AMP-001-11", () => {
  const p = { gain: 0.0, response: 0 };
  const a = mk(p);
  stepWith(a, { in1: [4.0, 2.0, 6.0], cv1: [5.0, 2.5] });
  assert.equal(a.output("out").channels, 3);
  nearAll(outVals(a, "out"), [4.0, 1.0, 0.0]);
  // (b) cv2=1ch を追加
  stepWith(a, { cv2: [2.5] });
  assert.equal(a.output("out").channels, 3);
  nearAll(outVals(a, "out"), [4.0, 2.0, 3.0]);
  // 各チャンネルはモノで与えたときと一致
  near(one(mk(p), { in1: 6.0, cv1: 0, cv2: 2.5 }), 3.0);
  near(one(mk(p), { in1: 4.0, cv1: 5.0, cv2: 2.5 }), 4.0);
  near(one(mk(p), { in1: 2.0, cv1: 2.5, cv2: 2.5 }), 2.0);
  // (c) 副入力のチャンネル数は N を決めない
  const c = mk(p);
  stepWith(c, { in1: [4.0], cv1: [5.0, 2.5, 0.0] });
  assert.equal(c.output("out").channels, 1);
  nearAll(outVals(c, "out"), [4.0]);
});

tv("TV-MOD-AMP-001-12", () => {
  const m = mk({ gain: 1.0, response: 0 });
  stepWith(m, { in1: [NaN, 3.0], in2: [2.0, -Infinity], cv1: [NaN], cv2: [0.0, NaN, NaN] });
  assert.equal(m.output("out").channels, 2);
  nearAll(outVals(m, "out"), [2.0, 3.0]);
  assert.equal(m.nonfiniteCount, 4);
  m.reset();
  assert.equal(m.nonfiniteCount, 0);
});
