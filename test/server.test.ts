// ローカルサーバー(src/server/app.ts)の試験。実際に 127.0.0.1 の空きポートで起動し、fetch と WebSocket で叩く。
// タブは試験用の偽のタブ(WebSocket クライアント)で、内部で Session + RecordingBackend を動かす。
// 契約の受入例(operation-contract §18)は ID を試験名に入れ、期待値は契約の表のまま書く。
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WebSocket } from "ws";
import { buildCatalog } from "../src/control/catalog.js";
import { Controller } from "../src/control/controller.js";
import { RecordingBackend, Session } from "../src/control/session.js";
import { Patch } from "../src/control/types.js";
import { REGISTRY } from "../src/modules/registry.js";
import { App, AppLimits, CLOSE_ANOTHER_TAB, DEFAULT_APP_LIMITS, createApp } from "../src/server/app.js";
import { FilePatchStore } from "../src/server/file-store.js";
import { ServerToTab } from "../src/server/protocol.js";

const CATALOG = buildCatalog(REGISTRY);
const AGENT_TOKEN = "agent-token-0123456789abcdef";
const TAB_TOKEN = "tab-token-0123456789abcdef";
type Obj = Record<string, any>;

/** 基準パッチ P0 = data-contract §11 の完全な例(受入例の前提: revision = 10、running)。 */
const P0: Patch = {
  format: "modular-synth-patch",
  schema_version: 1,
  meta: { title: "基本の減算シンセ", description: "MIDI-CV → VCO(saw) → LPF → VCA → 出力。ADSRがVCAを開閉する。" },
  modules: [
    { id: "out", type: "MOD-IO-001", spec_version: "0.2", params: { level: 1.0, mute: 0 }, ui: { x: 40, y: 0 } },
    { id: "midi1", type: "MOD-IO-002", spec_version: "0.2", params: { channel: 0, transpose: 0, voices: 1, cc_number: 1 }, ui: { x: 0, y: 0 } },
    { id: "vco1", type: "MOD-OSC-001", spec_version: "0.3", params: { range: 0, tune: 0.0, fm_amt: 0.0, pw: 0.5, pwm_amt: 0.0 }, ui: { x: 10, y: 0 } },
    { id: "vcf1", type: "MOD-FLT-001", spec_version: "0.2", params: { cutoff: 1.0, res: 0.3, cv2_level: 1.0, cv3_level: 1.0 }, ui: { x: 20, y: 0 } },
    {
      id: "vca1",
      type: "MOD-AMP-001",
      spec_version: "0.2",
      params: { gain: 0.0, in1_level: 1.0, in2_level: 1.0, cv2_level: 1.0, out_level: 1.0, response: 0 },
      ui: { x: 30, y: 0 },
    },
    { id: "env1", type: "MOD-ENV-001", spec_version: "0.2", params: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3 }, ui: { x: 20, y: 1 } },
  ],
  cables: [
    { id: "c1", from: { module: "midi1", port: "PITCH" }, to: { module: "vco1", port: "pitch" } },
    { id: "c2", from: { module: "vco1", port: "saw" }, to: { module: "vcf1", port: "in" } },
    { id: "c3", from: { module: "vcf1", port: "out" }, to: { module: "vca1", port: "in1" } },
    { id: "c4", from: { module: "midi1", port: "GATE" }, to: { module: "env1", port: "gate" } },
    { id: "c5", from: { module: "env1", port: "env" }, to: { module: "vca1", port: "cv1" } },
    { id: "c6", from: { module: "vca1", port: "out" }, to: { module: "out", port: "IN_L" } },
  ],
};

const INDEX_HTML = '<!doctype html>\n<html><head>\n<meta charset="utf-8">\n<meta name="synth-tab-token" content="">\n</head><body>ok</body></html>\n';

// ---- 試験の道具 ----

interface Rig {
  app: App;
  port: number;
  base: string;
  patchDir: string;
  url: string;
  cleanup(): Promise<void>;
}

async function startRig(limits: Partial<AppLimits> = {}): Promise<Rig> {
  const base = await mkdtemp(join(tmpdir(), "synth-server-"));
  const webRoot = join(base, "web");
  const patchDir = join(base, "patches");
  await mkdir(webRoot);
  await writeFile(join(webRoot, "index.html"), INDEX_HTML);
  await writeFile(join(webRoot, "app.js"), "export {};\n");
  const app = createApp({ webRoot, patchDir, catalog: CATALOG, agentToken: AGENT_TOKEN, tabToken: TAB_TOKEN, limits });
  const port = await app.listen(0);
  const opened: WebSocket[] = [];
  rigSockets.set(app, opened);
  return {
    app,
    port,
    base,
    patchDir,
    url: `http://127.0.0.1:${port}`,
    async cleanup() {
      for (const w of opened) w.terminate();
      await app.close();
      await rm(base, { recursive: true, force: true });
    },
  };
}
const rigSockets = new Map<App, WebSocket[]>();

let nextRequest = 1;
function req(command: string, args?: Obj, extra: Obj = {}): Obj {
  return { v: 1, request_id: `r-${nextRequest++}`, command, ...(args ? { args } : {}), ...extra };
}

/** fetch で POST /api/command。token を null にすると Authorization を付けない。 */
async function post(r: Rig, body: unknown, token: string | null = AGENT_TOKEN): Promise<{ status: number; headers: Headers; body: Obj }> {
  const res = await fetch(`${r.url}/api/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token !== null ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, body: (await res.json()) as Obj };
}

/** ヘッダを細かく指定する HTTP 要求(Host・Origin の試験用)。 */
function rawHttp(
  r: Rig,
  opts: { method?: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }> {
  return new Promise((resolve, reject) => {
    const q = httpRequest(
      { host: "127.0.0.1", port: r.port, method: opts.method ?? "GET", path: opts.path, headers: opts.headers, setHost: !(opts.headers && "Host" in opts.headers) },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    q.on("error", reject);
    q.end(opts.body);
  });
}

interface WsResult {
  ws?: WebSocket;
  /** 接続の直後に届く1通を取りこぼさないよう、開く前から受信を貯める。 */
  inbox?: Inbox;
  /** 接続を断られたときの HTTP の状態コードと本文。 */
  rejected?: { status: number; body: string };
}

function openWs(r: Rig, path: string, headers: Record<string, string>): Promise<WsResult> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${r.port}${path}`, { headers });
    rigSockets.get(r.app)!.push(ws);
    const inbox = new Inbox(ws);
    ws.on("open", () => resolve({ ws, inbox }));
    ws.on("unexpected-response", (_q, res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ rejected: { status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") } }));
    });
    ws.on("error", (e) => reject(e));
  });
}

/** 届いた JSON を貯め、条件に合うものを待てる受信箱。 */
class Inbox {
  readonly all: Obj[] = [];
  private waiters: { match: (m: Obj) => boolean; resolve: (m: Obj) => void }[] = [];
  constructor(ws: WebSocket) {
    ws.on("message", (data) => {
      const m = JSON.parse(String(data)) as Obj;
      this.all.push(m);
      this.waiters = this.waiters.filter((w) => {
        if (!w.match(m)) return true;
        w.resolve(m);
        return false;
      });
    });
  }
  wait(match: (m: Obj) => boolean, ms = 2000): Promise<Obj> {
    const found = this.all.find(match);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("受信待ちの時間切れ")), ms);
      this.waiters.push({
        match,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }
}

interface Agent {
  ws: WebSocket;
  inbox: Inbox;
  /** 要求を送り、同じ request_id の応答を待つ。 */
  call(request: Obj): Promise<Obj>;
  events(): Obj[];
}

async function connectAgent(r: Rig): Promise<Agent> {
  const got = await openWs(r, "/api/ws", { Authorization: `Bearer ${AGENT_TOKEN}` });
  assert.ok(got.ws && got.inbox, "エージェントの接続");
  const ws = got.ws;
  const inbox = got.inbox;
  return {
    ws,
    inbox,
    call(request) {
      ws.send(JSON.stringify(request));
      return inbox.wait((m) => "ok" in m && m.request_id === (request.request_id ?? null));
    },
    events: () => inbox.all.filter((m) => "event" in m),
  };
}

interface FakeTab {
  ws: WebSocket;
  inbox: Inbox;
  session: Session;
  backend: RecordingBackend;
  /** サーバーから受けた req(中継された要求)。 */
  reqs: Obj[];
  /** 保存先の操作を送り、store_res を待つ。 */
  store(op: Obj): Promise<Obj>;
  close(): Promise<void>;
}

const tabHeaders = (r: Rig) => ({ Origin: `http://127.0.0.1:${r.port}` });

/** 偽のタブ: req を Session.handle(request, "agent") で処理して res を返し、Session の通知を evt で送る。 */
async function connectTab(r: Rig, opts: { respond?: boolean; sessionId?: string } = {}): Promise<FakeTab> {
  const backend = new RecordingBackend({ audioState: "running" });
  const session = new Session({ catalog: CATALOG, backend, sessionId: opts.sessionId ?? "s-test", patch: P0, revision: 10 });
  const got = await openWs(r, `/tab?token=${TAB_TOKEN}`, tabHeaders(r));
  assert.ok(got.ws && got.inbox, "タブの接続");
  const ws = got.ws;
  const inbox = got.inbox;
  const reqs: Obj[] = [];
  session.subscribe((event) => ws.send(JSON.stringify({ t: "evt", event })));
  const onMessage = (m: ServerToTab) => {
    if (m.t !== "req") return;
    reqs.push(m);
    if (opts.respond === false) return;
    session.handle(m.request, "agent", (response) => ws.send(JSON.stringify({ t: "res", id: m.id, response })));
  };
  for (const m of inbox.all) onMessage(m as ServerToTab); // 接続と同時に届いていた分
  ws.on("message", (data) => onMessage(JSON.parse(String(data)) as ServerToTab));
  const hello = await inbox.wait((m) => m.t === "hello");
  assert.deepEqual(hello, { t: "hello", accepted: true });
  let storeId = 1;
  const tab: FakeTab = {
    ws,
    inbox,
    session,
    backend,
    reqs,
    store(op) {
      const id = storeId++;
      ws.send(JSON.stringify({ t: "store", id, ...op }));
      return inbox.wait((m) => m.t === "store_res" && m.id === id);
    },
    close() {
      return new Promise((resolve) => {
        ws.once("close", () => resolve());
        ws.close();
      });
    },
  };
  if (opts.respond !== false) {
    // サーバーが接続直後に送る読出し(セッションの確認)が済むまで待つ
    await waitFor(() => reqs.length >= 1);
    await sleep(20);
  }
  return tab;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error("条件待ちの時間切れ");
    await sleep(5);
  }
}

async function withRig(limits: Partial<AppLimits>, fn: (r: Rig) => Promise<void>): Promise<void> {
  const r = await startRig(limits);
  try {
    await fn(r);
  } finally {
    await r.cleanup();
  }
}

// =====================================================================================
// 受入例(operation-contract §18)
// =====================================================================================

test("AX-10e トークンなし: トークンを付けずに patch.get → ok:false, error.id ERR-004。パッチの内容を返さない。状態は不変", () =>
  withRig({}, async (r) => {
    const tab = await connectTab(r);
    const before = tab.reqs.length;
    // HTTP
    const res = await post(r, req("patch.get"), null);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error.id, "ERR-004");
    assert.equal(res.body.error.code, "unauthorized");
    assert.equal(res.status, 401);
    assert.equal("result" in res.body, false);
    assert.equal(JSON.stringify(res.body).includes("vcf1"), false);
    // WebSocket: 接続そのものを断る(本文は同じ ERR-004)
    const w = await openWs(r, "/api/ws", {});
    assert.equal(w.ws, undefined);
    assert.equal(w.rejected?.status, 401);
    const body = JSON.parse(w.rejected!.body) as Obj;
    assert.equal(body.ok, false);
    assert.equal(body.error.id, "ERR-004");
    assert.equal("result" in body, false);
    // 不変: タブへは何も中継されず、リビジョンも 10 のまま
    assert.equal(tab.reqs.length, before);
    assert.equal(tab.session.revision, 10);
  }));

test("AX-14 セッションなし: タブを閉じた状態で patch.get → ERR-006, revision:null。続けて patch.list → ok:true, result.patches", () =>
  withRig({}, async (r) => {
    for (const via of ["http", "ws"] as const) {
      const agent = via === "ws" ? await connectAgent(r) : null;
      const call = (q: Obj) => (agent ? agent.call(q) : post(r, q).then((x) => x.body));
      const first = await call(req("patch.get"));
      assert.equal(first.ok, false, via);
      assert.equal(first.error.id, "ERR-006", via);
      assert.equal(first.error.code, "no_session", via);
      assert.equal(first.revision, null, via);
      assert.equal(first.session_id, null, via);
      assert.equal(first.audio_state, null, via);
      const second = await call(req("patch.list"));
      assert.equal(second.ok, true, via);
      assert.ok(Array.isArray(second.result.patches), via);
      assert.equal(second.revision, null, via);
    }
    // 一度つながったタブを閉じた後も同じ
    const tab = await connectTab(r);
    assert.equal((await post(r, req("patch.get"))).body.ok, true);
    await tab.close();
    await sleep(30);
    const after = await post(r, req("patch.get"));
    assert.equal(after.body.ok, false);
    assert.equal(after.body.error.id, "ERR-006");
    assert.equal(after.body.revision, null);
    const list = await post(r, req("patch.list"));
    assert.equal(list.body.ok, true);
    assert.deepEqual(list.body.result.patches, []);
  }));

// =====================================================================================
// 待受・トークン・静的配信
// =====================================================================================

test("待受アドレスは 127.0.0.1 だけ(server.address())。listen にホストを渡す口はない", () =>
  withRig({}, async (r) => {
    const a = r.app.server.address() as AddressInfo;
    assert.equal(a.address, "127.0.0.1");
    assert.equal(a.family, "IPv4");
    assert.equal(a.port, r.port);
    assert.equal(r.app.listen.length <= 1, true);
  }));

test("上限と時間の既定値は契約の値(要求 2 MiB、応答待ち 5 秒、ファイル数 1000、パッチ 1 MiB)", () => {
  const { tabTimeoutMs, maxRequestBytes, maxPatchFiles, maxPatchBytes } = DEFAULT_APP_LIMITS;
  assert.deepEqual({ tabTimeoutMs, maxRequestBytes, maxPatchFiles, maxPatchBytes }, { tabTimeoutMs: 5000, maxRequestBytes: 2 * 1024 * 1024, maxPatchFiles: 1000, maxPatchBytes: 1024 * 1024 });
});

test("トークン: 省略時は乱数で発行し、2つは別の値。起動のたびに変わる。同じ値は拒否", async () => {
  const base = await mkdtemp(join(tmpdir(), "synth-server-"));
  try {
    const a = createApp({ webRoot: base, patchDir: join(base, "p"), catalog: CATALOG });
    const b = createApp({ webRoot: base, patchDir: join(base, "p"), catalog: CATALOG });
    for (const t of [a.agentToken, a.tabToken, b.agentToken, b.tabToken]) assert.match(t, /^[A-Za-z0-9_-]{43}$/); // 256 ビット
    assert.equal(new Set([a.agentToken, a.tabToken, b.agentToken, b.tabToken]).size, 4);
    assert.throws(() => createApp({ webRoot: base, patchDir: join(base, "p"), catalog: CATALOG, agentToken: AGENT_TOKEN, tabToken: AGENT_TOKEN }));
    assert.throws(() => createApp({ webRoot: base, patchDir: join(base, "p"), catalog: CATALOG, agentToken: "short" }));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("静的配信: index.html にタブ用トークンを埋める。エージェント用トークンは配らない。他のファイルはそのまま", () =>
  withRig({}, async (r) => {
    for (const path of ["/", "/index.html"]) {
      const res = await fetch(r.url + path);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes(`<meta name="synth-tab-token" content="${TAB_TOKEN}">`), path);
      assert.equal(html.includes(AGENT_TOKEN), false);
      assert.equal(res.headers.get("cache-control"), "no-store");
    }
    const js = await fetch(r.url + "/app.js");
    assert.equal(await js.text(), "export {};\n");
    assert.equal((await fetch(r.url + "/nothing.js")).status, 404);
    // 配信フォルダの外(保存フォルダなど)は配らない
    await mkdir(r.patchDir, { recursive: true });
    await writeFile(join(r.patchDir, "x.patch.json"), "{}");
    assert.notEqual((await rawHttp(r, { path: "/../patches/x.patch.json" })).status, 200);
    assert.notEqual((await rawHttp(r, { path: "/%2e%2e/patches/x.patch.json" })).status, 200);
  }));

test("配信する web/index.html にタブ用トークンの meta がある", async () => {
  const html = await readFile(join(process.cwd(), "web", "index.html"), "utf8");
  assert.match(html, /<meta name="synth-tab-token" content="">/);
});

// =====================================================================================
// 認証・Origin・Host
// =====================================================================================

test("トークンの誤り・書式違いは ERR-004(HTTP は 401、WebSocket は接続を断る)。タブ用トークンではエージェントの口を使えない", () =>
  withRig({}, async (r) => {
    const tab = await connectTab(r);
    const before = tab.reqs.length;
    for (const token of ["wrong-token-0123456789abcdef", TAB_TOKEN, AGENT_TOKEN + "x", AGENT_TOKEN.slice(0, -1), ""]) {
      const res = await post(r, req("patch.get"), token);
      assert.equal(res.status, 401, token);
      assert.equal(res.body.error.id, "ERR-004", token);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.revision, null); // 認証されていない相手にセッションの値を返さない
      assert.equal(res.body.session_id, null);
      const w = await openWs(r, "/api/ws", { Authorization: `Bearer ${token}` });
      assert.equal(w.ws, undefined, token);
      assert.equal(w.rejected?.status, 401, token);
      assert.equal((JSON.parse(w.rejected!.body) as Obj).error.id, "ERR-004");
    }
    // Bearer 以外の方式、問い合わせ文字列のトークンは通らない
    const basic = await rawHttp(r, { method: "POST", path: "/api/command", headers: { Authorization: `Basic ${AGENT_TOKEN}` }, body: JSON.stringify(req("patch.get")) });
    assert.equal(basic.status, 401);
    const query = await rawHttp(r, { method: "POST", path: `/api/command?token=${AGENT_TOKEN}`, body: JSON.stringify(req("patch.get")) });
    assert.equal(query.status, 401);
    const wq = await openWs(r, `/api/ws?token=${AGENT_TOKEN}`, {});
    assert.equal(wq.rejected?.status, 401);
    assert.equal(tab.reqs.length, before);
    // 正しいトークンなら通る
    assert.equal((await post(r, req("patch.get"))).body.ok, true);
  }));

test("応答の形: サーバーが作る ERR-004 も契約 §3.2 の封筒(request_id と command を写し、actor は agent)", () =>
  withRig({}, async (r) => {
    const q = req("patch.get", undefined, { client_id: "agent-a" });
    const res = await post(r, q, null);
    assert.deepEqual(Object.keys(res.body).sort(), ["actor", "audio_state", "command", "error", "ok", "replayed", "request_id", "revision", "session_id", "v"]);
    assert.equal(res.body.v, 1);
    assert.equal(res.body.request_id, q.request_id);
    assert.equal(res.body.command, "patch.get");
    assert.deepEqual(res.body.actor, { kind: "agent", client_id: "agent-a" });
    assert.equal(res.body.replayed, false);
    assert.deepEqual(Object.keys(res.body.error).sort(), ["code", "details", "id", "message"]);
  }));

test("Origin ヘッダが付いた要求は、正しいトークンでも拒否する(ERR-004)。CORS の許可ヘッダは出さない", () =>
  withRig({}, async (r) => {
    const tab = await connectTab(r);
    const before = tab.reqs.length;
    const auth = { Authorization: `Bearer ${AGENT_TOKEN}`, "Content-Type": "application/json" };
    for (const origin of ["https://evil.example", `http://127.0.0.1:${r.port}`, "null"]) {
      const res = await rawHttp(r, { method: "POST", path: "/api/command", headers: { ...auth, Origin: origin }, body: JSON.stringify(req("patch.get")) });
      assert.equal(res.status, 403, origin);
      const body = JSON.parse(res.text) as Obj;
      assert.equal(body.ok, false);
      assert.equal(body.error.id, "ERR-004", origin);
      assert.equal("result" in body, false);
      for (const h of Object.keys(res.headers)) assert.equal(h.startsWith("access-control-"), false, h);
      const w = await openWs(r, "/api/ws", { Authorization: `Bearer ${AGENT_TOKEN}`, Origin: origin });
      assert.equal(w.ws, undefined, origin);
      assert.equal(w.rejected?.status, 403, origin);
      assert.equal((JSON.parse(w.rejected!.body) as Obj).error.id, "ERR-004");
    }
    // 事前確認(preflight)にも許可を出さない
    const pre = await rawHttp(r, {
      method: "OPTIONS",
      path: "/api/command",
      headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization" },
    });
    assert.ok(pre.status >= 400);
    for (const h of Object.keys(pre.headers)) assert.equal(h.startsWith("access-control-"), false, h);
    // 成功応答にも許可ヘッダはない
    const ok = await post(r, req("patch.get"));
    assert.equal(ok.body.ok, true);
    assert.equal(ok.headers.get("access-control-allow-origin"), null);
    assert.equal(tab.reqs.length, before + 1);
  }));

test("Host の検査: 127.0.0.1 / localhost と待受ポートでない Host は拒否(API・静的配信・WebSocket とも)", () =>
  withRig({}, async (r) => {
    const body = JSON.stringify(req("module.list_types"));
    const auth = { Authorization: `Bearer ${AGENT_TOKEN}` };
    for (const host of [`evil.example:${r.port}`, "evil.example", `127.0.0.1:${r.port + 1}`, "127.0.0.1", `127.0.0.1.evil.example:${r.port}`, `[::1]:${r.port}`, ""]) {
      const api = await rawHttp(r, { method: "POST", path: "/api/command", headers: { ...auth, Host: host }, body });
      assert.equal(api.status, 403, host);
      assert.equal((JSON.parse(api.text) as Obj).error.id, "ERR-004", host);
      const page = await rawHttp(r, { path: "/", headers: { Host: host } });
      assert.equal(page.status, 403, host);
      assert.equal(page.text.includes(TAB_TOKEN), false, host); // リバインディングでタブ用トークンを読めない
      if (host === "") continue; // 試験に使う WebSocket クライアントは、空の Host を送れない
      const w = await openWs(r, "/api/ws", { ...auth, Host: host });
      assert.equal(w.rejected?.status, 403, host);
      const t = await openWs(r, `/tab?token=${TAB_TOKEN}`, { Host: host, Origin: `http://${host}` });
      assert.equal(t.rejected?.status, 403, host);
    }
    for (const host of [`127.0.0.1:${r.port}`, `localhost:${r.port}`, `LOCALHOST:${r.port}`]) {
      const api = await rawHttp(r, { method: "POST", path: "/api/command", headers: { ...auth, Host: host }, body });
      assert.equal(api.status, 200, host);
      assert.equal((await rawHttp(r, { path: "/", headers: { Host: host } })).status, 200, host);
    }
  }));

test("タブの接続: タブ用トークンと Origin(自サーバーのオリジンだけ)を検査する", () =>
  withRig({}, async (r) => {
    const own = `http://127.0.0.1:${r.port}`;
    // トークンなし・誤り・エージェント用トークン
    for (const path of ["/tab", "/tab?token=", "/tab?token=wrong-token-0123456789abcdef", `/tab?token=${AGENT_TOKEN}`]) {
      const w = await openWs(r, path, { Origin: own });
      assert.equal(w.ws, undefined, path);
      assert.equal(w.rejected?.status, 401, path);
      assert.equal((JSON.parse(w.rejected!.body) as Obj).error.id, "ERR-004");
    }
    // Origin なし・他のオリジン
    const noOrigin = await openWs(r, `/tab?token=${TAB_TOKEN}`, {});
    assert.equal(noOrigin.rejected?.status, 403);
    for (const origin of ["https://evil.example", `http://evil.example:${r.port}`, `https://127.0.0.1:${r.port}`, `http://127.0.0.1:${r.port + 1}`, "null"]) {
      const w = await openWs(r, `/tab?token=${TAB_TOKEN}`, { Origin: origin });
      assert.equal(w.ws, undefined, origin);
      assert.equal(w.rejected?.status, 403, origin);
    }
    // ここまでのどれもセッションになっていない
    assert.equal((await post(r, req("patch.get"))).body.error.id, "ERR-006");
    // 正しいトークンと自サーバーのオリジン(localhost でも可)
    const w = await openWs(r, `/tab?token=${TAB_TOKEN}`, { Origin: `http://localhost:${r.port}`, Host: `localhost:${r.port}` });
    assert.ok(w.ws && w.inbox);
    assert.deepEqual(await w.inbox.wait((m) => m.t === "hello"), { t: "hello", accepted: true });
  }));

test("2つ目のタブは hello で accepted:false(another_tab)。1つ目はそのまま使え、1つ目が閉じれば次のタブを受け付ける", () =>
  withRig({}, async (r) => {
    const tab1 = await connectTab(r, { sessionId: "s-one" });
    const w = await openWs(r, `/tab?token=${TAB_TOKEN}`, tabHeaders(r));
    assert.ok(w.ws && w.inbox);
    const inbox2 = w.inbox;
    const closed = new Promise<number>((resolve) => w.ws!.once("close", (code) => resolve(code)));
    assert.deepEqual(await inbox2.wait((m) => m.t === "hello"), { t: "hello", accepted: false, reason: "another_tab" });
    assert.equal(await closed, CLOSE_ANOTHER_TAB);
    assert.equal(inbox2.all.filter((m) => m.t === "req").length, 0); // 2つ目には要求を中継しない
    const res = await post(r, req("patch.get"));
    assert.equal(res.body.session_id, "s-one");
    await tab1.close();
    await sleep(30);
    const tab3 = await connectTab(r, { sessionId: "s-three" });
    assert.equal((await post(r, req("patch.get"))).body.session_id, "s-three");
    assert.ok(tab3.reqs.length >= 2);
  }));

// =====================================================================================
// 中継・通知
// =====================================================================================

test("中継の往復: エージェント → サーバー → タブ → 応答。操作者は agent、client_id は接続ごと", () =>
  withRig({}, async (r) => {
    const tab = await connectTab(r);
    const a1 = await connectAgent(r);
    const a2 = await connectAgent(r);
    const res = await a1.call(req("param.set", { module_id: "vcf1", param: "cutoff", value: 2.0 }, { client_id: "agent-a" }));
    assert.equal(res.ok, true);
    assert.equal(res.revision, 11);
    assert.equal(res.session_id, "s-test");
    assert.equal(res.audio_state, "running");
    assert.deepEqual(res.actor, { kind: "agent", client_id: "agent-a" });
    assert.deepEqual(res.result, { module_id: "vcf1", param: "cutoff", value: 2.0, previous: 1.0, changed: true });
    assert.equal(tab.session.getPatch().modules.find((m) => m.id === "vcf1")!.params.cutoff, 2.0);
    // 人専用の操作は、サーバー経由では常に拒否される(操作者は受け口が決める)
    const start = await a1.call(req("engine.release_panic"));
    assert.equal(start.error.id, "ERR-005");
    // 失敗の応答もそのまま返る
    const bad = await a2.call(req("param.set", { module_id: "m99", param: "cutoff", value: 1.0 }));
    assert.equal(bad.error.id, "ERR-102");
    assert.equal(bad.revision, 11);
    await a1.call(req("patch.get"));
    const http = await post(r, req("patch.get"));
    assert.equal(http.status, 200);
    assert.equal(http.body.revision, 11);
    // タブが受けた req: 取り決めの形。client_id は接続ごとに別の値で、同じ接続では同じ
    const mine = tab.reqs.filter((m) => m.request.request_id !== "server-hello");
    for (const m of mine) {
      assert.deepEqual(Object.keys(m).sort(), ["client_id", "id", "request", "t"]);
      assert.equal(typeof m.id, "number");
      assert.equal(typeof m.client_id, "string");
    }
    assert.equal(new Set(tab.reqs.map((m) => m.id)).size, tab.reqs.length);
    const [p1, p2, p3, p4, p5] = mine;
    assert.equal(p1.client_id, p2.client_id);
    assert.equal(p1.client_id, p4.client_id);
    assert.notEqual(p1.client_id, p3.client_id);
    assert.notEqual(p5.client_id, p1.client_id);
    assert.notEqual(p5.client_id, p3.client_id);
    assert.equal(p1.request.client_id, "agent-a"); // 要求は書き換えずに渡す
  }));

test("HTTP の口と WebSocket の口は同じ応答を返す(成功・失敗・タブなしで答えるコマンド)", () =>
  withRig({}, async (r) => {
    const both = async (make: () => Obj) => {
      const agent = await connectAgent(r);
      const q = make();
      const viaWs = await agent.call(q);
      const viaHttp = (await post(r, q)).body;
      assert.deepEqual(viaWs, viaHttp, q.command);
      agent.ws.close();
      return viaHttp;
    };
    const cases: (() => Obj)[] = [
      () => req("patch.get"),
      () => req("module.get", { module_id: "vcf1" }),
      () => req("module.list_types"),
      () => req("module.list_types", { type: "MOD-OSC-001" }),
      () => req("engine.get_status"),
      () => req("param.set", { module_id: "m99", param: "cutoff", value: 1.0 }),
      () => req("param.set", { module_id: "vcf1", param: "cutoff", value: 7.5 }),
      () => req("engine.start"),
      () => req("no.such_command"),
      () => req("patch.list"),
      () => req("patch.read", { name: "../etc/x" }),
      () => ({ v: 2, request_id: "r-v2", command: "patch.get" }),
      () => ({ v: 1, command: "patch.get" }),
    ];
    // タブなし
    for (const c of cases) await both(c);
    // タブあり
    const tab = await connectTab(r);
    for (const c of cases) await both(c);
    assert.equal((await both(() => req("patch.get"))).ok, true);
    assert.equal(tab.session.revision, 10);
    // 壊れた JSON
    const agent = await connectAgent(r);
    agent.ws.send("{not json");
    const viaWs = await agent.inbox.wait((m) => "ok" in m);
    assert.deepEqual(viaWs, (await post(r, "{not json")).body);
  }));

test("通知の配信: タブの evt を接続中のエージェントへ配る。seq は接続ごとの連番。応答の後に届く。HTTP には届かない", () =>
  withRig({}, async (r) => {
    const tab = await connectTab(r, { sessionId: "s-evt" });
    const a1 = await connectAgent(r);
    const q1 = req("param.set", { module_id: "vcf1", param: "res", value: 0.4 });
    await a1.call(q1);
    const a2 = await connectAgent(r); // 後からつないだ接続の連番は 1 から
    const q2 = req("param.set", { module_id: "vcf1", param: "res", value: 0.5 });
    await a2.call(q2);
    await post(r, req("param.set", { module_id: "vcf1", param: "res", value: 0.6 })); // HTTP の変更も通知される
    await post(r, req("param.set", { module_id: "vcf1", param: "res", value: 0.6 })); // 変わらない変更は通知なし(§4.3)
    tab.ws.send(JSON.stringify({ t: "evt", event: { v: 1, event: "library.changed", session_id: "s-evt", data: { name: "bass-01", action: "saved", actor: { kind: "agent" } } } }));
    await a1.inbox.wait((m) => m.event === "library.changed");
    await a2.inbox.wait((m) => m.event === "library.changed");

    const e1 = a1.events();
    assert.deepEqual(e1.map((e) => e.event), ["patch.changed", "patch.changed", "patch.changed", "library.changed"]);
    assert.deepEqual(e1.map((e) => e.seq), [1, 2, 3, 4]);
    assert.deepEqual(e1.map((e) => e.data.revision), [11, 12, 13, undefined]);
    for (const e of e1) {
      assert.deepEqual(Object.keys(e).sort(), ["data", "event", "seq", "session_id", "v"]); // §10 の共通フィールド
      assert.equal(e.v, 1);
      assert.equal(e.session_id, "s-evt");
    }
    // EVT-01 は要求した本人にも届き、応答の後に来る
    assert.equal(e1[0].data.request_id, q1.request_id);
    assert.equal(e1[0].data.actor.kind, "agent");
    assert.equal(e1[0].data.previous_revision, 10);
    const order = a1.inbox.all.map((m) => ("event" in m ? `evt:${m.data.request_id}` : `res:${m.request_id}`));
    assert.ok(order.indexOf(`res:${q1.request_id}`) < order.indexOf(`evt:${q1.request_id}`));
    // 2つ目の接続: 自分がつないだ後の分だけ、連番は 1 から
    const e2 = a2.events();
    assert.deepEqual(e2.map((e) => e.seq), [1, 2, 3]);
    assert.deepEqual(e2.map((e) => e.data.revision), [12, 13, undefined]);
    assert.deepEqual({ ...e2[0], seq: 0 }, { ...e1[1], seq: 0 }); // 中身は同じ
  }));

test("EVT-05 session.changed: タブがつながった・切れたときにサーバーが出す", () =>
  withRig({}, async (r) => {
    const agent = await connectAgent(r);
    const tab = await connectTab(r, { sessionId: "s-five" });
    const up = await agent.inbox.wait((m) => m.event === "session.changed");
    assert.deepEqual(up, { v: 1, event: "session.changed", seq: 1, session_id: "s-five", data: { connected: true, session_id: "s-five", revision: 10 } });
    await agent.call(req("param.set", { module_id: "vcf1", param: "res", value: 0.4 }));
    await tab.close();
    const down = await agent.inbox.wait((m) => m.event === "session.changed" && m.data.connected === false);
    assert.deepEqual(down.data, { connected: false, session_id: "s-five", revision: 11 });
    assert.equal(down.seq, 3);
  }));

// =====================================================================================
// 時間切れ・大きさ・封筒
// =====================================================================================

test("応答待ちの時間切れ: タブが応答しなければ ERR-007(details.timeout_ms)。遅れて届いた応答は捨てる", () =>
  withRig({ tabTimeoutMs: 80 }, async (r) => {
    const tab = await connectTab(r, { respond: false });
    const agent = await connectAgent(r);
    const q = req("param.set", { module_id: "vcf1", param: "res", value: 0.4 }, { client_id: "agent-a" });
    const t0 = Date.now();
    const res = await agent.call(q);
    assert.ok(Date.now() - t0 >= 70);
    assert.equal(res.ok, false);
    assert.equal(res.error.id, "ERR-007");
    assert.equal(res.error.code, "timeout");
    assert.deepEqual(res.error.details, { timeout_ms: 80 });
    assert.equal(res.request_id, q.request_id);
    assert.equal(res.command, "param.set");
    assert.deepEqual(res.actor, { kind: "agent", client_id: "agent-a" });
    const http = await post(r, req("patch.get"));
    assert.equal(http.status, 504);
    assert.equal(http.body.error.id, "ERR-007");
    // 遅れた応答を返しても、エージェントには何も届かない
    const count = agent.inbox.all.length;
    const sent = tab.reqs.find((m) => m.request.request_id === q.request_id)!;
    tab.ws.send(JSON.stringify({ t: "res", id: sent.id, response: { v: 1, request_id: q.request_id, ok: true, late: true } }));
    tab.ws.send(JSON.stringify({ t: "res", id: 99999, response: { ok: true } })); // 知らない番号
    tab.ws.send("not json");
    await sleep(60);
    assert.equal(agent.inbox.all.length, count);
    // タブ用の口を使わないコマンドは、時間切れの後も答える
    assert.equal((await post(r, req("module.list_types"))).body.error?.id, "ERR-007"); // タブがある間は中継する
  }));

test("応答待ちの間にタブが切れたら、待たずに ERR-007(適用されたかは不明)", () =>
  withRig({ tabTimeoutMs: 5000 }, async (r) => {
    const tab = await connectTab(r, { respond: false });
    const agent = await connectAgent(r);
    const q = req("param.set", { module_id: "vcf1", param: "res", value: 0.4 });
    const pending = agent.call(q);
    await waitFor(() => tab.reqs.some((m) => m.request.request_id === q.request_id));
    const t0 = Date.now();
    tab.ws.terminate();
    const res = await pending;
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(res.error.id, "ERR-007");
    assert.equal(res.error.details.timeout_ms, 5000);
  }));

test("要求の大きさの上限: 超えたら ERR-011(details.limit_bytes)。解釈前のバイト数で測る。ちょうど上限は通る", () =>
  withRig({ maxRequestBytes: 1000 }, async (r) => {
    const tab = await connectTab(r);
    const before = tab.reqs.length;
    const sized = (bytes: number): string => {
      const q = req("patch.set_meta", { description: "" });
      const pad = bytes - Buffer.byteLength(JSON.stringify(q));
      q.args.description = "x".repeat(pad);
      return JSON.stringify(q);
    };
    assert.equal(Buffer.byteLength(sized(1000)), 1000);
    // HTTP
    const fit = await post(r, sized(1000));
    assert.equal(fit.body.ok, true);
    const over = await post(r, sized(1001));
    assert.equal(over.status, 413);
    assert.equal(over.body.ok, false);
    assert.equal(over.body.error.id, "ERR-011");
    assert.equal(over.body.error.code, "payload_too_large");
    assert.deepEqual(over.body.error.details, { limit_bytes: 1000 });
    // 文字数でなくバイト数(「あ」は 3 バイト)。JSON として壊れていても、大きさの判定が先
    const jp = await post(r, JSON.stringify(req("patch.set_meta", { description: "あ".repeat(320) })));
    assert.equal(jp.body.error.id, "ERR-011");
    assert.equal((await post(r, "{".repeat(1001))).body.error.id, "ERR-011");
    // WebSocket
    const agent = await connectAgent(r);
    agent.ws.send(sized(1001));
    const viaWs = await agent.inbox.wait((m) => "ok" in m);
    assert.equal(viaWs.error.id, "ERR-011");
    assert.deepEqual(viaWs.error.details, { limit_bytes: 1000 });
    agent.ws.send(sized(1000));
    assert.equal((await agent.inbox.wait((m) => m.ok === true)).ok, true);
    // 大きすぎた要求はタブへ中継されていない
    assert.equal(tab.reqs.length, before + 2);
  }));

test("要求の大きさの上限(既定値 2 MiB): 2 MiB を超える HTTP の要求は ERR-011", () =>
  withRig({}, async (r) => {
    const big = JSON.stringify(req("patch.set_meta", { description: "x".repeat(2 * 1024 * 1024) }));
    const res = await post(r, big);
    assert.equal(res.status, 413);
    assert.equal(res.body.error.id, "ERR-011");
    assert.deepEqual(res.body.error.details, { limit_bytes: 2097152 });
  }));

test("壊れた要求: JSON でない・必須フィールドなし・型違いは ERR-001、v が未対応なら ERR-012。タブへは中継しない", () =>
  withRig({}, async (r) => {
    const tab = await connectTab(r);
    const before = tab.reqs.length;
    const e001: [unknown, string][] = [
      ["{not json", ""],
      ["", ""],
      ['{"v":1,"request_id":"r","command":"param.set","args":{"value":NaN}}', ""], // 数値の拡張表記(§12.1)
      [[1, 2], ""],
      ["null", ""],
      [{ request_id: "r", command: "patch.get" }, "v"],
      [{ v: "1", request_id: "r", command: "patch.get" }, "v"],
      [{ v: 1, command: "patch.get" }, "request_id"],
      [{ v: 1, request_id: "", command: "patch.get" }, "request_id"],
      [{ v: 1, request_id: "x".repeat(65), command: "patch.get" }, "request_id"],
      [{ v: 1, request_id: "r" }, "command"],
      [{ v: 1, request_id: "r", command: "patch.get", args: [] }, "args"],
      [{ v: 1, request_id: "r", command: "patch.get", expected_revision: -1 }, "expected_revision"],
      [{ v: 1, request_id: "r", command: "patch.get", idempotency_key: "" }, "idempotency_key"],
      [{ v: 1, request_id: "r", command: "patch.get", client_id: 5 }, "client_id"],
      [{ v: 1, request_id: "r", command: "engine.release_panic", actor: { kind: "human" } }, "actor"], // 操作者は指定できない(§3.1)
    ];
    for (const [body, field] of e001) {
      const res = await post(r, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.ok, false);
      assert.equal(res.body.error.id, "ERR-001", JSON.stringify(body));
      assert.equal(res.body.error.code, "invalid_request");
      assert.equal(res.body.error.details.field, field, JSON.stringify(body));
    }
    const v2 = await post(r, { v: 2, request_id: "r-v", command: "patch.get" });
    assert.equal(v2.body.error.id, "ERR-012");
    assert.deepEqual(v2.body.error.details, { supported: [1] });
    assert.equal(v2.body.request_id, "r-v");
    assert.equal(v2.body.revision, 10); // タブがあるときは現在のリビジョンを付ける(§3.2)
    assert.equal(v2.body.session_id, "s-test");
    assert.equal(tab.reqs.length, before);
    // サーバーの検査は Session と同じ結果になる
    const direct = tab.session.handle({ v: 1, command: "patch.get" }, "agent");
    const via = (await post(r, { v: 1, command: "patch.get" })).body;
    assert.deepEqual(via, direct);
  }));

test("検査の順(§3.3): 封筒の形(ERR-011 → ERR-001 → ERR-012)→ 認証(ERR-004)→ コマンド名(ERR-002)・権限(ERR-005)→ セッションの有無(ERR-006)", () =>
  withRig({ maxRequestBytes: 1000 }, async (r) => {
    const id = async (body: unknown, token: string | null) => (await post(r, body, token)).body.error.id as string;
    // トークンなし: 封筒の失敗が先、封筒が正しければ認証の失敗
    assert.equal(await id("x".repeat(1001), null), "ERR-011");
    assert.equal(await id("{not json", null), "ERR-001");
    assert.equal(await id({ v: 2, request_id: "r", command: "no.such" }, null), "ERR-012");
    assert.equal(await id(req("no.such"), null), "ERR-004");
    assert.equal(await id(req("engine.start"), null), "ERR-004");
    // トークンあり・タブなし: コマンド名 → 権限 → セッションの有無
    assert.equal(await id(req("no.such"), AGENT_TOKEN), "ERR-002");
    assert.equal(await id(req("engine.start"), AGENT_TOKEN), "ERR-005");
    assert.equal(await id(req("patch.delete", { name: "x" }), AGENT_TOKEN), "ERR-005");
    assert.equal(await id(req("patch.get"), AGENT_TOKEN), "ERR-006");
    assert.equal(await id(req("param.set", { bogus: 1 }), AGENT_TOKEN), "ERR-006"); // 引数の検査(ERR-003)より先
    const forbidden = (await post(r, req("engine.start"))).body;
    assert.deepEqual(forbidden.error.details, { command: "engine.start", actor_kind: "agent" });
    assert.equal(forbidden.revision, null);
  }));

// =====================================================================================
// タブなしで答えるコマンド
// =====================================================================================

test("タブなしの module.list_types: Session と同じ形・同じ内容を返す。未知の種別は ERR-101", () =>
  withRig({}, async (r) => {
    const session = new Session({ catalog: CATALOG, backend: new RecordingBackend(), sessionId: "s-ref" });
    for (const args of [undefined, {}, { type: "MOD-IO-003" }, { type: "MOD-IO-001" }, { type: "MOD-NSE-001" }]) {
      const q = req("module.list_types", args);
      const expected = session.handle(q, "agent");
      const got = (await post(r, q)).body;
      assert.equal(got.ok, true);
      assert.equal(expected.ok, true);
      assert.deepEqual(got.result, expected.ok && expected.result);
      assert.deepEqual(got.warnings, []);
      assert.equal(got.revision, null);
      assert.equal(got.session_id, null);
      assert.equal(got.audio_state, null);
      assert.deepEqual(Object.keys(got).sort(), Object.keys(expected).sort());
    }
    assert.equal((await post(r, req("module.list_types"))).body.result.types.length, 20);
    for (const args of [{ type: "MOD-XYZ-999" }, { type: 5 }, { typo: 1 }]) {
      const q = req("module.list_types", args);
      const expected = session.handle(q, "agent");
      const got = (await post(r, q)).body;
      assert.equal(got.ok, false);
      assert.equal(expected.ok, false);
      assert.deepEqual(got.error.id, !expected.ok && expected.error.id);
      assert.deepEqual(got.error.details, !expected.ok && expected.error.details);
    }
    assert.equal((await post(r, req("module.list_types", { type: "MOD-XYZ-999" }))).body.error.id, "ERR-101");
  }));

test("タブなしの patch.list / patch.read: 専用フォルダを直接読む。壊れたファイルは readable:false、名前の不正は ERR-201", () =>
  withRig({}, async (r) => {
    await mkdir(r.patchDir, { recursive: true });
    const doc = {
      format: "modular-synth-patch",
      schema_version: 1,
      meta: { title: "低音", description: "", saved_by: { kind: "agent" } },
      modules: [{ id: "out", type: "MOD-IO-001", spec_version: "0.2", params: { level: 1.0, mute: 0 } }],
      cables: [],
    };
    const text = JSON.stringify(doc, null, 2) + "\n";
    await writeFile(join(r.patchDir, "bass-01.patch.json"), text);
    await writeFile(join(r.patchDir, "broken.patch.json"), "{not json");
    // JSON としては読めるが、パッチとしては検証に通らない(未知の種別)。外で置かれたものは人の保存扱い
    await writeFile(join(r.patchDir, "invalid.patch.json"), JSON.stringify({ format: "modular-synth-patch", schema_version: 1, meta: { title: "だめ", description: "" }, modules: [{ id: "x1", type: "MOD-XYZ-999", spec_version: "0.1" }], cables: [] }));
    await writeFile(join(r.patchDir, "ignored.txt"), "x");
    await writeFile(join(r.base, "secret.patch.json"), '{"secret":true}');

    const list = (await post(r, req("patch.list"))).body;
    assert.equal(list.ok, true);
    assert.deepEqual(list.result.patches.map((p: Obj) => p.name), ["bass-01", "broken", "invalid"]);
    const [bass, broken, invalid] = list.result.patches as Obj[];
    assert.deepEqual(Object.keys(bass).sort(), ["bytes", "modified_at", "name", "readable", "saved_by_kind", "title"]);
    assert.deepEqual({ ...bass, modified_at: "" }, { name: "bass-01", title: "低音", bytes: Buffer.byteLength(text), modified_at: "", saved_by_kind: "agent", readable: true });
    assert.match(bass.modified_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    assert.deepEqual({ ...broken, modified_at: "" }, { name: "broken", title: null, bytes: 9, modified_at: "", saved_by_kind: null, readable: false });
    assert.equal(invalid.readable, false);
    assert.equal(invalid.title, "だめ");
    assert.equal((await post(r, req("patch.list", { extra: 1 }))).body.error.id, "ERR-003");

    const read = (await post(r, req("patch.read", { name: "bass-01" }))).body;
    assert.equal(read.ok, true);
    assert.deepEqual(read.result.patch, doc);
    assert.equal(read.result.bytes, Buffer.byteLength(text));
    assert.equal(read.result.modified_at, bass.modified_at);
    const err = async (args: Obj) => (await post(r, req("patch.read", args))).body.error;
    assert.equal((await err({ name: "nothing" })).id, "ERR-202");
    assert.equal((await err({ name: "broken" })).id, "ERR-204");
    assert.equal((await err({})).id, "ERR-003");
    assert.equal((await err({ name: 5 })).id, "ERR-003");
    assert.equal((await err({ name: "bass-01", path: "/etc/passwd" })).id, "ERR-003");
    // 専用フォルダの外は読めない(§15.2: ERR-201)
    for (const name of ["../secret", "../etc/x", "/etc/passwd", "..", "a/b", "a\\b", "Bass-01", "bass-01.patch.json", "con"]) {
      const e = await err({ name });
      assert.equal(e.id, "ERR-201", name);
      assert.deepEqual(e.details, { name });
    }
    // タブ側のコマンド処理(Controller)が同じフォルダに対して返す内容と一致する
    const controller = new Controller({
      session: new Session({ catalog: CATALOG, backend: new RecordingBackend(), sessionId: "s-ref" }),
      store: new FilePatchStore(r.patchDir),
      now: () => 0,
    });
    const same: Obj[] = [
      req("patch.list"),
      req("patch.list", { extra: 1 }),
      req("patch.read", { name: "bass-01" }),
      req("patch.read", { name: "invalid" }),
      req("patch.read", { name: "broken" }),
      req("patch.read", { name: "nothing" }),
      req("patch.read", { name: "../secret" }),
      req("patch.read", {}),
      req("patch.read", { name: 5 }),
    ];
    for (const q of same) {
      const expected = (await controller.handle(q, "agent")) as Obj;
      const got = (await post(r, q)).body;
      assert.equal(got.ok, expected.ok, JSON.stringify(q));
      if (expected.ok) assert.deepEqual(got.result, expected.result, JSON.stringify(q));
      else {
        assert.equal(got.error.id, expected.error.id, JSON.stringify(q));
        assert.equal(got.error.code, expected.error.code);
        assert.deepEqual(got.error.details, expected.error.details, JSON.stringify(q));
      }
    }
    // 書き込みはタブ(コマンド処理)が要る
    assert.equal((await post(r, req("patch.save", { name: "x" }))).body.error.id, "ERR-006");
    assert.equal((await post(r, req("patch.load", { name: "bass-01" }))).body.error.id, "ERR-006");
    assert.deepEqual((await readdir(r.patchDir)).sort(), ["bass-01.patch.json", "broken.patch.json", "ignored.txt", "invalid.patch.json"]);
  }));

// =====================================================================================
// 保存先(タブからの store 操作)
// =====================================================================================

test("VER-A-010f 演奏データの保存先: パッチとは別のフォルダへ <名前>.performance.json で置く。消す口はない", () =>
  withRig({}, async (r) => {
    const tab = await connectTab(r);
    const dir = `${r.patchDir}-performances`;
    const w = await tab.store({ op: "write", area: "performances", name: "20261123-210405", text: '{"a":1}', overwrite: false });
    assert.equal(w.ok, true);
    assert.deepEqual(await readdir(dir), ["20261123-210405.performance.json"]);
    assert.equal((await tab.store({ op: "write", area: "performances", name: "20261123-210405", text: "{}", overwrite: false })).error, "exists");
    assert.equal((await tab.store({ op: "write", area: "performances", name: "20261123-210405", text: '{"a":2}', overwrite: true })).ok, true);
    assert.equal((await tab.store({ op: "read", area: "performances", name: "20261123-210405" })).value.text, '{"a":2}');
    assert.deepEqual((await tab.store({ op: "list", area: "performances" })).value.map((i: Obj) => i.name), ["20261123-210405"]);
    // パッチの保存先とは混ざらない
    assert.deepEqual((await tab.store({ op: "list" })).value, []);
    assert.equal((await tab.store({ op: "read", name: "20261123-210405" })).error, "not_found");
    // 消す口はない。知らない保存先は失敗。名前の規則はパッチと同じ
    assert.equal((await tab.store({ op: "remove", area: "performances", name: "20261123-210405" })).ok, false);
    assert.equal((await tab.store({ op: "list", area: "elsewhere" })).ok, false);
    assert.equal((await tab.store({ op: "write", area: "performances", name: "../x", text: "{}", overwrite: false })).error, "invalid_name");
    assert.deepEqual(await readdir(dir), ["20261123-210405.performance.json"]);
    await rm(dir, { recursive: true, force: true });
  }));

test("タブからの store 操作: 専用フォルダに書き・読み・一覧・削除し、store_res を返す", () =>
  withRig({ maxPatchFiles: 2, maxPatchBytes: 200 }, async (r) => {
    const tab = await connectTab(r);
    assert.deepEqual(await tab.store({ op: "list" }), { t: "store_res", id: 1, ok: true, value: [] });
    const w = await tab.store({ op: "write", name: "bass-01", text: '{"a":1}', overwrite: false });
    assert.equal(w.ok, true);
    assert.equal(w.value.name, "bass-01");
    assert.equal(w.value.bytes, 7);
    assert.equal(await readFile(join(r.patchDir, "bass-01.patch.json"), "utf8"), '{"a":1}');
    const rd = await tab.store({ op: "read", name: "bass-01" });
    assert.deepEqual(rd.value, { text: '{"a":1}', info: w.value });
    // 上書き
    assert.deepEqual(await tab.store({ op: "write", name: "bass-01", text: "{}", overwrite: false }), { t: "store_res", id: 4, ok: false, error: "exists" });
    assert.equal((await tab.store({ op: "write", name: "bass-01", text: "{}", overwrite: true })).ok, true);
    assert.equal(await readFile(join(r.patchDir, "bass-01.patch.json"), "utf8"), "{}");
    // 名前の検証・フォルダの外
    for (const name of ["../etc/x", "a/b", "..", "", "Bass", 5, null]) {
      for (const op of [{ op: "write", name, text: "{}", overwrite: true }, { op: "read", name }, { op: "remove", name }]) {
        const res = await tab.store(op);
        assert.equal(res.ok, false, JSON.stringify(op));
        assert.equal(res.error, "invalid_name", JSON.stringify(op));
      }
    }
    assert.deepEqual(await readdir(r.base).then((x) => x.sort()), ["patches", "web"]);
    // 大きさ・件数の上限(limits で注入した値)
    assert.equal((await tab.store({ op: "write", name: "big", text: "x".repeat(201), overwrite: false })).error, "too_large");
    assert.equal((await tab.store({ op: "write", name: "second", text: "{}", overwrite: false })).ok, true);
    assert.equal((await tab.store({ op: "write", name: "third", text: "{}", overwrite: false })).error, "too_many");
    // 形の合わない操作
    assert.equal((await tab.store({ op: "write", name: "x", text: 5, overwrite: true })).error, "failed");
    assert.equal((await tab.store({ op: "write", name: "x", text: "{}" })).error, "failed");
    assert.equal((await tab.store({ op: "exec", name: "x" })).error, "failed");
    // 削除
    assert.equal((await tab.store({ op: "read", name: "nothing" })).error, "not_found");
    assert.deepEqual((await tab.store({ op: "remove", name: "second" })).ok, true);
    assert.equal((await tab.store({ op: "remove", name: "second" })).error, "not_found");
    const l = await tab.store({ op: "list" });
    assert.deepEqual(l.value.map((i: Obj) => i.name), ["bass-01"]);
    assert.deepEqual(await readdir(r.patchDir), ["bass-01.patch.json"]);
    // タブが書いたファイルは、タブなしの patch.list / patch.read で見える
    await tab.close();
    await sleep(30);
    assert.deepEqual((await post(r, req("patch.list"))).body.result.patches.map((p: Obj) => p.name), ["bass-01"]);
  }));

// =====================================================================================
// 作らない口(REQ-S-007)
// =====================================================================================

test("サーバーを止める口・任意の経路や任意ホストへの口はない", () =>
  withRig({}, async (r) => {
    const auth = { Authorization: `Bearer ${AGENT_TOKEN}` };
    for (const path of ["/api/shutdown", "/api/stop", "/api/exit", "/api/fetch", "/api/files", "/api"]) {
      for (const method of ["GET", "POST", "DELETE"]) {
        const res = await rawHttp(r, { method, path, headers: auth, body: method === "GET" ? undefined : "{}" });
        assert.ok(res.status === 404 || res.status === 405, `${method} ${path} → ${res.status}`);
      }
    }
    for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
      const res = await rawHttp(r, { method, path: "/api/command", headers: auth });
      assert.equal(res.status, 405, method);
    }
    // 静的配信の口は読出しだけ
    assert.equal((await rawHttp(r, { method: "POST", path: "/index.html", body: "x" })).status, 405);
    assert.equal((await rawHttp(r, { method: "DELETE", path: "/index.html" })).status, 405);
    // コマンドにもない(§15.2: ERR-002)
    for (const command of ["server.stop", "server.shutdown", "http.fetch", "file.read", "eval"]) {
      assert.equal((await post(r, req(command))).body.error.id, "ERR-002", command);
    }
    const tab = await connectTab(r);
    for (const command of ["server.stop", "http.fetch", "file.read"]) {
      assert.equal((await post(r, req(command))).body.error.id, "ERR-002", command);
    }
    assert.equal(tab.session.revision, 10);
    assert.equal(r.app.server.listening, true);
    // WebSocket の口は2つだけ
    assert.equal((await openWs(r, "/other", auth)).rejected?.status, 404);
    // WebSocket の口への通常の HTTP 要求
    assert.equal((await rawHttp(r, { path: "/api/ws", headers: auth })).status, 426);
    assert.equal((await rawHttp(r, { path: `/tab?token=${TAB_TOKEN}` })).status, 426);
  }));

// =====================================================================================
// Issue #24 の独立レビューで見つかった不具合の再発防止
// =====================================================================================

/** 約2万段の入れ子の JSON(解釈は通るが、文字列へ戻す処理はスタックを使い切る)。 */
const deepJson = (levels = 20000): string => '{"a":'.repeat(levels) + "0" + "}".repeat(levels);

test("深い入れ子の要求(約2万段)は ERR-001 で拒否し、サーバーは落ちない(HTTP・WebSocket、タブあり・なし)", () =>
  withRig({}, async (r) => {
    const body = `{"v":1,"request_id":"deep-1","command":"patch.load","args":{"patch":${deepJson()}}}`;
    for (const withTab of [false, true]) {
      const tab = withTab ? await connectTab(r) : null;
      const before = tab ? tab.reqs.length : 0;
      const res = await post(r, body);
      assert.equal(res.status, 400);
      assert.equal(res.body.error.id, "ERR-001");
      assert.equal(res.body.error.details.reason, "too_deep");
      assert.equal(res.body.request_id, "deep-1");
      const agent = await connectAgent(r);
      agent.ws.send(body);
      const viaWs = await agent.inbox.wait((m) => m.request_id === "deep-1");
      assert.equal(viaWs.error.id, "ERR-001");
      // 封筒そのものが深い場合(配列)
      const arr = await post(r, "[".repeat(20000) + "]".repeat(20000));
      assert.equal(arr.body.error.id, "ERR-001");
      // タブへは中継していない。サーバーは動き続けている
      if (tab) assert.equal(tab.reqs.length, before);
      const alive = await post(r, req(withTab ? "patch.get" : "patch.list"));
      assert.equal(alive.body.ok, true);
      agent.ws.close();
      if (tab) await tab.close();
      await sleep(30);
    }
  }));

test("保存フォルダに深い入れ子のファイルがあっても、patch.read は ERR-204、patch.list は readable:false で答え、サーバーは落ちない", () =>
  withRig({}, async (r) => {
    await mkdir(r.patchDir, { recursive: true });
    await writeFile(join(r.patchDir, "deep.patch.json"), deepJson());
    const read = await post(r, req("patch.read", { name: "deep" }));
    assert.equal(read.body.ok, false);
    assert.equal(read.body.error.id, "ERR-204");
    const list = await post(r, req("patch.list"));
    assert.equal(list.body.ok, true);
    assert.deepEqual(list.body.result.patches.map((p: Obj) => [p.name, p.readable]), [["deep", false]]);
  }));

test("タブが深い入れ子の応答・通知を返しても、サーバーは落ちない(応答は ERR-010、通知は配らない)", () =>
  withRig({}, async (r) => {
    const tab = await connectTab(r, { respond: false });
    await waitFor(() => tab.reqs.length >= 1); // 接続直後の読出し
    const agent = await connectAgent(r);
    const pending = post(r, req("patch.get"));
    await waitFor(() => tab.reqs.length >= 2);
    const id = tab.reqs[1]!.id as number;
    tab.ws.send(`{"t":"evt","event":{"event":"patch.changed","session_id":"s","data":${deepJson()}}}`);
    tab.ws.send(`{"t":"res","id":${id},"response":{"ok":true,"result":${deepJson()}}}`);
    const res = await pending;
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error.id, "ERR-010");
    await sleep(50);
    assert.equal(agent.events().filter((e) => e.event === "patch.changed").length, 0);
    // サーバーは動き続けている
    const again = post(r, req("patch.get"));
    await waitFor(() => tab.reqs.length >= 3);
    tab.ws.send(JSON.stringify({ t: "res", id: tab.reqs[2]!.id, response: { v: 1, ok: true, request_id: "x", result: {} } }));
    assert.equal((await again).body.ok, true);
  }));

test("画面を他のページの枠に入れさせない: 静的配信と API のすべての応答に X-Frame-Options: DENY と frame-ancestors 'none' を付ける", () =>
  withRig({}, async (r) => {
    for (const path of ["/", "/index.html", "/app.js", "/nothing.js", "/..%2f..%2fetc/passwd"]) {
      const res = await rawHttp(r, { path });
      assert.equal(res.headers["x-frame-options"], "DENY", path);
      assert.equal(res.headers["content-security-policy"], "frame-ancestors 'none'", path);
      assert.equal(res.headers["x-content-type-options"], "nosniff", path);
    }
    const post405 = await rawHttp(r, { method: "POST", path: "/index.html" });
    assert.equal(post405.status, 405);
    assert.equal(post405.headers["x-frame-options"], "DENY");
  }));

test("エージェントの WebSocket の接続数には上限があり、超えた接続は 503 で断る。切断すれば、また接続できる", () =>
  withRig({ maxAgentConnections: 2 }, async (r) => {
    const a = await connectAgent(r);
    await connectAgent(r);
    const third = await openWs(r, "/api/ws", { Authorization: `Bearer ${AGENT_TOKEN}` });
    assert.equal(third.ws, undefined);
    assert.equal(third.rejected?.status, 503);
    assert.equal((JSON.parse(third.rejected!.body) as Obj).error.id, "ERR-010");
    a.ws.close();
    await sleep(50);
    const again = await openWs(r, "/api/ws", { Authorization: `Bearer ${AGENT_TOKEN}` });
    assert.ok(again.ws);
    // HTTP は数えない
    assert.equal((await post(r, req("patch.list"))).body.ok, true);
  }));

test("タブの応答を待つ要求の数には上限があり、超えた要求はタブへ送らずに、すぐ ERR-010(too_many_pending)で断る", () =>
  withRig({ maxPendingRequests: 3, tabTimeoutMs: 400 }, async (r) => {
    const tab = await connectTab(r, { respond: false }); // 接続直後の読出し1件が応答待ちになる
    await waitFor(() => tab.reqs.length >= 1);
    const waiting = [post(r, req("patch.get")), post(r, req("patch.get"))];
    await waitFor(() => tab.reqs.length >= 3);
    const t0 = Date.now();
    const over = await post(r, req("patch.get"));
    assert.equal(over.body.error.id, "ERR-010");
    assert.equal(over.body.error.details.reason, "too_many_pending");
    assert.ok(Date.now() - t0 < 300, "待たずに断る");
    assert.equal(tab.reqs.length, 3, "タブへは送っていない");
    for (const w of await Promise.all(waiting)) assert.equal(w.body.error.id, "ERR-007");
  }));

test("受信しないエージェントへ通知をため続けない: 送信待ちが上限を超えたら、その接続を切る(他の接続は影響を受けない)", () =>
  withRig({ maxBufferedBytes: 256 * 1024 }, async (r) => {
    const tab = await connectTab(r);
    const stuck = await connectAgent(r);
    const fine = await connectAgent(r);
    (stuck.ws as unknown as { _socket: { pause(): void } })._socket.pause(); // 受信を止める
    let closed = false;
    stuck.ws.on("close", () => (closed = true));
    const pad = "x".repeat(16 * 1024);
    // 止めていない接続が読み切れる速さで送る(上限は、読まない相手にだけ効く)
    for (let i = 0; i < 4000 && !closed; i++) {
      tab.ws.send(JSON.stringify({ t: "evt", event: { v: 1, event: "engine.diagnostic", session_id: "s-test", data: { pad } } }));
      if (i % 4 === 3) await sleep(2);
    }
    await sleep(200);
    // 受信を止めた接続はサーバー側から切られ、止めていない接続は通知を受け取り続けている
    assert.ok(fine.events().length > 0);
    (stuck.ws as unknown as { _socket: { resume(): void } })._socket.resume();
    await waitFor(() => closed, 5000);
    assert.equal((await fine.call(req("patch.get"))).ok, true);
  }));

test("返事をしないタブ(固まった・回線が黙って切れた)は、生死の確認で切り、次のタブを受け付ける", () =>
  withRig({ tabPingMs: 60 }, async (r) => {
    const dead = await connectTab(r);
    (dead.ws as unknown as { _socket: { pause(): void } })._socket.pause(); // ping に返事をしなくなる
    const second = await openWs(r, `/tab?token=${TAB_TOKEN}`, tabHeaders(r));
    assert.deepEqual(await second.inbox!.wait((m) => m.t === "hello"), { t: "hello", accepted: false, reason: "another_tab" });
    await sleep(250);
    const third = await openWs(r, `/tab?token=${TAB_TOKEN}`, tabHeaders(r));
    assert.deepEqual(await third.inbox!.wait((m) => m.t === "hello"), { t: "hello", accepted: true });
    // 返事をするタブは切られない
    await sleep(250);
    assert.equal(third.ws!.readyState, WebSocket.OPEN);
  }));

test("保存フォルダに名前付きパイプがあっても、保存の操作は止まらない(読出しは失敗として返り、他のファイルは読める)", { skip: process.platform === "win32" }, () =>
  withRig({}, async (r) => {
    const { execFileSync } = await import("node:child_process");
    await mkdir(r.patchDir, { recursive: true });
    execFileSync("mkfifo", [join(r.patchDir, "pipe.patch.json")]);
    const tab = await connectTab(r);
    await tab.store({ t: "store", op: "write", name: "good", text: JSON.stringify(P0), overwrite: false });
    const t0 = Date.now();
    const read = await post(r, req("patch.get")); // タブ経由の要求も動く
    assert.equal(read.body.ok, true);
    const viaStore = await tab.store({ t: "store", op: "read", name: "pipe" });
    assert.equal(viaStore.ok, false);
    assert.equal(viaStore.error, "failed");
    const good = await tab.store({ t: "store", op: "read", name: "good" });
    assert.equal(good.ok, true);
    await tab.close();
    await sleep(30);
    const list = await post(r, req("patch.list"));
    assert.equal(list.body.ok, true);
    assert.deepEqual(list.body.result.patches.map((p: Obj) => [p.name, p.readable]), [["good", true], ["pipe", false]]);
    const direct = await post(r, req("patch.read", { name: "pipe" }));
    assert.equal(direct.body.error.id, "ERR-207");
    assert.ok(Date.now() - t0 < 3000, "待たされない");
  }));

test("書き込みの途中で残った古い一時ファイルは、起動時に片付ける(新しいものと、他の名前のファイルは消さない)", async () => {
  const base = await mkdtemp(join(tmpdir(), "synth-sweep-"));
  try {
    const { utimes } = await import("node:fs/promises");
    const old = join(base, ".song.0123456789abcdef.tmp");
    const fresh = join(base, ".song.fedcba9876543210.tmp");
    const other = join(base, ".notes.tmp");
    for (const f of [old, fresh, other]) await writeFile(f, "x");
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(old, past, past);
    await utimes(other, past, past);
    const store = new FilePatchStore(base);
    assert.equal(await store.sweepTemp(), 1);
    assert.deepEqual((await readdir(base)).sort(), [".notes.tmp", ".song.fedcba9876543210.tmp"]);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("PORT が数でなければ起動しない(空文字は既定のポート。意図しないポートで待ち受けない)", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const main = fileURLToPath(new URL("../src/server/main.js", import.meta.url));
  const base = await mkdtemp(join(tmpdir(), "synth-port-"));
  try {
    for (const bad of ["abc", "-1", "70000", "80 ", "1e3"]) {
      const out = spawnSync(process.execPath, [main], { env: { PATH: process.env.PATH ?? "", HOME: base, PORT: bad, SYNTH_PATCH_DIR: join(base, "p"), SYNTH_TOKEN_FILE: join(base, "t") }, encoding: "utf8", timeout: 10000 });
      assert.equal(out.status, 1, `PORT=${JSON.stringify(bad)}`);
      assert.match(out.stderr, /PORT は/);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
