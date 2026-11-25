// サーバーにつながっていない間の演奏データの保存の、実際のブラウザ(ヘッドレスの Chromium)での確認。
// npm run test:reconnect-browser で実行する。verification-plan VER-A-010i(DEC-025)。
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

  const patchDir = fs.mkdtempSync(path.join(os.tmpdir(), "synth-reconnect-"));
  const perfDir = `${patchDir}-performances`;
  const make = () => createApp({ webRoot: path.join(root, "web"), patchDir, catalog: buildCatalog(REGISTRY) });
  let app = make();
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ args: ["--autoplay-policy=user-gesture-required"] });
  const results = [];
  const ok = (name, detail = "") => {
    results.push(name);
    console.log(`ok - ${name}${detail ? " (" + detail + ")" : ""}`);
  };
  let seq = 0;
  const agentOk = async (command, args) => {
    const res = await fetch(`${base}/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${app.agentToken}` },
      body: JSON.stringify({ v: 1, request_id: `rc-${++seq}`, command, ...(args ? { args } : {}) }),
    });
    const r = await res.json();
    assert.equal(r.ok, true, `${command}: ${JSON.stringify(r)}`);
    return r.result;
  };
  const perfFiles = () => (fs.existsSync(perfDir) ? fs.readdirSync(perfDir).filter((f) => f.endsWith(".performance.json")).sort() : []);
  const readPerf = (f) => JSON.parse(fs.readFileSync(path.join(perfDir, f), "utf8"));

  try {
    const page = await (await browser.newContext()).newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    const synth = (expr) => page.evaluate(`window.__synth.${expr}`);
    const waitFor = async (fn, what, timeout = 15000) => {
      const t0 = Date.now();
      let last;
      while (Date.now() - t0 < timeout) {
        last = await fn();
        if (last) return last;
        await page.waitForTimeout(50);
      }
      throw new Error(`${what} を待ったが満たされなかった(最後の値: ${JSON.stringify(last)})`);
    };

    await page.goto(`${base}/`);
    await waitFor(() => synth("serverAccepted"), "タブの接続");
    await page.click("#demo");
    await waitFor(async () => (await synth("patch")).modules.length === 6, "デモ用パッチ");
    await page.click("#start");
    await waitFor(async () => (await synth("audioState")) === "running", "音声の開始");

    // ---- 1) 演奏中にサーバーが止まり、その間に人が演奏を止める。つながり直したら、止めた印が書かれる ----
    await agentOk("score.play", { notes: [{ t: 0, dur: 20, note: 60 }], length: 20 });
    const file = await waitFor(() => perfFiles()[0], "演奏データ");
    assert.equal(readPerf(file).ended_by, null, "演奏中");
    await app.close();
    await waitFor(async () => !(await synth("serverAccepted")), "接続が切れる");
    assert.equal(await page.isEnabled("#score-stop"), true, "サーバーが止まっていても、演奏は続いている");
    await page.click("#score-stop");
    await waitFor(async () => !(await page.isEnabled("#score-stop")), "演奏が止まる");
    await page.waitForTimeout(300);
    assert.equal(readPerf(file).ended_by, null, "切れている間は、止めた印を書けない");
    app = make();
    await app.listen(port);
    await waitFor(() => synth("serverAccepted"), "つながり直す", 20000);
    await waitFor(() => readPerf(file).ended_by === "stopped", "つながり直した後に、止めた印が書かれる");
    const doc = readPerf(file);
    assert.equal(typeof doc.ended_at, "string");
    assert.equal(doc.entries.length, 1);
    assert.equal(perfFiles().length, 1, "同じファイルを書き直す(新しいファイルは作らない)");
    ok("演奏中にサーバーが止まり、その間に止めても、つながり直したら演奏データに止めた印が付く", file);

    // ---- 2) つながり直した後の演奏も、ふつうに保存される ----
    await agentOk("score.play", { notes: [{ t: 0, dur: 0.3, note: 62 }], length: 0.5 });
    await waitFor(() => perfFiles().length === 2, "次の演奏データ");
    ok("つながり直した後の演奏は、新しい演奏データとして保存される");

    assert.deepEqual(await synth("errors"), []);
    assert.deepEqual(pageErrors, []);
    ok("ページとワークレットにエラーなし");
  } finally {
    await browser.close();
    await app.close();
    fs.rmSync(patchDir, { recursive: true, force: true });
    fs.rmSync(perfDir, { recursive: true, force: true });
  }
  console.log(`再接続のブラウザ試験: ${results.length} 項目すべて合格(Chromium ヘッドレス)`);
}

main().catch((e) => {
  console.error("再接続のブラウザ試験: 失敗");
  console.error(e);
  process.exit(1);
});
