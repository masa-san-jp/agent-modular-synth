// MCP アダプタ(src/mcp/)の試験(operation-contract §17、VER-A-007)。
// 実際にローカルサーバー(createApp)を 127.0.0.1 の空きポートで起動し、試験用の偽のタブ(WebSocket クライアント。
// 内部で Controller + Session + RecordingBackend)をつなぎ、SDK のクライアントからアダプタへ接続する
// (同じプロセス内の輸送、または stdio の子プロセス)。期待値は契約の表・受入例(§18)のまま書く。
import assert from "node:assert/strict";
import { ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { IncomingMessage, createServer } from "node:http";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { WebSocket } from "ws";
import { buildCatalog } from "../src/control/catalog.js";
import { Controller } from "../src/control/controller.js";
import { COMMANDS, RecordingBackend, Session } from "../src/control/session.js";
import { Patch } from "../src/control/types.js";
import { AdapterConfig, ConfigError, DEFAULT_TIMEOUT_MS, createMcpServer, resolveConfig, sendCommand } from "../src/mcp/adapter.js";
import { readTokenFile, removeTokenFile, tokenFilePath, writeTokenFile } from "../src/mcp/token-file.js";
import { TABLE, TOOLS } from "../src/mcp/tools.js";
import { REGISTRY } from "../src/modules/registry.js";
import { App, AppLimits, createApp } from "../src/server/app.js";
import { FilePatchStore } from "../src/server/file-store.js";
import { ServerToTab } from "../src/server/protocol.js";

const CATALOG = buildCatalog(REGISTRY);
const AGENT_TOKEN = "agent-token-0123456789abcdef";
const TAB_TOKEN = "tab-token-0123456789abcdef";
type Obj = Record<string, any>;

const here = dirname(fileURLToPath(import.meta.url)); // dist/test
const ADAPTER_MAIN = join(here, "..", "src", "mcp", "main.js");
const SERVER_MAIN = join(here, "..", "src", "server", "main.js");
const CONTRACT = join(here, "..", "..", "specifications", "synthesizer", "operation-contract.md");

/** 基準パッチ P0 = data-contract §11 の完全な例(受入例の前提: revision = 10、running)。test/server.test.ts と同じ。 */
const P0: Patch = {
  format: "modular-synth-patch",
  schema_version: 1,
  meta: { title: "基本の減算シンセ", description: "MIDI-CV → VCO(saw) → LPF → VCA → 出力。ADSRがVCAを開閉する。" },
  modules: [
    { id: "out", type: "MOD-IO-001", spec_version: "0.2", params: { level: 1.0, mute: 0 }, ui: { x: 40, y: 0 } },
    { id: "midi1", type: "MOD-IO-002", spec_version: "0.2", params: { channel: 0, transpose: 0, voices: 1, cc_number: 1 }, ui: { x: 0, y: 0 } },
    { id: "vco1", type: "MOD-OSC-001", spec_version: "0.2", params: { range: 0, tune: 0.0, fm_amt: 0.0, pw: 0.5, pwm_amt: 0.0 }, ui: { x: 10, y: 0 } },
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

/** 契約 §17 の「公開するツール」: 25個。人のみの4つはツールにしない。 */
const HUMAN_ONLY_TOOLS = ["patch_delete", "engine_start", "engine_release_panic", "prompt_send"];

// ---- 契約の文書から §6 の表を読む(ツールの名前・説明を「契約の表から機械的に」確かめるため) ----

interface ContractRow {
  id: string;
  command: string;
  summary: string;
  changes: string;
  undo: string;
  permission: string;
  batch: string;
}

function contractTable(): ContractRow[] {
  const rows: ContractRow[] = [];
  for (const line of readFileSync(CONTRACT, "utf8").split("\n")) {
    const m = /^\| (CMD-\d\d) \| `([a-z_.]+)` \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|/.exec(line);
    if (m) rows.push({ id: m[1], command: m[2], summary: m[3].trim(), changes: m[4].trim(), undo: m[5].trim(), permission: m[6].trim(), batch: m[7].trim() });
  }
  return rows;
}

// ---- 試験の道具 ----

interface Rig {
  app: App;
  port: number;
  url: string;
  base: string;
  patchDir: string;
  sockets: WebSocket[];
  closers: (() => Promise<void>)[];
  cleanup(): Promise<void>;
}

async function startRig(limits: Partial<AppLimits> = {}): Promise<Rig> {
  const base = await mkdtemp(join(tmpdir(), "synth-mcp-"));
  const webRoot = join(base, "web");
  const patchDir = join(base, "patches");
  await mkdir(webRoot);
  await writeFile(join(webRoot, "index.html"), '<!doctype html>\n<html><head>\n<meta name="synth-tab-token" content="">\n</head><body>ok</body></html>\n');
  const app = createApp({ webRoot, patchDir, catalog: CATALOG, agentToken: AGENT_TOKEN, tabToken: TAB_TOKEN, limits });
  const port = await app.listen(0);
  const rig: Rig = {
    app,
    port,
    url: `http://127.0.0.1:${port}`,
    base,
    patchDir,
    sockets: [],
    closers: [],
    async cleanup() {
      for (const c of rig.closers.reverse()) await c().catch(() => undefined);
      for (const w of rig.sockets) w.terminate();
      await app.close();
      await rm(base, { recursive: true, force: true });
    },
  };
  return rig;
}

async function withRig(limits: Partial<AppLimits>, fn: (r: Rig) => Promise<void>): Promise<void> {
  const r = await startRig(limits);
  try {
    await fn(r);
  } finally {
    await r.cleanup();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error("条件待ちの時間切れ");
    await sleep(5);
  }
}

interface FakeTab {
  session: Session;
  backend: RecordingBackend;
  /** サーバーから中継された要求(接続直後にサーバーが送る確認の1件を除く)。 */
  relayed: Obj[];
}

/**
 * 偽のタブ(test/server.test.ts と同じ方法)。中継された要求を Controller.handle(request, "agent") で処理して返す。
 * 保存先は専用フォルダを直接使う。時刻は固定(保存時刻を2つのサーバーで同じにするため)。
 */
async function connectTab(r: Rig, opts: { respond?: boolean } = {}): Promise<FakeTab> {
  const backend = new RecordingBackend({ audioState: "running" });
  const session = new Session({ catalog: CATALOG, backend, sessionId: "s-test", patch: P0, revision: 10 });
  const controller = new Controller({ session, store: new FilePatchStore(r.patchDir), now: () => 0 });
  const ws = new WebSocket(`ws://127.0.0.1:${r.port}/tab?token=${TAB_TOKEN}`, { headers: { Origin: `http://127.0.0.1:${r.port}` } });
  r.sockets.push(ws);
  const relayed: Obj[] = [];
  let hello = false;
  let probed = false;
  ws.on("message", (data) => {
    const m = JSON.parse(String(data)) as ServerToTab;
    if (m.t === "hello") hello = m.accepted;
    if (m.t !== "req") return;
    const request = m.request as Obj;
    const probe = request.request_id === "server-hello";
    if (!probe) relayed.push(request);
    if (opts.respond === false && !probe) return;
    void controller.handle(request, "agent").then((response) => {
      ws.send(JSON.stringify({ t: "res", id: m.id, response }));
      if (probe) probed = true;
    });
  });
  await new Promise<void>((ok, ng) => {
    ws.once("open", () => ok());
    ws.once("error", ng);
  });
  await waitFor(() => hello && probed);
  await sleep(20);
  return { session, backend, relayed };
}

function configFor(r: Rig, over: Partial<AdapterConfig> = {}): AdapterConfig {
  return { endpoint: `${r.url}/api/command`, token: AGENT_TOKEN, tokenFile: join(r.base, "no-such-token-file"), clientId: "mcp", timeoutMs: DEFAULT_TIMEOUT_MS, ...over };
}

/** 同じプロセス内でアダプタへ接続する(SDK の in-memory 輸送)。 */
async function connectMemory(r: Rig, over: Partial<AdapterConfig> = {}): Promise<Client> {
  const server = createMcpServer(configFor(r, over));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mcp-test", version: "0" });
  await server.connect(a);
  await client.connect(b);
  r.closers.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

/** アダプタを子プロセス(stdio)で起動して接続する。stderr は貯める。 */
async function connectChild(env: Record<string, string>, closers: (() => Promise<void>)[]): Promise<{ client: Client; stderr: () => string }> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [ADAPTER_MAIN], env, stderr: "pipe" });
  let err = "";
  transport.stderr?.on("data", (c: Buffer) => (err += c.toString("utf8")));
  const client = new Client({ name: "mcp-test", version: "0" });
  closers.push(() => client.close());
  await client.connect(transport);
  return { client, stderr: () => err };
}

/** ツールを呼び、結果(isError と、本文の JSON = 応答の封筒)を返す。 */
async function call(client: Client, name: string, args: Obj = {}): Promise<{ isError: boolean; body: Obj; raw: Obj }> {
  const raw = (await client.callTool({ name, arguments: args })) as Obj;
  assert.equal(raw.content.length, 1, "本文は1つ");
  assert.equal(raw.content[0].type, "text");
  return { isError: raw.isError === true, body: JSON.parse(raw.content[0].text) as Obj, raw };
}

let nextRequest = 1;
/** 共通コマンドAPIへ直接送る(POST /api/command)。 */
async function post(r: Rig, command: string, args: Obj = {}, extra: Obj = {}, token: string | null = AGENT_TOKEN): Promise<{ status: number; body: Obj }> {
  const res = await fetch(`${r.url}/api/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token !== null ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ v: 1, request_id: `direct-${nextRequest++}`, command, args, ...extra, client_id: "mcp" }),
  });
  return { status: res.status, body: (await res.json()) as Obj };
}

/** ツールの入力を、直接送るときの args と封筒の項目に分ける(契約 §17 の「入力」の逆)。 */
function split(input: Obj): { args: Obj; extra: Obj } {
  const { expected_revision, idempotency_key, ...args } = input;
  const extra: Obj = {};
  if ("expected_revision" in input) extra.expected_revision = expected_revision;
  if ("idempotency_key" in input) extra.idempotency_key = idempotency_key;
  return { args, extra };
}

/** 要求ごとに変わる項目を除く: request_id と、ファイルの更新時刻(patch.list / patch.read の modified_at)。 */
function comparable(body: Obj): Obj {
  const c = structuredClone(body);
  delete c.request_id;
  if (c.command === "patch.read" && c.result) delete c.result.modified_at;
  if (c.command === "patch.list" && c.result) for (const p of c.result.patches) delete p.modified_at;
  return c;
}

// =====================================================================================
// ツール一覧(§17)
// =====================================================================================

test("§17 ツール一覧(stdio の子プロセス): 25個。名前はコマンド名の . を _ に替えたもの。人のみの4つはない。入力に expected_revision と idempotency_key がある", () =>
  withRig({}, async (r) => {
    const { client } = await connectChild({ SYNTH_URL: r.url, SYNTH_AGENT_TOKEN: AGENT_TOKEN }, r.closers);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 25);
    const names = tools.map((t) => t.name);
    assert.equal(new Set(names).size, 25, "重複なし");
    // 契約 §6 の表で権限が「両方」のコマンドすべて
    const table = contractTable();
    assert.equal(table.length, 29, "契約の表は CMD-01〜29");
    const both = table.filter((row) => row.permission.startsWith("両方"));
    const humanOnly = table.filter((row) => row.permission === "人のみ");
    assert.equal(both.length + humanOnly.length, 29);
    assert.deepEqual(names, both.map((row) => row.command.replaceAll(".", "_")));
    assert.deepEqual(humanOnly.map((row) => row.command.replaceAll(".", "_")).sort(), [...HUMAN_ONLY_TOOLS].sort());
    for (const n of HUMAN_ONLY_TOOLS) assert.equal(names.includes(n), false, `${n} はツールにしない`);
    // 契約の例: module.add → module_add、patch.get → patch_get、batch → batch。接頭辞は付けない
    for (const n of ["module_add", "patch_get", "batch"]) assert.ok(names.includes(n), n);
    for (const n of names) assert.match(n, /^[a-z]+(_[a-z]+)*$/);

    for (const t of tools) {
      const s = t.inputSchema as Obj;
      assert.equal(s.type, "object", t.name);
      assert.equal(s.additionalProperties, false, t.name);
      assert.deepEqual(s.properties.expected_revision.type, "integer", t.name);
      assert.equal(s.properties.expected_revision.minimum, 0, t.name);
      assert.equal(s.properties.idempotency_key.type, "string", t.name);
      assert.equal(s.properties.idempotency_key.minLength, 1, t.name);
      assert.equal(s.properties.idempotency_key.maxLength, 64, t.name);
      // 任意の項目(必須にしない)
      assert.equal((s.required ?? []).includes("expected_revision"), false, t.name);
      assert.equal((s.required ?? []).includes("idempotency_key"), false, t.name);
      assert.ok(typeof t.description === "string" && t.description.length > 0, t.name);
    }
    // 引数(契約 §6 の引数表)
    const props = (name: string) => Object.keys((tools.find((t) => t.name === name)!.inputSchema as Obj).properties).filter((k) => k !== "expected_revision" && k !== "idempotency_key");
    const required = (name: string) => (tools.find((t) => t.name === name)!.inputSchema as Obj).required ?? [];
    const expected: Record<string, [string[], string[]]> = {
      module_list_types: [["type"], []],
      module_add: [["type", "id", "params", "ui"], ["type"]],
      module_remove: [["module_id"], ["module_id"]],
      module_get: [["module_id"], ["module_id"]],
      module_move: [["module_id", "ui"], ["module_id", "ui"]],
      cable_connect: [["from", "to", "id"], ["from", "to"]],
      cable_disconnect: [["cable_id", "to"], []],
      param_set: [["module_id", "param", "value", "coalesce_key"], ["module_id", "param", "value"]],
      batch: [["ops"], ["ops"]],
      patch_get: [[], []],
      patch_new: [[], []],
      patch_save: [["name", "overwrite"], ["name"]],
      patch_load: [["name", "patch"], []],
      patch_list: [[], []],
      patch_read: [["name"], ["name"]],
      patch_set_meta: [["title", "description"], []],
      history_undo: [[], []],
      history_redo: [[], []],
      meter_read: [["module_id", "fields"], ["module_id"]],
      engine_get_status: [[], []],
      engine_panic: [[], []],
      output_set_level: [["level_db"], ["level_db"]],
      score_play: [["notes", "params", "length", "tempo_bpm", "mode", "ack_prompt"], ["notes"]],
      score_stop: [[], []],
      score_get_status: [[], []],
    };
    assert.deepEqual(Object.keys(expected), names);
    for (const n of names) {
      assert.deepEqual(props(n), expected[n][0], `${n} の引数`);
      assert.deepEqual(required(n), expected[n][1], `${n} の必須の引数`);
    }
    // batch に入れられるコマンド(契約 CMD-09)
    const batch = tools.find((t) => t.name === "batch")!.inputSchema as Obj;
    assert.deepEqual(batch.properties.ops.items.properties.command.enum, ["module.add", "module.remove", "module.move", "cable.connect", "cable.disconnect", "param.set", "patch.set_meta"]);
    assert.equal(batch.properties.ops.maxItems, 500);
    // 種別は module.list_types と同じ定義表から
    const add = tools.find((t) => t.name === "module_add")!.inputSchema as Obj;
    assert.deepEqual(add.properties.type.enum, [...CATALOG.keys()]);
    assert.equal(add.properties.type.enum.length, 20);
  }));

test("§17 ツールの説明: 読出しのみ・取り消し不可などの性質が、契約 §6 の表のとおりに付いている", () => {
  const table = contractTable();
  for (const tool of TOOLS) {
    const row = table.find((x) => x.command === tool.command);
    assert.ok(row, tool.command);
    const d = tool.description;
    assert.ok(d.includes(row.summary), `${tool.name}: 概要`);
    assert.ok(d.includes(row.id) && d.includes(row.command), `${tool.name}: コマンド名とID`);
    const readOnly = row.changes === "×" && row.undo === "—";
    assert.equal(d.includes("読出しのみ"), readOnly, `${tool.name}: 読出しのみ`);
    assert.equal(tool.annotations.readOnlyHint, readOnly, `${tool.name}: readOnlyHint`);
    assert.equal(d.includes("パッチを変える"), row.changes === "○", `${tool.name}: 変更`);
    assert.equal(d.includes("取り消し不可"), row.undo === "×", `${tool.name}: 取り消し不可`);
    assert.equal(d.includes("history_undo で取り消せる"), row.undo.startsWith("○") || row.undo === "(undo)", `${tool.name}: 取り消せる`);
    assert.equal(d.includes("history_redo でやり直せる"), row.undo === "(redo)", `${tool.name}: やり直せる`);
    assert.equal(d.includes("batch に入れられる"), row.batch === "○", `${tool.name}: batch`);
    const note = /^両方\((.+)\)$/.exec(row.permission);
    assert.equal(d.includes("エージェントの制限"), note !== null, `${tool.name}: 権限の注記`);
    if (note) assert.ok(d.includes(note[1]), `${tool.name}: ${note[1]}`);
  }
  // 取り消せないのは保存・緊急停止・音量(契約の表の 取消 ×、権限 両方)
  assert.deepEqual(TOOLS.filter((t) => t.description.includes("取り消し不可")).map((t) => t.name), ["patch_save", "engine_panic", "output_set_level", "score_play", "score_stop"]);
  assert.deepEqual(TOOLS.filter((t) => t.description.includes("読出しのみ")).map((t) => t.name), ["module_list_types", "module_get", "patch_get", "patch_list", "patch_read", "meter_read", "engine_get_status", "score_get_status"]);
});

test("ツール定義の表は、契約 §6 の表とコマンド処理の定義(COMMANDS)に一致する", () => {
  const table = contractTable();
  assert.deepEqual(TABLE.map((x) => [x.id, x.command, x.summary]), table.map((x) => [x.id, x.command, x.summary]));
  assert.deepEqual(TABLE.map((x) => x.command), Object.keys(COMMANDS));
  for (const row of table) {
    const spec = COMMANDS[row.command];
    assert.equal(spec.humanOnly === true, row.permission === "人のみ", row.command);
    assert.equal(spec.batch === true, row.batch === "○", row.command);
    assert.equal(TOOLS.some((t) => t.command === row.command), row.permission !== "人のみ", row.command);
    const mine = TABLE.find((x) => x.command === row.command)!;
    assert.equal(mine.changes, row.changes === "○", row.command);
    const undo = row.undo.startsWith("○") ? "yes" : row.undo === "×" ? "no" : row.undo === "—" ? "na" : row.undo === "(redo)" ? "redo" : row.undo === "(undo)" ? "undo" : "?";
    assert.equal(mine.undo, undo, row.command);
  }
});

// =====================================================================================
// 結果の一致(VER-A-007)
// =====================================================================================

/** 25個のツールすべてを含む操作の列(成功・失敗・警告・再送を含む)。 */
const SCRIPT: [string, Obj][] = [
  ["module_list_types", {}],
  ["module_list_types", { type: "MOD-OSC-001" }],
  ["module_list_types", { type: "MOD-XYZ-999" }], // ERR-101
  ["engine_get_status", {}],
  ["patch_get", {}],
  ["module_get", { module_id: "vcf1" }],
  ["module_get", { module_id: "m99" }], // ERR-102
  ["module_add", { type: "MOD-IO-003", id: "scope1", ui: { x: 50, y: 2 } }],
  ["module_add", { type: "MOD-NSE-001" }], // 自動採番
  ["module_add", { type: "MOD-IO-001" }], // ERR-105
  ["module_move", { module_id: "scope1", ui: { x: 51, y: 3 } }],
  ["cable_connect", { from: { module: "vco1", port: "sine" }, to: { module: "scope1", port: "IN" } }],
  ["cable_connect", { from: { module: "vcf1", port: "out" }, to: { module: "vcf1", port: "cv2" }, id: "fb1" }], // AX-07: 警告 type_mismatch
  ["cable_connect", { from: { module: "vco1", port: "pulse" }, to: { module: "vcf1", port: "in" } }], // AX-02b: ERR-114
  ["cable_disconnect", { cable_id: "fb1" }],
  ["cable_disconnect", { cable_id: "c99" }], // AX-03c: ERR-115
  ["cable_disconnect", {}], // ERR-003
  ["param_set", { module_id: "vcf1", param: "res", value: 0.4, idempotency_key: "k-001", expected_revision: 16 }], // AX-05a
  ["param_set", { module_id: "vcf1", param: "res", value: 0.4, idempotency_key: "k-001", expected_revision: 16 }], // 再送: replayed
  ["param_set", { module_id: "vcf1", param: "res", value: 0.8, idempotency_key: "k-001", expected_revision: 16 }], // AX-05b: ERR-009
  ["param_set", { module_id: "vcf1", param: "cutoff", value: 7.5 }], // AX-04a: ERR-123
  ["param_set", { module_id: "vcf1", param: "cutoff", value: "high" }], // AX-04b: ERR-122
  ["param_set", { module_id: "vcf1", param: "cutoff", value: null }], // AX-04c: ERR-122
  ["param_set", { module_id: "vcf1", param: "cutoff", value: 1.0 }], // AX-15: changed false
  ["param_set", { module_id: "vcf1", param: "cutoff", value: 2.0, expected_revision: 3 }], // ERR-008
  ["param_set", { module_id: "vcf1", param: "cutoff", value: 2.0, expected_revision: "16" }], // 封筒の型違い: ERR-001
  ["param_set", { module_id: "vcf1", param: "cutoff", value: 2.0, extra: 1 }], // 未知の引数: ERR-003
  ["batch", { ops: [
    { command: "module.add", args: { type: "MOD-LFO-001", id: "lfo1" } },
    { command: "cable.connect", args: { from: { module: "lfo1", port: "sine" }, to: { module: "vcf1", port: "cv3" } } },
    { command: "param.set", args: { module_id: "lfo1", param: "freq", value: 9999 } },
  ] }], // AX-08a: ERR-131
  ["batch", { ops: [
    { command: "module.add", args: { type: "MOD-LFO-001", id: "lfo1" } },
    { command: "cable.connect", args: { from: { module: "lfo1", port: "sine" }, to: { module: "vcf1", port: "cv3" } } },
    { command: "param.set", args: { module_id: "lfo1", param: "freq", value: 0.5 } },
  ] }], // AX-08b
  ["batch", { ops: [{ command: "engine.start" }] }], // ERR-132
  ["patch_set_meta", { title: "MCP 経由", description: "説明" }],
  ["patch_set_meta", {}], // ERR-003
  ["history_undo", {}],
  ["history_redo", {}],
  ["history_redo", {}], // ERR-142
  ["meter_read", { module_id: "scope1" }],
  ["meter_read", { module_id: "scope1", fields: ["peak", "frame"] }],
  ["meter_read", { module_id: "vcf1" }], // ERR-303
  ["patch_save", { name: "mcp-01" }],
  ["patch_save", { name: "mcp-01" }], // ERR-203
  ["patch_save", { name: "mcp-01", overwrite: true }],
  ["patch_save", { name: "../etc/x" }], // AX-10c: ERR-201
  ["patch_list", {}],
  ["patch_read", { name: "mcp-01" }],
  ["patch_read", { name: "nothing" }], // ERR-202
  ["module_remove", { module_id: "out" }], // AX-10d: ERR-104
  ["module_remove", { module_id: "scope1" }],
  ["patch_new", {}],
  ["patch_load", { name: "mcp-01" }],
  ["patch_load", { patch: { format: "modular-synth-patch", schema_version: 1, modules: [{ id: "out", type: "MOD-IO-001", spec_version: "0.2" }, { id: "x1", type: "MOD-XYZ-999", spec_version: "0.1" }], cables: [] } }], // AX-12: ERR-204
  ["output_set_level", { level_db: -30 }],
  ["output_set_level", { level_db: -6 }], // AX-10b: ERR-302
  ["output_set_level", { level_db: 3 }], // ERR-123
  ["score_get_status", {}],
  ["score_play", { tempo_bpm: 120, notes: [{ t: 0, dur: 1, note: 60 }, { t: 1, dur: 1, note: 64, vel: 90 }, { t: 2, dur: 2, note: 67, ch: 2 }], length: 4 }],
  ["score_play", { notes: [{ t: 0, dur: 0.5, note: 72 }], idempotency_key: "s-001" }], // 前の楽譜の末尾に続く
  ["score_play", { notes: [{ t: 0, dur: 0.5, note: 72 }], idempotency_key: "s-001" }], // 再送: 二重に予約しない
  ["score_play", { notes: [{ t: 0, dur: 1, note: 60 }], params: [{ t: 0, dur: 1, module_id: "vcf1", param: "cutoff", value: 3 }, { t: 0.5, module_id: "vcf1", param: "res", value: 0.6 }] }], // パラメータの変化つき
  ["score_play", { notes: [], length: 1, params: [{ t: 0, module_id: "vcf1", param: "cutoff", value: 99 }] }], // ERR-123
  ["score_play", { notes: [], length: 1, params: [{ t: 0, module_id: "nope", param: "cutoff", value: 1 }] }], // ERR-102
  ["score_play", { notes: [{ t: 0, dur: 1, note: 128 }] }], // ERR-123
  ["score_play", { notes: [{ t: 0, dur: 1 }] }], // ERR-003
  ["score_play", { notes: [], length: 2, mode: "replace", ack_prompt: 0 }], // 休みだけの楽譜で置き換える
  ["score_get_status", {}],
  ["score_stop", {}],
  ["score_stop", {}], // 予約がなくても成功する
  ["engine_panic", { expected_revision: 0 }], // expected_revision は無視される(CMD-23)
  ["engine_get_status", {}],
  ["patch_get", {}],
];

test("VER-A-007 MCP 経由の結果は、同じ要求を POST /api/command へ直接送った結果と一致する(25個のツールすべて。成功・失敗・警告・再送)", async () => {
  const viaMcp = await startRig();
  const direct = await startRig();
  try {
    await connectTab(viaMcp);
    await connectTab(direct);
    const client = await connectMemory(viaMcp);
    assert.deepEqual([...new Set(SCRIPT.map(([name]) => name))].sort(), TOOLS.map((t) => t.name).sort(), "操作の列は25個のツールすべてを含む");
    let okCount = 0;
    let ngCount = 0;
    for (const [i, [name, input]] of SCRIPT.entries()) {
      const label = `#${i} ${name} ${JSON.stringify(input)}`;
      const tool = TOOLS.find((t) => t.name === name)!;
      const got = await call(client, name, input);
      const { args, extra } = split(input);
      const want = await post(direct, tool.command, args, extra);
      assert.deepEqual(comparable(got.body), comparable(want.body), label);
      // 応答の封筒をそのまま返す。ok:false はエラー結果
      assert.equal(got.isError, want.body.ok === false, label);
      assert.equal(got.body.command, tool.command, label);
      if (process.env.MCP_TEST_TRACE) console.log(label.slice(0, 90), "→", got.body.ok ? `ok rev ${got.body.revision}${got.body.replayed ? " replayed" : ""}${got.body.warnings.length ? " warn " + got.body.warnings[0].code : ""}` : got.body.error.id);
      assert.match(got.body.request_id, /^mcp-[0-9a-f-]{36}$/, label);
      if (want.body.ok) okCount++;
      else {
        ngCount++;
        assert.match(got.body.error.id, /^ERR-\d{3}$/, label);
      }
    }
    assert.ok(okCount >= 25 && ngCount >= 15, `成功 ${okCount} 件、失敗 ${ngCount} 件`);
    // 2つのサーバーの最終状態も一致する
    const a = (await post(viaMcp, "patch.get")).body;
    const b = (await post(direct, "patch.get")).body;
    assert.deepEqual(comparable(a), comparable(b));
  } finally {
    await viaMcp.cleanup();
    await direct.cleanup();
  }
});

test("VER-A-007 stdio の子プロセス経由でも、直接送った結果と一致する(読出しと変更)", () =>
  withRig({}, async (r) => {
    await connectTab(r);
    const { client } = await connectChild({ SYNTH_URL: r.url, SYNTH_AGENT_TOKEN: AGENT_TOKEN }, r.closers);
    for (const [name, command, args] of [
      ["patch_get", "patch.get", {}],
      ["module_list_types", "module.list_types", { type: "MOD-FLT-001" }],
      ["engine_get_status", "engine.get_status", {}],
      ["param_set", "param.set", { module_id: "m99", param: "cutoff", value: 1.0 }],
    ] as [string, string, Obj][]) {
      const got = await call(client, name, args);
      const want = await post(r, command, args);
      assert.deepEqual(comparable(got.body), comparable(want.body), name);
      assert.equal(got.isError, !want.body.ok, name);
    }
    // 変更: 応答は契約の受入例のとおりで、直後に直接読んだ状態に現れる
    const set = await call(client, "param_set", { module_id: "vcf1", param: "cutoff", value: 2.0, expected_revision: 10 });
    assert.equal(set.isError, false);
    assert.equal(set.body.revision, 11);
    assert.deepEqual(set.body.result, { module_id: "vcf1", param: "cutoff", value: 2.0, previous: 1.0, changed: true });
    assert.deepEqual(set.body.actor, { kind: "agent", client_id: "mcp" });
    const got = (await post(r, "module.get", { module_id: "vcf1" })).body;
    assert.equal(got.result.module.params.cutoff, 2.0);
    assert.equal(got.revision, 11);
  }));

// =====================================================================================
// 封筒・エラー・再送(§17)
// =====================================================================================

test("§17 封筒: アダプタが v・request_id(自動生成)・client_id を補う。expected_revision と idempotency_key は指定されたときだけ渡す", () =>
  withRig({}, async (r) => {
    const tab = await connectTab(r);
    const client = await connectMemory(r);
    await call(client, "patch_get");
    await call(client, "param_set", { module_id: "vcf1", param: "res", value: 0.4 });
    await call(client, "param_set", { module_id: "vcf1", param: "res", value: 0.5, expected_revision: 11, idempotency_key: "k-9" });
    assert.equal(tab.relayed.length, 3);
    const [a, b, c] = tab.relayed;
    assert.deepEqual(Object.keys(a).sort(), ["args", "client_id", "command", "request_id", "v"]);
    assert.deepEqual({ v: a.v, command: a.command, args: a.args, client_id: a.client_id }, { v: 1, command: "patch.get", args: {}, client_id: "mcp" });
    assert.deepEqual(Object.keys(b).sort(), ["args", "client_id", "command", "request_id", "v"]);
    assert.deepEqual(b.args, { module_id: "vcf1", param: "res", value: 0.4 });
    assert.deepEqual(Object.keys(c).sort(), ["args", "client_id", "command", "expected_revision", "idempotency_key", "request_id", "v"]);
    assert.deepEqual(c.args, { module_id: "vcf1", param: "res", value: 0.5 });
    assert.equal(c.expected_revision, 11);
    assert.equal(c.idempotency_key, "k-9");
    const ids = tab.relayed.map((q) => q.request_id);
    assert.equal(new Set(ids).size, 3, "request_id は要求ごとに違う");
    for (const id of ids) assert.ok(typeof id === "string" && id.length >= 1 && id.length <= 64);
    // 操作者は常に agent(§3.1)。SYNTH_CLIENT_ID で表示用の名前を変えられる
    const other = await connectMemory(r, { clientId: "agent-a" });
    const st = await call(other, "engine_get_status");
    assert.deepEqual(st.body.actor, { kind: "agent", client_id: "agent-a" });
  }));

test("§17 出力: ok:false はツールのエラー結果(isError)で、error(id・code・message・details)を保つ(AX-03a、AX-04a、AX-06、AX-08a)", () =>
  withRig({}, async (r) => {
    const tab = await connectTab(r);
    const client = await connectMemory(r);
    // AX-03a
    const a = await call(client, "param_set", { module_id: "m99", param: "cutoff", value: 1.0 });
    assert.equal(a.isError, true);
    assert.equal(a.body.ok, false);
    assert.equal(a.body.error.id, "ERR-102");
    assert.equal(a.body.error.code, "module_not_found");
    assert.equal(a.body.error.details.module_id, "m99");
    assert.equal(typeof a.body.error.message, "string");
    assert.equal(a.body.revision, 10);
    // AX-04a(クランプされない)
    const b = await call(client, "param_set", { module_id: "vcf1", param: "cutoff", value: 7.5 });
    assert.equal(b.isError, true);
    assert.equal(b.body.error.id, "ERR-123");
    assert.equal(b.body.error.details.min, -5);
    assert.equal(b.body.error.details.max, 6);
    // AX-08a
    const c = await call(client, "batch", { ops: [
      { command: "module.add", args: { type: "MOD-LFO-001", id: "lfo1" } },
      { command: "cable.connect", args: { from: { module: "lfo1", port: "sine" }, to: { module: "vcf1", port: "cv3" } } },
      { command: "param.set", args: { module_id: "lfo1", param: "freq", value: 9999 } },
    ] });
    assert.equal(c.isError, true);
    assert.equal(c.body.error.id, "ERR-131");
    assert.equal(c.body.error.details.failed_index, 2);
    assert.equal(c.body.error.details.cause.id, "ERR-123");
    assert.equal(c.body.revision, 10);
    // AX-06 競合
    tab.session.handle({ v: 1, request_id: "h1", command: "param.set", args: { module_id: "vcf1", param: "cutoff", value: 1.5 } }, "human");
    const d = await call(client, "param_set", { module_id: "vcf1", param: "cutoff", value: 2.0, expected_revision: 10 });
    assert.equal(d.isError, true);
    assert.equal(d.body.error.id, "ERR-008");
    assert.deepEqual(d.body.error.details, { expected_revision: 10, current_revision: 11 });
    assert.equal(d.body.revision, 11);
    // 状態は不変(人の変更が残る)
    const p = await call(client, "module_get", { module_id: "vcf1" });
    assert.equal(p.isError, false);
    assert.equal(p.body.ok, true);
    assert.equal(p.body.result.module.params.cutoff, 1.5);
    assert.equal(p.body.result.module.params.res, 0.3);
    assert.equal(p.body.revision, 11);
  }));

test("§17 再送: アダプタは自動再送しない(応答がなければ ERR-007 を1回返すだけ)。idempotency_key を自分では付けない", () =>
  withRig({ tabTimeoutMs: 150 }, async (r) => {
    const tab = await connectTab(r, { respond: false });
    const client = await connectMemory(r);
    const res = await call(client, "param_set", { module_id: "vcf1", param: "res", value: 0.4 });
    assert.equal(res.isError, true);
    assert.equal(res.body.error.id, "ERR-007");
    assert.equal(res.body.error.code, "timeout");
    await sleep(300);
    assert.equal(tab.relayed.length, 1, "タブへ届いた要求は1件だけ");
    assert.equal("idempotency_key" in tab.relayed[0], false);
  }));

test("§17 再送: 呼び出し側が idempotency_key を付けた再送は1回分しか適用されない(AX-05a、AX-05b)", () =>
  withRig({}, async (r) => {
    await connectTab(r);
    const client = await connectMemory(r);
    const input = { module_id: "vcf1", param: "res", value: 0.4, idempotency_key: "k-001" };
    const first = await call(client, "param_set", input);
    const second = await call(client, "param_set", input);
    assert.deepEqual([first.body.ok, first.body.revision, first.body.replayed], [true, 11, false]);
    assert.deepEqual([second.body.ok, second.body.revision, second.body.replayed], [true, 11, true]);
    assert.equal(second.isError, false);
    const reused = await call(client, "param_set", { ...input, value: 0.8 });
    assert.equal(reused.isError, true);
    assert.equal(reused.body.error.id, "ERR-009");
    assert.equal(reused.body.revision, 11);
    assert.equal((await call(client, "module_get", { module_id: "vcf1" })).body.result.module.params.res, 0.4);
  }));

// =====================================================================================
// 権限(§15、product-spec §8.2)
// =====================================================================================

test("権限: 人のみの操作(engine_start、engine_release_panic、patch_delete)はツールにないので呼べない。サーバーへ何も送らない(AX-09c、AX-10a)", () =>
  withRig({}, async (r) => {
    const tab = await connectTab(r);
    tab.backend.audioState = "stopped";
    const client = await connectMemory(r);
    for (const name of [...HUMAN_ONLY_TOOLS, "engine.start", "server_stop", "__proto__", "toString"]) {
      await assert.rejects(client.callTool({ name, arguments: {} }), (e: Error) => /未定義のツール/.test(e.message), name);
    }
    assert.equal(tab.relayed.length, 0, "タブへは何も届かない");
    assert.equal(tab.backend.audioState, "stopped");
    assert.equal(tab.backend.calls.some((c) => c[0] === "start"), false, "音声は開始されない");
    // 緊急停止は実行できるが、解除はできない
    const panic = await call(client, "engine_panic");
    assert.equal(panic.isError, false);
    assert.equal(panic.body.result.panic, true);
    await assert.rejects(client.callTool({ name: "engine_release_panic", arguments: {} }));
    const st = await call(client, "engine_get_status");
    assert.equal(st.body.result.panic, true, "緊急停止のまま");
    assert.equal(st.body.audio_state, "stopped");
    assert.equal(st.body.revision, 10);
    // batch に入れて回り込むこともできない(ERR-132)
    for (const command of ["engine.start", "engine.release_panic", "patch.delete"]) {
      const b = await call(client, "batch", { ops: [{ command, args: {} }] });
      assert.equal(b.isError, true);
      assert.equal(b.body.error.id, "ERR-132", command);
    }
    assert.equal(tab.backend.audioState, "stopped");
    assert.equal(tab.backend.panicOn, true);
  }));

test("権限: output_set_level の上限超過は拒否される(AX-10b: ERR-302。クランプしない)。上限内は設定できる", () =>
  withRig({}, async (r) => {
    const tab = await connectTab(r);
    const client = await connectMemory(r);
    // 人が -20 dB に設定(上限 = 人が最後に設定した値)
    tab.session.handle({ v: 1, request_id: "h1", command: "output.set_level", args: { level_db: -20 } }, "human");
    const over = await call(client, "output_set_level", { level_db: -6 });
    assert.equal(over.isError, true);
    assert.equal(over.body.error.id, "ERR-302");
    assert.equal(over.body.error.code, "level_limit_exceeded");
    assert.equal(over.body.error.details.max_db, -20);
    let st = await call(client, "engine_get_status");
    assert.equal(st.body.result.output.level_db, -20, "音量は不変(-20 にクランプもされない)");
    assert.equal(st.body.result.output.agent_max_level_db, -20);
    const ok = await call(client, "output_set_level", { level_db: -40 });
    assert.equal(ok.isError, false);
    assert.deepEqual(ok.body.result, { level_db: -40, agent_max_level_db: -20, changed: true });
    // 範囲外(ERR-123)
    const range = await call(client, "output_set_level", { level_db: 6 });
    assert.equal(range.body.error.id, "ERR-123");
    st = await call(client, "engine_get_status");
    assert.equal(st.body.result.output.level_db, -40);
    assert.equal(st.body.result.output.agent_max_level_db, -20, "上限はエージェントの要求では変わらない");
  }));

test("権限: 保存フォルダの外を指す名前は拒否(AX-10c: ERR-201)。人が保存したファイルは上書きできない(ERR-005)", () =>
  withRig({}, async (r) => {
    const tab = await connectTab(r);
    const client = await connectMemory(r);
    const esc = await call(client, "patch_save", { name: "../etc/x" });
    assert.equal(esc.isError, true);
    assert.equal(esc.body.error.id, "ERR-201");
    assert.equal(existsSync(r.patchDir) ? readdirSync(r.patchDir).length : 0, 0, "ファイルは作られない");
    // 人が保存 → エージェントは上書きできない
    const controller = new Controller({ session: tab.session, store: new FilePatchStore(r.patchDir), now: () => 0 });
    const human = (await controller.handle({ v: 1, request_id: "h1", command: "patch.save", args: { name: "mine" } }, "human")) as Obj;
    assert.equal(human.ok, true);
    const over = await call(client, "patch_save", { name: "mine", overwrite: true });
    assert.equal(over.isError, true);
    assert.equal(over.body.error.id, "ERR-005");
  }));

// =====================================================================================
// 接続先・トークン・サーバーが動いていないとき
// =====================================================================================

test("セッションなし(AX-14): タブがないと patch_get は ERR-006(revision null)。patch_list と module_list_types は応答できる", () =>
  withRig({}, async (r) => {
    const client = await connectMemory(r);
    const got = await call(client, "patch_get");
    assert.equal(got.isError, true);
    assert.equal(got.body.error.id, "ERR-006");
    assert.equal(got.body.revision, null);
    const list = await call(client, "patch_list");
    assert.equal(list.isError, false);
    assert.deepEqual(list.body.result.patches, []);
    const types = await call(client, "module_list_types");
    assert.equal(types.body.result.types.length, 20);
  }));

test("トークン誤り: サーバーの応答(AX-10e: ERR-004)をそのままエラー結果で返す。パッチの内容を返さない", () =>
  withRig({}, async (r) => {
    const tab = await connectTab(r);
    const { client } = await connectChild({ SYNTH_URL: r.url, SYNTH_AGENT_TOKEN: "wrong-token-wrong-token" }, r.closers);
    const got = await call(client, "patch_get");
    assert.equal(got.isError, true);
    assert.equal(got.body.ok, false);
    assert.equal(got.body.error.id, "ERR-004");
    assert.equal(got.body.error.code, "unauthorized");
    assert.equal("result" in got.body, false);
    assert.equal(got.raw.content[0].text.includes("vcf1"), false);
    assert.equal(got.body.revision, null);
    assert.equal(tab.relayed.length, 0, "タブへは届かない");
    // 直接送った結果と同じ
    const want = await post(r, "patch.get", {}, {}, "wrong-token-wrong-token");
    assert.deepEqual(comparable(got.body), comparable(want.body));
    // 変更も拒否される
    const set = await call(client, "param_set", { module_id: "vcf1", param: "res", value: 0.9 });
    assert.equal(set.body.error.id, "ERR-004");
    assert.equal(tab.session.revision, 10);
  }));

test("サーバー停止時: アダプタは起動でき、ツール一覧も返す。呼出しは分かりやすいエラー結果(adapter_server_unreachable)。サーバーが起動すれば、そのまま使える", async () => {
  // 空きポートを得てから閉じる(その番号で後からサーバーを起動する)
  const probe = createServer();
  await new Promise<void>((ok) => probe.listen(0, "127.0.0.1", () => ok()));
  const port = (probe.address() as AddressInfo).port;
  await new Promise((ok) => probe.close(ok));
  const base = await mkdtemp(join(tmpdir(), "synth-mcp-down-"));
  const closers: (() => Promise<void>)[] = [];
  let app: App | undefined;
  try {
    const { client, stderr } = await connectChild({ SYNTH_URL: `http://127.0.0.1:${port}`, SYNTH_AGENT_TOKEN: AGENT_TOKEN }, closers);
    assert.equal((await client.listTools()).tools.length, 25);
    const down = await call(client, "patch_get");
    assert.equal(down.isError, true);
    assert.equal(down.body.ok, false);
    assert.equal(down.body.command, "patch.get");
    // 契約の ERR-… ではない(アダプタが作った失敗)ことが分かる形
    assert.equal(down.body.error.id, null);
    assert.equal(down.body.error.code, "adapter_server_unreachable");
    assert.match(down.body.error.message, /接続できない/);
    assert.equal(down.body.error.details.url, `http://127.0.0.1:${port}/api/command`);
    assert.equal(down.body.error.details.applied, "no");
    assert.equal(down.body.revision, null);
    assert.equal(down.body.session_id, null);
    assert.match(stderr(), new RegExp(`接続先 http://127\\.0\\.0\\.1:${port}/api/command`));
    // サーバーを起動すると、アダプタを起動し直さずに使える
    await mkdir(join(base, "web"));
    app = createApp({ webRoot: join(base, "web"), patchDir: join(base, "patches"), catalog: CATALOG, agentToken: AGENT_TOKEN, tabToken: TAB_TOKEN });
    await app.listen(port);
    const up = await call(client, "patch_list");
    assert.equal(up.isError, false);
    assert.deepEqual(up.body.result.patches, []);
  } finally {
    for (const c of closers) await c().catch(() => undefined);
    await app?.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("トークンがないとき: 環境変数もファイルもなければ、呼出しはエラー結果(adapter_no_token)で、サーバーへは送らない。ファイルは呼出しのたびに読む", () =>
  withRig({}, async (r) => {
    const tab = await connectTab(r);
    const tokenFile = join(r.base, "state", "agent-token");
    const { client, stderr } = await connectChild({ SYNTH_URL: r.url, SYNTH_TOKEN_FILE: tokenFile }, r.closers);
    assert.equal((await client.listTools()).tools.length, 25, "起動は失敗しない");
    const none = await call(client, "patch_get");
    assert.equal(none.isError, true);
    assert.equal(none.body.error.id, null);
    assert.equal(none.body.error.code, "adapter_no_token");
    assert.deepEqual(none.body.error.details, { token_file: tokenFile, reason: "missing", applied: "no" });
    assert.match(none.body.error.message, /SYNTH_AGENT_TOKEN/);
    assert.equal(tab.relayed.length, 0);
    assert.ok(stderr().includes(tokenFile));
    // サーバーが書く形のファイルができれば、起動し直さずに使える
    writeTokenFile(tokenFile, AGENT_TOKEN);
    const ok = await call(client, "patch_get");
    assert.equal(ok.isError, false);
    assert.equal(ok.body.revision, 10);
    // サーバーの再起動でトークンが変わった(古いファイルが残った)場合は、サーバーの ERR-004
    writeTokenFile(tokenFile, "stale-token-0123456789abcdef");
    assert.equal((await call(client, "patch_get")).body.error.id, "ERR-004");
    // 形が合わない内容は使わない(サーバーへ送らない)
    writeFileSync(tokenFile, "not a token\nsecond line\n");
    const bad = await call(client, "patch_get");
    assert.equal(bad.body.error.code, "adapter_no_token");
    assert.equal(bad.body.error.details.reason, "malformed");
    assert.equal(tab.relayed.length, 1);
  }));

test("トークンのファイル: 所有者だけが読める(0600)。置き換えられる。自分が書いた内容のときだけ消す", async () => {
  const base = await mkdtemp(join(tmpdir(), "synth-mcp-token-"));
  try {
    const path = join(base, "sub", "agent-token");
    assert.deepEqual(readTokenFile(path), { ok: false, reason: "missing" });
    writeTokenFile(path, "token-aaaaaaaaaaaaaaaa");
    assert.deepEqual(readTokenFile(path), { ok: true, token: "token-aaaaaaaaaaaaaaaa" });
    if (process.platform !== "win32") {
      assert.equal(statSync(path).mode & 0o777, 0o600);
      assert.equal(statSync(dirname(path)).mode & 0o077, 0, "フォルダも所有者だけ");
    }
    writeTokenFile(path, "token-bbbbbbbbbbbbbbbb");
    assert.deepEqual(readTokenFile(path), { ok: true, token: "token-bbbbbbbbbbbbbbbb" });
    if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
    removeTokenFile(path, "token-aaaaaaaaaaaaaaaa"); // 別のサーバーが書き換えた後: 消さない
    assert.equal(existsSync(path), true);
    removeTokenFile(path, "token-bbbbbbbbbbbbbbbb");
    assert.equal(existsSync(path), false);
    removeTokenFile(path, "token-bbbbbbbbbbbbbbbb"); // ない: 何もしない
    assert.deepEqual(readTokenFile(base), { ok: false, reason: "unreadable" }, "通常のファイルでなければ読まない");
    // 場所: 環境変数、なければ利用者データの場所
    assert.equal(tokenFilePath({ SYNTH_TOKEN_FILE: path }), path);
    assert.match(tokenFilePath({}), /[\\/]\.agent-modular-synth[\\/]agent-token$/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

function run(file: string, env: Record<string, string>): { child: ChildProcess; out: () => string; err: () => string; exited: Promise<number | null> } {
  const child = spawn(process.execPath, [file], { env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env }, stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout!.on("data", (c: Buffer) => (out += c.toString("utf8")));
  child.stderr!.on("data", (c: Buffer) => (err += c.toString("utf8")));
  const exited = new Promise<number | null>((ok) => child.on("exit", (code) => ok(code)));
  return { child, out: () => out, err: () => err, exited };
}

test("ローカルサーバー(main.js)は起動時にトークンをファイル(0600)へ書き、終了時に消す。アダプタは環境変数がなければそのファイルを読む", async () => {
  const base = await mkdtemp(join(tmpdir(), "synth-mcp-main-"));
  const tokenFile = join(base, "state", "agent-token");
  const env = { PORT: "0", SYNTH_PATCH_DIR: join(base, "patches"), SYNTH_TOKEN_FILE: tokenFile };
  const closers: (() => Promise<void>)[] = [];
  const server = run(SERVER_MAIN, env);
  try {
    await waitFor(() => /トークンのファイル/.test(server.out()) || /書けませんでした/.test(server.err()), 10000);
    const port = Number(/POST http:\/\/127\.0\.0\.1:(\d+)\/api\/command/.exec(server.out())![1]);
    const shown = /トークン\s+(\S+)/.exec(server.out())![1];
    assert.ok(server.out().includes(tokenFile), "ファイルの場所を表示する");
    assert.equal(readFileSync(tokenFile, "utf8"), `${shown}\n`);
    if (process.platform !== "win32") assert.equal(statSync(tokenFile).mode & 0o777, 0o600);
    // アダプタ(環境変数のトークンなし)がファイルから読んで使える
    const { client } = await connectChild({ SYNTH_URL: `http://127.0.0.1:${port}`, SYNTH_TOKEN_FILE: tokenFile }, closers);
    const list = await call(client, "patch_list");
    assert.equal(list.isError, false, JSON.stringify(list.body));
    assert.deepEqual(list.body.result.patches, []);
    const types = await call(client, "module_list_types", { type: "MOD-OSC-001" });
    assert.equal(types.body.result.types[0].type, "MOD-OSC-001");
    // 終了時に消す
    server.child.kill("SIGTERM");
    await server.exited;
    assert.equal(existsSync(tokenFile), false, "終了時にファイルを消す");
    const down = await call(client, "patch_list");
    assert.equal(down.isError, true);
    assert.equal(down.body.error.code, "adapter_no_token");
  } finally {
    for (const c of closers) await c().catch(() => undefined);
    server.child.kill("SIGKILL");
    await rm(base, { recursive: true, force: true });
  }
});

test("接続先: 127.0.0.1 / localhost 以外(他のホスト、https、IPv6、利用者名つき、経路つき)を指定すると起動しない", async () => {
  const bad = [
    "http://192.168.1.10:47800",
    "http://example.com",
    "http://example.com:47800/",
    "http://0.0.0.0:47800",
    "http://127.0.0.2:47800",
    "http://[::1]:47800",
    "http://127.0.0.1.example.com:47800",
    "http://localhost.example.com:47800",
    "http://127.0.0.1@example.com:47800",
    "http://user:pw@127.0.0.1:47800",
    "https://127.0.0.1:47800",
    "ws://127.0.0.1:47800",
    "file:///etc/passwd",
    "http://127.0.0.1:47800/other",
    "http://127.0.0.1:47800/?next=http://example.com",
    "127.0.0.1:47800",
    "not a url",
  ];
  for (const url of bad) assert.throws(() => resolveConfig({ SYNTH_URL: url }), ConfigError, url);
  // 受け付ける形
  assert.equal(resolveConfig({}).endpoint, "http://127.0.0.1:47800/api/command");
  assert.equal(resolveConfig({ SYNTH_URL: "" }).endpoint, "http://127.0.0.1:47800/api/command");
  assert.equal(resolveConfig({ SYNTH_URL: "http://127.0.0.1:5000" }).endpoint, "http://127.0.0.1:5000/api/command");
  assert.equal(resolveConfig({ SYNTH_URL: "http://localhost:5000/" }).endpoint, "http://localhost:5000/api/command");
  assert.equal(resolveConfig({ SYNTH_URL: "HTTP://LOCALHOST:5000" }).endpoint, "http://localhost:5000/api/command");
  assert.equal(resolveConfig({ SYNTH_AGENT_TOKEN: "abc" }).token, "abc");
  assert.equal(resolveConfig({}).token, null);
  assert.equal(resolveConfig({}).clientId, "mcp");
  assert.throws(() => resolveConfig({ SYNTH_CLIENT_ID: "x".repeat(65) }), ConfigError);
  assert.throws(() => resolveConfig({ SYNTH_AGENT_TOKEN: "a b" }), ConfigError);

  // 子プロセス: MCP の応答を1つも返さずに、0 でない終了コードで終わる
  for (const url of ["http://192.168.1.10:47800", "http://example.com", "https://127.0.0.1:47800"]) {
    const p = run(ADAPTER_MAIN, { SYNTH_URL: url, SYNTH_AGENT_TOKEN: AGENT_TOKEN });
    p.child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } })}\n`);
    const code = await p.exited;
    assert.notEqual(code, 0, url);
    assert.notEqual(code, null, url);
    assert.equal(p.out(), "", `${url}: 標準出力(MCP)には何も返さない`);
    assert.match(p.err(), /起動できません/, url);
    assert.ok(p.err().includes(url), url);
  }
  // SDK のクライアントから見ると、接続に失敗する
  const transport = new StdioClientTransport({ command: process.execPath, args: [ADAPTER_MAIN], env: { SYNTH_URL: "http://example.com" }, stderr: "pipe" });
  const client = new Client({ name: "mcp-test", version: "0" });
  await assert.rejects(client.connect(transport));
  await client.close().catch(() => undefined);
});

test("独自の機能を持たない: アダプタが送るのは POST /api/command だけ(Authorization: Bearer 付き、Origin なし)。ツール一覧の取得では何も送らない", async () => {
  const seen: { method?: string; url?: string; auth?: string; origin?: string; body: Obj }[] = [];
  const stub = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Obj;
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, origin: req.headers.origin, body });
      if (body.command === "patch.list") {
        res.writeHead(302, { Location: "http://127.0.0.1:9/elsewhere" }).end(); // 転送には従わない
      } else if (body.command === "patch.get") {
        res.writeHead(200, { "Content-Type": "text/html" }).end("<html>別のプログラム</html>");
      } else {
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ v: 1, request_id: body.request_id, ok: true, command: body.command, result: {}, extra_field: [1, 2] }));
      }
    });
  });
  await new Promise<void>((ok) => stub.listen(0, "127.0.0.1", () => ok()));
  const port = (stub.address() as AddressInfo).port;
  const closers: (() => Promise<void>)[] = [];
  try {
    const { client } = await connectChild({ SYNTH_URL: `http://127.0.0.1:${port}`, SYNTH_AGENT_TOKEN: AGENT_TOKEN }, closers);
    await client.listTools();
    assert.equal(seen.length, 0);
    for (const t of TOOLS) await client.callTool({ name: t.name, arguments: {} });
    assert.equal(seen.length, 25, "ツールの呼出し1回につき要求1件");
    for (const q of seen) {
      assert.equal(q.method, "POST");
      assert.equal(q.url, "/api/command");
      assert.equal(q.auth, `Bearer ${AGENT_TOKEN}`);
      assert.equal(q.origin, undefined);
    }
    assert.deepEqual(seen.map((q) => q.body.command), TOOLS.map((t) => t.command));
    // 応答の封筒は、知らない項目も含めてそのまま返す
    const ok = await call(client, "engine_get_status");
    assert.equal(ok.isError, false);
    assert.deepEqual(ok.body.extra_field, [1, 2]);
    // 共通コマンドの応答の形でないもの・転送は、アダプタのエラー結果にする
    const html = await call(client, "patch_get");
    assert.equal(html.isError, true);
    assert.equal(html.body.error.code, "adapter_bad_response");
    assert.equal(html.body.error.details.applied, "unknown");
    const redirected = await call(client, "patch_list");
    assert.equal(redirected.isError, true);
    assert.equal(redirected.body.error.id, null);
    assert.equal(seen.every((q) => q.url === "/api/command"), true);
  } finally {
    for (const c of closers) await c().catch(() => undefined);
    await new Promise((ok) => stub.close(ok));
  }
});

test("トークンのファイル: 所有者以外が読み書きできる権限のファイルは使わない(insecure)。応答は ok の真偽だけでなく、封筒の形を確かめる", { skip: process.platform === "win32" }, async () => {
  const { chmodSync, writeFileSync, mkdtempSync, rmSync } = await import("node:fs");
  const base = mkdtempSync(join(tmpdir(), "synth-token-mode-"));
  try {
    const path = join(base, "agent-token");
    writeFileSync(path, "token-cccccccccccccccc\n", { mode: 0o600 });
    assert.deepEqual(readTokenFile(path), { ok: true, token: "token-cccccccccccccccc" });
    for (const mode of [0o644, 0o640, 0o604, 0o660]) {
      chmodSync(path, mode);
      assert.deepEqual(readTokenFile(path), { ok: false, reason: "insecure" }, mode.toString(8));
    }
    chmodSync(path, 0o600);
    // 応答の形: ok があるだけの JSON は、共通コマンドの応答として通さない
    const shapes: [unknown, boolean][] = [
      [{ ok: true }, false],
      [{ v: 1, ok: true }, false],
      [{ v: 2, ok: true, result: {} }, false],
      [{ v: 1, ok: false, error: "x" }, false],
      [{ v: 1, ok: false, error: { id: "ERR-006" } }, false],
      [{ v: 1, ok: true, result: {} }, true],
      [{ v: 1, ok: false, error: { id: "ERR-006", code: "no_session", message: "", details: {} } }, true],
    ];
    for (const [body, pass] of shapes) {
      const stub = createServer((_q, res) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body)));
      await new Promise<void>((ok) => stub.listen(0, "127.0.0.1", () => ok()));
      try {
        const cfg = resolveConfig({ SYNTH_URL: `http://127.0.0.1:${(stub.address() as AddressInfo).port}`, SYNTH_AGENT_TOKEN: AGENT_TOKEN });
        const out = await sendCommand(cfg, { v: 1, request_id: "s1", command: "patch.get", client_id: "mcp" });
        const isAdapterError = (out.error as Obj | undefined)?.code === "adapter_bad_response";
        assert.equal(!isAdapterError, pass, JSON.stringify(body));
      } finally {
        await new Promise<void>((ok) => stub.close(() => ok()));
      }
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
