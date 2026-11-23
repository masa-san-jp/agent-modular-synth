// サーバーでの、演奏データの音声ファイルへの書き出し(operation-contract CMD-34、verification-plan VER-A-011c・d)。
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { EngineBackend } from "../src/control/backend.js";
import { buildCatalog } from "../src/control/catalog.js";
import { Controller } from "../src/control/controller.js";
import { MemoryPatchStore } from "../src/control/memory-store.js";
import { renderPerformance } from "../src/control/render.js";
import { Session } from "../src/control/session.js";
import { REGISTRY } from "../src/modules/registry.js";
import { createApp } from "../src/server/app.js";

const TOKEN = "agent-token-0123456789abcdef0123456789abcdef";
const TAB = "tab-token-0123456789abcdef0123456789abcdef00";
type Obj = Record<string, any>;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** 短い演奏の演奏データ(文字列)を作る。seconds が長いほど、書き出しに時間がかかる。 */
async function performanceText(seconds = 1): Promise<string> {
  const be = new EngineBackend(48000, REGISTRY);
  const session = new Session({ catalog: buildCatalog(REGISTRY), backend: be, sessionId: "live" });
  const store = new MemoryPatchStore({ maxBytes: 1 << 23 });
  const c = new Controller({ session, store: new MemoryPatchStore(), performanceStore: store, now: () => 0 });
  let n = 0;
  const send = async (command: string, args?: Obj): Promise<void> => {
    const r = await c.handle({ v: 1, request_id: `l-${++n}`, command, ...(args ? { args } : {}) }, "human");
    assert.equal(r.ok, true, `${command}: ${JSON.stringify(r)}`);
  };
  await send("batch", {
    ops: [
      { command: "module.add", args: { id: "midi", type: "MOD-IO-002" } },
      { command: "module.add", args: { id: "vco", type: "MOD-OSC-001" } },
      { command: "module.add", args: { id: "vca", type: "MOD-AMP-001" } },
      { command: "cable.connect", args: { from: { module: "midi", port: "PITCH" }, to: { module: "vco", port: "pitch" } } },
      { command: "cable.connect", args: { from: { module: "vco", port: "saw" }, to: { module: "vca", port: "in1" } } },
      { command: "cable.connect", args: { from: { module: "midi", port: "GATE" }, to: { module: "vca", port: "cv1" } } },
      { command: "cable.connect", args: { from: { module: "vca", port: "out" }, to: { module: "out", port: "IN_L" } } },
    ],
  });
  await send("engine.start");
  await send("score.play", { notes: [{ t: 0, dur: seconds / 2, note: 60 }], length: seconds });
  await c.savePerformances();
  const names = (await store.list()) as Obj;
  return ((await store.read(names.value[0].name)) as Obj).value.text;
}

async function withServer(fn: (x: { url: string; perfDir: string; cmd: (command: string, args?: Obj) => Promise<Obj>; until: (name: string, args?: Obj) => Promise<Obj> }) => Promise<void>): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), "synth-render-"));
  const perfDir = join(base, "performances");
  await mkdir(join(base, "web"));
  await mkdir(perfDir);
  await writeFile(join(base, "web", "index.html"), "<!doctype html>");
  const app = createApp({ webRoot: join(base, "web"), patchDir: join(base, "patches"), performanceDir: perfDir, catalog: buildCatalog(REGISTRY), agentToken: TOKEN, tabToken: TAB });
  const port = await app.listen(0);
  const url = `http://127.0.0.1:${port}`;
  let n = 0;
  const cmd = async (command: string, args?: Obj): Promise<Obj> => {
    const res = await fetch(`${url}/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ v: 1, request_id: `rs-${++n}`, command, ...(args ? { args } : {}) }),
    });
    return (await res.json()) as Obj;
  };
  /** 終わる(done / failed)まで、同じ引数で聞き続ける。 */
  const until = async (name: string, args: Obj = {}): Promise<Obj> => {
    for (let i = 0; i < 600; i++) {
      const r = await cmd("performance.render", { name, ...args });
      assert.equal(r.ok, true, JSON.stringify(r));
      if (r.result.status === "done" || r.result.status === "failed") return r.result;
      await sleep(50);
    }
    throw new Error("書き出しが終わらない");
  };
  try {
    await fn({ url, perfDir, cmd, until });
  } finally {
    await app.close();
    await rm(base, { recursive: true, force: true });
  }
}

test("VER-A-011c performance.render: タブなしで <名前>.wav ができる。中身は、同じ演奏データを計算した結果と一致する。書き出し済みなら作り直さない", () =>
  withServer(async ({ perfDir, cmd, until }) => {
    const text = await performanceText(1);
    await writeFile(join(perfDir, "20261123-210405.performance.json"), text);
    const first = await cmd("performance.render", { name: "20261123-210405" });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.revision, null, "タブがない(セッションの値はない)");
    assert.ok(["queued", "rendering", "done"].includes(first.result.status));
    assert.equal(first.result.name, "20261123-210405");
    const done = await until("20261123-210405");
    assert.equal(done.status, "done");
    assert.equal(done.file, "20261123-210405.wav");
    assert.equal(done.path, join(perfDir, "20261123-210405.wav"));
    assert.equal(done.fs, 48000);
    assert.equal(done.seconds, 3, "演奏 1 秒 + 余韻 2 秒");
    assert.equal(done.level_db, -6);
    assert.equal(done.scores, 1);
    assert.ok(done.peak > 0.01);
    assert.deepEqual((await readdir(perfDir)).sort(), ["20261123-210405.performance.json", "20261123-210405.wav"]);

    // WAV の中身: 16 ビット・ステレオ・48 kHz。サンプルは、同じ演奏データを計算した結果を 16 ビットにしたもの
    const wav = await readFile(done.path);
    assert.equal(wav.length, done.bytes);
    assert.equal(wav.toString("latin1", 0, 4) + wav.toString("latin1", 8, 16) + wav.toString("latin1", 36, 40), "RIFFWAVEfmt data");
    assert.deepEqual([wav.readUInt16LE(20), wav.readUInt16LE(22), wav.readUInt32LE(24), wav.readUInt16LE(34), wav.readUInt32LE(40)], [1, 2, 48000, 16, 3 * 48000 * 4]);
    let i = 0;
    await renderPerformance(text, REGISTRY, { levelDb: -6, tailSeconds: 2 }, (l, r, n) => {
      for (let k = 0; k < n; k++, i++) {
        if (wav.readInt16LE(44 + i * 4) !== Math.round(Math.max(-1, Math.min(1, l[k]!)) * 32767) || wav.readInt16LE(46 + i * 4) !== Math.round(Math.max(-1, Math.min(1, r[k]!)) * 32767)) assert.fail(`${i} 番目のサンプルが違う`);
      }
    });
    assert.equal(i, 3 * 48000);

    // 書き出し済み: 作り直さない(ファイルの更新時刻が変わらない)
    await utimes(done.path, new Date(1000), new Date(1000));
    assert.deepEqual((await cmd("performance.render", { name: "20261123-210405" })).result, { name: "20261123-210405", ...done });
    assert.equal((await readFile(done.path)).length, wav.length);
    const { mtimeMs } = await (await import("node:fs/promises")).stat(done.path);
    assert.equal(mtimeMs, 1000);
    // 引数が変われば作り直す
    const quiet = await until("20261123-210405", { level_db: -26, tail_seconds: 0 });
    assert.equal(quiet.seconds, 1);
    assert.ok(Math.abs(quiet.peak / done.peak - 0.1) < 1e-3);
    // 演奏データが変われば(演奏が続いて楽譜が足された)、作り直す
    await writeFile(join(perfDir, "20261123-210405.performance.json"), await performanceText(1.5));
    const again = await until("20261123-210405");
    assert.equal(again.seconds, 3.5);
  }));

test("VER-A-011c performance.render の失敗: ない名前・引数の不正はコマンドの失敗。中身が不正な演奏データは status: failed(もう一度頼めば、やり直す)", () =>
  withServer(async ({ perfDir, cmd, until }) => {
    const ids = async (args: Obj): Promise<string> => (await cmd("performance.render", args)).error?.id;
    assert.equal(await ids({ name: "nothing" }), "ERR-202");
    assert.equal(await ids({}), "ERR-003");
    assert.equal(await ids({ name: "../x" }), "ERR-201");
    assert.equal(await ids({ name: "a", level_db: 6 }), "ERR-123");
    assert.equal(await ids({ name: "a", tail_seconds: -1 }), "ERR-123");
    assert.equal(await ids({ name: "a", speed: 2 }), "ERR-003");
    const good = JSON.parse(await performanceText(0.5)) as Obj;
    await writeFile(join(perfDir, "broken.performance.json"), "{");
    await writeFile(join(perfDir, "wrong-format.performance.json"), JSON.stringify({ ...good, format: "x" }));
    await writeFile(join(perfDir, "too-long.performance.json"), JSON.stringify({ ...good, length_seconds: 4000 }));
    assert.equal((await until("broken")).error.id, "ERR-204");
    assert.equal((await until("wrong-format")).error.id, "ERR-205");
    const long = await until("too-long");
    assert.equal(long.status, "failed");
    assert.equal(long.error.id, "ERR-106");
    assert.equal(long.error.details.limit, "render_seconds");
    // 直してから頼み直すと、書き出せる
    await writeFile(join(perfDir, "broken.performance.json"), JSON.stringify(good));
    assert.equal((await until("broken")).status, "done");
    assert.deepEqual((await readdir(perfDir)).filter((f) => !f.endsWith(".json")), ["broken.wav"], "失敗した書き出しは、ファイルを残さない");
    // 他のコマンドは、タブがなければ従来どおり
    assert.equal((await cmd("performance.list")).error.id, "ERR-006");
  }));

test("VER-A-011c 書き出しの間も、サーバーは他の要求に答える。待たせられる書き出しは 4 件まで", () =>
  withServer(async ({ perfDir, cmd, until }) => {
    const text = await performanceText(20);
    for (const n of ["a", "b", "c", "d", "e"]) await writeFile(join(perfDir, `${n}.performance.json`), text);
    const started = Date.now();
    const states = [];
    for (const n of ["a", "b", "c", "d"]) states.push((await cmd("performance.render", { name: n, tail_seconds: 0 })).result.status);
    assert.equal(states[0] === "queued" || states[0] === "rendering", true);
    assert.deepEqual(states.slice(1), ["queued", "queued", "queued"]);
    const fifth = await cmd("performance.render", { name: "e", tail_seconds: 0 });
    assert.equal(fifth.error.id, "ERR-106");
    assert.equal(fifth.error.details.limit, "render_jobs");
    const types = await cmd("module.list_types");
    assert.equal(types.ok, true);
    assert.ok(Date.now() - started < 3000, "書き出しを待たずに答える");
    const a = await until("a", { tail_seconds: 0 });
    assert.equal(a.seconds, 20);
  }));

test("VER-A-011d コマンド行(npm run render)から、サーバーなしで書き出せる。同じ入力からバイト同一のファイルになる", async () => {
  const base = await mkdtemp(join(tmpdir(), "synth-render-cli-"));
  try {
    await writeFile(join(base, "20261123-210405.performance.json"), await performanceText(1));
    const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "server", "render-cli.js");
    const run = (args: string[]) => promisify(execFile)(process.execPath, [cli, ...args], { env: { ...process.env, SYNTH_PERFORMANCE_DIR: base } });
    const byName = await run(["20261123-210405"]);
    assert.match(byName.stdout, /書き出し: .*20261123-210405\.wav.3\.0 秒/);
    const byPath = await run([join(base, "20261123-210405.performance.json"), join(base, "copy.wav"), "--tail", "2", "--level", "-6"]);
    assert.match(byPath.stdout, /copy\.wav/);
    const a = await readFile(join(base, "20261123-210405.wav"));
    assert.equal(a.length, 44 + 3 * 48000 * 4);
    assert.ok(a.equals(await readFile(join(base, "copy.wav"))), "バイト同一");
    await assert.rejects(run(["nothing"]), /演奏データがない/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
