// Issue #24 の独立レビューで見つかった不具合の、実際のブラウザ(ヘッドレスの Chromium)での再発防止の確認。
// npm run test:review-browser で実行する。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..", "..");
const load = (rel) => import(pathToFileURL(path.join(root, "dist", "src", rel)).href);
const AUTOSAVE_KEY = "modular-synth.autosave.v1";
const BROKEN_KEY = "modular-synth.autosave.broken.v1";

async function main() {
  const { chromium } = require("playwright");
  const { createApp } = await load("server/app.js");
  const { buildCatalog } = await load("control/catalog.js");
  const { REGISTRY } = await load("modules/registry.js");

  const patchDir = fs.mkdtempSync(path.join(os.tmpdir(), "synth-r24-"));
  const catalog = buildCatalog(REGISTRY);
  let app = createApp({ webRoot: path.join(root, "web"), patchDir, catalog });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ args: ["--autoplay-policy=user-gesture-required"] });
  const results = [];
  const ok = (name, detail = "") => {
    results.push(name);
    console.log(`ok - ${name}${detail ? " (" + detail + ")" : ""}`);
  };
  let seq = 0;
  const agent = async (command, args) => {
    const res = await fetch(`${base}/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${app.agentToken}` },
      body: JSON.stringify({ v: 1, request_id: `r24-${++seq}`, command, ...(args ? { args } : {}) }),
    });
    return (await res.json());
  };
  const agentOk = async (command, args) => {
    const r = await agent(command, args);
    assert.equal(r.ok, true, `${command}: ${JSON.stringify(r)}`);
    return r;
  };

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    const watch = (p) => {
      p.on("pageerror", (e) => pageErrors.push(String(e)));
      p.on("console", (m) => {
        if (m.type() === "error" && !/WebSocket|ERR_CONNECTION_REFUSED|Failed to load resource/.test(m.text())) pageErrors.push(m.text());
      });
    };
    watch(page);
    const on = (p) => (expr) => p.evaluate(`window.__synth.${expr}`);
    const synth = on(page);
    const waitFor = async (fn, what, timeout = 10000) => {
      const t0 = Date.now();
      let last;
      while (Date.now() - t0 < timeout) {
        last = await fn();
        if (last) return last;
        await page.waitForTimeout(50);
      }
      throw new Error(`${what} を待ったが満たされなかった(最後の値: ${JSON.stringify(last)})`);
    };

    // ---- 1) 枠への埋め込みの禁止 ----
    for (const p of ["/", "/dist/main.js", "/style.css", "/nothing"]) {
      const res = await fetch(base + p);
      assert.equal(res.headers.get("x-frame-options"), "DENY", p);
      assert.equal(res.headers.get("content-security-policy"), "frame-ancestors 'none'", p);
    }
    // 実際に枠へ入れてみる: 別オリジンのページ(data: の文書)の枠には表示されない
    const framer = await context.newPage();
    await framer.setContent(`<iframe id="f" src="${base}/" width="400" height="300"></iframe>`);
    await framer.waitForTimeout(800);
    const frame = framer.frames().find((f) => f !== framer.mainFrame());
    const inFrame = frame ? await frame.evaluate(() => typeof window.__synth).catch(() => "blocked") : "blocked";
    assert.notEqual(inFrame, "object", "枠の中でアプリが動いていない");
    await framer.close();
    ok("画面は他のページの枠に入れられない(X-Frame-Options: DENY、frame-ancestors 'none'。実際の枠でも動かない)");

    // ---- 2) 音声開始の前の音量・緊急停止が、音声側へ届く ----
    await page.goto(`${base}/`);
    await waitFor(() => synth("serverAccepted"), "タブの接続");
    assert.equal(await synth("tabRole"), "owner");
    await agentOk("batch", { ops: [
      { command: "module.add", args: { id: "vco", type: "MOD-OSC-001" } },
      { command: "cable.connect", args: { from: { module: "vco", port: "saw" }, to: { module: "out", port: "IN_L" } } },
    ] });
    await page.fill("#level", "-40"); // 人が音量を下げる(エージェントの上限も −40)
    await waitFor(async () => (await synth("backendState")).levelDb === -40, "音量 −40");
    await agentOk("engine.panic"); // 音声開始の前の緊急停止
    assert.equal(await synth("contextState"), "none");
    await page.click("#start");
    await waitFor(async () => (await synth("audioState")) === "running", "音声の開始");
    const w1 = await waitFor(async () => {
      const w = await synth("workletState");
      return w && w.running ? w : null;
    }, "ワークレットの状態");
    assert.deepEqual({ levelDb: w1.levelDb, agentMaxLevelDb: w1.agentMaxLevelDb, panic: w1.panic }, { levelDb: -40, agentMaxLevelDb: -40, panic: true });
    await page.waitForTimeout(400);
    assert.equal((await synth("status")).peak, 0, "緊急停止が効いていて無音");
    assert.equal(await synth("desyncCount"), 0);
    await page.click("#release");
    const w2 = await waitFor(async () => {
      const s = await synth("status");
      return s && s.peak > 0 ? s : null;
    }, "解除後に音が出る");
    assert.ok(w2.peak <= Math.pow(10, -40 / 20) * 1.05, `解除後のピーク ${w2.peak} は人が決めた −40 dB 以下`);
    ok("音声開始の前に行った音量の設定と緊急停止が、開始後のワークレットで効いている(開始しても鳴らず、解除後も −40 dB)", `peak=${w2.peak.toFixed(5)}`);

    // ---- 3) 音量のスライダー: フォーカスがあっても、引き下げの後は実際の値を表示する ----
    await page.fill("#level", "-5");
    await page.focus("#level");
    await waitFor(async () => (await synth("backendState")).levelDb === -5, "音量 −5");
    await agentOk("patch.new"); // 全体の置き換え → 既定値(−20)へ引き下げ
    await waitFor(async () => (await synth("backendState")).levelDb === -20, "引き下げ");
    await waitFor(() => page.evaluate(() => document.getElementById("level").value === "-20"), "スライダーが −20 を表示");
    await page.keyboard.press("ArrowRight"); // 1 dB 上げる操作
    await waitFor(async () => (await synth("backendState")).levelDb === -19, "−19(−4 に跳ね上がらない)");
    ok("引き下げの後、フォーカスのあるスライダーも実際の値に合い、次の矢印キーで音量が跳ね上がらない");

    // ---- 4) 変更の直後の再読込でも、変更が残る ----
    await agentOk("module.add", { id: "keep1", type: "MOD-UTL-001" });
    const rev = await synth("revision");
    await page.reload(); // 自動保存の待ち時間(1秒)を待たない
    await waitFor(() => synth("serverAccepted"), "再読込後の接続");
    assert.equal(await synth("revision"), rev);
    assert.ok((await synth("patch")).modules.some((m) => m.id === "keep1"));
    ok("変更の直後(1秒以内)に再読込しても、変更は自動保存に残っている");

    // ---- 5) 2つ目のタブは編集も自動保存もしない ----
    const second = await context.newPage();
    watch(second);
    await second.goto(`${base}/`);
    await waitFor(async () => (await on(second)("tabRole")) === "blocked", "2つ目のタブが編集不可になる");
    assert.equal(await second.evaluate(() => document.getElementById("blocked").hidden), false);
    assert.equal(await on(second)("serverAccepted"), false);
    assert.equal(await second.evaluate(() => document.querySelector("section").inert), true, "操作を受け付けない");
    // 1つ目のタブで変更する。2つ目のタブを閉じても(閉じるときの保存で)上書きされない
    await agentOk("module.add", { id: "keep2", type: "MOD-UTL-001" });
    await page.waitForTimeout(1300);
    const saved = await page.evaluate((k) => localStorage.getItem(k), AUTOSAVE_KEY);
    await second.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await second.close();
    assert.equal(await page.evaluate((k) => localStorage.getItem(k), AUTOSAVE_KEY), saved, "自動保存は1つ目のタブのまま");
    await page.reload();
    await waitFor(() => synth("serverAccepted"), "再読込後の接続");
    assert.ok((await synth("patch")).modules.some((m) => m.id === "keep2"));
    ok("2つ目のタブは編集・自動保存・サーバーへの接続をせず、1つ目のタブの作業は再読込しても残る");

    // ---- 6) 壊れた自動保存は、退避して知らせる ----
    await page.evaluate((k) => localStorage.setItem(k, '{"revision":3,"text":"{ 壊れた"}'), AUTOSAVE_KEY);
    await page.evaluate(() => window.addEventListener("pagehide", (e) => e.stopImmediatePropagation(), true)); // 閉じるときの保存で上書きさせない
    await page.reload();
    await waitFor(() => synth("serverAccepted"), "再読込後の接続");
    assert.equal(await synth("restoredFromAutosave"), false);
    assert.equal((await synth("patch")).modules.length, 1, "空のパッチで始まる");
    assert.match(await synth("autosaveProblem"), /読めなかった/);
    assert.equal(await page.evaluate((k) => localStorage.getItem(k), BROKEN_KEY), '{"revision":3,"text":"{ 壊れた"}');
    assert.match(await page.textContent("#notice"), /退避しました/);
    ok("読めない自動保存は黙って捨てず、退避して画面に知らせる");

    // ---- 7) サーバーが再起動しても、タブはつなぎ直す ----
    await agentOk("module.add", { id: "keep3", type: "MOD-UTL-001" });
    await app.close();
    await waitFor(async () => (await synth("serverAccepted")) === false, "切断の検出");
    app = createApp({ webRoot: path.join(root, "web"), patchDir, catalog }); // トークンは新しくなる
    await app.listen(port);
    await waitFor(() => synth("serverAccepted"), "再接続", 20000);
    const after = await agentOk("patch.get");
    assert.ok(after.result.patch.modules.some((m) => m.id === "keep3"), "タブのパッチはそのまま");
    ok("サーバーを再起動すると、タブは新しいトークンを取り直してつなぎ直す(パッチはタブに残っている)");

    // ---- 8) 深い入れ子の要求でサーバーもタブも落ちない ----
    const deep = '{"a":'.repeat(20000) + "0" + "}".repeat(20000);
    const res = await fetch(`${base}/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${app.agentToken}` },
      body: `{"v":1,"request_id":"deep","command":"patch.load","args":{"patch":${deep}}}`,
    });
    assert.equal((await res.json()).error.id, "ERR-001");
    assert.equal((await agentOk("patch.get")).ok, true);
    ok("深い入れ子(約2万段)の要求は ERR-001 で拒否され、サーバーは動き続ける");

    assert.deepEqual(await synth("errors"), [], "ワークレットと画面が記録したエラー");
    assert.deepEqual(pageErrors, [], "ページのエラー");
    ok("ページとワークレットにエラーなし");
  } finally {
    await browser.close();
    await app.close();
    fs.rmSync(patchDir, { recursive: true, force: true });
  }
  console.log(`レビュー指摘のブラウザ試験: ${results.length} 項目すべて合格(Chromium ヘッドレス)`);
}

main().catch((e) => {
  console.error("レビュー指摘のブラウザ試験: 失敗");
  console.error(e);
  process.exit(1);
});
