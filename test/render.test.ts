// 演奏データを、演奏せずに音声へ書き出す(operation-contract CMD-34、verification-plan VER-A-011a・b)。
import assert from "node:assert/strict";
import { test } from "node:test";
import { EngineBackend } from "../src/control/backend.js";
import { buildCatalog } from "../src/control/catalog.js";
import { Controller } from "../src/control/controller.js";
import { CommandError } from "../src/control/errors.js";
import { MemoryPatchStore } from "../src/control/memory-store.js";
import { SCORE_LIMITS } from "../src/control/performance.js";
import { RENDER_DEFAULTS, RENDER_LIMITS, parseRenderArgs, renderPerformance } from "../src/control/render.js";
import { Session } from "../src/control/session.js";
import { REGISTRY } from "../src/modules/registry.js";

const FS = 48000;
const LEAD = Math.round(SCORE_LIMITS.leadSeconds * FS);
type Obj = Record<string, any>;

/** 実際に「演奏」して(エンジンを回して)、演奏データの文字列と、そのときの出力を返す。 */
async function perform(opts: { stopAt?: number; levelDb?: number } = {}): Promise<{ text: string; left: Float32Array; right: Float32Array }> {
  const be = new EngineBackend(FS, REGISTRY);
  const session = new Session({ catalog: buildCatalog(REGISTRY), backend: be, sessionId: "live" });
  const store = new MemoryPatchStore({ maxBytes: 1 << 23 });
  const c = new Controller({ session, store: new MemoryPatchStore(), performanceStore: store, now: () => 0 });
  let n = 0;
  const send = async (command: string, args?: Obj): Promise<Obj> => {
    const r = await c.handle({ v: 1, request_id: `l-${++n}`, command, ...(args ? { args } : {}) }, "human");
    assert.equal(r.ok, true, `${command}: ${JSON.stringify(r)}`);
    return r as Obj;
  };
  await send("batch", {
    ops: [
      { command: "module.add", args: { id: "midi", type: "MOD-IO-002" } },
      { command: "module.add", args: { id: "vco", type: "MOD-OSC-001" } },
      { command: "module.add", args: { id: "vcf", type: "MOD-FLT-001" } },
      { command: "module.add", args: { id: "env", type: "MOD-ENV-001", params: { release: 0.4 } } },
      { command: "module.add", args: { id: "vca", type: "MOD-AMP-001" } },
      { command: "cable.connect", args: { from: { module: "midi", port: "PITCH" }, to: { module: "vco", port: "pitch" } } },
      { command: "cable.connect", args: { from: { module: "vco", port: "saw" }, to: { module: "vcf", port: "in" } } },
      { command: "cable.connect", args: { from: { module: "vcf", port: "out" }, to: { module: "vca", port: "in1" } } },
      { command: "cable.connect", args: { from: { module: "midi", port: "GATE" }, to: { module: "env", port: "gate" } } },
      { command: "cable.connect", args: { from: { module: "env", port: "env" }, to: { module: "vca", port: "cv1" } } },
      { command: "cable.connect", args: { from: { module: "vca", port: "out" }, to: { module: "out", port: "IN_L" } } },
      { command: "cable.connect", args: { from: { module: "vca", port: "out" }, to: { module: "out", port: "IN_R" } } },
    ],
  });
  await send("engine.start");
  await send("output.set_level", { level_db: opts.levelDb ?? RENDER_DEFAULTS.levelDb });
  await send("score.play", { tempo_bpm: 120, notes: [{ t: 0, dur: 0.5, note: 57 }, { t: 1, dur: 0.9, note: 64 }], params: [{ t: 0, dur: 2, module_id: "vcf", param: "cutoff", value: 2.5 }], length: 2 });
  await send("score.play", { notes: [{ t: 0, dur: 0.3, note: 69 }], length: 0.5 });
  const total = LEAD + Math.round(1.5 * FS) + 2 * FS;
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const run = (from: number, to: number): void => {
    for (let i = from; i < to; i += 128) be.processBlock(left.subarray(i, Math.min(to, i + 128)), right.subarray(i, Math.min(to, i + 128)));
  };
  const stop = opts.stopAt === undefined ? LEAD + Math.round(1.5 * FS) : LEAD + Math.round(opts.stopAt * FS);
  run(0, stop);
  if (opts.stopAt === undefined) session.pollBackend(); // 演奏し終えた
  else await send("score.stop");
  run(stop, total);
  if (opts.stopAt === undefined) {
    // 30 秒たって閉じたことにする(演奏データの ended_by を finished にする)
    const L = new Float32Array(4800);
    for (let i = 0; i < 10 * 31; i++) be.processBlock(L, new Float32Array(4800));
    session.pollBackend();
  }
  await c.savePerformances();
  const names = await store.list();
  const text = await store.read((names as Obj).value[0].name);
  return { text: (text as Obj).value.text, left: left.subarray(LEAD), right: right.subarray(LEAD) };
}

/** 大きな配列の比較(違いの一覧を作らせない)。 */
function same(a: Float32Array, b: Float32Array, label: string): void {
  assert.equal(a.length, b.length, `${label}: 長さ`);
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) assert.fail(`${label}: ${i} 番目が違う(${a[i]} / ${b[i]})`);
}

async function collect(text: string, options: { levelDb: number; tailSeconds: number } = { levelDb: RENDER_DEFAULTS.levelDb, tailSeconds: 2 }) {
  const left: number[] = [];
  const right: number[] = [];
  const progress: number[] = [];
  const summary = await renderPerformance(text, REGISTRY, options, (l, r, n) => {
    for (let i = 0; i < n; i++) {
      left.push(l[i]!);
      right.push(r[i]!);
    }
  }, (done, total) => progress.push(done / total));
  return { summary, left: Float32Array.from(left), right: Float32Array.from(right), progress };
}

test("VER-A-011a 書き出したサンプルは、実際に演奏したときの出力とビット同一。2 回書き出しても同じ", async () => {
  const live = await perform();
  assert.equal(JSON.parse(live.text).ended_by, "finished");
  const a = await collect(live.text);
  assert.equal(a.summary.fs, FS);
  assert.equal(a.summary.frames, Math.round(1.5 * FS) + 2 * FS);
  assert.equal(a.summary.seconds, 3.5);
  assert.equal(a.summary.scores, 2);
  assert.equal(a.summary.clip_count, 0);
  assert.ok(a.summary.peak > 0.01 && a.summary.peak <= 1, `音が出ている: ${a.summary.peak}`);
  assert.equal(a.left.length, a.summary.frames);
  same(a.left, live.left, "左");
  same(a.right, live.right, "右");
  assert.equal(a.progress.at(-1), 1);
  assert.ok(a.progress.every((p, i) => i === 0 || p >= a.progress[i - 1]!));
  const b = await collect(live.text);
  same(b.left, a.left, "左");
  assert.deepEqual(b.summary, a.summary);
});

test("VER-A-011a 途中で止めた演奏は、同じ位置で止まる。余韻と音量の引数が効く", async () => {
  const live = await perform({ stopAt: 0.8 });
  const doc = JSON.parse(live.text);
  assert.equal(doc.ended_by, "stopped");
  assert.ok(Math.abs(doc.length_seconds - 0.8) < 1e-9);
  const a = await collect(live.text, { levelDb: RENDER_DEFAULTS.levelDb, tailSeconds: 1 });
  assert.equal(a.summary.frames, Math.round(0.8 * FS) + FS);
  same(a.left, live.left.subarray(0, a.summary.frames), "止めた後の消え際まで一致する");
  const tail0 = await collect(live.text, { levelDb: RENDER_DEFAULTS.levelDb, tailSeconds: 0 });
  assert.equal(tail0.summary.frames, Math.round(0.8 * FS));
  const quiet = await collect(live.text, { levelDb: -26, tailSeconds: 0 });
  assert.ok(Math.abs(quiet.summary.peak / tail0.summary.peak - 0.1) < 1e-3, "20 dB 下げると 1/10");
});

test("VER-A-011b 引数の検証と、不正な演奏データ(再演奏と同じエラー)。長すぎる演奏は ERR-106", async () => {
  assert.deepEqual(parseRenderArgs({ name: "a" }), { name: "a", options: { levelDb: -6, tailSeconds: 2 } });
  assert.deepEqual(parseRenderArgs({ name: "a", level_db: -12, tail_seconds: 0 }), { name: "a", options: { levelDb: -12, tailSeconds: 0 } });
  const idOf = (fn: () => unknown): string => {
    try {
      fn();
    } catch (e) {
      return e instanceof CommandError ? e.id : String(e);
    }
    return "ok";
  };
  assert.equal(idOf(() => parseRenderArgs({})), "ERR-003");
  assert.equal(idOf(() => parseRenderArgs({ name: "../x" })), "ERR-201");
  assert.equal(idOf(() => parseRenderArgs({ name: "a", level_db: "x" })), "ERR-003");
  assert.equal(idOf(() => parseRenderArgs({ name: "a", level_db: 1 })), "ERR-123");
  assert.equal(idOf(() => parseRenderArgs({ name: "a", tail_seconds: RENDER_LIMITS.maxTailSeconds + 1 })), "ERR-123");
  assert.equal(idOf(() => parseRenderArgs({ name: "a", extra: 1 })), "ERR-003");

  const good = JSON.parse((await perform({ stopAt: 0.2 })).text) as Obj;
  const fails = async (doc: unknown): Promise<string> => {
    try {
      await collect(typeof doc === "string" ? doc : JSON.stringify(doc), { levelDb: -6, tailSeconds: 0 });
    } catch (e) {
      return e instanceof CommandError ? e.id : String(e);
    }
    return "ok";
  };
  assert.equal(await fails("{"), "ERR-204");
  assert.equal(await fails({ ...good, format: "x" }), "ERR-205");
  assert.equal(await fails({ ...good, schema_version: 9 }), "ERR-205");
  assert.equal(await fails({ ...good, entries: [] }), "ERR-204");
  assert.equal(await fails({ ...good, fs: 10 }), "ERR-204");
  assert.equal(await fails({ ...good, length_seconds: "long" }), "ERR-204");
  assert.equal(await fails({ ...good, length_seconds: RENDER_LIMITS.maxSeconds + 1 }), "ERR-106");
  assert.equal(await fails({ ...good, patch: { ...good.patch, modules: good.patch.modules.filter((m: Obj) => m.id !== "vcf"), cables: [] } }), "ERR-102");
  assert.equal(await fails({ ...good, entries: [{ at: 0, actor: { kind: "agent" }, score: { notes: [{ t: 0, dur: 1, note: 200 }] } }] }), "ERR-123");
  assert.equal(await fails(good), "ok");
});
