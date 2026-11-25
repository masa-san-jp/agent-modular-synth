// サーバーの中での音声ファイルの書き出し(CMD-34 performance.render)の所要時間を測る。Issue #48。
// 使い方: node test/browser/bench-render.cjs <演奏データ(.performance.json)> [--json <結果の出力先>]
// 2 つの条件で測る: (1) タブなし (2) タブで、演奏データと同じパッチの音声を動かしたまま。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..", "..");
const load = (rel) => import(pathToFileURL(path.join(root, "dist", "src", rel)).href);

async function main() {
  const args = process.argv.slice(2);
  const ji = args.indexOf("--json");
  const jsonOut = ji >= 0 ? args.splice(ji, 2)[1] : null;
  const src = args[0];
  if (!src) throw new Error("演奏データのファイルを指定する");
  const record = JSON.parse(fs.readFileSync(src, "utf8"));
  const { chromium } = require("playwright");
  const { createApp } = await load("server/app.js");
  const { buildCatalog } = await load("control/catalog.js");
  const { REGISTRY } = await load("modules/registry.js");

  const patchDir = fs.mkdtempSync(path.join(os.tmpdir(), "synth-bench-render-"));
  const perfDir = `${patchDir}-performances`;
  fs.mkdirSync(perfDir, { mode: 0o700 });
  const app = createApp({ webRoot: path.join(root, "web"), patchDir, performanceDir: perfDir, catalog: buildCatalog(REGISTRY) });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  let seq = 0;
  const agent = async (command, a) => {
    const res = await fetch(`${base}/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${app.agentToken}` },
      body: JSON.stringify({ v: 1, request_id: `br-${++seq}`, command, ...(a ? { args: a } : {}) }),
    });
    const r = await res.json();
    assert.equal(r.ok, true, `${command}: ${JSON.stringify(r)}`);
    return r.result;
  };
  const renderOnce = async (name) => {
    fs.copyFileSync(src, path.join(perfDir, `${name}.performance.json`));
    const t0 = performance.now();
    let r = await agent("performance.render", { name });
    while (r.status === "queued" || r.status === "rendering") {
      await new Promise((res) => setTimeout(res, 250));
      r = await agent("performance.render", { name });
    }
    const sec = (performance.now() - t0) / 1000;
    assert.equal(r.status, "done", JSON.stringify(r));
    return { wall_seconds: sec, audio_seconds: r.seconds, speed: r.seconds / sec, md5: require("node:crypto").createHash("md5").update(fs.readFileSync(path.join(perfDir, r.file))).digest("hex") };
  };
  const results = {};
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  try {
    // (1) タブなし
    results.no_tab = await renderOnce("20260101-000001");
    console.log(`タブなし: ${results.no_tab.wall_seconds.toFixed(1)} 秒(音声 ${results.no_tab.audio_seconds.toFixed(1)} 秒、実時間の ${results.no_tab.speed.toFixed(2)} 倍)`);
    // (2) タブで同じパッチの音声を動かしたまま
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${base}/`);
    const synth = (expr) => page.evaluate(`window.__synth.${expr}`);
    for (let t = 0; !(await synth("serverAccepted")); t++) {
      if (t > 200) throw new Error("タブの接続");
      await page.waitForTimeout(50);
    }
    fs.writeFileSync(path.join(patchDir, "bench.patch.json"), JSON.stringify(record.patch) + "\n", { mode: 0o600 });
    await agent("patch.load", { name: "bench" });
    await page.click("#start");
    for (let t = 0; (await synth("audioState")) !== "running"; t++) {
      if (t > 200) throw new Error("音声の開始");
      await page.waitForTimeout(50);
    }
    const modules = (await synth("patch")).modules.length;
    await page.waitForTimeout(2000);
    const c0 = (await synth("audioClock")).currentTime;
    const w0 = Date.now();
    results.tab_running = { ...(await renderOnce("20260101-000002")), tab_modules: modules };
    const clock = ((await synth("audioClock")).currentTime - c0) / ((Date.now() - w0) / 1000);
    results.tab_running.tab_clock_ratio = clock;
    console.log(`タブで音声を動かしたまま(${modules} モジュール): ${results.tab_running.wall_seconds.toFixed(1)} 秒(実時間の ${results.tab_running.speed.toFixed(2)} 倍)、タブの音声の時計の比 ${clock.toFixed(3)}`);
    assert.equal(results.tab_running.md5, results.no_tab.md5, "条件が違っても、書き出したファイルは同じ");
    // (3) 2 件を同時に頼む(書き出しは 1 件ずつ順に行う)。タブは動かしたまま
    {
      const names = ["20260101-000003", "20260101-000004"];
      for (const n of names) fs.copyFileSync(src, path.join(perfDir, `${n}.performance.json`));
      const t0 = performance.now();
      const done = {};
      for (const n of names) await agent("performance.render", { name: n });
      while (Object.keys(done).length < names.length) {
        for (const n of names) {
          if (done[n]) continue;
          const r = await agent("performance.render", { name: n });
          if (r.status === "done") done[n] = (performance.now() - t0) / 1000;
          else assert.ok(r.status === "queued" || r.status === "rendering", JSON.stringify(r));
        }
        await new Promise((res) => setTimeout(res, 250));
      }
      results.two_at_once = { first_done_seconds: done[names[0]], second_done_seconds: done[names[1]] };
      console.log(`2 件を同時に頼む(タブあり): 1 件目 ${done[names[0]].toFixed(1)} 秒、2 件目 ${done[names[1]].toFixed(1)} 秒で終わる`);
    }
    console.log(`書き出したファイルは 2 回とも同じ(MD5 ${results.no_tab.md5})`);
  } finally {
    await browser.close();
    await app.close();
    fs.rmSync(patchDir, { recursive: true, force: true });
    fs.rmSync(perfDir, { recursive: true, force: true });
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ measured_at: new Date().toISOString(), node: process.version, cpus: os.cpus().length, cpu: os.cpus()[0]?.model, source: path.basename(src), ...results }, null, 2) + "\n");
}

main().catch((e) => {
  console.error("書き出しの測定: 失敗");
  console.error(e);
  process.exit(1);
});
