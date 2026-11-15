// 検証例(#2仕様 §10 の TV)を実装に対して実行するための補助。
import assert from "node:assert/strict";
import { test } from "node:test";
import { SynthModule } from "../src/engine/module.js";

/** 仕様の検証例を1件登録する。ID は仕様の TV-ID と一致させる(tv-coverage が照合する)。 */
export function tv(id: string, fn: () => void): void {
  test(id, fn);
}

/** COM-15: |actual − expected| ≤ max(abs, rel·|expected|)。 */
export function near(actual: number, expected: number, abs = 1e-6, rel = 0, msg = ""): void {
  const tol = Math.max(abs, rel * Math.abs(expected));
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg} 期待 ${expected} に対し ${actual}(差 ${Math.abs(actual - expected)}、許容 ${tol})`,
  );
}

export function nearAll(actual: ArrayLike<number>, expected: readonly number[], abs = 1e-6, rel = 0, msg = ""): void {
  assert.ok(actual.length >= expected.length, `${msg} 長さ ${actual.length} < ${expected.length}`);
  for (let i = 0; i < expected.length; i++) near(actual[i]!, expected[i]!, abs, rel, `${msg}[${i}]`);
}

export type InSpec = Record<string, number | readonly number[] | null>;

/**
 * 入力を与えて1ステップ進める。値は数(1チャンネル)か配列(ポリ)。null は未接続。
 * 指定しなかった入力は前の状態のまま(初期状態は未接続)。
 */
export function stepWith(m: SynthModule, inputs: InSpec = {}): void {
  for (const [name, v] of Object.entries(inputs)) {
    const p = m.input(name);
    if (v === null) p.disconnect();
    else p.set(typeof v === "number" ? [v] : v);
  }
  m.step();
}

/** 出力ポートの現在の値(先頭 n チャンネル)。 */
export function outVals(m: SynthModule, name: string, n?: number): number[] {
  const p = m.output(name);
  return Array.from(p.values.subarray(0, n ?? p.channels));
}

/** 1チャンネルの入力列を順に与え、出力の ch0 の列を返す。 */
export function runSeq(m: SynthModule, inName: string, xs: readonly number[], outName: string): number[] {
  const ys: number[] = [];
  for (const x of xs) {
    stepWith(m, { [inName]: x });
    ys.push(m.output(outName).values[0]!);
  }
  return ys;
}
