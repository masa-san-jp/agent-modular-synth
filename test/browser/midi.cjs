// MIDI 機器の接続(Web MIDI)の、実際のブラウザ(ヘッドレスの Chromium)での確認。npm run test:midi-browser で実行する。
// 試験環境に MIDI 機器はないので、ブラウザの Web MIDI の入口(navigator.requestMIDIAccess)を試験用の機器に差し替える。
// 差し替えるのは入口だけで、その先(受信 → エンジン → 音)は製品のコードがそのまま動く。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..", "..");
const load = (rel) => import(pathToFileURL(path.join(root, "dist", "src", rel)).href);

/** ページに入れる試験用の Web MIDI。window.__fakeMidi から機器を足す・抜く・メッセージを送る。 */
const FAKE_MIDI = `
(() => {
  const inputs = new Map();
  const access = { inputs: { forEach: (fn) => inputs.forEach((v) => fn(v)) }, onstatechange: null };
  window.__fakeMidi = {
    mode: "ok", // "ok" | "deny"
    asked: 0,
    sysex: null,
    add(id, name) { inputs.set(id, { id, name, state: "connected", onmidimessage: null }); access.onstatechange && access.onstatechange(); },
    unplug(id) { const i = inputs.get(id); i.state = "disconnected"; access.onstatechange && access.onstatechange(); },
    send(id, bytes) { const i = inputs.get(id); if (i.onmidimessage) { i.onmidimessage({ data: new Uint8Array(bytes) }); return true; } return false; },
  };
  navigator.requestMIDIAccess = (opts) => {
    window.__fakeMidi.asked++;
    window.__fakeMidi.sysex = opts ? opts.sysex : undefined;
    return window.__fakeMidi.mode === "deny" ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve(access);
  };
})();
`;

async function main() {
  const { chromium } = require("playwright");
  const WebSocket = require("ws");
  const { createApp } = await load("server/app.js");
  const { buildCatalog } = await load("control/catalog.js");
  const { REGISTRY } = await load("modules/registry.js");

  const patchDir = fs.mkdtempSync(path.join(os.tmpdir(), "synth-midi-"));
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
  const agentOk = async (command, args) => {
    const res = await fetch(`${base}/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${app.agentToken}` },
      body: JSON.stringify({ v: 1, request_id: `midi-${++seq}`, command, ...(args ? { args } : {}) }),
    });
    const r = await res.json();
    assert.equal(r.ok, true, `${command}: ${JSON.stringify(r)}`);
    return r;
  };
  const midiAvailable = async () => (await agentOk("engine.get_status")).result.midi.available;
  const pageErrors = [];
  const open = async (init) => {
    const context = await browser.newContext();
    if (init) await context.addInitScript(init);
    const page = await context.newPage();
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") pageErrors.push(m.text());
    });
    await page.goto(`${base}/`);
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
    await waitFor(() => synth("serverAccepted"), "タブの接続");
    return { context, page, synth, waitFor };
  };

  try {
    // ---- 1) 対応ブラウザ: 接続の前は「使えない」。押すまで許可を尋ねない ----
    const a = await open(FAKE_MIDI);
    const fake = (expr) => a.page.evaluate(`window.__fakeMidi.${expr}`);
    assert.equal(await midiAvailable(), false);
    assert.equal(await fake("asked"), 0, "ページを開いただけでは許可を尋ねない");
    assert.match(await a.page.textContent("#midi-state"), /^off$/);
    assert.equal(await a.page.isEnabled("#midi-connect"), true);
    ok("接続の前は midi.available が偽。ページを開いただけでは MIDI の許可を尋ねない");

    // ---- 2) 接続: 利用可否が状態と通知に出る ----
    const events = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`, { headers: { Authorization: `Bearer ${app.agentToken}` } });
    await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
    ws.on("message", (d) => { const m = JSON.parse(String(d)); if (m.event) events.push(m); });
    await fake('add("k1", "Fake Keys")');
    await a.page.click("#midi-connect");
    await a.waitFor(async () => (await a.synth("midiState")).kind === "ready", "MIDI が使える");
    assert.equal(await fake("asked"), 1);
    assert.equal(await fake("sysex"), false, "SysEx は求めない");
    assert.equal(await midiAvailable(), true);
    assert.match(await a.page.textContent("#midi-state"), /Fake Keys/);
    assert.equal(await a.page.isEnabled("#midi-connect"), false);
    await a.waitFor(() => events.some((e) => e.event === "engine.state_changed" && e.data.midi && e.data.midi.available === true), "EVT-02");
    ok("「MIDI を接続」で機器の名前が表示され、midi.available が真になり、エージェントへ通知(EVT-02)が届く");

    // ---- 3) 機器の鍵盤で鳴る(画面鍵盤と同じ経路) ----
    await a.page.click("#demo");
    await a.waitFor(async () => (await a.synth("patch")).modules.length === 6, "デモ用パッチ");
    await agentOk("batch", { ops: [
      { command: "module.add", args: { id: "mt", type: "MOD-IO-003" } },
      { command: "cable.connect", args: { from: { module: "midi", port: "PITCH" }, to: { module: "mt", port: "IN" } } },
    ] });
    // 音声が止まっている間のメッセージは、ためない(開始しても鳴らない)
    assert.equal(await fake("send('k1', [0x90, 72, 100])"), true);
    await a.page.click("#start");
    await a.waitFor(async () => (await a.synth("audioState")) === "running", "音声の開始");
    await a.page.waitForTimeout(400);
    assert.equal((await a.synth("status")).peak, 0, "開始前に届いたノートは鳴らない");
    await fake("send('k1', [0x90, 60, 100])"); // ノート60(C4)オン
    const loud = await a.waitFor(async () => {
      const s = await a.synth("status");
      return s && s.peak > 0.01 ? s : null;
    }, "MIDI のノートオンで音が出る");
    const pitch60 = (await agentOk("meter.read", { module_id: "mt", fields: ["level"] })).result.values.level;
    assert.equal(pitch60, 0, "ノート60で PITCH は 0 V(COM-03)");
    await fake("send('k1', [0x90, 72, 100])"); // 1オクターブ上
    await a.waitFor(async () => (await agentOk("meter.read", { module_id: "mt", fields: ["level"] })).result.values.level === 1, "ノート72で PITCH は 1 V");
    await fake("send('k1', [0x80, 72, 0])");
    await fake("send('k1', [0x80, 60, 0])");
    await a.waitFor(async () => (await a.synth("status")).peak === 0, "ノートオフで音が止まる");
    const before = await a.synth("revision");
    assert.equal(await a.synth("revision"), before);
    ok("MIDI 機器のノートオンで鳴り、ノートオフで止まる。ノート60で PITCH は 0 V、72 で 1 V。開始前のノートは鳴らない", `peak=${loud.peak.toFixed(4)}`);

    // 演奏はコマンド・履歴・リビジョンの対象外
    const rev0 = await a.synth("revision");
    await fake("send('k1', [0x90, 64, 90])");
    await fake("send('k1', [0x80, 64, 0])");
    await a.page.waitForTimeout(200);
    assert.equal(await a.synth("revision"), rev0);
    // 長いメッセージ(3バイトを超える)と空のメッセージは渡さない
    const n0 = await a.synth("midiMessages");
    await fake("send('k1', [0xf0, 1, 2, 3, 0xf7])");
    await fake("send('k1', [])");
    assert.equal(await a.synth("midiMessages"), n0);
    ok("演奏ではリビジョンが変わらない。3バイトを超えるメッセージは渡さない");

    // ---- 4) 抜き差し ----
    await fake('add("k2", "Second Pad")');
    await a.waitFor(async () => (await a.synth("midiState")).inputs.length === 2, "2台目");
    assert.match(await a.page.textContent("#midi-state"), /Fake Keys, Second Pad/);
    await fake("send('k2', [0x90, 67, 100])");
    await a.waitFor(async () => (await a.synth("status")).peak > 0.01, "2台目で鳴る");
    await fake("send('k2', [0x80, 67, 0])");
    await fake('unplug("k1")');
    await a.waitFor(async () => (await a.synth("midiState")).inputs.length === 1, "1台目を抜く");
    assert.equal(await fake("send('k1', [0x90, 60, 100])"), false, "抜いた機器からは受けない");
    assert.equal(await midiAvailable(), true, "機器が減っても、MIDI 自体は使える");
    await fake('unplug("k2")');
    await a.waitFor(async () => (await a.synth("midiState")).inputs.length === 0, "全部抜く");
    assert.match(await a.page.textContent("#midi-state"), /^no device$/);
    ok("機器を後からつなぐと自動で使え、抜くと受信をやめる。表示が追従する");
    assert.deepEqual(await a.synth("errors"), [], "ワークレットと画面が記録したエラー");
    ws.close();
    await a.context.close();
    await new Promise((r) => setTimeout(r, 200));

    // ---- 5) 許可されなかった ----
    const b = await open(FAKE_MIDI + "window.__fakeMidi.mode = 'deny';");
    await b.page.click("#midi-connect");
    await b.waitFor(async () => (await b.synth("midiState")).kind === "denied", "拒否");
    assert.equal(await midiAvailable(), false);
    assert.match(await b.page.textContent("#midi-state"), /^denied/);
    assert.equal(await b.page.isEnabled("#midi-connect"), true, "もう一度試せる");
    ok("許可されなかったときは、その旨を表示し、midi.available は偽のまま");
    await b.context.close();
    await new Promise((r) => setTimeout(r, 200));

    // ---- 6) 非対応のブラウザ ----
    const c = await open("delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;");
    await c.waitFor(async () => (await c.synth("midiState")).kind === "unsupported", "非対応");
    assert.equal(await midiAvailable(), false);
    assert.match(await c.page.textContent("#midi-state"), /^unsupported$/);
    assert.equal(await c.page.isEnabled("#midi-connect"), false);
    // 画面鍵盤は使える
    await c.page.click("#demo");
    await c.waitFor(async () => (await c.synth("patch")).modules.length === 6, "デモ用パッチ");
    await c.page.click("#start");
    await c.waitFor(async () => (await c.synth("audioState")) === "running", "音声の開始");
    await c.page.locator('#keys button[data-note="64"]').dispatchEvent("pointerdown");
    await c.waitFor(async () => (await c.synth("status")).peak > 0.01, "画面鍵盤で鳴る");
    ok("Web MIDI に対応しないブラウザでは、MIDI を無効にしてその旨を表示する(midi.available は偽)。画面鍵盤は使える");
    await c.context.close();

    assert.deepEqual(pageErrors, [], "ページのエラー");
    ok("ページとワークレットにエラーなし");
  } finally {
    await browser.close();
    await app.close();
    fs.rmSync(patchDir, { recursive: true, force: true });
  }
  console.log(`MIDI のブラウザ試験: ${results.length} 項目すべて合格(Chromium ヘッドレス、試験用の MIDI 機器)`);
}

main().catch((e) => {
  console.error("MIDI のブラウザ試験: 失敗");
  console.error(e);
  process.exit(1);
});
