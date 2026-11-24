// ラックの表示と配色(Issue #31)の、実際のブラウザ(ヘッドレスの Chromium)での確認。npm run test:rack-browser で実行する。
// 見た目の方針(docs/design/20261123-ui-visual-direction-single-hue-wash.md)の数値を、資料と同じ測り方で確かめる。
// 環境変数 RACK_SCREENSHOT にパスを入れると、画面の画像を保存する。
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
  const { PATCH } = await import(pathToFileURL(path.join(root, "demo", "techno.mjs")).href);

  const patchDir = fs.mkdtempSync(path.join(os.tmpdir(), "synth-rack-"));
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
  const agent = async (command, args) => {
    const res = await fetch(`${base}/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${app.agentToken}` },
      body: JSON.stringify({ v: 1, request_id: `rack-${++seq}`, command, ...(args ? { args } : {}) }),
    });
    const r = await res.json();
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
    /** キャンバスの画素を、資料と同じ測り方で測る: 暗部(L<0.15)、白飛び(L>0.8)、彩度の高い画素の色相の幅(四分位範囲)。 */
    const measure = () =>
      page.evaluate(() => {
        const cv = document.getElementById("rack");
        const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
        const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        let dark = 0;
        let bright = 0;
        let sat = 0;
        const hues = [];
        const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i] / 255;
          const g = d[i + 1] / 255;
          const b = d[i + 2] / 255;
          const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
          if (L < 0.15) dark++;
          if (L > 0.8) bright++;
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const s = max === 0 ? 0 : (max - min) / max;
          if (s > 0.5) sat++;
          if (s > 0.5 && max > 0.3) {
            const c = max - min;
            let h = max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
            h = (h * 60 + 360) % 360;
            hues.push(h);
          }
        }
        hues.sort((a, b) => a - b);
        const q = (p) => hues[Math.floor((hues.length - 1) * p)];
        return { dark: dark / n, bright: bright / n, sat: sat / n, hue: q(0.5), spread: q(0.75) - q(0.25), counted: hues.length, w: cv.width, h: cv.height };
      });

    await page.goto(`${base}/`, { waitUntil: "load" });
    await waitFor(() => synth("serverAccepted"), "タブがサーバーに受け付けられる");

    // ---- 1) ラックが、パッチどおりの板・ジャック・ケーブルを持つ ----
    await agent("batch", { ops: PATCH });
    await waitFor(async () => (await synth("rack.layout.panels.length")) === 41, "板の数");
    const patch = await synth("patch");
    const layout = await synth("rack.layout");
    assert.deepEqual(layout.panels.map((p) => p.id), patch.modules.map((m) => m.id), "板はモジュールの順");
    const size = await page.evaluate(() => {
      const r = document.getElementById("rack").getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
    assert.ok(size.w > 1000 && size.h > 400 && size.h <= 950, `ラックの大きさ ${size.w}×${size.h}`);
    // 板には、すべてのパラメータの行がある(値は数字で描かれる)
    for (const p of layout.panels) {
      const m = patch.modules.find((x) => x.id === p.id);
      assert.deepEqual(p.rows.flatMap((r) => r.params).sort(), Object.keys(m.params).sort(), `${p.id} のパラメータ`);
    }
    // 画面の並び: 音量と prompt が上、ラックが広く、ユーティリティ(緊急停止・MIDI・画面鍵盤・色)はいちばん下
    const order = await page.evaluate(() => {
      const top = (sel) => document.querySelector(sel).getBoundingClientRect().top + scrollY;
      return { level: top("#level"), prompt: top("#prompt-text"), rack: top("#rack"), modules: top("#module-list"), util: top("#utility"), panic: top("#panic"), midi: top("#midi-connect"), keys: top("#keys"), hue: top("#hue"), bottom: document.documentElement.scrollHeight };
    });
    assert.ok(order.level < order.prompt && order.prompt < order.rack && order.rack < order.modules && order.modules < order.util, JSON.stringify(order));
    for (const k of ["panic", "midi", "keys", "hue"]) assert.ok(order[k] > order.util, `${k} はユーティリティの中`);
    assert.ok(order.rack < 400, "ラックは、最初の画面に見えている");
    assert.equal((await page.textContent('label[for="prompt-text"]')).trim(), "prompt");
    assert.equal(await page.getAttribute("#prompt-text", "placeholder"), null, "prompt の欄に説明を書かない");
    assert.match(await page.getAttribute("#rack", "aria-label"), /41 個のモジュールと 56 本のケーブル/);
    ok("ラックに、パッチのモジュールが板として並び、板に全パラメータの行がある。音量と prompt が上、ユーティリティが下", `板 ${layout.panels.length} 枚、${Math.round(size.w)}×${Math.round(size.h)}px`);

    // ---- 2) 見た目の数値(資料の測り方): 暗部 10% 以上、白飛び 2.4% 以下、色相の幅 31° 以内 ----
    await page.click("#start");
    await waitFor(async () => (await synth("audioState")) === "running", "音声の開始");
    await page.waitForTimeout(500);
    const m = await measure();
    assert.ok(m.dark >= 0.1 && m.dark <= 0.66, `暗部 ${(m.dark * 100).toFixed(1)}%(資料の実測の範囲 10〜66%)`);
    assert.ok(m.bright <= 0.024, `白飛び ${(m.bright * 100).toFixed(2)}%(2.4% 以下)`);
    assert.ok(m.bright > 0, "発光する点(LED・LCD)がある");
    assert.ok(m.spread <= 31, `色相の幅 ${m.spread.toFixed(1)}°(31° 以内)`);
    assert.ok(Math.abs(m.hue - 196) <= 6, `主色相 ${m.hue.toFixed(0)}°(既定はシアン 196°)`);
    assert.ok(m.sat >= 0.8, `彩度の高い画素 ${(m.sat * 100).toFixed(0)}%`);
    ok("単色ウォッシュの数値を満たす(暗部・白飛び・色相の幅)", `暗部 ${(m.dark * 100).toFixed(0)}%、白飛び ${(m.bright * 100).toFixed(2)}%、色相 ${m.hue.toFixed(0)}° 幅 ${m.spread.toFixed(1)}°、彩度 ${(m.sat * 100).toFixed(0)}%`);

    // ---- 3) LED は、音の出ているモジュールで点く。状態の帯 ----
    const act = (await synth("status")).activity;
    assert.ok(Object.keys(act).length === 41, "全モジュールの出力の大きさが届く");
    assert.ok(Object.values(act).some((v) => v >= 0.5) && Object.values(act).some((v) => v < 0.5), "点く板と、消えている板がある");
    const hud = await page.$$eval("#rack-hud div", (els) => els.map((e) => e.textContent));
    assert.deepEqual(hud.slice(0, 1).concat(hud.slice(2)), ["audio run", "mod 41 · cbl 56", "idle", "out -20db", "hue 196°"]);
    assert.match(hud[1], /^rev \d+$/);
    ok("LED は出力のあるモジュールで点き、状態は下の帯に等幅でまとまる", hud.join(" | "));

    // 楽譜がパラメータを動かしている間は、音声側のいまの値が届く(板の数字が動く)
    await agent("score.play", { notes: [], length: 3, params: [{ t: 0, dur: 2, module_id: "r_vcf", param: "cutoff", value: 2 }] });
    await waitFor(async () => (await synth("status")).overrides.r_vcf?.cutoff !== undefined, "動いている値が届く");
    const v1 = (await synth("status")).overrides.r_vcf.cutoff;
    await page.waitForTimeout(400);
    const v2 = (await synth("status")).overrides.r_vcf.cutoff;
    assert.ok(v2 > v1 && v2 <= 2, `値が動いている: ${v1} → ${v2}`);
    assert.equal((await synth("patch")).modules.find((x) => x.id === "r_vcf").params.cutoff, patch.modules.find((x) => x.id === "r_vcf").params.cutoff, "パッチの値は変わらない");
    await agent("score.stop");
    await waitFor(async () => Object.keys((await synth("status")).overrides).length === 0, "演奏が止まれば、パッチの値へ戻る");
    ok("楽譜がパラメータを動かしている間は、板の数字が音声側のいまの値で動く", `cutoff ${v1.toFixed(3)} → ${v2.toFixed(3)}`);

    // ---- 4) 色相を選べる。ページ全体が同じ色相になる。選んだ色は再読込の後も残る ----
    await page.selectOption("#hue", "297");
    await waitFor(async () => (await synth("rack.hue")) === 297, "色相の変更");
    const magenta = await measure();
    assert.ok(Math.abs(magenta.hue - 297) <= 6 && magenta.spread <= 31, `マゼンタ: 色相 ${magenta.hue.toFixed(0)}° 幅 ${magenta.spread.toFixed(1)}°`);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--h").trim()), "297");
    assert.equal(await page.isDisabled("#hue-period"), true, "固定のとき、周期は選べない");
    const options = await page.$$eval("#hue option", (els) => els.map((e) => e.value));
    assert.deepEqual(options, ["196", "173", "141", "117", "227", "268", "297", "345", "cycle"]);
    ok("色相を選ぶと、ラックもページも同じ 1 つの色相になる", `マゼンタ 297° → 実測 ${magenta.hue.toFixed(0)}°`);

    // ---- 5) 自動: 周期的に、連続に変わる。黄・橙は通らない ----
    await page.selectOption("#hue", "cycle");
    await page.selectOption("#hue-period", "60");
    const seen = [];
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(250);
      seen.push(await synth("rack.hue"));
    }
    assert.ok(new Set(seen).size >= 6, `色相が動く: ${seen.join(", ")}`);
    for (let i = 1; i < seen.length; i++) assert.ok(Math.abs(seen[i] - seen[i - 1]) < 8, `跳ばない: ${seen[i - 1]} → ${seen[i]}`);
    assert.ok(seen.every((h) => h >= 117 && h <= 348), "範囲は緑 117° 〜 赤 348°");
    assert.ok(Math.abs(seen[0] - 297) < 10, "選んでいた色相から動き始める");
    const auto = await measure();
    assert.ok(auto.spread <= 31, `動いている間も、1 枚の中は単色(幅 ${auto.spread.toFixed(1)}°)`);
    assert.match((await page.$$eval("#rack-hud div", (els) => els.map((e) => e.textContent))).at(-1), /^hue \d+° auto$/);
    await page.reload({ waitUntil: "load" });
    await waitFor(() => synth("serverAccepted"), "再読込");
    assert.equal(await page.inputValue("#hue"), "cycle", "設定は再読込の後も残る");
    assert.equal(await page.inputValue("#hue-period"), "60");
    ok("自動にすると、色相が周期的に連続に変わる(黄・橙は通らない)。設定は再読込の後も残る", `3 秒で ${seen[0]}° → ${seen.at(-1)}°`);

    // ---- 6) 板を押すと、そのモジュールの欄へ移る。変わったモジュールが分かる ----
    await page.selectOption("#hue", "196");
    await waitFor(async () => (await synth("rack.layout.panels.length")) === 41, "再読込の後の板");
    const target = await page.evaluate(() => {
      const r = window.__synth.rack;
      const p = r.layout.panels.find((x) => x.id === "desk");
      const b = document.getElementById("rack").getBoundingClientRect();
      return { x: b.left + (p.x + p.w / 2) * r.scale, y: b.top + (p.y + p.h / 2) * r.scale };
    });
    await page.mouse.click(target.x, target.y);
    await waitFor(() => page.evaluate(() => document.activeElement?.closest("[data-module]")?.getAttribute("data-module") === "desk"), "卓の欄へ移る");
    assert.ok(await page.evaluate(() => {
      const r = document.querySelector('#module-list [data-module="desk"]').getBoundingClientRect();
      return r.top >= 0 && r.top < innerHeight;
    }), "卓の欄が画面の中にある");
    ok("ラックの板を押すと、そのモジュールの欄へ移る");

    // ---- 7) 緊急停止は、色相の規則の例外で赤い枠が出る。LED は消える ----
    await page.evaluate(() => scrollTo(0, 0));
    await page.keyboard.press("Escape"); // 緊急停止のボタンは下にあるので、Esc キーでも止められる
    await waitFor(async () => (await page.$$eval("#rack-hud div", (els) => els[0].textContent)) === "panic", "帯に panic");
    await page.waitForTimeout(300);
    const red = await page.evaluate(() => {
      const cv = document.getElementById("rack");
      const d = cv.getContext("2d").getImageData(1, Math.floor(cv.height / 2), 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    assert.ok(red[0] > 180 && red[1] < 90 && red[2] < 130, `枠が赤い: ${red}`);
    await page.click("#release");
    ok("Esc キーで緊急停止できる。その間は、ラックに赤い枠が出る(見落とせない表示は、色相の規則より優先)");

    // ---- 8) 文字の読みやすさ(地との明るさの比)と、狭い画面 ----
    const contrast = await page.evaluate(() => {
      const lum = (rgb) => {
        const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map((v) => {
          const x = Number(v) / 255;
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const probe = (sel) => {
        const el = document.querySelector(sel);
        const fg = lum(getComputedStyle(el).color);
        const bg = lum(getComputedStyle(document.documentElement).backgroundColor);
        return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      };
      return { body: probe("body"), muted: probe(".muted"), hud: probe("#rack-hud div"), heading: probe("h2") };
    });
    assert.ok(contrast.body >= 7, `本文 ${contrast.body.toFixed(1)}:1`);
    for (const k of ["muted", "hud", "heading"]) assert.ok(contrast[k] >= 4.5, `${k} ${contrast[k].toFixed(1)}:1`);
    if (process.env.RACK_SCREENSHOT) await page.screenshot({ path: process.env.RACK_SCREENSHOT });
    await page.setViewportSize({ width: 340, height: 800 });
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `幅 340px で横に ${overflow}px はみ出す`);
    assert.equal(await synth("rack.layout.panels.length"), 41);
    ok("文字は地との明るさの比を保つ(本文 7:1 以上、補助 4.5:1 以上)。幅 340px でもはみ出さない", `本文 ${contrast.body.toFixed(1)}:1、補助 ${contrast.muted.toFixed(1)}:1`);

    // ---- 画面に文章を書かない(DEC-023): 全 20 種のモジュール、エラー、知らせ、確認を出した状態で、見える文字に日本語が 1 文字もない ----
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.selectOption("#hue", "196");
    const types = (await agent("module.list_types")).result.types.map((x) => x.type).filter((x) => x !== "MOD-IO-001");
    await agent("patch.new");
    await agent("batch", { ops: types.map((type, i) => ({ command: "module.add", args: { type, id: `m${i}` } })) });
    await waitFor(async () => (await page.locator("#module-list [data-module]").count()) === 20, "全 20 種の欄");
    await page.evaluate(() => { for (const d of document.querySelectorAll("#module-list details")) d.open = true; });
    await page.evaluate(() => window.__synth.human("score.play", { notes: [{ t: 0, dur: 1, note: 60 }], length: 2 }));
    await page.fill("#prompt-text", "x");
    await page.click("#prompt-send");
    await page.fill("#save-name", "t1");
    await page.click("#save");
    await page.click("#save"); // 同じ名前: 上書きの確認が出る
    await page.waitForSelector("#confirm:not([hidden])");
    const japanese = /[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/;
    const visible = async () => page.evaluate(() => [document.body.innerText, ...[...document.querySelectorAll("option, optgroup")].map((o) => o.label || o.textContent), ...[...document.querySelectorAll("input[placeholder]")].map((i) => i.placeholder)].join("\n"));
    let shown = await visible();
    assert.equal(japanese.test(shown), false, `見える文字に日本語がある: ${JSON.stringify(shown.split("\n").filter((l) => japanese.test(l)).slice(0, 8))}`);
    await page.click("#confirm-cancel");
    await page.evaluate(() => window.__synth.human("score.stop"));
    // エラー(範囲外の値)と、注意(型違いの接続)
    await page.fill('#module-list [data-module="out"] input[type="number"]', "999");
    await page.keyboard.press("Enter");
    await waitFor(async () => /^ERR-\d{3} [a-z_]+$/.test(await page.textContent("#error")), "エラーは ID とコードだけ");
    assert.ok((await page.getAttribute("#error", "title")).length > 0, "説明の文は title にある");
    shown = await visible();
    assert.equal(japanese.test(shown), false, `エラーの表示に日本語がある: ${JSON.stringify(shown.split("\n").filter((l) => japanese.test(l)).slice(0, 8))}`);
    const longest = shown.split("\n").map((l) => l.trim()).filter((l) => l && !/→|=|\d| \/ /.test(l)).reduce((a, l) => (l.split(/\s+/).length > a.split(/\s+/).length ? l : a), "");
    assert.ok(longest.split(/\s+/).length <= 4, `ラベルは短い語だけ(いちばん長いもの: ${longest})`);
    ok("画面の見える文字に、日本語(文章)が 1 文字もない(全 20 種のモジュール、演奏中、確認、エラーを出した状態)", `いちばん長いラベル: ${longest}`);

    assert.deepEqual(await synth("errors"), [], "アプリのエラー");
    assert.deepEqual(pageErrors, [], "ページのエラー");
    ok("ページとワークレットにエラーなし");
  } finally {
    await browser.close();
    await app.close();
    fs.rmSync(patchDir, { recursive: true, force: true });
    fs.rmSync(`${patchDir}-performances`, { recursive: true, force: true });
  }
  console.log(`ラックのブラウザ試験: ${results.length} 項目すべて合格(Chromium ヘッドレス)`);
}

main().catch((e) => {
  console.error("ラックのブラウザ試験: 失敗");
  console.error(e);
  process.exit(1);
});
