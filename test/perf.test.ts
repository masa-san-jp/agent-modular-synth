// 性能の測定の道具(src/perf/、ワークレットの集計)が正しく動くことの確認。測定値そのものの合否は出さない(OPEN-001)。
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FromWorklet } from "../src/audio/messages.js";
import { WorkletCore } from "../src/audio/worklet-core.js";
import { EngineBackend } from "../src/control/backend.js";
import { buildCatalog } from "../src/control/catalog.js";
import { Session } from "../src/control/session.js";
import { REGISTRY } from "../src/modules/registry.js";
import { measure, stats } from "../src/perf/offline.js";
import { BPM_TYPES, BenchOp, bp0, bp1, bpAll, bpM, bpN, bpNModules, bpPoly } from "../src/perf/patches.js";

const CATALOG = buildCatalog(REGISTRY);

function build(ops: BenchOp[]): Session {
  const s = new Session({ catalog: CATALOG, backend: new EngineBackend(48000, REGISTRY), sessionId: "perf" });
  if (ops.length > 0) {
    const r = s.handle({ v: 1, request_id: "p", command: "batch", args: { ops } }, "agent");
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
    // 型の違う接続(gate → trigger など)は実際のパッチでも普通に使う。それ以外の注意(seed の重複など)はない
    assert.deepEqual((r as { warnings: { code: string }[] }).warnings.filter((w) => w.code !== "type_mismatch"), []);
  }
  return s;
}

test("測定用のパッチ(BP-0 / BP-1 / BP-POLY / BP-ALL / BP-N / BP-M)は、製品の検証を通って組める", () => {
  assert.equal(build(bp0()).getPatch().modules.length, 1);
  assert.equal(build(bp1()).getPatch().modules.length, 6);
  assert.equal(build(bpPoly()).getPatch().modules.find((m) => m.id === "midi")!.params.voices, 16);
  const all = build(bpAll()).getPatch();
  assert.deepEqual([...new Set(all.modules.map((m) => m.type))].sort(), [...CATALOG.keys()].sort(), "BP-ALL は 20 種すべてを含む");
  assert.equal(all.modules.length, 20);
  for (const n of [1, 2, 4, 16, 64]) {
    const p = build(bpN(n)).getPatch();
    assert.equal(p.modules.length, bpNModules(n));
    assert.equal(p.modules.filter((m) => m.type === "MOD-OSC-001").length, n);
  }
  assert.ok(bpNModules(64) <= 256, "N = 64 は製品の上限(256 モジュール)に収まる");
  assert.equal(BPM_TYPES.length, 19, "常設の出力を除く 19 種");
  for (const type of BPM_TYPES) {
    const p = build(bpM(type, 4)).getPatch();
    assert.equal(p.modules.filter((m) => m.id.startsWith("u")).length, 4, type);
    assert.ok(p.modules.filter((m) => m.id.startsWith("u")).every((m) => m.type === type));
  }
});

test("オフラインの測定: 音が出ているパッチで負荷値が求まる。集計(中央値・パーセンタイル・超過の数)が正しい", () => {
  const st = measure(bp1(), 0.2, { warmupSeconds: 0.1, midi: [[0x90, 60, 100]] });
  assert.equal(st.blocks, Math.ceil((0.2 * 48000) / 128));
  assert.ok(st.peak > 0.01, "音が出ている");
  assert.ok(st.median > 0 && st.median <= st.p95 && st.p95 <= st.p99 && st.p99 <= st.max);
  assert.ok(Math.abs(st.realtimeFactor - 1 / st.mean) < 1e-9);
  const s = stats(Float64Array.from([0.1, 0.2, 0.3, 0.4, 2.0]), 0.5, 3);
  assert.deepEqual({ median: s.median, max: s.max, over: s.over, blocks: s.blocks, modules: s.modules }, { median: 0.3, max: 2.0, over: 1, blocks: 5, modules: 3 });
});

test("ワークレットの集計: 測定中だけブロックごとの処理時間と、差分の適用までの時間を数える。始めるたびに 0 に戻る", () => {
  let t = 0;
  const posted: FromWorklet[] = [];
  // 1 ブロック(128 サンプル = 約 2.667 ms)の処理に、試験用の時計で 4 ms かかることにする(負荷値 1.5)
  const core = new WorkletCore(48000, REGISTRY, (m) => posted.push(m), { name: "test", now: () => (t += 2) });
  const L = new Float32Array(128);
  core.process(L, new Float32Array(128));
  assert.equal(core.status().perf, undefined, "測定していない間は集計を持たない");
  core.onMessage({ type: "perf", enabled: true });
  core.onMessage({ type: "ops", ops: [], revision: 1, sentAt: Date.now() - 5 });
  for (let i = 0; i < 10; i++) core.process(L, new Float32Array(128));
  const p = core.status().perf!;
  assert.equal(p.clock, "test");
  assert.equal(p.blocks, 10);
  assert.ok(Math.abs(p.meanLoad - 2 / ((128 / 48000) * 1000)) < 1e-9);
  assert.equal(p.over, 0);
  assert.equal(p.histogram.reduce((a, b) => a + b, 0), 10);
  assert.equal(p.histogram[Math.floor(p.meanLoad / 0.05)], 10);
  assert.equal(p.applyCount, 1);
  assert.ok(p.applyMaxMs >= 5 && p.applyMaxMs < 1000);
  core.onMessage({ type: "perf", enabled: true });
  assert.equal(core.status().perf!.blocks, 0);
  core.onMessage({ type: "perf", enabled: false });
  assert.equal(core.status().perf, undefined);
  assert.deepEqual(posted, []);
});
