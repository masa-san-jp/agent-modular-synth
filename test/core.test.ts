// 音声の中核(エンジン+出力保護)をオフラインで確認する。AudioWorklet はこのクラスを包むだけ。
import assert from "node:assert/strict";
import { test } from "node:test";
import { AudioCore, DEMO_PATCH } from "../src/audio/core.js";
import { PROVISIONAL } from "../src/audio/output-stage.js";
import { REGISTRY } from "../src/modules/registry.js";

const FS = 48000;

function mk(): AudioCore {
  const c = new AudioCore(FS, REGISTRY);
  c.loadPatch(DEMO_PATCH);
  return c;
}

/** 総フレーム数を blockSize ごとに処理する。events はブロック境界(フレーム番号)で適用する操作。 */
function render(c: AudioCore, total: number, blockSize: number, events: Record<number, (c: AudioCore) => void> = {}): Float32Array[] {
  const L = new Float32Array(total);
  const R = new Float32Array(total);
  for (let n = 0; n < total; n += blockSize) {
    for (const [at, f] of Object.entries(events)) {
      const a = Number(at);
      if (a >= n && a < n + blockSize) {
        assert.equal(a % 128, 0, "操作は128フレームの境界に置く");
        if (a === n) f(c);
      }
    }
    const l = L.subarray(n, n + blockSize);
    const r = R.subarray(n, n + blockSize);
    c.processBlock(l, r);
  }
  return [L, R];
}
const bits = (b: Float32Array): number[] => Array.from(new Uint32Array(b.buffer, b.byteOffset, b.length));
const peak = (b: Float32Array): number => b.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

const EVENTS: Record<number, (c: AudioCore) => void> = {
  0: (c) => c.start(),
  1280: (c) => c.setParam("gate", "offset", 10),
  12800: (c) => c.setParam("pitch", "offset", 7 / 12),
  25600: (c) => c.setParam("gate", "offset", 0),
  38400: (c) => {
    c.setLevel(-6, "human");
    c.setParam("gate", "offset", 10);
  },
};

test("音声の開始前は無音。開始してゲートを開くと音が出て、出力は ±1.0 以内で有限", () => {
  const c = mk();
  const silent = render(c, 1280, 128);
  assert.equal(peak(silent[0]!), 0, "開始前は無音(ユーザー操作まで音を出さない)");
  const [L, R] = render(c, 48000, 128, EVENTS);
  assert.ok(peak(L!.subarray(0, 1280)) === 0, "ゲートを開く前は無音");
  const p = peak(L!);
  assert.ok(p > 0.01 && p <= 1, `ピーク ${p}`);
  for (const v of L!) assert.ok(Number.isFinite(v));
  assert.deepEqual(bits(L!), bits(R!), "IN_R 未接続なので左右は同じ(normal = IN_L)");
  const s = c.status();
  assert.equal(s.audioState, "running");
  assert.equal(s.moduleNonfiniteCount, 0);
  assert.equal(s.nonfiniteCount, 0);
});

test("DEC-108: ブロック長 128 と 1 でビット同一(操作はブロック境界で適用)", () => {
  const a = render(mk(), 48000, 128, EVENTS);
  const b = render(mk(), 48000, 1, EVENTS);
  assert.deepEqual(bits(a[0]!), bits(b[0]!));
  assert.deepEqual(bits(a[1]!), bits(b[1]!));
});

test("VER-NF-003: 同じ操作列の2回実行でビット同一", () => {
  const a = render(mk(), 48000, 128, EVENTS);
  const b = render(mk(), 48000, 128, EVENTS);
  assert.deepEqual(bits(a[0]!), bits(b[0]!));
});

test("起動直後は低い既定音量: 出力のピークは既定音量 × 入力のピーク以下", () => {
  const c = mk();
  const [L] = render(c, 24000, 128, { 0: (x) => x.start(), 128: (x) => x.setParam("gate", "offset", 10) });
  const limit = Math.pow(10, PROVISIONAL.defaultLevelDb / 20) * (5 / 5) * 1.0001; // VCO ±5 V = ±1.0、VCA 利得は最大1
  assert.ok(peak(L!) <= limit, `ピーク ${peak(L!)} > ${limit}`);
  assert.ok(peak(L!) > 0.01);
});

test("VER-S-002: 緊急停止で即時に無音になり、内部状態が初期化される。パッチとパラメータは残り、解除後にまた鳴る", () => {
  const c = mk();
  render(c, 12800, 128, { 0: (x) => x.start(), 128: (x) => x.setParam("gate", "offset", 10) });
  assert.ok(c.status().step > 0);
  c.panic();
  assert.equal(c.status().step, 0, "エンジンは初期状態に戻る");
  const [L] = render(c, 12800, 128);
  assert.equal(peak(L!), 0);
  assert.equal(c.status().panic, true);
  c.releasePanic();
  const [L2] = render(c, 12800, 128);
  assert.ok(peak(L2!) > 0.01, "ゲートのパラメータは残っているので、解除後に鳴る");
});

test("パッチの読込で音量は上がらない(DEC-111)。既定値より上げていた場合は既定値へ下がる", () => {
  const c = mk();
  c.start();
  c.setLevel(-3, "human");
  c.loadPatch(DEMO_PATCH);
  assert.equal(c.status().levelDb, PROVISIONAL.defaultLevelDb);
  assert.equal(c.status().agentMaxLevelDb, -3);
  c.setLevel(-40, "human");
  c.loadPatch(DEMO_PATCH);
  assert.equal(c.status().levelDb, -40);
});

test("過大な信号(VCA を通さず VCO を直接、出力モジュールの level 最大)でも最終出力は ±1.0 以内で、リミッターが働く", () => {
  const c = new AudioCore(FS, REGISTRY);
  c.loadPatch({
    modules: [
      { id: "vco", type: "MOD-OSC-001" },
      { id: "out", type: "MOD-IO-001", params: { level: 2 } },
    ],
    cables: [{ from: ["vco", "pulse"], to: ["out", "IN_L"] }],
    output: "out",
  });
  c.start();
  c.setLevel(0, "human");
  const [L] = render(c, 48000, 128);
  assert.ok(peak(L!) <= PROVISIONAL.limiterThreshold + 1e-6, `ピーク ${peak(L!)}`);
  const s = c.status();
  assert.ok(s.limiterGain < 1, "リミッターが利得を下げている");
  assert.ok(s.preClipCount > 0, "出力モジュールは PRE の ±1.0 超過を数える(リミッターの前)");
  assert.equal(s.clipCount, 0, "最終クリップ(リミッターの後)は働かない");
});

test("未知の種別や PRE を持たない出力モジュールのパッチは拒否し、現在のパッチは変わらない", () => {
  const c = mk();
  assert.throws(() => c.loadPatch({ modules: [{ id: "x", type: "MOD-XYZ-999" }], cables: [], output: "x" }), /未知/);
  assert.throws(() => c.loadPatch({ modules: [{ id: "u", type: "MOD-UTL-001" }], cables: [], output: "u" }), /PRE_L/);
  const [L] = render(c, 12800, 128, { 0: (x) => x.start(), 128: (x) => x.setParam("gate", "offset", 10) });
  assert.ok(peak(L!) > 0.01, "元のパッチがそのまま鳴る");
});
