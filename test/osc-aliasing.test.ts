// MOD-OSC-001 の折り返し成分が、暫定の目標(DEC-030。MOD-OSC-001 §6 の表)以下であることを確かめる。
// 測定方法は MOD-OSC-001 §6「音質要件」(VER-NF-007a)と同じ。道具 tools/measure-osc-aliasing.mjs と同じ計算をする。
import assert from "node:assert/strict";
import { test } from "node:test";
import { OscModule } from "../src/modules/osc.js";

const FS = 48000;
const N = 1 << 16;
const F0 = 261.6256;
const EXCLUDE = 3;

/** 暫定の目標 [dB](以下であること)。MOD-OSC-001 §6、DEC-030。 */
const TARGET: { hz: number; saw: number; pulse: number; tri: number }[] = [
  { hz: 440, saw: -42, pulse: -42, tri: -77 },
  { hz: 4186.0096, saw: -23, pulse: -28, tri: -45 },
  { hz: 10000, saw: -20, pulse: -20, tri: -30 },
];
const WAVES = ["saw", "pulse", "tri"] as const;

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k + len / 2;
        const xr = re[a]! * wr - im[a]! * wi;
        const xi = re[a]! * wi + im[a]! * wr;
        re[a] = re[i + k]! - xr;
        im[a] = im[i + k]! - xi;
        re[i + k] = re[i + k]! + xr;
        im[i + k] = im[i + k]! + xi;
      }
    }
  }
}

/** 折り返し成分の基本波比 [dB](全帯域。MOD-OSC-001 §6)。 */
function aliasingDb(x: Float64Array, f: number): number {
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let n = 0; n < N; n++) re[n] = x[n]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N));
  fft(re, im);
  const half = N / 2;
  const mag = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) mag[k] = Math.hypot(re[k]!, im[k]!);
  const df = FS / N;
  const excluded = new Uint8Array(half + 1);
  for (let h = 0; h * f <= FS / 2 + EXCLUDE * df; h++) {
    const c = Math.round((h * f) / df);
    for (let k = Math.max(0, c - EXCLUDE); k <= Math.min(half, c + EXCLUDE); k++) excluded[k] = 1;
  }
  const c1 = Math.round(f / df);
  let fund = 0;
  for (let k = c1 - EXCLUDE; k <= c1 + EXCLUDE; k++) fund = Math.max(fund, mag[k]!);
  let peak = 0;
  for (let k = 1; k < half; k++) {
    if (excluded[k] || !(mag[k]! > mag[k - 1]! && mag[k]! > mag[k + 1]!)) continue;
    peak = Math.max(peak, mag[k]!);
  }
  return 20 * Math.log10(peak / fund);
}

for (const t of TARGET) {
  test(`VER-NF-007a / DEC-030: ${t.hz} Hz の鋸歯・矩形・三角の折り返し成分が暫定の目標以下`, () => {
    const pitch = Math.log2(t.hz / F0);
    const m = new OscModule(FS);
    m.input("pitch").set([pitch]);
    const cap = { saw: new Float64Array(N), pulse: new Float64Array(N), tri: new Float64Array(N) };
    for (let n = 0; n < N; n++) {
      m.step();
      for (const w of WAVES) cap[w][n] = m.output(w).values[0]!;
    }
    for (const w of WAVES) {
      const db = aliasingDb(cap[w], F0 * Math.pow(2, pitch));
      assert.ok(db <= t[w], `${w}: ${db.toFixed(2)} dB > 目標 ${t[w]} dB`);
    }
  });
}
