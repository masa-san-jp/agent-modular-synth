// 演奏の様子(画面と音)を録る。demo/play-live.cjs と同じ流れ(テクノ曲)を、画面を録画しながら動かし、
// ブラウザの中でシンセの出力を録音する(アプリのコードは変えず、録るときだけ AudioNode.connect を包む)。
// 使い方: npm run build && node demo/record-video.cjs <出力フォルダ> [曲のファイル(既定 demo/techno.mjs)]
// 出力: screen.webm(画面)、audio.webm(音。PCM)、meta.json(音の始まりの位置など)。1 本の動画にするには、例えば:
//   ffmpeg -i screen.webm -i audio.webm -filter_complex "[1:a]adelay=<audioOffset のミリ秒>|<同>[a]" -map 0:v -map "[a]" -c:v libx264 -c:a aac out.mp4
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const root = path.join(__dirname, "..");
const load = (rel) => import(pathToFileURL(path.join(root, "dist", "src", rel)).href);

// ページの中で: ワークレットの出力が音声の出口へつながるとき、同じ音を MediaRecorder にも流す
const CAPTURE = `(() => {
  const orig = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = orig.call(this, dest, ...rest);
    try {
      if (dest instanceof AudioDestinationNode && this instanceof AudioWorkletNode && !window.__rec) {
        const md = this.context.createMediaStreamDestination();
        orig.call(this, md);
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=pcm") ? "audio/webm;codecs=pcm" : "audio/webm;codecs=opus";
        const rec = new MediaRecorder(md.stream, { mimeType: mime, audioBitsPerSecond: 320000 });
        const chunks = [];
        rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        rec.start(1000);
        window.__rec = { rec, chunks, mime, startedAt: Date.now(), ctxTimeAtStart: this.context.currentTime };
      }
    } catch (e) { window.__recError = String(e); }
    return r;
  };
})();`;

async function main() {
  const out = path.resolve(process.argv[2] || ".");
  fs.mkdirSync(out, { recursive: true });
  const { chromium } = require("playwright");
  const { createApp } = await load("server/app.js");
  const { buildCatalog } = await load("control/catalog.js");
  const { REGISTRY } = await load("modules/registry.js");
  const piece = await import(pathToFileURL(path.resolve(root, process.argv[3] || "demo/techno.mjs")).href);
  const { PATCH, SECTIONS, TITLE, SOUNDCHECK, HUE } = piece;
  const patchDir = fs.mkdtempSync(path.join(os.tmpdir(), "synth-video-"));
  const app = createApp({ webRoot: path.join(root, "web"), patchDir, catalog: buildCatalog(REGISTRY) });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ args: ["--autoplay-policy=user-gesture-required"] });
  let seq = 0;
  const agent = async (command, args) => {
    const res = await fetch(`${base}/api/command`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${app.agentToken}` }, body: JSON.stringify({ v: 1, request_id: `video-${++seq}`, command, ...(args ? { args } : {}) }) });
    const r = await res.json();
    if (!r.ok) throw new Error(`${command}: ${JSON.stringify(r.error)}`);
    return r;
  };
  const W = 1600, H = 900;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: out, size: { width: W, height: H } } });
  await ctx.addInitScript(CAPTURE);
  const videoStart = Date.now();
  const page = await ctx.newPage();
  const T = () => ((Date.now() - videoStart) / 1000).toFixed(1).padStart(5);
  const log = (s) => console.log(`[${T()} 秒] ${s}`);
  const marks = [];
  const mark = (s) => { marks.push({ t: (Date.now() - videoStart) / 1000, s }); log(s); };
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const synth = (expr) => page.evaluate(`window.__synth.${expr}`);
  try {
    await page.goto(`${base}/`);
    while (!(await synth("serverAccepted"))) await page.waitForTimeout(50);
    if (HUE !== undefined) {
      // 人の役: 曲に合わせて画面の色相を選ぶ(画面の hue の選択。製品の機能そのまま)
      await page.selectOption("#hue", String(HUE));
      mark(`人が画面の色相を ${HUE} にした`);
    }
    await page.waitForTimeout(1500);
    await agent("batch", { ops: PATCH });
    mark(`エージェントがパッチを組んだ(${TITLE}、モジュール ${(await agent("patch.get")).result.patch.modules.length} 個)`);
    await page.waitForTimeout(2500);
    await page.click("#start");
    while ((await synth("audioState")) !== "running") await page.waitForTimeout(50);
    mark("人が START を押した");
    if (SOUNDCHECK) {
      const { soundcheck } = await import(pathToFileURL(path.join(root, "demo", "soundcheck.mjs")).href);
      mark("サウンドチェック(エージェントがメーターを読んで音量を整える)");
      await soundcheck({ send: async (command, args) => (await agent(command, args)).result, advance: (sec) => page.waitForTimeout(sec * 1000) }, SOUNDCHECK, () => undefined);
    }
    let prompted = false;
    const tick = async () => { await page.waitForTimeout(250); return (await agent("score.get_status")).result; };
    for (let i = 0; i < SECTIONS.length; i++) {
      const sec = SECTIONS[i];
      const st = (await agent("score.get_status")).result;
      const pending = st.prompts.filter((p) => !p.acked);
      const r = await agent("score.play", { ...sec.score, ...(pending.length ? { ack_prompt: pending[pending.length - 1].id } : {}) });
      const startAt = Date.now() + r.result.starts_in * 1000;
      while (Date.now() < startAt) await tick();
      mark(`楽譜 ${i + 1}「${sec.name}」が始まった`);
      for (const p of sec.params) await agent("param.set", p);
      for (;;) {
        const now = await tick();
        if (!prompted && i === 1 && now.remaining < 8 && piece.PROMPT !== null) {
          const text = piece.PROMPT ?? "もっと暗く、重く";
          await page.fill("#prompt-text", text);
          await page.click("#prompt-send");
          prompted = true;
          mark(`人が指示を書いた: ${text}`);
        }
        if (i < SECTIONS.length - 1 ? now.remaining < 4 : !now.playing) break;
      }
    }
    mark("演奏し終えた");
    await page.waitForTimeout(2500);
    // 録音を取り出す
    const audio = await page.evaluate(async () => {
      const r = window.__rec;
      if (!r) return { error: window.__recError || "no recorder" };
      await new Promise((res) => { r.rec.onstop = res; r.rec.stop(); });
      const blob = new Blob(r.chunks, { type: r.mime });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { b64: btoa(s), mime: r.mime, startedAt: r.startedAt };
    });
    if (audio.error) throw new Error(`録音できなかった: ${audio.error}`);
    fs.writeFileSync(path.join(out, "audio.webm"), Buffer.from(audio.b64, "base64"));
    const st = await synth("status");
    const meta = { videoStart, audioStartedAt: audio.startedAt, audioOffset: (audio.startedAt - videoStart) / 1000, mime: audio.mime, marks, clipCount: st.clipCount, errors: errors.concat(await synth("errors")) };
    fs.writeFileSync(path.join(out, "meta.json"), JSON.stringify(meta, null, 2));
    log(`録音 ${audio.mime}、画面の開始から ${meta.audioOffset.toFixed(2)} 秒後に始まった。クリップ ${st.clipCount}、エラー ${JSON.stringify(meta.errors)}`);
    const video = page.video();
    await page.close();
    await ctx.close();
    fs.renameSync(await video.path(), path.join(out, "screen.webm"));
  } finally {
    await browser.close();
    await app.close();
    fs.rmSync(patchDir, { recursive: true, force: true });
    fs.rmSync(`${patchDir}-performances`, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
