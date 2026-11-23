// 実際の経路で鳴らす: サーバーを起動 → ブラウザのタブ(ヘッドレス)→ 人の役が「音声開始」を押す →
// エージェント(このスクリプト)が HTTP の共通コマンドでパッチを組み、楽譜を 1 つずつ送って演奏を続ける。
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const root = path.join(__dirname, "..");
const load = (rel) => import(pathToFileURL(path.join(root, "dist", "src", rel)).href);

async function main() {
  const { chromium } = require("playwright");
  const { createApp } = await load("server/app.js");
  const { buildCatalog } = await load("control/catalog.js");
  const { REGISTRY } = await load("modules/registry.js");
  const { PATCH, SCORES } = await import(pathToFileURL(path.join(__dirname, "piece.mjs")).href);
  const patchDir = fs.mkdtempSync(path.join(os.tmpdir(), "synth-demo-"));
  const app = createApp({ webRoot: path.join(root, "web"), patchDir, catalog: buildCatalog(REGISTRY) });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ args: ["--autoplay-policy=user-gesture-required"] });
  let seq = 0;
  const agent = async (command, args) => {
    const res = await fetch(`${base}/api/command`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${app.agentToken}` }, body: JSON.stringify({ v: 1, request_id: `demo-${++seq}`, command, ...(args ? { args } : {}) }) });
    const r = await res.json();
    if (!r.ok) throw new Error(`${command}: ${JSON.stringify(r.error)}`);
    return r;
  };
  const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} 秒] ${s}`);
  let t0 = Date.now();
  try {
    const page = await (await browser.newContext()).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const synth = (expr) => page.evaluate(`window.__synth.${expr}`);
    await page.goto(`${base}/`);
    while (!(await synth("serverAccepted"))) await page.waitForTimeout(50);
    // エージェント: パッチを組む
    const built = await agent("batch", { ops: PATCH });
    log(`パッチを組んだ(モジュール ${(await agent("patch.get")).result.patch.modules.length} 個、リビジョン ${built.revision})`);
    // 人の役: 音声開始(エージェントにはできない操作)
    await page.click("#start");
    while ((await synth("audioState")) !== "running") await page.waitForTimeout(50);
    await page.waitForTimeout(300);
    t0 = Date.now();
    log("人が音声を開始した");
    // 人の役: 途中で指示を書く
    let prompted = false;
    const peaks = [];
    for (let i = 0; i < SCORES.length; i++) {
      // 次の楽譜を送る前に、状態と指示を読む
      const st = (await agent("score.get_status")).result;
      const pending = st.prompts.filter((p) => !p.acked);
      const args = { ...SCORES[i], ...(pending.length ? { ack_prompt: pending[pending.length - 1].id } : {}) };
      const r = await agent("score.play", args);
      log(`楽譜 ${i + 1} を送った(音符 ${SCORES[i].notes.length} 個)。開始まで ${r.result.starts_in.toFixed(2)} 秒、予約の残り ${r.result.remaining.toFixed(2)} 秒${pending.length ? `。指示「${pending[pending.length - 1].text}」を反映済みにした` : ""}`);
      // 次の楽譜を「書いている」間も演奏は続く。残りが 3 秒を切るまで待つ
      for (;;) {
        await page.waitForTimeout(500);
        const s = await synth("status");
        peaks.push(s.peak);
        const now = (await agent("score.get_status")).result;
        if (!prompted && i === 1 && now.remaining < 6) {
          await page.fill("#prompt-text", "次はもっと高く、動きを増やして");
          await page.click("#prompt-send");
          prompted = true;
          log("人が指示を書いた: 「次はもっと高く、動きを増やして」");
        }
        if (i < SCORES.length - 1 ? now.remaining < 3 : !now.playing) break;
      }
    }
    log("演奏し終えた");
    await page.waitForTimeout(500);
    const end = await synth("status");
    const list = await page.locator("#prompt-list li").allTextContents();
    console.log(`\n演奏中の出力ピーク: 最小 ${Math.min(...peaks).toFixed(3)} / 最大 ${Math.max(...peaks).toFixed(3)}(0.5 秒ごとに ${peaks.length} 回)`);
    console.log(`演奏後のピーク: ${end.peak.toFixed(3)} / 最終クリップ ${end.clipCount} / 非有限値 ${end.nonfiniteModules + end.nonfiniteOutputStage}`);
    console.log(`画面の指示の一覧: ${JSON.stringify(list)}`);
    console.log(`リビジョン: ${await synth("revision")}(演奏では変わらない) / 画面とワークレットのエラー: ${JSON.stringify(errors.concat(await synth("errors")))}`);
  } finally {
    await browser.close();
    await app.close();
    fs.rmSync(patchDir, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
