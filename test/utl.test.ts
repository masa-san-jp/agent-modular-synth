// MOD-UTL-001 の検証例(specifications/modules/MOD-UTL-001.md §10)。
import assert from "node:assert/strict";
import { UtlModule } from "../src/modules/utl.js";
import { nearAll, outVals, runSeq, stepWith, tv } from "./helpers.js";

const FS = 48000;
function mk(gain?: number, offset?: number): UtlModule {
  const m = new UtlModule(FS);
  if (gain !== undefined) m.setParam("gain", gain);
  if (offset !== undefined) m.setParam("offset", offset);
  return m;
}

tv("TV-MOD-UTL-001-01", () => {
  nearAll(runSeq(mk(), "in", [0, 1, -2.5, 5], "out"), [0, 1, -2.5, 5]);
});

tv("TV-MOD-UTL-001-02", () => {
  nearAll(runSeq(mk(0.5, 1), "in", [-10, 0, 4, 10], "out"), [-4, 1, 3, 6]);
});

tv("TV-MOD-UTL-001-03", () => {
  nearAll(runSeq(mk(-1, 0), "in", [2, -7], "out"), [-2, 7]);
});

tv("TV-MOD-UTL-001-04", () => {
  nearAll(runSeq(mk(1, 10), "in", [5, -20], "out"), [12, -10]);
  nearAll(runSeq(mk(1, -10), "in", [20], "out"), [10]);
});

tv("TV-MOD-UTL-001-05", () => {
  nearAll(runSeq(mk(3), "in", [5], "out"), [5]);
  nearAll(runSeq(mk(undefined, -50), "in", [1], "out"), [-9]);
  nearAll(runSeq(mk(1, 0), "in", [12.5], "out"), [12]);
});

tv("TV-MOD-UTL-001-06", () => {
  const m = mk(0.5, 2);
  assert.equal(m.nonfiniteCount, 0);
  nearAll(runSeq(m, "in", [NaN, Infinity], "out"), [2, 2]);
  assert.equal(m.nonfiniteCount, 2);
});

tv("TV-MOD-UTL-001-07", () => {
  const m = mk(NaN, NaN);
  nearAll(runSeq(m, "in", [1], "out"), [1]);
  assert.equal(m.nonfiniteCount, 0);
});

tv("TV-MOD-UTL-001-08", () => {
  const m = mk(1, 3);
  const ys: number[] = [];
  for (let n = 0; n < 3; n++) {
    stepWith(m, { in: null });
    ys.push(m.output("out").values[0]!);
    assert.equal(m.output("out").channels, 1);
  }
  nearAll(ys, [3, 3, 3]);
});

tv("TV-MOD-UTL-001-09", () => {
  const m = mk(0.5, 1);
  nearAll(runSeq(m, "in", [4], "out"), [3]);
  m.reset();
  nearAll(runSeq(m, "in", [4], "out"), [3]);
  assert.equal(m.param("gain"), 0.5);
});

tv("TV-MOD-UTL-001-10", () => {
  const m = mk(0.5, 1);
  stepWith(m, { in: [-10, 4, 10] });
  assert.equal(m.output("out").channels, 3);
  nearAll(outVals(m, "out"), [-4, 3, 6]);
});

tv("TV-MOD-UTL-001-11", () => {
  const m = mk(0.5, 1);
  stepWith(m, { in: [NaN, 2] });
  nearAll(outVals(m, "out"), [1, 2]);
  assert.equal(m.nonfiniteCount, 1);
});
