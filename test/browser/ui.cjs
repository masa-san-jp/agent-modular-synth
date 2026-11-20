// パッチの編集画面(Issue #22)の確認。実際のブラウザ(ヘッドレスの Chromium)で、画面の操作だけでパッチを組む。
// npm run test:ui で実行する。作りは smoke.cjs と同じ(サーバーを空きポートで起動 → タブを開く)。
// 環境変数 UI_SCREENSHOT にパスを入れると、画面の画像を保存する。
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

  const patchDir = fs.mkdtempSync(path.join(os.tmpdir(), "synth-ui-"));
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
  /** エージェント(HTTP)。 */
  const agent = async (command, args, extra = {}) => {
    const res = await fetch(`${base}/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${app.agentToken}` },
      body: JSON.stringify({ v: 1, request_id: `ui-e2e-${++seq}`, command, ...(args ? { args } : {}), ...extra }),
    });
    return res.json();
  };

  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
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
        await page.waitForTimeout(50);
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
    const text = (sel) => page.locator(sel).innerText();
    const snapshot = async () => ({ patch: JSON.stringify(await synth("patch")), revision: await synth("revision") });
    const moduleOf = async (id) => (await synth("patch")).modules.find((m) => m.id === id);
    const numberOf = (id, param) => page.locator(`#module-list [data-module="${id}"] input[type="number"][data-param="${param}"]`);
    /** 数値欄に入力して確定する(Enter)。 */
    const typeNumber = async (id, param, value) => {
      const input = numberOf(id, param);
      await input.fill(String(value));
      await input.press("Enter");
    };
    const connect = async (from, to) => {
      await page.selectOption("#cable-from", from);
      await page.selectOption("#cable-to", to);
      await page.click("#cable-connect");
    };

    // ---- 1) 開いた直後 ----
    await page.goto(`${base}/`);
    await waitFor(() => synth("serverAccepted"), "タブがサーバーに受け付けられる");
    await page.waitForSelector('#module-list [data-module="out"]');
    assert.equal(await page.locator('#module-list [data-module="out"] button[data-action="remove"]').count(), 0);
    assert.match(await text('#module-list [data-module="out"]'), /オーディオ出力/);
    assert.equal(await page.isDisabled("#undo"), true);
    assert.equal(await page.isDisabled("#redo"), true);
    assert.equal(await page.isDisabled("#release"), true);
    assert.match(await text(".note"), /ヘッドホン/);
    ok("開いた直後: 常設の出力モジュールが日本語の種別名で表示され、削除ボタンがない。取り消し・やり直し・解除は無効。ヘッドホンの注意文がある");

    // 接続できないポート(PRE_L など)は選択肢に出ない
    const fromOptions0 = await page.locator("#cable-from option").evaluateAll((os) => os.map((o) => o.value));
    assert.deepEqual(fromOptions0.filter((v) => /^out\.(PRE|DEV)_/.test(v)), []);

    // ---- 2) モジュールの追加 → 出力への接続 → 音声開始 → 音が出る ----
    await page.selectOption("#add-type", "MOD-OSC-001");
    await page.fill("#add-id", "vco");
    await page.click("#add-module");
    await page.waitForSelector('#module-list [data-module="vco"]');
    assert.equal((await moduleOf("vco")).type, "MOD-OSC-001");
    assert.match(await text('#module-list [data-module="vco"] h3'), /VCO/);
    assert.equal(await synth("revision"), 1);
    ok("画面でモジュール(VCO)を追加すると、パッチとモジュール一覧に反映される");

    await connect("vco.sine", "out.IN_L");
    await page.waitForSelector("#cable-list li[data-cable]");
    const cables1 = (await synth("patch")).cables;
    assert.equal(cables1.length, 1);
    assert.deepEqual(cables1[0].to, { module: "out", port: "IN_L" });
    ok("画面で出力へ接続すると、ケーブルの一覧に出る");

    assert.equal(await synth("contextState"), "none");
    await page.click("#start");
    await waitFor(async () => (await synth("audioState")) === "running", "音声の開始");
    const s1 = await peakAbove(0.001);
    assert.equal(await page.isDisabled("#start"), true);
    ok("音声開始の後、画面で組んだパッチが鳴る。出力は無音でなく ±1.0 以内", `peak=${s1.peak.toFixed(4)}`);

    // ---- 3) パラメータの変更と取り消し ----
    const tune0 = (await moduleOf("vco")).params.tune;
    await typeNumber("vco", "tune", 0.5);
    await waitFor(async () => (await moduleOf("vco")).params.tune === 0.5, "tune = 0.5");
    const revTune = await synth("revision");
    ok("数値欄でパラメータを変えると patch に反映される");

    // スライダーを動かしている間の変更は、取り消し1回で元に戻る(coalesce_key)
    const slider = page.locator('#module-list [data-module="vco"] input[type="range"][data-param="tune"]');
    await slider.dispatchEvent("pointerdown");
    for (const v of ["0.6", "0.7", "0.8"]) {
      await slider.evaluate((el, value) => {
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }, v);
    }
    await slider.dispatchEvent("change");
    await slider.dispatchEvent("pointerup");
    await waitFor(async () => (await moduleOf("vco")).params.tune === 0.8, "スライダーで tune = 0.8");
    assert.equal(await synth("revision"), revTune + 3, "リビジョンは1回ごとに進む");
    assert.equal(await numberOf("vco", "tune").inputValue(), "0.8");
    await page.click("#undo");
    await waitFor(async () => (await moduleOf("vco")).params.tune === 0.5, "取り消しで 0.5 へ");
    assert.equal(await numberOf("vco", "tune").inputValue(), "0.5");
    assert.equal(await slider.inputValue(), "0.5");
    await page.click("#undo");
    await waitFor(async () => (await moduleOf("vco")).params.tune === tune0, "取り消しで元の値へ");
    ok("スライダーの連続操作は取り消し1回で戻り、もう1回の取り消しで最初の値に戻る。入力欄も追従する");
    await page.click("#redo");
    await waitFor(async () => (await moduleOf("vco")).params.tune === 0.5, "やり直しで 0.5 へ");
    ok("やり直しで変更が戻る");

    // ---- 4) 無効な操作はエラー表示になり、状態は変わらない ----
    const before1 = await snapshot();
    await typeNumber("vco", "tune", 99);
    await waitFor(async () => /ERR-123/.test(await text("#error")), "ERR-123 の表示");
    assert.match(await text("#error"), /param_out_of_range/);
    assert.deepEqual(await snapshot(), before1);
    assert.equal(await numberOf("vco", "tune").inputValue(), "0.5", "入力欄は実際の値に戻る");
    ok("範囲外の値を数値欄に入れるとエラーID・コード・メッセージが表示され、patch とリビジョンは変わらず、入力欄は実際の値に戻る", (await text("#error")).slice(0, 60));

    await page.selectOption("#add-type", "MOD-OSC-001");
    await page.click("#add-module");
    await waitFor(async () => (await synth("patch")).modules.length === 3, "2つ目の VCO");
    const second = (await synth("patch")).modules.find((m) => m.id !== "out" && m.id !== "vco").id;
    assert.equal(await text("#error"), "", "成功したらエラー表示は消える");
    const before2 = await snapshot();
    await connect(`${second}.saw`, "out.IN_L");
    await waitFor(async () => /ERR-114/.test(await text("#error")), "ERR-114 の表示");
    assert.match(await text("#error"), /input_occupied/);
    assert.deepEqual(await snapshot(), before2);
    ok("使用中の入力への接続はエラー表示(ERR-114)になり、patch とリビジョンは変わらない");

    // 型違いの接続は成功し、注意が表示される
    await connect("vco.sine", `${second}.pitch`);
    await waitFor(async () => /type_mismatch/.test(await text("#notice")), "型違いの注意");
    assert.equal((await synth("patch")).cables.length, 2);
    ok("型違いの接続は成功し、注意(type_mismatch)が画面に表示される");

    // ---- 5) 切断で無音、モジュールの削除 ----
    const toOut = (await synth("patch")).cables.find((c) => c.to.module === "out").id;
    await page.click(`#cable-list li[data-cable="${toOut}"] button[data-action="disconnect"]`);
    await waitFor(async () => (await synth("patch")).cables.length === 1, "切断");
    await silent();
    ok("画面で出力へのケーブルを切断すると無音になる");

    await page.click(`#module-list [data-module="${second}"] button[data-action="remove"]`);
    await waitFor(async () => (await synth("patch")).modules.length === 2, "モジュールの削除");
    assert.equal(await page.locator(`#module-list [data-module="${second}"]`).count(), 0);
    assert.equal((await synth("patch")).cables.length, 0, "つながっていたケーブルも外れる");
    assert.equal(await page.locator("#cable-list li[data-cable]").count(), 0);
    ok("画面でモジュールを削除すると、一覧から消え、つながっていたケーブルも外れる");

    // ---- 6) 保存 → 新規 → 一覧 → 読込 ----
    await connect("vco.sine", "out.IN_R");
    await waitFor(async () => (await synth("patch")).cables.length === 1, "保存前の接続");
    const savedPatch = await synth("patch");
    await page.fill("#save-name", "ui-test");
    await page.click("#save");
    await page.waitForSelector('#library li[data-patch="ui-test"]');
    assert.ok(fs.existsSync(path.join(patchDir, "ui-test.patch.json")));
    const revSaved = await synth("revision");
    // 同じ名前でもう一度保存すると、上書きの確認が出る
    await page.click("#save");
    await page.waitForSelector("#confirm:not([hidden])");
    assert.match(await text("#confirm-text"), /上書き/);
    await page.click("#confirm-ok");
    await waitFor(async () => /上書き/.test(await text("#notice")), "上書き保存の表示");
    assert.equal(await synth("revision"), revSaved, "保存ではリビジョンは進まない");
    ok("名前を付けて保存すると一覧に出る。同じ名前は確認の後に上書きできる");

    await page.click("#new");
    await waitFor(async () => (await synth("patch")).modules.length === 1, "新規作成");
    assert.equal(await page.locator("#module-list [data-module]").count(), 1);
    await silent();
    assert.equal(await page.locator('#library li[data-patch="ui-test"]').count(), 1);
    await page.click('#library li[data-patch="ui-test"] button[data-action="load"]');
    await waitFor(async () => (await synth("patch")).modules.length === 2, "読込");
    const loaded = await synth("patch");
    assert.deepEqual(loaded.modules, savedPatch.modules);
    assert.deepEqual(loaded.cables, savedPatch.cables);
    await page.waitForSelector('#module-list [data-module="vco"]');
    assert.equal(await numberOf("vco", "tune").inputValue(), "0.5");
    await peakAbove(0.001);
    ok("新規作成で空になり、一覧から読み込むと構成・パラメータ・ケーブルが復元されて鳴る");

    // ---- 7) エージェントの変更が画面に反映される ----
    const added = await agent("module.add", { type: "MOD-LFO-001", id: "agentlfo" }, { client_id: "ui-e2e-agent" });
    assert.equal(added.ok, true, JSON.stringify(added));
    await page.waitForSelector('#module-list [data-module="agentlfo"]');
    assert.match(await text('#module-list [data-module="agentlfo"] h3'), /LFO/);
    const top = page.locator("#history li").first();
    assert.equal(await top.getAttribute("data-actor"), "agent");
    assert.match(await top.innerText(), /エージェント/);
    assert.match(await top.innerText(), /agentlfo/);
    const toOptions = await page.locator("#cable-to option").evaluateAll((os) => os.map((o) => o.value));
    assert.ok(toOptions.some((v) => v.startsWith("agentlfo.")), "接続の選択肢にも出る");
    ok("エージェントがモジュールを足すと、モジュール一覧と変更の履歴(エージェントの操作と分かる表示)に反映される", (await top.innerText()).replace(/\s+/g, " "));

    // エージェントがパラメータを変えると入力欄が追従し、人が取り消せる(履歴は1本)
    const setByAgent = await agent("param.set", { module_id: "vco", param: "tune", value: -0.25 });
    assert.equal(setByAgent.ok, true, JSON.stringify(setByAgent));
    await waitFor(async () => (await numberOf("vco", "tune").inputValue()) === "-0.25", "入力欄がエージェントの値に追従");
    await page.click("#undo");
    await waitFor(async () => (await numberOf("vco", "tune").inputValue()) === "0.5", "人の取り消しで戻る");
    assert.equal(await page.locator("#history li").first().getAttribute("data-actor"), "human");
    ok("エージェントのパラメータ変更に入力欄が追従し、人の「取り消し」で戻る");

    // ---- 8) そのほか ----
    assert.equal(await page.locator('#module-list [data-module="out"] button[data-action="remove"]').count(), 0);
    assert.equal(await page.locator('#module-list [data-module="vco"] button[data-action="remove"]').count(), 1);
    ok("出力モジュールには削除ボタンがなく、ほかのモジュールにはある");

    // パラメータが多い種別(ステップシーケンサ)は折りたたんで表示する
    await page.selectOption("#add-type", "MOD-SEQ-001");
    await page.fill("#add-id", "seq");
    await page.click("#add-module");
    await page.waitForSelector('#module-list [data-module="seq"] details');
    assert.equal(await page.locator('#module-list [data-module="seq"] details').evaluate((d) => d.open), false);
    await page.click('#module-list [data-module="seq"] summary');
    const gate = page.locator('#module-list [data-module="seq"] input[type="checkbox"][data-param="gate[2]"]');
    assert.equal(await gate.isChecked(), true);
    await gate.click();
    await waitFor(async () => (await moduleOf("seq")).params["gate[2]"] === 0, "真偽のパラメータ");
    ok("パラメータが多い種別は折りたたみ表示。真偽のパラメータはチェックボックスで変えられる");

    if (process.env.UI_SCREENSHOT) await page.screenshot({ path: process.env.UI_SCREENSHOT, fullPage: true });

    // 保存済みパッチの削除(人のみ)。確認の後に消える
    await page.click('#library li[data-patch="ui-test"] button[data-action="delete"]');
    await page.waitForSelector("#confirm:not([hidden])");
    await page.click("#confirm-ok");
    await waitFor(async () => (await page.locator('#library li[data-patch="ui-test"]').count()) === 0, "一覧から消える");
    assert.equal(fs.existsSync(path.join(patchDir, "ui-test.patch.json")), false);
    ok("保存済みパッチを確認の後に削除できる");

    // 画面幅が狭くても横にはみ出さない
    await page.setViewportSize({ width: 340, height: 800 });
    await page.waitForTimeout(100);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `幅 340px で横に ${overflow}px はみ出す`);
    ok("幅 340px でも横にはみ出さない");

    assert.deepEqual(await synth("errors"), [], "アプリのエラー");
    assert.deepEqual(pageErrors, [], "ページのエラー");
    ok("ページとワークレットにエラーなし");
  } finally {
    await browser.close();
    await app.close();
    fs.rmSync(patchDir, { recursive: true, force: true });
  }
  console.log(`画面の試験: ${results.length} 項目すべて合格(Chromium ヘッドレス)`);
}

main().catch((e) => {
  console.error("画面の試験: 失敗");
  console.error(e);
  process.exit(1);
});
