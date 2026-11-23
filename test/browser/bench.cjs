// 性能の測定(verification-plan VER-NF-004 負荷、VER-NF-005 遅延)。npm run bench:browser で実行する。
// 実際のブラウザ(Chromium)でパッチを鳴らし、音声スレッドでブロックごとの処理時間を集計する。
// 合否は出さない(目標は未決: OPEN-001)。結果は JSON と Markdown に書く。
//
// 環境変数: BENCH_SECONDS(測定区間。既定 10)、BENCH_HEADED=1(画面を出す)、BENCH_OUT(出力先のフォルダ。既定 bench/results)
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..", "..");
const load = (rel) => import(pathToFileURL(path.join(root, "dist", "src", rel)).href);
const SECONDS = Number(process.env.BENCH_SECONDS || 10);
const OUT = process.env.BENCH_OUT || path.join(root, "bench", "results");

const quantile = (hist, q) => {
  const total = hist.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let acc = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i];
    if (acc >= q * total) return (i + 1) * 0.05; // 区間の上端
  }
  return hist.length * 0.05;
};
const summary = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { count: s.length, min: s[0], median: q(0.5), p95: q(0.95), max: s[s.length - 1] };
};

async function main() {
  const { chromium } = require("playwright");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const { createApp } = await load("server/app.js");
  const { buildCatalog } = await load("control/catalog.js");
  const { REGISTRY } = await load("modules/registry.js");
  const P = await load("perf/patches.js");

  const patchDir = fs.mkdtempSync(path.join(os.tmpdir(), "synth-bench-"));
  const app = createApp({ webRoot: path.join(root, "web"), patchDir, catalog: buildCatalog(REGISTRY) });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: !process.env.BENCH_HEADED, args: ["--autoplay-policy=user-gesture-required"] });
  let seq = 0;
  const agent = async (command, args) => {
    const res = await fetch(`${base}/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${app.agentToken}` },
      body: JSON.stringify({ v: 1, request_id: `bench-${++seq}`, command, ...(args ? { args } : {}) }),
    });
    const r = await res.json();
    if (!r.ok) throw new Error(`${command}: ${JSON.stringify(r.error)}`);
    return r;
  };

  const report = { kind: "browser", at: new Date().toISOString(), seconds: SECONDS, env: {}, load: {}, latency: {} };
  try {
    const page = await (await browser.newContext()).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const synth = (expr) => page.evaluate(`window.__synth.${expr}`);
    const waitFor = async (fn, what, timeout = 15000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        const v = await fn();
        if (v) return v;
        await page.waitForTimeout(50);
      }
      throw new Error(`${what} を待ったが満たされなかった`);
    };
    await page.goto(`${base}/`);
    await waitFor(() => synth("serverAccepted"), "タブの接続");
    await page.click("#start");
    await waitFor(async () => (await synth("audioState")) === "running", "音声の開始");
    await page.fill("#level", "-20");

    const cpu = os.cpus();
    const clock = await synth("audioClock");
    report.env = {
      browser: `${browser.browserType().name()} ${browser.version()}${process.env.BENCH_HEADED ? "" : "(ヘッドレス)"}`,
      userAgent: await page.evaluate(() => navigator.userAgent),
      platform: `${os.platform()} ${os.arch()} ${os.release()}`,
      cpu: cpu[0] ? cpu[0].model : "不明",
      cores: cpu.length,
      memoryGiB: Math.round(os.totalmem() / 2 ** 30),
      sampleRate: clock.sampleRate,
      baseLatencyMs: clock.baseLatency * 1000,
      outputLatencyMs: clock.outputLatency === null ? null : clock.outputLatency * 1000,
    };

    /** パッチを組んで、準備区間を捨ててから測定区間の負荷を測る。 */
    const measure = async (name, ops, opts = {}) => {
      await agent("patch.new");
      if (ops.length > 0) await agent("batch", { ops });
      const modules = (await synth("patch")).modules.length;
      for (const m of opts.midi || []) await page.evaluate((b) => window.__synth.sendMidiForBench(b), m);
      await page.waitForTimeout(2000); // 準備区間
      const c0 = await synth("audioClock");
      const w0 = Date.now();
      await synth("perf(true)");
      await page.waitForTimeout(SECONDS * 1000);
      const st = await waitFor(async () => {
        const s = await synth("status");
        return s && s.perf && s.perf.blocks > 0 ? s : null;
      }, "測定の集計");
      const c1 = await synth("audioClock");
      const w1 = Date.now();
      await synth("perf(false)");
      const p = st.perf;
      const r = {
        modules,
        clock: p.clock,
        blocks: p.blocks,
        meanLoad: p.meanLoad,
        p50: quantile(p.histogram, 0.5),
        p95: quantile(p.histogram, 0.95),
        p99: quantile(p.histogram, 0.99),
        maxLoad: p.maxLoad,
        over: p.over,
        // 音声の時計の進み ÷ 実時間。1 より小さければ、処理が間に合わず音が途切れている
        audioClockRatio: (c1.currentTime - c0.currentTime) / ((w1 - w0) / 1000),
        peak: st.peak,
      };
      report.load[name] = r;
      console.log(`${name.padEnd(12)} モジュール ${String(modules).padStart(4)}  負荷 平均 ${r.meanLoad.toFixed(3)}  95% ${r.p95.toFixed(2)}  99% ${r.p99.toFixed(2)}  最大 ${r.maxLoad.toFixed(2)}  超過 ${r.over}/${r.blocks}  時計の比 ${r.audioClockRatio.toFixed(3)}`);
      return r;
    };

    await measure("BP-0", P.bp0());
    await measure("BP-1", P.bp1(), { midi: [[0x90, 60, 100]] });
    await measure("BP-POLY", P.bpPoly(), { midi: Array.from({ length: 16 }, (_, i) => [0x90, 48 + i * 2, 100]) });
    await measure("BP-ALL", P.bpAll());
    for (const n of [1, 2, 4, 8, 16, 32, 64]) {
      const r = await measure(`BP-N N=${n}`, P.bpN(n));
      if (r.audioClockRatio < 0.5) break; // 大きく間に合っていない。これ以上は測らない
    }

    // ---- 遅延(BP-1) ----
    await agent("patch.new");
    await agent("batch", { ops: P.bp1() });
    await page.waitForTimeout(1000);
    // L4: エージェントの往復(HTTP)。L2: 差分を送ってから音声側が適用するまで
    await synth("perf(true)");
    const http = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      await agent("param.set", { module_id: "vcf", param: "cutoff", value: 1 + (i % 50) / 50 });
      http.push(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 7 + ((i * 37) % 23))); // ブロックの周期と同期しない間隔
    }
    await page.waitForTimeout(300);
    const st = await synth("status");
    await synth("perf(false)");
    report.latency.L4_http_ms = summary(http);
    report.latency.L2_apply_ms = { count: st.perf.applyCount, mean: st.perf.applyCount ? st.perf.applySumMs / st.perf.applyCount : null, max: st.perf.applyMaxMs, note: "時計は 1 ms 刻み(Date.now)。ブロック境界の待ち(最大 2.7 ms)を含む" };
    // L4: MCP 経由
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, "dist", "src", "mcp", "main.js")],
      env: { PATH: process.env.PATH || "", HOME: process.env.HOME || "", SYNTH_URL: base, SYNTH_AGENT_TOKEN: app.agentToken },
      stderr: "pipe",
    });
    const mcp = new Client({ name: "bench", version: "0.0.1" });
    await mcp.connect(transport);
    const viaMcp = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      await mcp.callTool({ name: "param_set", arguments: { module_id: "vcf", param: "cutoff", value: 1 + (i % 50) / 50 } });
      viaMcp.push(performance.now() - t0);
    }
    await mcp.close();
    report.latency.L4_mcp_ms = summary(viaMcp);
    report.latency.L3_output_ms = { baseLatency: report.env.baseLatencyMs, outputLatency: report.env.outputLatencyMs, note: "ブラウザが報告する計算値。実際の機材の遅延は含まない場合がある" };
    report.latency.L5 = "未測定(録音の機材がない)";
    report.errors = errors.concat(await synth("errors"));
    console.log(`遅延  エージェント往復(HTTP)中央値 ${report.latency.L4_http_ms.median.toFixed(1)} ms / 95% ${report.latency.L4_http_ms.p95.toFixed(1)} ms、MCP 中央値 ${report.latency.L4_mcp_ms.median.toFixed(1)} ms / 95% ${report.latency.L4_mcp_ms.p95.toFixed(1)} ms、音声側の適用 平均 ${report.latency.L2_apply_ms.mean === null ? "—" : report.latency.L2_apply_ms.mean.toFixed(1)} ms / 最大 ${report.latency.L2_apply_ms.max} ms`);
  } finally {
    await browser.close();
    await app.close();
    fs.rmSync(patchDir, { recursive: true, force: true });
  }
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, "browser.json");
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
  console.log(`結果を ${path.relative(root, file)} に書きました`);
}

main().catch((e) => {
  console.error("測定: 失敗");
  console.error(e);
  process.exit(1);
});
