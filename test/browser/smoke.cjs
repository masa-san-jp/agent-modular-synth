// 実際のブラウザ(ヘッドレスの Chromium)での端から端の確認。npm run test:browser で実行する。
// サーバーを起動し、タブを開いて人が音声を開始した後、エージェント(HTTP と WebSocket の試験用クライアント)が
// サーバー経由でコマンドを送り、同じパッチを人と交互に操作する。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..", "..");
const load = (rel) => import(pathToFileURL(path.join(root, "dist", "src", rel)).href);

async function main() {
  const { chromium } = require("playwright");
  const WebSocket = require("ws");
  const { createApp } = await load("server/app.js");
  const { buildCatalog } = await load("control/catalog.js");
  const { REGISTRY } = await load("modules/registry.js");

  const patchDir = fs.mkdtempSync(path.join(os.tmpdir(), "synth-e2e-"));
  const app = createApp({ webRoot: path.join(root, "web"), patchDir, catalog: buildCatalog(REGISTRY) });
  const port = await app.listen(0); // 試験では空いているポートを使う
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ args: ["--autoplay-policy=user-gesture-required"] });
  const results = [];
  const ok = (name, detail = "") => {
    results.push(name);
    console.log(`ok - ${name}${detail ? " (" + detail + ")" : ""}`);
  };

  let seq = 0;
  /** エージェント(HTTP)。 */
  const agent = async (command, args, extra = {}) => {
    const res = await fetch(`${base}/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${app.agentToken}` },
      body: JSON.stringify({ v: 1, request_id: `e2e-${++seq}`, command, ...(args ? { args } : {}), ...extra }),
    });
    return { http: res.status, body: await res.json() };
  };
  const agentOk = async (command, args) => {
    const r = await agent(command, args);
    assert.equal(r.body.ok, true, `${command}: ${JSON.stringify(r.body)}`);
    return r.body;
  };

  try {
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

    // ---- 1) タブなし・認証 ----
    const noTab = await agent("patch.get");
    assert.equal(noTab.body.ok, false);
    assert.equal(noTab.body.error.id, "ERR-006");
    ok("タブがない間、エージェントの patch.get は ERR-006");
    const unauth = await fetch(`${base}/api/command`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ v: 1, request_id: "u1", command: "patch.get" }) });
    assert.equal(unauth.status, 401);
    assert.equal((await unauth.json()).error.id, "ERR-004");
    const wrong = await fetch(`${base}/api/command`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer wrong-token-wrong-token" }, body: JSON.stringify({ v: 1, request_id: "u2", command: "patch.get" }) });
    assert.equal(wrong.status, 401);
    ok("トークンなし・誤ったトークンは拒否(ERR-004)");
    const cross = await fetch(`${base}/api/command`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${app.agentToken}`, Origin: "http://evil.example" }, body: JSON.stringify({ v: 1, request_id: "u3", command: "patch.get" }) });
    assert.equal(cross.status, 403);
    ok("Origin が付いた要求(ブラウザ上の別サイトからの要求)は拒否");
    assert.equal(app.server.address().address, "127.0.0.1");
    ok("待受は 127.0.0.1 だけ");

    // ---- 2) タブを開く。ユーザー操作の前は音声が始まらない ----
    await page.goto(`${base}/`);
    assert.equal(await page.evaluate(() => window.isSecureContext), true);
    await waitFor(() => synth("serverAccepted"), "タブがサーバーに受け付けられる");
    assert.equal(await synth("contextState"), "none");
    assert.equal(await synth("audioState"), "stopped");
    ok("タブがサーバーに接続。ユーザー操作の前は AudioContext を作らず、音声は始まらない");

    // 音声が未開始でも、エージェントは編集と状態の読出しができる。音声の開始はできない
    const st0 = await agentOk("engine.get_status");
    assert.equal(st0.audio_state, "stopped");
    const startByAgent = await agent("engine.start");
    assert.equal(startByAgent.body.ok, false);
    assert.equal(startByAgent.body.error.id, "ERR-005");
    assert.equal(await synth("audioState"), "stopped");
    ok("エージェントは音声を開始できない(ERR-005)。状態は読める");

    // ---- 3) 人が音声を開始し、デモ用パッチを組んで鍵盤で鳴らす ----
    await page.click("#start");
    await waitFor(async () => (await synth("audioState")) === "running", "音声の開始");
    assert.equal(await synth("contextState"), "running");
    await page.click("#demo");
    await waitFor(async () => (await synth("patch")).modules.length === 6, "デモ用パッチ(6モジュール)");
    await silent();
    const key = page.locator('#keys button[data-note="64"]');
    await key.dispatchEvent("pointerdown");
    const s1 = await peakAbove(0.01);
    assert.equal(s1.nonfiniteModules + s1.nonfiniteOutputStage, 0);
    assert.equal(s1.levelDb, -20);
    ok("人が音声を開始し、コマンドで組んだパッチを画面鍵盤で鳴らす。出力は無音でなく ±1.0 以内", `peak=${s1.peak.toFixed(4)}`);
    await key.dispatchEvent("pointerup");

    // ---- 4) エージェントが同じパッチを操作する ----
    const events = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`, { headers: { Authorization: `Bearer ${app.agentToken}` } });
    await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
    ws.on("message", (d) => { const m = JSON.parse(String(d)); if (m.event) events.push(m); });

    const got = await agentOk("patch.get");
    assert.equal(got.result.patch.modules.length, 6);
    const types = await agentOk("module.list_types");
    assert.equal(types.result.types.length, 20);
    const revBefore = got.revision;
    // エージェントが、鍵盤なしで鳴る構成を足す(VCO2 を出力の右へ直結)
    const b = await agentOk("batch", { ops: [
      { command: "module.add", args: { id: "vco2", type: "MOD-OSC-001", params: { tune: 0.5 } } },
      { command: "cable.connect", args: { from: { module: "vco2", port: "sine" }, to: { module: "out", port: "IN_R" } } },
    ] });
    assert.equal(b.revision, revBefore + 1, "batch は1リビジョン");
    const s2 = await peakAbove(0.01);
    assert.equal((await synth("patch")).modules.length, 7);
    assert.equal(await synth("revision"), revBefore + 1);
    ok("エージェントがサーバー経由でモジュールと接続を足すと、タブのパッチと音に反映される", `peak=${s2.peak.toFixed(4)}`);
    await waitFor(() => events.some((e) => JSON.stringify(e).includes("agent")), "エージェントへの通知");
    ok("変更の通知がエージェントの接続(WebSocket)へ届く", `通知 ${events.length} 件`);

    // 無効な要求は状態を変えない
    const bad = await agent("param.set", { module_id: "vco2", param: "tune", value: 99 });
    assert.equal(bad.body.ok, false);
    assert.equal(bad.body.error.id, "ERR-123");
    assert.equal(await synth("revision"), revBefore + 1);
    ok("範囲外の値は拒否され、リビジョンは変わらない(ERR-123)");

    // 人がエージェントの操作を取り消す(履歴は1本)
    await page.click("#undo");
    await waitFor(async () => (await synth("patch")).modules.length === 6, "取り消し後の6モジュール");
    await silent();
    ok("人が「取り消し」を押すと、エージェントの操作が取り消されて音も止まる");
    await page.click("#redo");
    await waitFor(async () => (await synth("patch")).modules.length === 7, "やり直し後の7モジュール");
    await peakAbove(0.01);

    // 音量: 人が決めた上限をエージェントは超えられない
    await page.fill("#level", "-30");
    await waitFor(async () => (await agentOk("engine.get_status")).result.output.level_db === -30, "人が音量を -30 dB に");
    const over = await agent("output.set_level", { level_db: -10 });
    assert.equal(over.body.ok, false);
    await agentOk("output.set_level", { level_db: -40 });
    ok("エージェントは人が決めた上限を超える音量にできない(下げることはできる)");

    // 緊急停止: エージェントが実行でき、解除は人だけ
    await agentOk("engine.panic");
    await silent();
    const rel = await agent("engine.release_panic");
    assert.equal(rel.body.ok, false);
    assert.equal(rel.body.error.id, "ERR-005");
    await page.click("#release");
    await peakAbove(0.001);
    ok("エージェントの緊急停止で無音になり、解除は人だけができる");

    // ---- 5) 保存 ----
    const saved = await agentOk("patch.save", { name: "e2e-demo" });
    assert.ok(fs.existsSync(path.join(patchDir, "e2e-demo.patch.json")), "専用フォルダにファイルができる");
    const escape = await agent("patch.save", { name: "../escape" });
    assert.equal(escape.body.ok, false);
    assert.equal(escape.body.error.id, "ERR-201");
    assert.deepEqual(fs.readdirSync(patchDir).filter((f) => !f.startsWith(".")), ["e2e-demo.patch.json"]);
    assert.equal(fs.existsSync(path.join(patchDir, "..", "escape.patch.json")), false);
    const del = await agent("patch.delete", { name: "e2e-demo" });
    assert.equal(del.body.ok, false);
    assert.equal(del.body.error.id, "ERR-005");
    ok("エージェントがパッチを保存できる。フォルダの外を指す名前は拒否(ERR-201)。削除は人だけ(ERR-005)", `revision=${saved.revision}`);

    // ---- 6) 自動保存と再読込 ----
    const before = await synth("patch");
    const revSaved = await synth("revision");
    await page.waitForTimeout(1500); // 自動保存の待ち時間
    await page.reload();
    await waitFor(() => synth("serverAccepted"), "再読込後の接続");
    assert.equal(await synth("restoredFromAutosave"), true);
    const after = await synth("patch");
    assert.deepEqual(after.modules, before.modules);
    assert.deepEqual(after.cables, before.cables);
    assert.equal(await synth("revision"), revSaved);
    assert.equal(await synth("contextState"), "none");
    assert.equal(await synth("audioState"), "stopped");
    ok("再読込の後、構成・パラメータ・リビジョンが自動保存から復元され、音声は停止状態(人の操作まで鳴らない)");
    await page.click("#start");
    await peakAbove(0.001);
    ok("復元したパッチが、人の「音声開始」の後に鳴る");

    // 保存したパッチの読込(エージェント)。音量は上がらない
    const lv = (await agentOk("engine.get_status")).result.output.level_db;
    await agentOk("patch.new");
    await silent();
    await agentOk("patch.load", { name: "e2e-demo" });
    await peakAbove(0.001);
    assert.ok((await agentOk("engine.get_status")).result.output.level_db <= lv);
    ok("エージェントが保存済みのパッチを読み込むと復元されて鳴る。音量は上がらない");

    // ---- 7) タブを閉じるとセッションなし ----
    assert.deepEqual(await synth("errors"), [], "ワークレットと画面が記録したエラー");
    assert.equal(await synth("desyncCount"), 0, "音量・緊急停止の写しとワークレットのずれ");
    ws.close();
    await page.close();
    await new Promise((r) => setTimeout(r, 300));
    const gone = await agent("patch.get");
    assert.equal(gone.body.error.id, "ERR-006");
    const list = await agentOk("patch.list");
    assert.equal(list.result.patches.length, 1);
    ok("タブを閉じると ERR-006。保存済みパッチの一覧はタブなしでも読める");

    assert.deepEqual(pageErrors, [], "ページのエラー");
    ok("ページとワークレットにエラーなし");
  } finally {
    await browser.close();
    await app.close();
    fs.rmSync(patchDir, { recursive: true, force: true });
  }
  console.log(`ブラウザ試験: ${results.length} 項目すべて合格(Chromium ヘッドレス、端から端)`);
}

main().catch((e) => {
  console.error("ブラウザ試験: 失敗");
  console.error(e);
  process.exit(1);
});
