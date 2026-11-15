// 出力保護の不変条件(検証計画 §9: VER-S-001、002、003、004、006 のうちオフラインで確認できる部分)。
// 定数は仮値(OPEN-010)なので、値そのものではなく不変条件を確認する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { OutputStage, PROVISIONAL } from "../src/audio/output-stage.js";

const FS = 48000;
const FADE = Math.round(PROVISIONAL.fadeSeconds * FS);

function run(st: OutputStage, n: number, f: (i: number) => [number, number]): { l: number[]; r: number[] } {
  const l: number[] = [];
  const r: number[] = [];
  for (let i = 0; i < n; i++) {
    const [a, b] = f(i);
    st.step(a, b);
    l.push(st.outL[0]!);
    r.push(st.outR[0]!);
  }
  return { l, r };
}
const peak = (xs: number[]): number => xs.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

function started(levelDb = 0): OutputStage {
  const st = new OutputStage(FS);
  st.start();
  assert.deepEqual(st.setLevel(levelDb, "human"), { ok: true });
  return st;
}

test("VER-S-001a: 過大信号を入れても最終出力は ±1.0 を超えず有限", () => {
  const st = started(0);
  const sig = (i: number): [number, number] => {
    const x = 76.8 * Math.sin((2 * Math.PI * 440 * i) / FS); // 16声 × ±12 V × level 2 に相当する最大値
    return [x, -x];
  };
  const { l, r } = run(st, FS, sig);
  for (const v of [...l, ...r]) assert.ok(Number.isFinite(v) && Math.abs(v) <= 1);
});

test("VER-S-001e: リミッターはクリップより前で利得を下げ、最終クリップは働かず、入力が下がると復帰する", () => {
  const st = started(0);
  run(st, FADE + 2000, () => [0.5, 0.5]); // フェードと音量の平滑化が落ち着くまで
  assert.ok(Math.abs(st.status().limiterGain - 1) < 1e-9, "しきい値未満では作用しない");
  const before = st.status().clipCount;
  const { l } = run(st, 4800, (i) => [2.0 * Math.sin((2 * Math.PI * 1000 * i) / FS), 0]); // PRE = ±2.0
  assert.ok(st.status().limiterGain < 1, "利得が1未満に下がる");
  assert.ok(peak(l) <= PROVISIONAL.limiterThreshold + 1e-9, "出力はしきい値以下");
  assert.equal(st.status().clipCount, before, "最終クリップは働かない");
  run(st, FS, () => [0.1, 0.1]);
  assert.ok(st.status().limiterGain > 0.999, "入力が下がると利得が1へ戻る");
});

test("VER-S-001: リミッターの利得は1を超えない", () => {
  const st = started(0);
  let max = 0;
  for (let i = 0; i < FS; i++) {
    st.step(i % 9000 < 3000 ? 5 : 0.01, 0);
    max = Math.max(max, st.status().limiterGain);
  }
  assert.ok(max <= 1);
});

test("VER-S-006b: 出力段に非有限値が入っても出力は有限で、回数を数える", () => {
  const st = started(0);
  const { l, r } = run(st, 10, (i) => (i === 3 ? [NaN, 0.1] : i === 5 ? [Infinity, -Infinity] : [0.1, 0.1]));
  for (const v of [...l, ...r]) assert.ok(Number.isFinite(v));
  assert.equal(st.status().nonfiniteCount, 3);
});

test("VER-S-002: 緊急停止の後は次のサンプルから厳密に無音で、解除まで続く。エージェントの音量設定でも鳴らない", () => {
  const st = started(0);
  run(st, 5000, () => [0.8, 0.8]);
  st.panic();
  const { l, r } = run(st, 5000, () => [0.8, 0.8]);
  assert.equal(peak(l), 0);
  assert.equal(peak(r), 0);
  st.setLevel(-30, "agent");
  st.start(); // 音声の再開の契機があっても、緊急停止中は消音が続く
  assert.equal(peak(run(st, 2000, () => [0.8, 0.8]).l), 0);
  assert.equal(st.releasePanic(), true);
  const after = run(st, FADE + 10, () => [0.8, 0.8]).l;
  assert.equal(after[0]! < after[FADE - 1]!, true, "解除後は無音からフェードインする");
});

test("VER-S-003: 起動時は既定値(低い音量)から始まり、無音からフェードインする", () => {
  const st = new OutputStage(FS);
  assert.equal(st.status().levelDb, PROVISIONAL.defaultLevelDb);
  assert.equal(peak(run(st, 100, () => [1, 1]).l), 0, "音声の開始前は無音");
  st.start();
  const y = run(st, FADE * 2, () => [1, 1]).l;
  assert.ok(y[0]! <= 1 / FADE + 1e-12, "最初のサンプルはほぼ無音");
  for (let i = 1; i < FADE; i++) assert.ok(y[i]! >= y[i - 1]!, "フェード中は単調に増える");
  const target = Math.pow(10, PROVISIONAL.defaultLevelDb / 20);
  assert.ok(Math.abs(y[y.length - 1]! - target) < 1e-6, "フェード後は既定の音量");
});

test("DEC-111: 契機では音量を自動で上げない(min(現在値, 既定値))。上限は変わらない", () => {
  const d = PROVISIONAL.defaultLevelDb;
  // 人が既定値より下げていた場合: そのまま
  const low = started(d - 20);
  for (const t of ["patch_replaced", "reinit"] as const) {
    assert.equal(low.reduce(t), false);
    assert.equal(low.status().levelDb, d - 20);
    assert.equal(low.status().agentMaxLevelDb, d - 20);
  }
  low.start();
  assert.equal(low.status().levelDb, d - 20);
  // 人が既定値より上げていた場合: 既定値へ下げる。上限(人が最後に設定した値)は変えない
  const high = started(d + 15);
  assert.equal(high.reduce("patch_replaced"), true);
  assert.equal(high.status().levelDb, d);
  assert.equal(high.status().agentMaxLevelDb, d + 15);
  // 緊急停止の解除でも同じ
  const p = started(d + 10);
  p.panic();
  p.releasePanic();
  assert.equal(p.status().levelDb, d);
});

test("VER-S-004: エージェントは上限を超える音量を設定できない。上限を変えられるのは人だけ", () => {
  const st = started(-30);
  assert.deepEqual(st.setLevel(-29, "agent"), { ok: false, reason: "over_agent_max" });
  assert.equal(st.status().levelDb, -30, "拒否された要求は状態を変えない");
  assert.deepEqual(st.setLevel(-40, "agent"), { ok: true });
  assert.equal(st.status().agentMaxLevelDb, -30, "エージェントの設定で上限は変わらない");
  assert.deepEqual(st.setLevel(-30, "agent"), { ok: true });
  assert.deepEqual(st.setLevel(1, "human"), { ok: false, reason: "out_of_range" });
  assert.deepEqual(st.setLevel(NaN, "human"), { ok: false, reason: "not_a_number" });
  assert.deepEqual(st.setLevel(-10, "human"), { ok: true });
  assert.equal(st.status().agentMaxLevelDb, -10);
});

test("乱数の過大・非有限入力でも出力は常に有限で ±1.0 以内", () => {
  const st = started(0);
  let s = 12345;
  const rnd = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < 200000; i++) {
    const k = rnd();
    const x = k < 0.01 ? NaN : k < 0.02 ? Infinity : k < 0.03 ? -Infinity : (rnd() * 2 - 1) * 100;
    st.step(x, (rnd() * 2 - 1) * 100);
    const a = st.outL[0]!;
    const b = st.outR[0]!;
    if (!(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 1 && Math.abs(b) <= 1)) {
      assert.fail(`i=${i}: ${a}, ${b}`);
    }
    if (i % 50000 === 49999) st.reduce("patch_replaced");
  }
});
