// 人が操作する画面 PANEL(Issue #59、DEC-029、product-spec §4.1)の、実際のブラウザ(ヘッドレスの Chromium)での確認。
// npm run test:panel-browser で実行する。環境変数 PANEL_SCREENSHOT にパスを入れると、PANEL の画像を保存する(RACK は同じ名前に -rack、楽譜が動かしている LFO のカードは -moving を付ける)。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..", "..");
const load = (rel) => import(pathToFileURL(path.join(root, "dist", "src", rel)).href);

async function main() {
  const { chromium } = require("playwright");
  const { createApp } = await load("server/app.js");
  const { buildCatalog } = await load("control/catalog.js");
  const { REGISTRY } = await load("modules/registry.js");

  const patchDir = fs.mkdtempSync(path.join(os.tmpdir(), "synth-panel-"));
  const app = createApp({ webRoot: path.join(root, "web"), patchDir, catalog: buildCatalog(REGISTRY) });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ args: ["--autoplay-policy=user-gesture-required"] });
  const results = [];
  const ok = (name, detail = "") => {
    results.push(name);
    console.log(`ok - ${name}${detail ? " (" + detail + ")" : ""}`);
  };
  let seq = 0;
  const agentRaw = async (command, args) => {
    const res = await fetch(`${base}/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${app.agentToken}` },
      body: JSON.stringify({ v: 1, request_id: `panel-${++seq}`, command, ...(args ? { args } : {}) }),
    });
    return res.json();
  };
  const agent = async (command, args) => {
    const r = await agentRaw(command, args);
    assert.equal(r.ok, true, `${command}: ${JSON.stringify(r.error)}`);
    return r;
  };

  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") pageErrors.push(m.text());
    });
    const synth = (expr) => page.evaluate(`window.__synth.${expr}`);
    const waitFor = async (fn, what, timeout = 8000) => {
      const t0 = Date.now();
      for (;;) {
        if (await fn()) return;
        if (Date.now() - t0 > timeout) throw new Error(`待ち時間切れ: ${what}`);
        await page.waitForTimeout(50);
      }
    };
    const shown = (sel) => page.isVisible(sel);
    const status = async () => (await agent("engine.get_status")).result;

    await page.goto(`${base}/`, { waitUntil: "load" });
    await waitFor(() => synth("serverAccepted"), "タブがサーバーに受け付けられる");

    // ---- 1) 既定は RACK(今までの画面)。PANEL のタブで切り替わる。URL は変わらない ----
    assert.equal(await page.getAttribute("#tab-rack", "aria-selected"), "true");
    assert.equal(await shown("#rack"), true);
    assert.equal(await shown("#panel-bar"), false);
    if (process.env.PANEL_SCREENSHOT) await page.screenshot({ path: process.env.PANEL_SCREENSHOT.replace(/(\.png)?$/, "-rack.png"), fullPage: true });
    const url = page.url();
    await page.click("#tab-panel");
    assert.equal(page.url(), url, "別の URL にしない");
    assert.equal(await page.getAttribute("#tab-panel", "aria-selected"), "true");
    for (const sel of ["#panel-bar", "#panel-panic", "#panel-undo", "#panel-redo", "#panel-fill", "#level", "#cable-from", "#cable-to", "#cable-connect", "#module-list", "#keys"]) assert.equal(await shown(sel), true, `${sel} が見える`);
    for (const sel of ["#rack", "#add-type", "#add-module", "#save", "#library", "#history", "#prompt-text", "#panic"]) assert.equal(await shown(sel), false, `${sel} は PANEL に出さない`);
    const order = await page.evaluate(() => {
      const top = (sel) => document.querySelector(sel).getBoundingClientRect().top + scrollY;
      return { level: top("#level"), bar: top("#panel-bar"), cables: top("#cable-from"), modules: top("#module-list"), util: top("#utility") };
    });
    assert.ok(order.level < order.bar && order.bar < order.cables && order.cables < order.modules && order.modules < order.util, JSON.stringify(order));
    ok("RACK と PANEL を同じページの中で切り替える。PANEL には追加・削除・保存・ラックを出さない", JSON.stringify(order));

    // ---- 2) FILL: 空のパッチから 20 種類を 1 台ずつ、配線なしで置く。取り消しは 1 回 ----
    assert.deepEqual((await synth("patch")).modules.map((m) => m.id), ["out"]);
    const rev0 = await synth("revision");
    await page.click("#panel-fill");
    await waitFor(async () => (await page.locator("#module-list [data-module]").count()) === 20, "20 種類の欄");
    let patch = await synth("patch");
    assert.equal(new Set(patch.modules.map((m) => m.type)).size, 20);
    assert.equal(patch.cables.length, 0, "配線しない");
    assert.equal(await synth("revision"), rev0 + 1, "1 回の batch");
    assert.equal(await page.isDisabled("#panel-fill"), true, "全種類がそろえば押せない");
    assert.equal(await page.locator('#module-list [data-action="remove"]').evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length), 0, "モジュールの DEL は出さない");
    await page.click("#panel-undo");
    await waitFor(async () => (await synth("patch")).modules.length === 1, "取り消しで out だけに戻る");
    await page.click("#panel-redo");
    await waitFor(async () => (await synth("patch")).modules.length === 20, "やり直し");
    ok("FILL で 20 種類が 1 台ずつ並ぶ(配線なし、1 リビジョン)。UNDO 1 回で戻り、REDO で戻る");

    // ---- 3) エージェントのモジュールがあれば、ない種類だけ足す ----
    await agent("patch.new");
    await agent("batch", {
      ops: [
        { command: "module.add", args: { id: "vco", type: "MOD-OSC-001" } },
        { command: "module.add", args: { id: "vco2", type: "MOD-OSC-001" } },
        { command: "cable.connect", args: { from: { module: "vco", port: "saw" }, to: { module: "out", port: "IN_L" } } },
      ],
    });
    await waitFor(async () => (await page.locator("#module-list [data-module]").count()) === 3, "エージェントの 2 台が見える");
    assert.equal(await page.isDisabled("#panel-fill"), false);
    await page.click("#panel-fill");
    await waitFor(async () => (await page.locator("#module-list [data-module]").count()) === 21, "ない 18 種類を足す");
    patch = await synth("patch");
    assert.equal(patch.modules.filter((m) => m.type === "MOD-OSC-001").length, 2, "エージェントの 2 台目も残る");
    assert.equal(patch.cables.length, 1, "エージェントの配線は残る");
    ok("既にモジュールがあれば、ない種類だけ足す(エージェントの 2 台目と配線は残る)");

    // ---- 4) 配線(プルダウン)と切断、つまみ。人の操作の間もエージェントの操作が通る ----
    await page.selectOption("#cable-from", "env.env");
    await page.selectOption("#cable-to", "amp.cv1");
    await page.click("#cable-connect");
    await waitFor(async () => (await synth("patch")).cables.some((c) => c.from.module === "env" && c.to.module === "amp"), "プルダウンで接続");
    const cableId = (await synth("patch")).cables.find((c) => c.from.module === "env").id;
    await agent("param.set", { module_id: "vco2", param: "tune", value: 0.25 });
    await waitFor(async () => (await page.inputValue('#module-list [data-module="vco2"] input[type="number"][data-param="tune"]')) === "0.25", "エージェントの変更が PANEL に出る");
    await page.click(`#cable-list [data-cable="${cableId}"] [data-action="disconnect"]`);
    await waitFor(async () => !(await synth("patch")).cables.some((c) => c.id === cableId), "DEL で切断");
    const slider = page.locator('#module-list [data-module="flt"] input[type="range"]').first();
    const param = await slider.getAttribute("data-param");
    const before = (await synth("patch")).modules.find((m) => m.id === "flt").params[param];
    await slider.focus();
    await page.keyboard.press("End");
    await waitFor(async () => (await synth("patch")).modules.find((m) => m.id === "flt").params[param] !== before, "スライダーで param.set");
    const agentAfter = await agentRaw("cable.connect", { from: { module: "lfo", port: "saw" }, to: { module: "flt", port: "cv2" } });
    assert.equal(agentAfter.ok, true, JSON.stringify(agentAfter.error));
    ok("PANEL のプルダウンで接続・DEL で切断・スライダーで変更。間に送ったエージェントの操作も通る", `flt.${param}`);

    // ---- 5) 音量、緊急停止と解除 ----
    await page.click("#start");
    await waitFor(async () => (await synth("audioState")) === "running", "音声の開始");
    await page.fill("#level", "-30");
    await page.dispatchEvent("#level", "input");
    await waitFor(async () => (await status()).output.level_db === -30, "マスター音量");
    const over = await agentRaw("output.set_level", { level_db: -10 });
    assert.equal(over.ok, false, "エージェントは人が決めた上限(-30 dB)を超えられない");
    await page.click("#panel-panic");
    await waitFor(async () => (await status()).panic === true, "緊急停止");
    assert.equal(await page.isDisabled("#panel-release"), false);
    await page.click("#panel-release");
    await waitFor(async () => (await status()).panic === false, "解除");
    ok("PANEL の音量が上限になり、PANIC と RELEASE が効く");

    // ---- 5b) 楽譜が動かしているパラメータは、PANEL のつまみと数値が音声側のいまの値で動き、終われば パッチの値に戻る(DEC-029) ----
    const lfoSel = '#module-list [data-module="lfo"] .param[data-param="freq"]';
    const shownFreq = () => page.$eval(lfoSel, (row) => ({ range: Number(row.querySelector('input[type="range"]').value), number: row.querySelector('input[type="number"]').value, moving: row.classList.contains("moving") }));
    const patchFreq = (await synth("patch")).modules.find((m) => m.id === "lfo").params.freq;
    const f0 = await shownFreq(); // パッチの値の表示(スライダーは刻みに丸めて出す)
    await agent("score.play", { notes: [], length: 3, params: [{ t: 0, dur: 2, module_id: "lfo", param: "freq", value: patchFreq + 6 }] });
    await waitFor(async () => (await shownFreq()).moving, "動いている値の表示");
    const f1 = await shownFreq();
    await page.waitForTimeout(600);
    const f2 = await shownFreq();
    if (process.env.PANEL_SCREENSHOT) await page.locator('#module-list [data-module="lfo"]').screenshot({ path: process.env.PANEL_SCREENSHOT.replace(/(\.png)?$/, "-moving.png") });
    assert.ok(f2.range !== f0.range, `スライダーがパッチの値(${f0.range})のまま`);
    assert.ok(f2.range > f1.range, `スライダーが動く: ${f1.range} → ${f2.range}`);
    assert.notEqual(f2.number, f0.number, "数値の欄も動く");
    assert.equal((await synth("patch")).modules.find((m) => m.id === "lfo").params.freq, patchFreq, "パッチの値は書き換えない");
    await waitFor(async () => !(await shownFreq()).moving, "終わると表示を戻す", 10000);
    const f3 = await shownFreq();
    assert.deepEqual(f3, f0, "終わればパッチの値の表示に戻る");
    ok("楽譜が動かしている間は、PANEL のつまみと数値が音声側のいまの値で動き、終わればパッチの値に戻る", `freq ${f1.range} → ${f2.range} → ${f3.range}`);

    // ---- 6) 見える文字に日本語がない(DEC-023)。RACK に戻せる ----
    const japanese = /[぀-ヿ㐀-鿿＀-￯]/;
    const visible = await page.evaluate(() => [document.body.innerText, ...[...document.querySelectorAll("option, optgroup")].map((o) => o.label || o.textContent)].join("\n"));
    assert.equal(japanese.test(visible), false, `見える文字に日本語がある: ${JSON.stringify(visible.split("\n").filter((l) => japanese.test(l)).slice(0, 8))}`);
    if (process.env.PANEL_SCREENSHOT) await page.screenshot({ path: process.env.PANEL_SCREENSHOT, fullPage: true });
    await page.click("#tab-rack");
    assert.equal(await shown("#rack"), true);
    assert.equal(await shown("#panel-bar"), false);
    ok("PANEL の見える文字に日本語がない。RACK に戻せる");

    assert.deepEqual(await synth("errors"), [], "アプリのエラー");
    assert.deepEqual(pageErrors, [], "ページのエラー");
    ok("ページとワークレットにエラーなし");
  } finally {
    await browser.close();
    await app.close();
    fs.rmSync(patchDir, { recursive: true, force: true });
    fs.rmSync(`${patchDir}-performances`, { recursive: true, force: true });
  }
  console.log(`PANEL のブラウザ試験: ${results.length} 項目すべて合格(Chromium ヘッドレス)`);
}

main().catch((e) => {
  console.error("PANEL のブラウザ試験: 失敗");
  console.error(e);
  process.exit(1);
});
