// MCP アダプタの端から端の確認(実際のブラウザ = ヘッドレスの Chromium)。npm run test:mcp-browser で実行する。
// サーバーを起動 → タブを開いて人が音声を開始 → MCP クライアントが、stdio で起動したアダプタ経由で batch を呼び、
// 鍵盤なしで鳴る構成を組む → タブの出力が鳴る → engine_panic で無音。
// 画面の要素は `#start` と `window.__synth`(status、patch、revision、audioState、serverAccepted)だけに依存する。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..", "..");
const load = (rel) => import(pathToFileURL(path.join(root, "dist", "src", rel)).href);

async function main() {
  const { chromium } = require("playwright");
  const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
  const { createApp } = await load("server/app.js");
  const { buildCatalog } = await load("control/catalog.js");
  const { REGISTRY } = await load("modules/registry.js");

  const patchDir = fs.mkdtempSync(path.join(os.tmpdir(), "synth-mcp-e2e-"));
  const app = createApp({ webRoot: path.join(root, "web"), patchDir, catalog: buildCatalog(REGISTRY) });
  const port = await app.listen(0); // 試験では空いているポートを使う
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ args: ["--autoplay-policy=user-gesture-required"] });
  const results = [];
  const ok = (name, detail = "") => {
    results.push(name);
    console.log(`ok - ${name}${detail ? " (" + detail + ")" : ""}`);
  };

  // MCP クライアント → アダプタ(子プロセス、stdio)→ ローカルサーバー → タブ
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "dist", "src", "mcp", "main.js")],
    env: { SYNTH_URL: base, SYNTH_AGENT_TOKEN: app.agentToken },
    stderr: "pipe",
  });
  const mcp = new Client({ name: "mcp-e2e", version: "0" });
  /** ツールを呼び、応答の封筒(本文の JSON)と isError を返す。 */
  const tool = async (name, args = {}) => {
    const res = await mcp.callTool({ name, arguments: args });
    assert.equal(res.content.length, 1);
    return { isError: res.isError === true, body: JSON.parse(res.content[0].text) };
  };
  const toolOk = async (name, args) => {
    const r = await tool(name, args);
    assert.equal(r.isError, false, `${name}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.ok, true);
    return r.body;
  };

  try {
    await mcp.connect(transport);
    const { tools } = await mcp.listTools();
    assert.equal(tools.length, 22);
    for (const n of ["patch_delete", "engine_start", "engine_release_panic"]) assert.equal(tools.some((t) => t.name === n), false, n);
    ok("アダプタが stdio で起動し、ツール22個を返す(人のみの3つはない)");

    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") pageErrors.push(m.text());
    });
    const synth = (expr) => page.evaluate(`window.__synth.${expr}`);
    const waitFor = async (fn, what, timeout = 8000) => {
      const t0 = Date.now();
      let last;
      while (Date.now() - t0 < timeout) {
        last = await fn();
        if (last) return last;
        await page.waitForTimeout(100);
      }
      throw new Error(`${what} を待ったが満たされなかった(最後の値: ${JSON.stringify(last)})`);
    };
    const peakAbove = (min) => waitFor(async () => {
      const s = await synth("status");
      return s && s.peak > min && s.peak <= 1 ? s : null;
    }, `出力ピーク > ${min}`);
    const silent = () => waitFor(async () => {
      const s = await synth("status");
      return s && s.peak === 0 ? s : null;
    }, "無音");

    // ---- 1) タブがない間 ----
    const noTab = await tool("patch_get");
    assert.equal(noTab.isError, true);
    assert.equal(noTab.body.error.id, "ERR-006");
    assert.equal((await toolOk("module_list_types")).result.types.length, 18);
    ok("タブがない間、patch_get は ERR-006 のエラー結果。module_list_types は応答する");

    // ---- 2) タブを開く。人が音声を開始する(エージェントは開始できない) ----
    await page.goto(`${base}/`);
    await waitFor(() => synth("serverAccepted"), "タブがサーバーに受け付けられる");
    assert.equal(await synth("audioState"), "stopped");
    const st0 = await toolOk("engine_get_status");
    assert.equal(st0.audio_state, "stopped");
    assert.deepEqual(st0.actor, { kind: "agent", client_id: "mcp" });
    await assert.rejects(mcp.callTool({ name: "engine_start", arguments: {} }));
    assert.equal(await synth("audioState"), "stopped");
    ok("エージェントは MCP 経由で音声を開始できない(engine_start というツールはない)。状態は読める");

    await page.click("#start");
    await waitFor(async () => (await synth("audioState")) === "running", "音声の開始");
    await silent();
    ok("人が「音声開始」を押すと running。まだ無音");

    // ---- 3) MCP 経由の batch で、鍵盤なしで鳴る構成を組む ----
    const before = await toolOk("patch_get");
    assert.equal(before.audio_state, "running");
    assert.equal(before.revision, await synth("revision"));
    const b = await toolOk("batch", {
      ops: [
        { command: "module.add", args: { id: "vco1", type: "MOD-OSC-001" } },
        { command: "cable.connect", args: { from: { module: "vco1", port: "sine" }, to: { module: "out", port: "IN_L" } } },
      ],
      expected_revision: before.revision,
    });
    assert.equal(b.revision, before.revision + 1, "batch は1リビジョン");
    assert.equal(b.result.results.length, 2);
    const s1 = await peakAbove(0.01);
    assert.ok(s1.peak > 0 && s1.peak <= 1);
    const patch = await synth("patch");
    assert.ok(patch.modules.some((m) => m.id === "vco1" && m.type === "MOD-OSC-001"));
    assert.ok(patch.cables.some((c) => c.from.module === "vco1" && c.from.port === "sine" && c.to.module === "out" && c.to.port === "IN_L"));
    assert.equal(await synth("revision"), before.revision + 1);
    ok("MCP 経由の batch でモジュールと接続を足すと、タブのパッチに反映され、出力が鳴る(0 < ピーク ≤ 1)", `peak=${s1.peak.toFixed(4)}`);

    // 無効な要求はエラー結果になり、状態を変えない
    const bad = await tool("param_set", { module_id: "vco1", param: "tune", value: 99 });
    assert.equal(bad.isError, true);
    assert.equal(bad.body.error.id, "ERR-123");
    const stale = await tool("param_set", { module_id: "vco1", param: "tune", value: 0.5, expected_revision: before.revision });
    assert.equal(stale.isError, true);
    assert.equal(stale.body.error.id, "ERR-008");
    assert.equal(await synth("revision"), before.revision + 1);
    ok("範囲外の値(ERR-123)と古い expected_revision(ERR-008)はエラー結果で、リビジョンは変わらない");

    // MCP 経由の結果は、同じ要求を直接送った結果と一致する(VER-A-007)
    const viaMcp = (await toolOk("patch_get"));
    const direct = await (await fetch(`${base}/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${app.agentToken}` },
      body: JSON.stringify({ v: 1, request_id: "direct-1", command: "patch.get", args: {}, client_id: "mcp" }),
    })).json();
    delete viaMcp.request_id;
    delete direct.request_id;
    assert.deepEqual(viaMcp, direct);
    assert.deepEqual(viaMcp.result.patch.modules, (await synth("patch")).modules);
    ok("patch_get の結果が、POST /api/command へ直接送った結果・タブのパッチと一致する");

    // ---- 4) 緊急停止で無音。解除はできない ----
    const panic = await toolOk("engine_panic");
    assert.equal(panic.result.panic, true);
    await silent();
    await assert.rejects(mcp.callTool({ name: "engine_release_panic", arguments: {} }));
    await page.waitForTimeout(300);
    assert.equal((await synth("status")).peak, 0);
    assert.equal((await toolOk("engine_get_status")).result.panic, true);
    assert.equal(await synth("revision"), before.revision + 1, "緊急停止はパッチ・リビジョンを変えない");
    ok("engine_panic で無音になる。MCP 経由では解除できず、無音のまま");

    assert.deepEqual(pageErrors, [], "ページのエラー");
    ok("ページとワークレットにエラーなし");
  } finally {
    await mcp.close().catch(() => undefined);
    await browser.close();
    await app.close();
    fs.rmSync(patchDir, { recursive: true, force: true });
  }
  console.log(`MCP ブラウザ試験: ${results.length} 項目すべて合格(Chromium ヘッドレス、MCP クライアント → アダプタ → サーバー → タブ)`);
}

main().catch((e) => {
  console.error("MCP ブラウザ試験: 失敗");
  console.error(e);
  process.exit(1);
});
