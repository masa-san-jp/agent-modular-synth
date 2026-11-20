// MCP アダプタ本体(operation-contract §17、DEC-002、REQ-A-007、product-spec §7.2)。
// 共通コマンドを1対1でツールにする薄い変換層で、独自の状態・機能を持たない。
// 呼べるのはローカルサーバーの `POST /api/command` だけ(接続先は 127.0.0.1 / localhost に限る)。
// - 封筒の v・request_id(自動生成)・client_id を補う。操作者はサーバーが agent と決める。
// - 応答の封筒をそのまま JSON で返す。ok:false はツールのエラー結果(isError)で、error を保つ。
// - 自動再送しない。通知は転送しない。入力の検査はしない(検査はコマンド処理が行い、契約のエラーを返す)。
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, CallToolResult, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import { readTokenFile, tokenFilePath } from "./token-file.js";
import { TOOLS, ToolDef } from "./tools.js";

type Obj = Record<string, unknown>;

export const DEFAULT_URL = "http://127.0.0.1:47800";
export const DEFAULT_CLIENT_ID = "mcp";
/** 応答待ち [ms]。サーバーのタブ応答待ち(5 秒。operation-contract §7.8)より長くし、サーバーの ERR-007 を先に受け取る。 */
export const DEFAULT_TIMEOUT_MS = 15000;
const ALLOWED_HOSTS = ["127.0.0.1", "localhost"];

export interface AdapterConfig {
  /** `POST` する先(`http://127.0.0.1:<ポート>/api/command`)。 */
  endpoint: string;
  /** 環境変数で渡されたトークン。null ならファイルを呼出しのたびに読む(サーバーの再起動で変わるため)。 */
  token: string | null;
  tokenFile: string;
  clientId: string;
  timeoutMs: number;
}

/** 設定の誤り(起動を拒否する)。 */
export class ConfigError extends Error {}

/**
 * 環境変数から設定を作る。接続先が 127.0.0.1 / localhost の http でなければ ConfigError(起動しない)。
 * サーバーが動いているか・トークンがあるかは、ここでは調べない(ツールの呼出し時に分かる)。
 */
export function resolveConfig(env: NodeJS.ProcessEnv = process.env): AdapterConfig {
  const raw = env.SYNTH_URL !== undefined && env.SYNTH_URL !== "" ? env.SYNTH_URL : DEFAULT_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`SYNTH_URL が URL として読めない: ${raw}`);
  }
  if (url.protocol !== "http:") throw new ConfigError(`SYNTH_URL は http:// だけ(ローカルサーバーは http で待ち受ける): ${raw}`);
  if (!ALLOWED_HOSTS.includes(url.hostname)) {
    throw new ConfigError(`SYNTH_URL の接続先は 127.0.0.1 または localhost だけ(他のホストへは送信しない): ${raw}`);
  }
  if (url.username !== "" || url.password !== "") throw new ConfigError("SYNTH_URL に利用者名・パスワードは書けない");
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new ConfigError(`SYNTH_URL は http://127.0.0.1:<ポート> の形(経路・問合せは書けない): ${raw}`);
  }
  const clientId = env.SYNTH_CLIENT_ID !== undefined && env.SYNTH_CLIENT_ID !== "" ? env.SYNTH_CLIENT_ID : DEFAULT_CLIENT_ID;
  if ([...clientId].length > 64) throw new ConfigError("SYNTH_CLIENT_ID は 1〜64 文字");
  const token = env.SYNTH_AGENT_TOKEN !== undefined && env.SYNTH_AGENT_TOKEN !== "" ? env.SYNTH_AGENT_TOKEN : null;
  if (token !== null && !/^[\x21-\x7e]+$/.test(token)) throw new ConfigError("SYNTH_AGENT_TOKEN に空白や制御文字は使えない");
  return { endpoint: `${url.origin}/api/command`, token, tokenFile: tokenFilePath(env), clientId, timeoutMs: DEFAULT_TIMEOUT_MS };
}

/** アダプタ自身が作る失敗(サーバーへ届かなかった等)の種類。契約の ERR-… ではないので `error.id` は null にする。 */
export type AdapterErrorCode = "adapter_no_token" | "adapter_server_unreachable" | "adapter_bad_response";

/**
 * アダプタ自身が作る失敗の応答。形は契約の失敗応答(§3.2)に合わせるが、契約のエラーではないことが分かるよう
 * `error.id` は null、`error.code` は `adapter_` で始める。`details.applied` は、要求が適用されたか
 * (`"no"` = 送っていない・届いていない、`"unknown"` = 送ったが応答を受け取れなかった)。
 */
function adapterFailure(request: Obj, code: AdapterErrorCode, message: string, details: Obj): Obj {
  return {
    v: 1,
    request_id: request.request_id,
    ok: false,
    command: request.command,
    revision: null,
    session_id: null,
    actor: { kind: "agent", client_id: request.client_id },
    audio_state: null,
    replayed: false,
    error: { id: null, code, message, details },
  };
}

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** ツールの入力 → 要求の封筒(§3.1)。expected_revision と idempotency_key は、指定されたときだけ渡す。 */
export function buildRequest(tool: ToolDef, input: Obj, clientId: string): Obj {
  const { expected_revision, idempotency_key, ...args } = input;
  return {
    v: 1,
    request_id: `mcp-${randomUUID()}`,
    command: tool.command,
    args,
    ...("expected_revision" in input ? { expected_revision } : {}),
    ...("idempotency_key" in input ? { idempotency_key } : {}),
    client_id: clientId,
  };
}

/** 要求1件をローカルサーバーへ送り、応答の封筒を返す。1回だけ送る(再送しない)。 */
export async function sendCommand(config: AdapterConfig, request: Obj): Promise<Obj> {
  let token = config.token;
  if (token === null) {
    const read = readTokenFile(config.tokenFile);
    if (!read.ok) {
      return adapterFailure(
        request,
        "adapter_no_token",
        read.reason === "missing"
          ? `エージェント用トークンがない。ローカルサーバーが起動していない可能性がある(npm run dev で起動する)。トークンは環境変数 SYNTH_AGENT_TOKEN、またはサーバーが起動時に書くファイル ${config.tokenFile} から読む`
          : `トークンのファイル ${config.tokenFile} を読めない、または内容がトークンの形でない`,
        { token_file: config.tokenFile, reason: read.reason, applied: "no" },
      );
    }
    token = read.token;
  }
  let res: Response;
  let text: string;
  let sent = false;
  try {
    const pending = fetch(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(request),
      redirect: "error", // 他の場所へ転送されない
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    res = await pending;
    sent = true;
    text = await res.text();
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? (e.cause as NodeJS.ErrnoException) : undefined;
    const refused = cause?.code === "ECONNREFUSED";
    const reason = e instanceof Error && e.name === "TimeoutError" ? "timeout" : (cause?.code ?? (e instanceof Error ? e.name : "error"));
    return adapterFailure(
      request,
      "adapter_server_unreachable",
      refused
        ? `ローカルサーバー ${config.endpoint} に接続できない(起動していない、またはポートが違う)。npm run dev で起動し、ポートを変えている場合は SYNTH_URL を合わせる`
        : `ローカルサーバー ${config.endpoint} から応答を受け取れなかった(${reason})。要求が適用されたかは不明`,
      { url: config.endpoint, reason, applied: refused && !sent ? "no" : "unknown" },
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (!isObj(body) || typeof body.ok !== "boolean") {
    return adapterFailure(request, "adapter_bad_response", `ローカルサーバーの応答が共通コマンドの応答の形でない(HTTP ${res.status})。SYNTH_URL が別のプログラムを指している可能性がある`, {
      url: config.endpoint,
      http_status: res.status,
      applied: "unknown",
    });
  }
  return body;
}

/** 応答の封筒 → ツールの結果。封筒をそのまま JSON にする。ok:false はエラー結果。 */
export function toToolResult(response: Obj): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(response) }], isError: response.ok !== true };
}

/** MCP サーバーを作る(輸送はつながない)。 */
export function createMcpServer(config: AdapterConfig): Server {
  const server = new Server({ name: "agent-modular-synth", version: "0.0.1" }, { capabilities: { tools: {} } });
  const byName = new Map(TOOLS.map((t) => [t.name, t]));
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as { type: "object" }, annotations: t.annotations })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const tool = byName.get(req.params.name);
    // 人のみのコマンド(engine_start など)を含め、一覧にない名前はここで断る(サーバーへは何も送らない)
    if (!tool) throw new McpError(ErrorCode.InvalidParams, `未定義のツール ${req.params.name}`);
    const request = buildRequest(tool, req.params.arguments ?? {}, config.clientId);
    return toToolResult(await sendCommand(config, request));
  });
  return server;
}
