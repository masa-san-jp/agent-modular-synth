// 手元の LLM に演奏させるプログラム(agents/local-llm。Issue #55、DEC-027)の、端から端の確認。
// LLM は試験用の偽物(Ollama の /api/chat の形で、決めた順に答える)。プログラムは実際に別のプロセスで動かし、
// 実際のサーバーとブラウザ(ヘッドレスの Chromium)のタブで鳴らす。npm run test:local-llm-browser で実行する。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..", "..");
const load = (rel) => import(pathToFileURL(path.join(root, "dist", "src", rel)).href);

/** 偽の LLM(Ollama の形)。台本の順に答え、受けた要求を残す。 */
function fakeOllama(script) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      if (req.url !== "/api/chat") {
        res.writeHead(404).end("not found");
        return;
      }
      const parsed = JSON.parse(body);
      requests.push(parsed);
      const step = script.shift() ?? { content: "[END]" };
      const message = { role: "assistant", content: step.content ?? "" };
      if (step.tools) message.tool_calls = step.tools.map(([name, args]) => ({ function: { name, arguments: args } }));
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ model: parsed.model, message, done: true }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, requests })));
}

async function main() {
  const { chromium } = require("playwright");
  const { createApp } = await load("server/app.js");
  const { buildCatalog } = await load("control/catalog.js");
  const { REGISTRY } = await load("modules/registry.js");

  const patchDir = fs.mkdtempSync(path.join(os.tmpdir(), "synth-local-llm-"));
  const perfDir = `${patchDir}-performances`;
  const app = createApp({ webRoot: path.join(root, "web"), patchDir, catalog: buildCatalog(REGISTRY) });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ args: ["--autoplay-policy=user-gesture-required"] });
  const results = [];
  const ok = (name, detail = "") => {
    results.push(name);
    console.log(`ok - ${name}${detail ? " (" + detail + ")" : ""}`);
  };

  // 台本: パッチを組む → (音声が止まっているので)待つ → 音声が始まったら楽譜 → 残りが少なくなったら続きと終わりの宣言
  const script = [
    { tools: [["patch_get", {}]] },
    {
      tools: [
        [
          "batch",
          {
            ops: [
              { command: "module.add", args: { id: "midi", type: "MOD-IO-002" } },
              { command: "module.add", args: { id: "vco", type: "MOD-OSC-001" } },
              { command: "module.add", args: { id: "vca", type: "MOD-AMP-001" } },
              { command: "cable.connect", args: { from: { module: "midi", port: "PITCH" }, to: { module: "vco", port: "pitch" } } },
              { command: "cable.connect", args: { from: { module: "vco", port: "saw" }, to: { module: "vca", port: "in1" } } },
              { command: "cable.connect", args: { from: { module: "midi", port: "GATE" }, to: { module: "vca", port: "cv1" } } },
              { command: "cable.connect", args: { from: { module: "vca", port: "out" }, to: { module: "out", port: "IN_L" } } },
            ],
          },
        ],
      ],
    },
    { content: "パッチを組んだ。音声の開始を待つ。" },
    { tools: [["score_play", { tempo_bpm: 120, notes: [{ t: 0, dur: 1.8, note: 57 }, { t: 2, dur: 1.8, note: 60 }], length: 4 }]] },
    { content: "1 つ目の楽譜を送った。" },
    { tools: [["score_play", { tempo_bpm: 120, notes: [{ t: 0, dur: 1.8, note: 64 }], length: 2 }], ["engine_start", {}]] },
    { content: "続きを送った。[END]" },
  ];
  const llm = await fakeOllama(script);
  let child = null;
  try {
    const page = await (await browser.newContext()).newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    const synth = (expr) => page.evaluate(`window.__synth.${expr}`);
    const waitFor = async (fn, what, timeout = 20000) => {
      const t0 = Date.now();
      let last;
      while (Date.now() - t0 < timeout) {
        last = await fn();
        if (last) return last;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`${what} を待ったが満たされなかった(最後の値: ${JSON.stringify(last)})`);
    };
    await page.goto(`${base}/`);
    await waitFor(() => synth("serverAccepted"), "タブの接続");

    // ---- プログラムを起動する(音声はまだ止まっている) ----
    const out = [];
    child = spawn(process.execPath, [path.join(root, "dist", "agents", "local-llm", "main.js"), "--model", "test-model", "--num-ctx", "20000", "短い", "テスト"], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, SYNTH_URL: base, SYNTH_AGENT_TOKEN: app.agentToken, LLM_URL: `http://127.0.0.1:${llm.port}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d) => out.push(String(d)));
    child.stderr.on("data", (d) => out.push(String(d)));
    const exited = new Promise((res) => child.on("exit", (code) => res(code)));

    await waitFor(async () => (await synth("patch")).modules.length === 4, "モデルがパッチを組む");
    await waitFor(() => out.join("").includes("音声の開始を待つ"), "モデルが待つ");
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(llm.requests.length, 3, "音声が止まっている間は、モデルを起こさない");
    const first = llm.requests[0];
    assert.equal(first.model, "test-model");
    assert.equal(first.options.num_ctx, 20000);
    assert.equal(first.tools.length, 30, "MCP と同じツール");
    assert.ok(!first.tools.some((t) => t.function.name === "engine_start"), "人のみのコマンドは渡さない");
    assert.ok(!JSON.stringify(first.tools).includes("\"expected_revision\":"), "既定では縮めた説明を渡す(compact)");
    assert.match(first.messages[1].content, /Goal of the performance: 短い テスト/, "目標は書かれたまま渡す");
    const JA = /[\u3040-\u30ff\u3400-\u9fff]/;
    assert.ok(!JA.test(first.messages[0].content), "指示文は英語");
    assert.match(first.messages[0].content, /MOD-OSC-001 VCO \| in: pitch/, "指示文にモジュールの一覧表がある");
    assert.ok(!JA.test(JSON.stringify(first.tools)), "ツールの説明は英語");
    ok("プログラムが LLM にツールを渡し、LLM の呼出しどおりにパッチを組む。音声が止まっている間は待つ");

    // ---- 人が音声を開始すると、モデルが起こされて演奏する ----
    await page.click("#start");
    await waitFor(async () => (await synth("status"))?.peak > 0.01, "楽譜の音が出る");
    ok("人が音声を開始すると、モデルが起こされ、楽譜を送って鳴らす");

    // ---- 続きを送り、終わりを宣言し、鳴り終わったら終了する ----
    const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r("timeout"), 30000))]);
    assert.equal(code, 0, `プログラムが終了する: ${out.join("")}`);
    const log = out.join("");
    assert.match(log, /\[起こす\] audio_started/);
    assert.match(log, /\[起こす\] remaining_low/);
    assert.match(log, /\[ツール\] engine_start .*失敗.*unknown_tool/, "人のみのコマンドは呼べない");
    assert.match(log, /\[終了\] 演奏が終わった/);
    assert.equal(await synth("audioState"), "running");
    const wake = llm.requests[3].messages.at(-1);
    assert.match(wake.content, /human started audio/);
    const toolMsgs = llm.requests.flatMap((r) => r.messages.filter((m) => m.role === "tool").map((m) => m.content));
    assert.ok(toolMsgs.length > 0);
    assert.ok(toolMsgs.every((c) => !JA.test(c)), `シンセの応答も英語: ${toolMsgs.find((c) => JA.test(c))}`);
    ok("残りが少なくなると起こされて続きを送り、終わりを宣言したら、鳴り終わってから終了する");

    // ---- 演奏データに、このプログラムの名前で残る ----
    const files = await waitFor(() => (fs.existsSync(perfDir) ? fs.readdirSync(perfDir).filter((f) => f.endsWith(".performance.json")) : []).length === 1 && fs.readdirSync(perfDir), "演奏データ");
    const doc = JSON.parse(fs.readFileSync(path.join(perfDir, files.find((f) => f.endsWith(".performance.json"))), "utf8"));
    assert.equal(doc.entries.length, 2);
    assert.deepEqual(doc.entries.map((e) => e.actor), [{ kind: "agent", client_id: "local-llm" }, { kind: "agent", client_id: "local-llm" }]);
    ok("演奏データに、2 つの楽譜が local-llm の名前で残る");

    assert.deepEqual(await synth("errors"), []);
    assert.deepEqual(pageErrors, []);
    ok("ページとワークレットにエラーなし");
  } finally {
    if (child && child.exitCode === null) child.kill("SIGKILL");
    llm.server.close();
    await browser.close();
    await app.close();
    fs.rmSync(patchDir, { recursive: true, force: true });
    fs.rmSync(perfDir, { recursive: true, force: true });
  }
  console.log(`手元の LLM のブラウザ試験: ${results.length} 項目すべて合格(Chromium ヘッドレス、偽の LLM)`);
}

main().catch((e) => {
  console.error("手元の LLM のブラウザ試験: 失敗");
  console.error(e);
  process.exit(1);
});
