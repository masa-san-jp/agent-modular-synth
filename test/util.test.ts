import assert from "node:assert/strict";
import { test } from "node:test";
import { Schmitt, expCoefFromTime, resetIgnoreSamples, roundHalfUp, triggerSamples } from "../src/engine/util.js";
import { normalizeParam } from "../src/engine/module.js";
import { near } from "./helpers.js";

test("COM-04: シュミットトリガ(ON 2.0 V、OFF 0.1 V)", () => {
  const s = new Schmitt();
  const xs = [0, 1.9, 2.0, 5, 0.2, 0.11, 0.1, 0, 10];
  const edges = xs.map((x) => s.step(x));
  assert.deepEqual(edges, [false, false, true, false, false, false, false, false, true]);
  const s2 = new Schmitt();
  s2.step(2.0);
  s2.step(0.2);
  assert.equal(s2.state, 1, "0.1 V を超える間は high を保つ");
  s2.step(0.1);
  assert.equal(s2.state, 0);
});

test("COM-04: ポート値(float32)の 0.1 V ちょうどで OFF になる", () => {
  const port = new Float32Array(1);
  const s = new Schmitt();
  port[0] = 2.0;
  assert.equal(s.step(port[0]!), true);
  port[0] = 0.1;
  s.step(port[0]!);
  assert.equal(s.state, 0, "float32 に丸めた 0.1 V は OFF 閾値以下として扱う");
});

test("COM-04/07: パルス幅は round、無視区間は ceil(fs=44100 で 44 と 45)", () => {
  assert.equal(triggerSamples(48000), 48);
  assert.equal(resetIgnoreSamples(48000), 48);
  assert.equal(triggerSamples(44100), 44);
  assert.equal(resetIgnoreSamples(44100), 45);
  assert.equal(triggerSamples(100), 1);
});

test("COM-17: 指数区間の時間 T で残差が 1/1000 になる", () => {
  const fs = 48000;
  const T = 0.1;
  const a = expCoefFromTime(T, fs);
  near(Math.pow(a, T * fs), 1 / 1000, 1e-12);
});

test("COM-12/13: パラメータの正規化(NaN は既定値、整数は四捨五入、範囲はクランプ)", () => {
  const f = { name: "x", kind: "float" as const, min: -1, max: 1, default: 0.5 };
  assert.equal(normalizeParam(f, NaN), 0.5);
  assert.equal(normalizeParam(f, Infinity), 0.5);
  assert.equal(normalizeParam(f, 3), 1);
  assert.equal(normalizeParam(f, -3), -1);
  const i = { name: "n", kind: "int" as const, min: 1, max: 16, default: 8 };
  assert.equal(normalizeParam(i, 2.5), 3);
  assert.equal(normalizeParam(i, 2.4), 2);
  assert.equal(normalizeParam(i, 100), 16);
  assert.equal(normalizeParam(i, NaN), 8);
  assert.equal(roundHalfUp(-0.5), 0);
});
