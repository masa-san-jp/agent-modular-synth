// 実際のブラウザ(ヘッドレスの Chromium)での確認。npm run test:browser で実行する。
// 確認すること: ユーザー操作の前は音声が始まらない / 「音声開始」の後に AudioWorklet が動く /
// ゲートを開くと出力が無音でなく ±1.0 以内 / 緊急停止で無音 / 解除後にまた鳴る。
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function main() {
  const { chromium } = require("playwright");
  const { createStaticServer, listen } = await import(
    pathToFileURL(path.join(__dirname, "..", "..", "dist", "src", "server", "static.js")).href
  );
  const server = createStaticServer(path.join(__dirname, "..", "..", "web"));
  const port = await listen(server, 0); // 試験では空いているポートを使う
  const browser = await chromium.launch({ args: ["--autoplay-policy=user-gesture-required"] });
  const results = [];
  const ok = (name, detail = "") => {
    results.push(name);
    console.log(`ok - ${name}${detail ? " (" + detail + ")" : ""}`);
  };
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") pageErrors.push(m.text());
    });
    await page.goto(`http://127.0.0.1:${port}/`);
    const status = () => page.evaluate(() => window.__synth.status);
    const waitStatus = async (pred, what, timeout = 8000) => {
      const t0 = Date.now();
      let last = null;
      while (Date.now() - t0 < timeout) {
        last = await status();
        if (last && pred(last)) return last;
        await page.waitForTimeout(100);
      }
      throw new Error(`${what} を待ったが満たされなかった。最後の状態: ${JSON.stringify(last)}`);
    };

    // 1) ユーザー操作の前
    assert.equal(await page.evaluate(() => window.isSecureContext), true);
    ok("127.0.0.1 での配信はセキュアコンテキスト");
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.__synth.contextState), "none");
    assert.equal(await status(), null);
    ok("ユーザー操作の前は AudioContext を作らず、音声は始まらない");

    // 2) 音声開始
    await page.click("#start");
    const s1 = await waitStatus((s) => s.audioState === "running", "音声の開始");
    assert.equal(await page.evaluate(() => window.__synth.contextState), "running");
    ok("「音声開始」の後に AudioWorklet が動く", `fs=${s1.fs}`);
    assert.equal(s1.peak, 0);
    ok("ゲートを開く前は無音");

    // 3) 鳴らす(ボタンを押している間)
    const note = page.locator("#note");
    await note.dispatchEvent("pointerdown");
    const s2 = await waitStatus((s) => s.peak > 0.01, "音が出る");
    assert.ok(s2.peak <= 1 && Number.isFinite(s2.peak));
    assert.equal(s2.nonfiniteCount + s2.moduleNonfiniteCount, 0);
    assert.equal(s2.levelDb, -20);
    ok("ゲートを開くと出力が無音でなく、±1.0 以内で有限", `peak=${s2.peak.toFixed(4)}, level=${s2.levelDb} dB`);

    // 4) 音量を上げ、波形を切り替える(パッチの読込)と、音量は既定値へ下がる
    await page.fill("#level", "0");
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await waitStatus((s) => s.levelDb === 0, "音量 0 dB");
    await page.selectOption("#wave", "pulse");
    const s3 = await waitStatus((s) => s.levelDb === -20, "読込後の音量の引き下げ");
    assert.equal(s3.agentMaxLevelDb, 0);
    assert.equal(await page.inputValue("#level"), "-20", "スライダーも実際の値に合う");
    ok("パッチの読込で音量が自動で上がらない(既定値へ下がり、上限は変わらない)");

    // 5) 緊急停止
    await note.dispatchEvent("pointerdown");
    await waitStatus((s) => s.peak > 0.01, "音が出る(緊急停止の前)");
    await page.click("#panic");
    await waitStatus((s) => s.panic === true, "緊急停止");
    await page.waitForTimeout(300);
    await note.dispatchEvent("pointerdown");
    await page.waitForTimeout(500);
    const s4 = await waitStatus((s) => s.panic === true && s.peak === 0, "緊急停止中の無音");
    ok("緊急停止の後は、鳴らす操作をしても無音", `peak=${s4.peak}`);

    // 6) 解除
    await page.click("#release");
    const s5 = await waitStatus((s) => s.panic === false && s.peak > 0.01, "解除後に音が出る");
    assert.ok(s5.peak <= 1);
    ok("緊急停止を解除すると、また鳴る", `peak=${s5.peak.toFixed(4)}`);

    await note.dispatchEvent("pointerup");
    assert.deepEqual(pageErrors, [], "ページのエラー");
    assert.deepEqual(await page.evaluate(() => window.__synth.errors), []);
    ok("ページとワークレットにエラーなし");
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`ブラウザ試験: ${results.length} 項目すべて合格(Chromium ヘッドレス)`);
}

main().catch((e) => {
  console.error("ブラウザ試験: 失敗");
  console.error(e);
  process.exit(1);
});
