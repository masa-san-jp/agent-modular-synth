// MOD-OSC-001 の折り返し成分を、仕様 §6「音質要件」の測定方法で測る(VER-NF-007a)。
// 使い方: npm run build && node tools/measure-osc-aliasing.mjs [--fs 標本化周波数] [--json 出力.json]
//   --fs の既定は仕様の 48000。ほかの値は補足の測定(例: 44100 では 4000 Hz が fs の整数分の1にならない)。
//
// 測定方法(MOD-OSC-001 §6):
//   fs = 48000、pitch 一定で各波形を 2^16 サンプル取り、Hann 窓の FFT で振幅スペクトルを求める。
//   基本波とその整数倍の高調波(0 倍 = 直流を含む)の位置から ±EXCLUDE ビンを除き、残りのビンの「山」
//   (両隣より大きいビン)のうち最大のものを折り返し成分とし、基本波の山との比 [dB] を報告する。
//   山だけを数えるのは、強い高調波の窓の裾(山を持たず単調に下がる)を折り返し成分と数えないため。
//   4000 Hz は fs/12 で、折り返した成分がすべて高調波の位置に重なり、この方法では見えない。
//   そのため、周期が整数サンプルにならない近くの周波数 4186.0096 Hz(pitch = +4 V)も測る。
//   参考として、山を 20 kHz 以下(可聴域)に限った値も出す(仕様の方法は全帯域)。
import { writeFileSync } from "node:fs";
import { OscModule } from "../dist/src/modules/osc.js";

const fsArg = process.argv.indexOf("--fs");
const FS = fsArg >= 0 ? Number(process.argv[fsArg + 1]) : 48000;
if (!(FS > 0)) throw new Error("--fs には正の数を渡す");
const N = 1 << 16;
const F0 = 261.6256; // COM-03
const EXCLUDE = 3; // ビン。Hann 窓の主ローブは ±2 ビン
const AUDIBLE_HZ = 20000;
const FREQS = [440, 4000, 4186.0096, 10000];
const WAVES = ["saw", "pulse", "tri", "sine"];

/** 長さ 2^k の複素 FFT(その場で書き換える)。 */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const ar = re[i + k + len / 2];
        const ai = im[i + k + len / 2];
        const xr = ar * wr - ai * wi;
        const xi = ar * wi + ai * wr;
        re[i + k + len / 2] = re[i + k] - xr;
        im[i + k + len / 2] = im[i + k] - xi;
        re[i + k] += xr;
        im[i + k] += xi;
      }
    }
  }
}

/** 既定パラメータの VCO を pitch 一定で N サンプル動かし、4 波形の列を返す。 */
function capture(pitch) {
  const m = new OscModule(FS);
  const out = Object.fromEntries(WAVES.map((w) => [w, new Float64Array(N)]));
  m.input("pitch").set([pitch]);
  for (let n = 0; n < N; n++) {
    m.step();
    for (const w of WAVES) out[w][n] = m.output(w).values[0];
  }
  return out;
}

/** 折り返し成分の基本波比 [dB] と、その周波数 [Hz]。 */
function aliasing(x, f) {
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let n = 0; n < N; n++) re[n] = x[n] * (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N));
  fft(re, im);
  const half = N / 2;
  const mag = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) mag[k] = Math.hypot(re[k], im[k]);
  const df = FS / N;
  const excluded = new Uint8Array(half + 1);
  for (let h = 0; h * f <= FS / 2 + EXCLUDE * df; h++) {
    const c = Math.round((h * f) / df);
    for (let k = Math.max(0, c - EXCLUDE); k <= Math.min(half, c + EXCLUDE); k++) excluded[k] = 1;
  }
  const c1 = Math.round(f / df);
  let fund = 0;
  for (let k = c1 - EXCLUDE; k <= c1 + EXCLUDE; k++) fund = Math.max(fund, mag[k]);
  const peakBelow = (kMax) => {
    let peak = 0;
    let at = -1;
    for (let k = 1; k < Math.min(half, kMax + 1); k++) {
      if (excluded[k] || !(mag[k] > mag[k - 1] && mag[k] > mag[k + 1])) continue;
      if (mag[k] > peak) {
        peak = mag[k];
        at = k;
      }
    }
    return { db: 20 * Math.log10(peak / fund), hz: at * df };
  };
  const all = peakBelow(half);
  const audible = peakBelow(Math.floor(AUDIBLE_HZ / df));
  return { db: all.db, hz: all.hz, db20k: audible.db, hz20k: audible.hz };
}

const rows = [];
for (const target of FREQS) {
  const pitch = Math.log2(target / F0);
  const f = F0 * Math.pow(2, pitch);
  const cap = capture(pitch);
  for (const w of WAVES) {
    const r = aliasing(cap[w], f);
    rows.push({ target_hz: target, f_hz: f, pitch_v: pitch, wave: w, alias_db: r.db, alias_at_hz: r.hz, alias_db_20k: r.db20k, alias_at_hz_20k: r.hz20k });
  }
}

console.log(`MOD-OSC-001 仕様版 ${new OscModule(FS).def.specVersion}、fs=${FS}、2^16 サンプル、Hann 窓、除外 ±${EXCLUDE} ビン`);
console.log("周波数 | 波形 | 折り返し成分の基本波比 [dB] | その周波数 [Hz] | 20 kHz 以下に限った比 [dB] | その周波数 [Hz]");
for (const r of rows) console.log(`${r.target_hz} | ${r.wave} | ${r.alias_db.toFixed(1)} | ${r.alias_at_hz.toFixed(1)} | ${r.alias_db_20k.toFixed(1)} | ${r.alias_at_hz_20k.toFixed(1)}`);

const j = process.argv.indexOf("--json");
if (j >= 0 && process.argv[j + 1]) {
  const doc = { spec_version: new OscModule(FS).def.specVersion, fs: FS, n: N, window: "hann", exclude_bins: EXCLUDE, audible_hz: AUDIBLE_HZ, rows };
  writeFileSync(process.argv[j + 1], JSON.stringify(doc, null, 2) + "\n");
}
