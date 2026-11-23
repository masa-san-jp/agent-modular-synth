// 使い方: node demo/play-live.cjs [曲のファイル(既定 piece.mjs。techno.mjs など)]
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
  const { PATCH, SECTIONS, TITLE, SOUNDCHECK } = await import(pathToFileURL(path.resolve(process.argv[2] || path.join(__dirname, "piece.mjs"))).href);
  console.log(TITLE);
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
    // サウンドチェック(曲が設定を持っていれば): エージェントが卓のメーターを読んで、音量の配分を決める
    if (SOUNDCHECK) {
      const { soundcheck } = await import(pathToFileURL(path.join(__dirname, "soundcheck.mjs")).href);
      log("サウンドチェック(エージェントが、聞く代わりにメーターを読む)");
      await soundcheck({ send: async (command, args) => (await agent(command, args)).result, advance: (sec) => page.waitForTimeout(sec * 1000) }, SOUNDCHECK, (t) => console.log(t));
      log("サウンドチェック終わり。演奏を始める");
    }
    // 人の役: 途中で指示を書く
    let prompted = false;
    const peaks = [];
    const tick = async () => {
      await page.waitForTimeout(500);
      peaks.push((await synth("status")).peak);
      return (await agent("score.get_status")).result;
    };
    for (let i = 0; i < SECTIONS.length; i++) {
      const sec = SECTIONS[i];
      // 次の楽譜を送る前に、状態と指示を読む
      const st = (await agent("score.get_status")).result;
      const pending = st.prompts.filter((p) => !p.acked);
      const r = await agent("score.play", { ...sec.score, ...(pending.length ? { ack_prompt: pending[pending.length - 1].id } : {}) });
      log(`楽譜 ${i + 1}(${sec.name}、音符 ${sec.score.notes.length} 個)を送った。開始まで ${r.result.starts_in.toFixed(2)} 秒、予約の残り ${r.result.remaining.toFixed(2)} 秒${pending.length ? `。指示「${pending[pending.length - 1].text}」を反映済みにした` : ""}`);
      // この区間が始まったら、パラメータを動かす
      const startAt = Date.now() + r.result.starts_in * 1000;
      while (Date.now() < startAt) await tick();
      for (const p of sec.params) await agent("param.set", p);
      if (sec.params.length) log(`  区間「${sec.name}」に入った。パラメータを ${sec.params.length} 個動かした`);
      // 次の楽譜を「書いている」間も演奏は続く。残りが 4 秒を切るまで待つ
      for (;;) {
        const now = await tick();
        if (!prompted && i === 1 && now.remaining < 8) {
          await page.fill("#prompt-text", "もっと暗く、重く");
          await page.click("#prompt-send");
          prompted = true;
          log("人が指示を書いた: 「もっと暗く、重く」");
        }
        if (i < SECTIONS.length - 1 ? now.remaining < 4 : !now.playing) break;
      }
    }
    log("演奏し終えた");
    await page.waitForTimeout(500);
    const end = await synth("status");
    const list = await page.locator("#prompt-list li").allTextContents();
    console.log(`\n演奏中の出力ピーク: 最小 ${Math.min(...peaks).toFixed(3)} / 最大 ${Math.max(...peaks).toFixed(3)}(0.5 秒ごとに ${peaks.length} 回)`);
    console.log(`演奏後のピーク: ${end.peak.toFixed(3)} / 最終クリップ ${end.clipCount} / 非有限値 ${end.nonfiniteModules + end.nonfiniteOutputStage}`);
    console.log(`画面の指示の一覧: ${JSON.stringify(list)}`);
    console.log(`リビジョン: ${await synth("revision")}(進むのは、パッチを組んだ分とサウンドチェックで音量を直した分だけ。演奏では進まない) / 画面とワークレットのエラー: ${JSON.stringify(errors.concat(await synth("errors")))}`);
  } finally {
    await browser.close();
    await app.close();
    fs.rmSync(patchDir, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
