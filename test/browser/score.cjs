// エージェントの演奏(楽譜と指示)の、実際のブラウザ(ヘッドレスの Chromium)での確認。npm run test:score-browser で実行する。
// verification-plan VER-A-009g。
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

  const patchDir = fs.mkdtempSync(path.join(os.tmpdir(), "synth-score-"));
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
      body: JSON.stringify({ v: 1, request_id: `score-${++seq}`, command, ...(args ? { args } : {}) }),
    });
    return res.json();
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
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") pageErrors.push(m.text());
    });
    const synth = (expr) => page.evaluate(`window.__synth.${expr}`);
    const waitFor = async (fn, what, timeout = 10000) => {
      const t0 = Date.now();
      let last;
      while (Date.now() - t0 < timeout) {
        last = await fn();
        if (last) return last;
        await page.waitForTimeout(40);
      }
      throw new Error(`${what} を待ったが満たされなかった(最後の値: ${JSON.stringify(last)})`);
    };
    const peak = async () => (await synth("status")).peak;
    const pitch = async () => (await agentOk("meter.read", { module_id: "mt", fields: ["level"] })).result.values.level;

    await page.goto(`${base}/`);
    await waitFor(() => synth("serverAccepted"), "タブの接続");
    const events = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`, { headers: { Authorization: `Bearer ${app.agentToken}` } });
    await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
    ws.on("message", (d) => { const m = JSON.parse(String(d)); if (m.event === "performance.changed") events.push(m.data); });

    // ---- 1) 音声が始まる前は演奏できない ----
    await page.click("#demo");
    await waitFor(async () => (await synth("patch")).modules.length === 6, "デモ用パッチ");
    await agentOk("batch", { ops: [
      { command: "module.add", args: { id: "mt", type: "MOD-IO-003" } },
      { command: "cable.connect", args: { from: { module: "midi", port: "PITCH" }, to: { module: "mt", port: "IN" } } },
    ] });
    const early = await agent("score.play", { notes: [{ t: 0, dur: 1, note: 60 }] });
    assert.equal(early.ok, false);
    assert.equal(early.error.id, "ERR-301");
    assert.equal(await page.textContent("#perf-state"), "");
    ok("人が音声を開始する前は、エージェントは演奏できない(ERR-301)");

    // ---- 2) エージェントが楽譜を送ると鳴る ----
    await page.click("#start");
    await waitFor(async () => (await synth("audioState")) === "running", "音声の開始");
    await page.waitForTimeout(300);
    assert.equal(await peak(), 0);
    const rev = await synth("revision");
    // ド(60)を 1 秒、ド1オクターブ上(72)を 1 秒。1 分 120 拍で 2 拍ずつ
    const first = await agentOk("score.play", { tempo_bpm: 120, notes: [{ t: 0, dur: 1.8, note: 60 }, { t: 2, dur: 1.8, note: 72 }], length: 4 });
    assert.equal(first.result.score_id, 1);
    assert.ok(Math.abs(first.result.starts_in - 0.1) < 0.02, `開始まで ${first.result.starts_in} 秒`);
    assert.ok(Math.abs(first.result.remaining - 2.1) < 0.02);
    await waitFor(async () => (await peak()) > 0.01, "楽譜の音が出る");
    assert.equal(await pitch(), 0, "1 つ目の音符(60)で PITCH は 0 V");
    await waitFor(async () => (await pitch()) === 1, "2 つ目の音符(72)で PITCH は 1 V", 3000);
    assert.match(await page.textContent("#perf-state"), /^▶ \d+:\d\d {2}\+\d+\.\ds$/);
    assert.equal(await synth("revision"), rev, "演奏ではリビジョンが変わらない");
    ok("エージェントが楽譜を送ると、楽譜どおりの音程で鳴る(60 → 0 V、72 → 1 V)。画面に「演奏中」と出る");

    // ---- 3) 演奏中に次の楽譜を送ると、切れ目なく続く ----
    const st = (await agentOk("score.get_status")).result;
    assert.equal(st.playing, true);
    assert.ok(st.remaining > 0 && st.remaining < 2.1);
    const second = await agentOk("score.play", { tempo_bpm: 120, notes: [{ t: 0, dur: 3.9, note: 67 }], length: 4 });
    assert.equal(second.result.queued_scores, 2);
    assert.ok(Math.abs(second.result.starts_in - st.remaining) < 0.2, `続きは前の楽譜の末尾から(${second.result.starts_in} と ${st.remaining})`);
    assert.ok(Math.abs(second.result.remaining - second.result.starts_in - 2) < 0.002);
    await waitFor(async () => Math.abs((await pitch()) - 7 / 12) < 1e-6, "続きの楽譜(67)の音程", 5000);
    assert.ok((await peak()) > 0.01, "続きも鳴っている");
    ok("演奏中に次の楽譜を送ると、前の楽譜の末尾に続いて鳴る", `残り ${second.result.remaining.toFixed(2)} 秒`);

    // ---- 4) 演奏し終えると、無音に戻り、通知が届く ----
    await waitFor(() => events.some((e) => e.reason === "finished"), "EVT-07(finished)", 8000);
    await waitFor(async () => (await peak()) === 0, "演奏の後は無音");
    assert.equal(await page.textContent("#perf-state"), "");
    assert.equal((await agentOk("score.get_status")).result.playing, false);
    assert.deepEqual(events.map((e) => e.reason), ["score_queued", "score_queued", "finished"]);
    ok("演奏し終えると無音に戻り、エージェントへ通知(EVT-07 finished)が届く");

    // ---- 5) 人の指示がエージェントに届き、反映済みが画面に出る ----
    await page.fill("#prompt-text", "もっと高い音で");
    await page.click("#prompt-send");
    await waitFor(async () => (await page.locator("#prompt-list li").count()) === 1, "指示の一覧");
    assert.equal(await page.inputValue("#prompt-text"), "", "送ったら欄が空になる");
    assert.equal(await page.textContent("#prompt-list li"), "· もっと高い音で");
    const withPrompt = (await agentOk("score.get_status")).result;
    assert.deepEqual(withPrompt.prompts, [{ id: 1, text: "もっと高い音で", acked: false }]);
    await waitFor(() => events.some((e) => e.reason === "prompt_sent" && e.prompts.length === 1), "EVT-07(prompt_sent)");
    const fromAgent = await agent("prompt.send", { text: "x" });
    assert.equal(fromAgent.error.id, "ERR-005");
    await agentOk("score.play", { notes: [{ t: 0, dur: 20, note: 84 }], ack_prompt: 1 });
    await waitFor(async () => (await page.textContent("#prompt-list li")) === "✓ もっと高い音で", "反映済みの表示");
    await waitFor(async () => (await pitch()) === 2, "指示を踏まえた楽譜(84)が鳴る");
    ok("人が書いた指示がエージェントに届き、エージェントが踏まえた楽譜を送ると画面に「反映済み」と出る");

    // ---- 6) 人が止められる。緊急停止でも止まり、解除の後に続きは鳴らない ----
    assert.equal(await page.isEnabled("#score-stop"), true);
    await page.click("#score-stop");
    await waitFor(async () => (await peak()) === 0, "「演奏を止める」で無音");
    assert.equal((await agentOk("score.get_status")).result.playing, false);
    assert.equal(await page.isEnabled("#score-stop"), false);
    await agentOk("score.play", { notes: [{ t: 0, dur: 30, note: 60 }, { t: 30, dur: 30, note: 62 }] });
    await waitFor(async () => (await peak()) > 0.01, "また鳴る");
    await page.click("#panic");
    await waitFor(async () => (await peak()) === 0, "緊急停止で無音");
    assert.equal((await agentOk("score.get_status")).result.playing, false, "予約は捨てられる");
    const duringPanic = await agent("score.play", { notes: [{ t: 0, dur: 1, note: 60 }] });
    assert.equal(duringPanic.error.id, "ERR-301");
    await page.click("#release");
    await page.waitForTimeout(600);
    assert.equal(await peak(), 0, "解除の後、楽譜の続きは鳴らない");
    ok("人が「演奏を止める」で止められる。緊急停止で予約が捨てられ、解除の後に続きは鳴らない");

    // ---- 7) 演奏した楽譜が、日時つきの名前で保存される。画面とエージェントから再演奏できる ----
    const perfDir = `${patchDir}-performances`;
    const files = fs.readdirSync(perfDir).sort();
    assert.ok(files.length === 2, `演奏ごとにファイルがある: ${files.join(", ")}`);
    for (const f of files) assert.match(f, /^\d{8}-\d{6}(-[2-9])?\.performance\.json$/);
    const listed = (await agentOk("performance.list")).result.performances.map((p) => p.name);
    assert.deepEqual(listed, files.map((f) => f.replace(".performance.json", "")).reverse(), "一覧は新しい順");
    const oldest = listed.at(-1);
    const doc = (await agentOk("performance.read", { name: oldest })).result.performance;
    assert.equal(doc.format, "modular-synth-performance");
    assert.equal(doc.ended_by, "stopped", "人が「演奏を止める」で止めた");
    assert.equal(doc.entries.length, 3, "演奏し終えて 30 秒以内の続きは、同じ演奏に入る");
    assert.deepEqual(doc.entries.slice(0, 2).map((e) => e.at), [0, 2], "2 つの楽譜が、切れ目なく続いた位置で残っている");
    assert.ok(doc.entries[2].at > 4, "間を空けて送った楽譜は、実際に始まった位置");
    assert.deepEqual(doc.prompts.map((p) => p.text), ["もっと高い音で"]);
    assert.deepEqual(doc.entries[0].score.notes.map((n) => n.note), [60, 72]);
    assert.ok(doc.patch.modules.some((m) => m.id === "mt"), "演奏を始めた時点のパッチ");
    assert.match(await page.textContent("#perf-saved"), /^\d{8}-\d{6}(-\d)? · \d+$/);
    ok("演奏した楽譜が、日時つきの名前で専用フォルダに保存され、エージェントが一覧・中身を読める", files.join(", "));

    // 再演奏(エージェント): 保存した楽譜のとおりに鳴る(60 → 72 → 67)
    const revBefore = await synth("revision");
    const replay = await agentOk("performance.replay", { name: oldest });
    assert.equal(replay.result.scores, 3);
    assert.equal(await synth("revision"), revBefore + 1, "パッチの置き換えでリビジョンが進む");
    await waitFor(async () => (await pitch()) === 0 && (await peak()) > 0.01, "再演奏の 1 音目(60)");
    await waitFor(async () => (await pitch()) === 1, "再演奏の 2 音目(72)");
    await agentOk("score.stop");
    // 再演奏(画面): 一覧のボタンから
    await page.click("#performance-refresh");
    await waitFor(async () => (await page.locator("#performance-list li[data-performance]").count()) >= 3, "画面の一覧");
    await page.click(`#performance-list li[data-performance="${oldest}"] button`);
    await waitFor(async () => (await agentOk("score.get_status")).result.playing, "画面からの再演奏");
    await waitFor(async () => (await peak()) > 0.01, "鳴る");
    await page.click("#score-stop");
    ok("保存した演奏を、エージェントと画面から再演奏できる(楽譜どおりに鳴る)");

    // ---- 8) 演奏せずに、音声ファイルに書き出す(画面のボタンと、エージェント) ----
    await waitFor(async () => (await peak()) === 0, "止めた後の無音");
    await page.click(`#performance-list li[data-performance="${oldest}"] button:has-text("WAV")`);
    await waitFor(async () => (await page.textContent(`#performance-list li[data-performance="${oldest}"] .render-state`)).endsWith(".wav"), "画面からの書き出し");
    const wavPath = path.join(perfDir, `${oldest}.wav`);
    assert.ok(fs.existsSync(wavPath), "演奏データと同じフォルダに <名前>.wav");
    assert.ok((await page.textContent(`#performance-list li[data-performance="${oldest}"] .render-state`)).includes(wavPath), "画面に場所が出る");
    const rendered = (await agentOk("performance.render", { name: oldest })).result;
    assert.equal(rendered.status, "done", "エージェントが同じ引数で聞くと、書き出し済みの結果が返る");
    assert.equal(fs.statSync(wavPath).size, rendered.bytes);
    assert.ok(rendered.peak > 0.01 && rendered.clip_count === 0);
    assert.equal(rendered.scores, 3);
    assert.equal((await agentOk("score.get_status")).result.playing, false, "演奏はしていない");
    assert.equal(await peak(), 0, "音は出ていない");
    ok("演奏せずに、演奏データから音声ファイル(WAV)を書き出せる(画面のボタン、エージェント)", `${rendered.seconds.toFixed(1)} 秒、${(rendered.bytes / 2 ** 20).toFixed(1)} MiB`);

    // 演奏の長さの予定: 画面で決めると、エージェントが読める
    await page.fill("#plan-minutes", "3");
    await page.click("#plan-set");
    await waitFor(async () => (await agentOk("score.get_status")).result.plan.duration_seconds === 180, "予定が届く");
    await page.fill("#plan-minutes", "");
    await page.click("#plan-set");
    await waitFor(async () => (await agentOk("score.get_status")).result.plan.duration_seconds === null, "止めるまで続ける");
    ok("人が演奏の長さを決めると、エージェントが読める。空にすると「止めるまで」");

    assert.deepEqual(await synth("errors"), [], "ワークレットと画面が記録したエラー");
    assert.equal(await synth("desyncCount"), 0);
    assert.deepEqual(pageErrors, [], "ページのエラー");
    ok("ページとワークレットにエラーなし");
    ws.close();
  } finally {
    await browser.close();
    await app.close();
    fs.rmSync(patchDir, { recursive: true, force: true });
    fs.rmSync(`${patchDir}-performances`, { recursive: true, force: true });
  }
  console.log(`演奏のブラウザ試験: ${results.length} 項目すべて合格(Chromium ヘッドレス)`);
}

main().catch((e) => {
  console.error("演奏のブラウザ試験: 失敗");
  console.error(e);
  process.exit(1);
});
