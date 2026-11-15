import assert from "node:assert/strict";
import { test } from "node:test";
import { Prng, normalizeSeed } from "../src/engine/prng.js";
import { near } from "./helpers.js";

// COM-11 の参照値
const REF: [number, number[], number[]][] = [
  [0, [0x92ca2f0e, 0x3cd6e3f3, 0x1b147dcc, 0x4c081dbf], [0xe308dc58, 0x4392d0e4, 0x03318f97]],
  [1, [0x96a0f96b, 0x12bc8390, 0x971e9964, 0x79adc7e7], [0x9190299e, 0xc1017b27, 0xe3af522f]],
  [12345, [0x479199b4, 0x30c2cbd5, 0x3b5fd909, 0x8ee55794], [0x1eea3cc1, 0x1a40a62e, 0xfc4cd240]],
];

test("COM-11: 初期状態と next() が参照値と完全一致", () => {
  for (const [seed, state, outs] of REF) {
    const r = new Prng(seed);
    assert.deepEqual(r.getState(), state, `seed=${seed} の初期状態`);
    assert.deepEqual([r.next(), r.next(), r.next()], outs, `seed=${seed} の next()`);
  }
});

test("COM-11: seed=1 の uniform() ×3", () => {
  const r = new Prng(1);
  near(r.uniform(), 0.5686059594, 1e-9);
  near(r.uniform(), 0.7539288402, 1e-9);
  near(r.uniform(), 0.8893939257, 1e-9);
});

test("COM-11: seed の正規化", () => {
  assert.equal(normalizeSeed(NaN, 1), 1);
  assert.equal(normalizeSeed(Infinity, 7), 7);
  assert.equal(normalizeSeed(-3, 1), 0);
  assert.equal(normalizeSeed(7.9, 1), 7);
  assert.equal(normalizeSeed(4294967296 + 1, 1), 1);
  assert.equal(normalizeSeed(4294967295, 1), 4294967295);
});

test("COM-14: PRNG 状態の保存・復元でビット同一に続く", () => {
  const a = new Prng(42);
  for (let i = 0; i < 10; i++) a.next();
  const b = new Prng(0);
  b.setState(a.getState());
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});
