// MOD-SAT-001 の検証例(specifications/modules/MOD-SAT-001.md §10)。
import assert from "node:assert/strict";
import { SatModule } from "../src/modules/sat.js";
import { near, nearAll, outVals, runSeq, stepWith, tv } from "./helpers.js";

const FS = 48000;
const TOL = 1e-5;
function mk(params: Record<string, number> = {}): SatModule {
  const m = new SatModule(FS);
  for (const [k, v] of Object.entries(params)) m.setParam(k, v);
  return m;
}
const one = (params: Record<string, number>, x: number, cv?: number): number => {
  const m = mk(params);
  stepWith(m, cv === undefined ? { in: x } : { in: x, drive_cv: cv });
  return m.output("out").values[0]!;
};

tv("TV-MOD-SAT-001-01", () => {
  nearAll(runSeq(mk(), "in", [0, 1, -1, 5, -5], "out"), [0, 3.309575, -3.309575, 4.996517, -4.996517], TOL);
});

tv("TV-MOD-SAT-001-02", () => {
  nearAll(runSeq(mk({ drive: 0 }), "in", [1, 5, -2.5], "out"), [0.986877, 3.807971, -2.310586], TOL);
});

tv("TV-MOD-SAT-001-03", () => {
  nearAll(runSeq(mk({ mode: 1 }), "in", [0.5, 2, -3], "out"), [1.990536, 5, -5], TOL);
});

tv("TV-MOD-SAT-001-04", () => {
  nearAll(runSeq(mk({ mode: 2 }), "in", [1, 2, 5, -2], "out"), [3.981072, 2.037857, -0.094641, -2.037857], TOL);
});

tv("TV-MOD-SAT-001-05", () => {
  nearAll(runSeq(mk({ bias: 0.5, drive: 0 }), "in", [0, 1, -1], "out"), [0, 0.711253, -0.854023], TOL);
  near(one({ bias: 0.5, drive: 0, mode: 1 }, 5), 2.5, TOL);
});

tv("TV-MOD-SAT-001-06", () => {
  near(one({ mix: 0.5 }, 1), 2.154788, TOL);
  near(one({ mix: 0 }, 1), 1, TOL);
});

tv("TV-MOD-SAT-001-07", () => {
  near(one({ level: 0.5 }, 1), 1.654788, TOL);
  near(one({ level: 0 }, 5), 0, TOL);
});

tv("TV-MOD-SAT-001-08", () => {
  near(one({ drive: 0 }, 1, 4), 3.309575, TOL);
  near(one({ drive: 0 }, 1, -10), 0.986877, TOL);
  near(one({ drive: 0 }, 1, 20), 5, TOL);
  near(one({ drive: 30 }, 1, 1), 5, TOL);
});

tv("TV-MOD-SAT-001-09", () => {
  near(one({ drive: 99 }, 1), 5, TOL);
  near(one({ mode: 7 }, 2), 2.037857, TOL);
  near(one({ mode: 1.5, drive: 12 }, 2), 2.037857, TOL);
  near(one({ mix: 2 }, 1), 3.309575, TOL);
  near(one({ bias: 5, drive: 0 }, 1), 0.360302, TOL);
});

tv("TV-MOD-SAT-001-10", () => {
  const m = mk();
  assert.equal(m.nonfiniteCount, 0);
  nearAll(runSeq(m, "in", [NaN, Infinity], "out"), [0, 0], TOL);
  stepWith(m, { in: 1, drive_cv: NaN });
  near(m.output("out").values[0]!, 3.309575, TOL);
  assert.equal(m.nonfiniteCount, 3);
});

tv("TV-MOD-SAT-001-11", () => {
  const m = mk({ drive: NaN, bias: NaN, mode: NaN, mix: NaN, level: NaN });
  stepWith(m, { in: 1 });
  near(m.output("out").values[0]!, 3.309575, TOL);
  assert.equal(m.nonfiniteCount, 0);
});

tv("TV-MOD-SAT-001-12", () => {
  const m = mk({ bias: 0.7, mode: 2 });
  for (let n = 0; n < 3; n++) {
    stepWith(m);
    assert.deepEqual(outVals(m, "out"), [0]);
  }
});

tv("TV-MOD-SAT-001-13", () => {
  nearAll(runSeq(mk({ mix: 0 }), "in", [20, -20], "out"), [12, -12]);
  near(one({ mix: 0.5, mode: 1, drive: 12 }, 20), 12);
});

tv("TV-MOD-SAT-001-14", () => {
  const m = mk({ drive: 12 });
  stepWith(m, { in: 1 });
  near(m.output("out").values[0]!, 3.309575, TOL);
  m.reset();
  stepWith(m, { in: 1 });
  near(m.output("out").values[0]!, 3.309575, TOL);
  assert.equal(m.param("drive"), 12);
});

tv("TV-MOD-SAT-001-15", () => {
  const m = mk();
  stepWith(m, { in: [1, -1, 5] });
  nearAll(outVals(m, "out"), [3.309575, -3.309575, 4.996517], TOL);
  assert.equal(m.output("out").channels, 3);
});

tv("TV-MOD-SAT-001-16", () => {
  const a = mk({ drive: 0 });
  stepWith(a, { in: [1, 1, 1], drive_cv: [4] });
  nearAll(outVals(a, "out"), [3.309575, 3.309575, 3.309575], TOL);
  const b = mk({ drive: 0 });
  stepWith(b, { in: [1, 1, 1], drive_cv: [4, 0] });
  nearAll(outVals(b, "out"), [3.309575, 0.986877, 0.986877], TOL);
});

tv("TV-MOD-SAT-001-17", () => {
  const m = mk();
  stepWith(m, { in: [NaN, 1], drive_cv: [0, 0, NaN] });
  nearAll(outVals(m, "out"), [0, 3.309575], TOL);
  assert.equal(m.nonfiniteCount, 1);
});
