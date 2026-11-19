// ローカルサーバー本体(DEC-103/104、product-spec §4・§8.2、operation-contract §3・§10・§15・§16)。
// 静的配信、エージェント用の共通コマンドAPI(WebSocket / HTTP)、タブへの中継、パッチファイルの保存先。
// 取り決めは src/server/protocol.ts。パッチの正本はタブ側(Session)で、サーバーは持たない。
//
// 守ること:
// - 待受は 127.0.0.1 だけ(listen にホストを渡す口がない)。
// - Host ヘッダが 127.0.0.1 / localhost と待受ポートでない要求はすべて拒否する(DNS リバインディング対策)。
// - エージェント用の口(/api/…)は `Authorization: Bearer <エージェント用トークン>` を要求し、Origin ヘッダが付いた要求を
//   拒否する(ブラウザ上のページから叩けないようにする。CORS の許可ヘッダは出さない)。
// - タブの口(/tab)はタブ用トークンと Origin(自サーバーのオリジンだけ)を検査する。
// - サーバーを止める口、任意の経路を読み書きする口、任意ホストへ送信する口は作らない(REQ-S-007)。
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { IncomingMessage, Server, ServerResponse, createServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { TypeCatalog } from "../control/catalog.js";
import { ERRORS, ErrorId } from "../control/errors.js";
import { MAX_PATCH_BYTES, isValidPatchName, parsePatchText } from "../control/patch-doc.js";
import { COMMANDS, METER_FIELDS, METER_TYPE, OUT_TYPE } from "../control/session.js";
import type { StoreResult } from "../control/store.js";
import { FilePatchStore, MAX_PATCH_FILES } from "./file-store.js";
import type { ServerToTab } from "./protocol.js";
import { DEFAULT_PORT, HOST, createStaticHandler } from "./static.js";

// ---- 上限と時間(いずれも契約の暫定値) ----

export interface AppLimits {
  /** タブの応答待ち時間 [ms](operation-contract §7.8: 5 秒)。超えたら ERR-007。 */
  tabTimeoutMs: number;
  /** 要求1件の大きさの上限 [バイト](§16: 2 MiB。解釈前のバイト数)。超えたら ERR-011。 */
  maxRequestBytes: number;
  /** 専用フォルダ内の保存パッチのファイル数(§16: 1000)。 */
  maxPatchFiles: number;
  /** パッチファイル1つの大きさ [バイト](data-contract §10: 1 MiB)。 */
  maxPatchBytes: number;
}

export const DEFAULT_APP_LIMITS: AppLimits = {
  tabTimeoutMs: 5000,
  maxRequestBytes: 2 * 1024 * 1024,
  maxPatchFiles: MAX_PATCH_FILES,
  maxPatchBytes: 1024 * 1024,
};

/** タブからの1通の上限 [バイト](応答・保存する文書を運ぶ。契約にない実装上の値)。 */
const TAB_MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
/** 2つ目のタブを閉じるときの終了コード(アプリ用の範囲)。 */
export const CLOSE_ANOTHER_TAB = 4001;

export interface AppOptions {
  /** 静的配信するフォルダ(web/)。 */
  webRoot: string;
  /** パッチファイルの専用フォルダ(data-contract DAT-30)。コマンドの引数では変えられない。 */
  patchDir: string;
  /** モジュール種別の定義(タブなしでも module.list_types に答えるため)。 */
  catalog: TypeCatalog;
  /** エージェント用トークン。省略時は乱数で発行する。 */
  agentToken?: string;
  /** タブ用トークン。省略時は乱数で発行する。 */
  tabToken?: string;
  limits?: Partial<AppLimits>;
}

export interface App {
  readonly server: Server;
  readonly agentToken: string;
  readonly tabToken: string;
  /** 専用フォルダの保存先。 */
  readonly store: FilePatchStore;
  /** 127.0.0.1 の指定ポートで待ち受ける(ホストは選べない)。実際のポートを返す。 */
  listen(port?: number): Promise<number>;
  /** 待受と全接続を閉じる(プロセス内からだけ呼べる。通信の口はない)。 */
  close(): Promise<void>;
}

// ---- 小さな補助 ----

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function charLen(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

function okLen(v: unknown): v is string {
  return typeof v === "string" && charLen(v) >= 1 && charLen(v) <= 64;
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

const TOKEN_RE = /^[A-Za-z0-9_-]{16,256}$/;

/** 長さや一致位置が時間に現れない比較。 */
function sameToken(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

function headerOne(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

interface ErrorSpec {
  id: ErrorId;
  message: string;
  details?: Obj;
}

/** 封筒から読めた範囲の情報(応答に写す)。 */
interface EnvelopeInfo {
  requestId: string | null;
  command: string | null;
  clientId?: string;
}

/** セッション(タブ)について最後に分かっている値。 */
interface Known {
  session_id: string | null;
  revision: number | null;
  audio_state: string | null;
}

const NO_SESSION: Known = { session_id: null, revision: null, audio_state: null };

const ENVELOPE_KEYS = ["v", "request_id", "command", "args", "expected_revision", "idempotency_key", "client_id"];

/**
 * 封筒の形(operation-contract §3.1、§3.3 の1)。Session と同じ規則(未知のフィールドは ERR-001: docs/contract-notes.md)。
 * 問題がなければ null。
 */
function checkEnvelope(r: unknown): ErrorSpec | null {
  const invalid = (field: string, message: string): ErrorSpec => ({ id: "ERR-001", message, details: { field } });
  if (!isObj(r)) return invalid("", "要求がオブジェクトでない");
  for (const k of Object.keys(r)) {
    if (!ENVELOPE_KEYS.includes(k)) return invalid(k, `封筒に未知のフィールド ${k}`);
  }
  if (typeof r.v !== "number" || !Number.isInteger(r.v)) return invalid("v", "v は整数(必須)");
  if (!okLen(r.request_id)) return invalid("request_id", "request_id は 1〜64 文字の文字列(必須)");
  if (typeof r.command !== "string") return invalid("command", "command は文字列(必須)");
  if ("args" in r && !isObj(r.args)) return invalid("args", "args はオブジェクト");
  if ("expected_revision" in r) {
    const e = r.expected_revision;
    if (typeof e !== "number" || !Number.isInteger(e) || e < 0) {
      return invalid("expected_revision", "expected_revision は 0 以上の整数");
    }
  }
  if ("idempotency_key" in r && !okLen(r.idempotency_key)) {
    return invalid("idempotency_key", "idempotency_key は 1〜64 文字の文字列");
  }
  if ("client_id" in r && !okLen(r.client_id)) return invalid("client_id", "client_id は 1〜64 文字の文字列");
  if (r.v !== 1) return { id: "ERR-012", message: `封筒の版 ${r.v} は未対応`, details: { supported: [1] } };
  return null;
}

function envelopeInfo(r: unknown): EnvelopeInfo {
  if (!isObj(r)) return { requestId: null, command: null };
  return {
    requestId: typeof r.request_id === "string" ? r.request_id : null,
    command: typeof r.command === "string" ? r.command : null,
    ...(okLen(r.client_id) ? { clientId: r.client_id } : {}),
  };
}

/** サーバーが作る応答(operation-contract §3.2 の形)。操作者は常に agent(§3.1)。 */
function failure(info: EnvelopeInfo, known: Known, e: ErrorSpec): Obj {
  return {
    v: 1,
    request_id: info.requestId,
    ok: false,
    command: info.command,
    revision: known.revision,
    session_id: known.session_id,
    actor: { kind: "agent", ...(info.clientId !== undefined ? { client_id: info.clientId } : {}) },
    audio_state: known.audio_state,
    replayed: false,
    error: { id: e.id, code: ERRORS[e.id], message: e.message, details: e.details ?? {} },
  };
}

function success(info: EnvelopeInfo, known: Known, result: Obj): Obj {
  return {
    v: 1,
    request_id: info.requestId,
    ok: true,
    command: info.command,
    revision: known.revision,
    session_id: known.session_id,
    actor: { kind: "agent", ...(info.clientId !== undefined ? { client_id: info.clientId } : {}) },
    audio_state: known.audio_state,
    replayed: false,
    warnings: [],
    result,
  };
}

/** HTTP の状態コード(契約にない。本文は常に §3.2 の形)。コマンド処理まで届いた応答は成否に関わらず 200。 */
function httpStatus(response: Obj): number {
  const id = response.ok === false && isObj(response.error) ? response.error.id : null;
  switch (id) {
    case "ERR-001":
    case "ERR-012":
      return 400;
    case "ERR-004":
      return 401;
    case "ERR-011":
      return 413;
    case "ERR-006":
      return 503;
    case "ERR-007":
      return 504;
    default:
      return 200;
  }
}

const STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  426: "Upgrade Required",
};

/** WebSocket の接続要求を HTTP の応答で断る。 */
function rejectUpgrade(socket: Duplex, status: number, body: Obj): void {
  const text = JSON.stringify(body);
  socket.on("error", () => undefined);
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? "Error"}\r\n` +
      "Content-Type: application/json; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(text)}\r\n` +
      "Cache-Control: no-store\r\n" +
      "Connection: close\r\n\r\n" +
      text,
  );
}

function sendJson(res: ServerResponse, status: number, body: Obj, extra: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  });
  res.end(text);
}

/** 認証の失敗の種類(どちらも ERR-004)。 */
type AuthFailure = "origin" | "token";

interface AgentConn {
  ws: WebSocket;
  seq: number;
}

interface Pending {
  info: EnvelopeInfo;
  timer: NodeJS.Timeout;
  resolve: (response: Obj) => void;
}

// =====================================================================================

export function createApp(options: AppOptions): App {
  const limits: AppLimits = { ...DEFAULT_APP_LIMITS, ...(options.limits ?? {}) };
  const agentToken = options.agentToken ?? newToken();
  const tabToken = options.tabToken ?? newToken();
  if (!TOKEN_RE.test(agentToken) || !TOKEN_RE.test(tabToken)) {
    throw new Error("トークンは英数字・_・- の 16〜256 文字");
  }
  if (agentToken === tabToken) throw new Error("エージェント用トークンとタブ用トークンは別の値にする");

  const catalog = options.catalog;
  const store = new FilePatchStore(options.patchDir, { maxFiles: limits.maxPatchFiles, maxBytes: limits.maxPatchBytes });

  // ---- 状態(接続だけ。パッチは持たない) ----
  let port = 0;
  let tab: WebSocket | null = null;
  let known: Known = NO_SESSION;
  let nextReqId = 1;
  let nextClient = 1;
  const pending = new Map<number, Pending>();
  const agents = new Set<AgentConn>();

  // ---- 静的配信(index.html にタブ用トークンを埋める) ----
  const META_RE = /<meta\s+name="synth-tab-token"\s+content="[^"]*"\s*\/?>/;
  const meta = `<meta name="synth-tab-token" content="${tabToken}">`;
  const serveStatic = createStaticHandler(options.webRoot, {
    transformIndex: (html) =>
      META_RE.test(html) ? html.replace(META_RE, meta) : html.replace(/<head[^>]*>/i, (m) => `${m}\n${meta}`),
  });

  // ---- 検査 ----
  const hostOk = (req: IncomingMessage): boolean => {
    const h = (req.headers.host ?? "").toLowerCase();
    if (h === `127.0.0.1:${port}` || h === `localhost:${port}`) return true;
    return port === 80 && (h === "127.0.0.1" || h === "localhost");
  };
  const ownOrigin = (origin: string | undefined): boolean =>
    origin === `http://127.0.0.1:${port}` ||
    origin === `http://localhost:${port}` ||
    (port === 80 && (origin === "http://127.0.0.1" || origin === "http://localhost"));
  /** エージェント用の口の認証。通れば null。 */
  const agentAuth = (req: IncomingMessage): AuthFailure | null => {
    if (req.headers.origin !== undefined) return "origin";
    const m = /^Bearer +(\S+)$/i.exec(headerOne(req.headers.authorization) ?? "");
    return m && sameToken(m[1], agentToken) ? null : "token";
  };
  const unauthorized = (info: EnvelopeInfo, why: AuthFailure | "host"): Obj =>
    // 認証されていない相手には、セッションの値(リビジョンなど)を返さない
    failure(info, NO_SESSION, {
      id: "ERR-004",
      message:
        why === "origin"
          ? "Origin ヘッダが付いた要求は受け付けない"
          : why === "host"
            ? "Host ヘッダが不正"
            : "トークンがない、または違う",
    });
  const NO_INFO: EnvelopeInfo = { requestId: null, command: null };

  // ---- エージェントへの通知(§10)。seq は接続ごとの連番 ----
  const broadcast = (event: string, sessionId: string | null, data: unknown): void => {
    for (const a of agents) {
      if (a.ws.readyState !== WebSocket.OPEN) continue;
      a.seq += 1;
      a.ws.send(JSON.stringify({ v: 1, event, seq: a.seq, session_id: sessionId, data }));
    }
  };
  /** EVT-05(サーバーが出す)。 */
  const sessionChanged = (connected: boolean, k: Known): void => {
    broadcast("session.changed", k.session_id, { connected, session_id: k.session_id, revision: k.revision });
  };

  /** タブの応答・通知から、セッションの現在値を覚える(サーバーが作るエラー応答の封筒に使う)。 */
  const learn = (v: Obj): void => {
    const next = { ...known };
    if (typeof v.session_id === "string") next.session_id = v.session_id;
    if (typeof v.revision === "number") next.revision = v.revision;
    if (typeof v.audio_state === "string") next.audio_state = v.audio_state;
    const d = v.data;
    if (isObj(d) && typeof v.event === "string") {
      if (v.event === "patch.changed" && typeof d.revision === "number") next.revision = d.revision;
      if (v.event === "engine.state_changed" && typeof d.audio_state === "string") next.audio_state = d.audio_state;
    }
    known = next;
  };

  // ---- タブへの中継 ----
  const sendTab = (ws: WebSocket, m: ServerToTab): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };

  /**
   * 要求をタブへ送り、応答を `deliver` へ渡す。`deliver` はタブの応答を受けたその場で(同期で)呼ぶ:
   * タブは応答の直後に通知を送るので、非同期を挟むと通知が応答を追い越す(§10: 通知は応答の後)。
   */
  const forward = (request: unknown, info: EnvelopeInfo, clientId: string, deliver: (response: Obj) => void): void => {
    const t = tab;
    if (!t) {
      deliver(failure(info, NO_SESSION, { id: "ERR-006", message: "パッチを持つタブが開かれていない" }));
      return;
    }
    const id = nextReqId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      // 適用されたかは不明(§7.4)
      deliver(failure(info, known, { id: "ERR-007", message: "タブが時間内に応答しなかった", details: { timeout_ms: limits.tabTimeoutMs } }));
    }, limits.tabTimeoutMs);
    pending.set(id, { info, timer, resolve: deliver });
    sendTab(t, { t: "req", id, client_id: clientId, request });
  };

  // ---- タブなしでも答えるコマンド(product-spec §4: patch.list、patch.read、module.list_types) ----
  const DIRECT = new Set(["module.list_types", "patch.list", "patch.read"]);
  const badArg = (arg: string, reason: string, message?: string): ErrorSpec => ({
    id: "ERR-003",
    message: message ?? `引数 ${arg}: ${reason}`,
    details: { arg, reason },
  });
  const unknownKey = (args: Obj, allowed: string[]): ErrorSpec | null => {
    for (const k of Object.keys(args)) if (!allowed.includes(k)) return badArg(k, "unknown_key", `未知の引数 ${k}`);
    return null;
  };
  /** 保存先の失敗 → 契約のエラー(src/control/controller.ts の storeError と同じ対応)。 */
  const storeError = (operation: string, name: string | null, error: string, message?: string): ErrorSpec => {
    switch (error) {
      case "not_found":
        return { id: "ERR-202", message: `保存パッチ ${name} はない`, details: { name } };
      case "invalid_name":
        return { id: "ERR-201", message: "パッチ名が規則に合わない", details: { name } };
      case "too_large":
        return { id: "ERR-206", message: "パッチの大きさが上限を超える", details: { limit_bytes: MAX_PATCH_BYTES } };
      default:
        return { id: "ERR-207", message: message ?? `保存先の ${operation} に失敗`, details: { reason: error, operation } };
    }
  };
  /** ファイルに今書かれている `meta.saved_by.kind`(DAT-36。controller.ts の savedByKindOf と同じ)。 */
  const savedByKindOf = (text: string): string | null => {
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      return null;
    }
    if (!isObj(doc) || !isObj(doc.meta)) return null;
    const sb = doc.meta.saved_by;
    if (!isObj(sb)) return null;
    if (Object.keys(sb).some((k) => k !== "kind" && k !== "client_id")) return null;
    if ("client_id" in sb && typeof sb.client_id !== "string") return null;
    return sb.kind === "agent" || sb.kind === "human" ? sb.kind : null;
  };

  /**
   * CMD-01。応答の形は Session(src/control/session.ts の cmdListTypes)と同じでなければならない。
   * 共有できる関数がまだないので、同じ形をここで作っている(session.ts 側の変更に合わせること)。
   */
  const listTypes = (args: Obj): Obj | ErrorSpec => {
    const k = unknownKey(args, ["type"]);
    if (k) return k;
    let infos = [...catalog.values()];
    if ("type" in args) {
      if (typeof args.type !== "string") return badArg("type", "type");
      const one = catalog.get(args.type);
      if (!one) return { id: "ERR-101", message: `未知のモジュール種別 ${args.type}`, details: { type: args.type } };
      infos = [one];
    }
    const portOf = (p: { name: string; type: string; connectable: boolean }, direction: "in" | "out") => ({
      name: p.name,
      direction,
      signal_type: p.type,
      unit: null,
      connectable: p.connectable,
      unconnected: null,
    });
    const types = infos.map((t) => ({
      type: t.type,
      title: t.title,
      category: null,
      spec_version: t.specVersion,
      singleton: t.type === OUT_TYPE,
      ports: [...t.inputs.map((p) => portOf(p, "in")), ...t.outputs.map((p) => portOf(p, "out"))],
      params: t.params.map((p) => ({
        name: p.name,
        kind: p.kind === "seed" ? "int" : p.kind,
        unit: p.unit ?? null,
        min: p.min,
        max: p.max,
        default: p.default,
      })),
      readouts: t.type === METER_TYPE ? [...METER_FIELDS] : [],
    }));
    return { types };
  };

  // CMD-14・CMD-15 の応答は、タブ側(src/control/controller.ts の planList / planRead)と同じでなければならない。
  // 共有できる関数がまだないので、同じ規則をここで作っている(controller.ts 側の変更に合わせること)。

  /** CMD-14。壊れた・読めないファイルも `readable: false` で載せる(DAT-34)。 */
  const patchList = async (args: Obj): Promise<Obj | ErrorSpec> => {
    const k = unknownKey(args, []);
    if (k) return k;
    const listed = await store.list();
    if (!listed.ok) return storeError("list", null, "failed", listed.message);
    const patches: Obj[] = [];
    for (const info of listed.value) {
      const r = await store.read(info.name);
      if (!r.ok && r.error === "not_found") continue; // 一覧の後に消えた
      let title: string | null = null;
      let savedByKind: string | null = null;
      let readable = false;
      if (r.ok) {
        const parsed = parsePatchText(r.value.text, catalog);
        readable = parsed.ok;
        if (parsed.ok) {
          title = parsed.patch.meta.title;
          savedByKind = parsed.patch.meta.saved_by?.kind ?? null;
        } else {
          savedByKind = savedByKindOf(r.value.text);
          try {
            const doc: unknown = JSON.parse(r.value.text);
            if (isObj(doc) && isObj(doc.meta) && typeof doc.meta.title === "string") title = doc.meta.title;
          } catch {
            // JSON として読めない
          }
        }
      }
      patches.push({ name: info.name, title, bytes: info.bytes, modified_at: info.modified_at, saved_by_kind: savedByKind, readable });
    }
    return { patches };
  };

  /** CMD-15。検証・移行はしない。 */
  const patchRead = async (args: Obj): Promise<Obj | ErrorSpec> => {
    const k = unknownKey(args, ["name"]);
    if (k) return k;
    if (!("name" in args)) return badArg("name", "missing");
    const name = args.name;
    if (typeof name !== "string") return badArg("name", "type");
    if (!isValidPatchName(name)) return { id: "ERR-201", message: "パッチ名が規則に合わない", details: { name } };
    const r = await store.read(name);
    if (!r.ok) return storeError("read", name, r.error, r.message);
    let patch: unknown;
    try {
      patch = JSON.parse(r.value.text);
    } catch (e) {
      const message = `JSONとして解釈できない: ${e instanceof Error ? e.message : String(e)}`;
      return { id: "ERR-204", message, details: { issues: [{ rule: "DAT-V02", path: "", message }] } };
    }
    return { patch, bytes: r.value.info.bytes, modified_at: r.value.info.modified_at };
  };

  const isErrorSpec = (v: Obj | ErrorSpec): v is ErrorSpec => typeof (v as ErrorSpec).id === "string" && (v as ErrorSpec).id in ERRORS && "message" in v;

  /** タブがないときの処理(§3.3 の 3 → 4。その後、直接答えられるコマンドだけ実行する)。 */
  const withoutSession = async (request: Obj, info: EnvelopeInfo): Promise<Obj> => {
    const cmd = request.command as string;
    const spec = Object.prototype.hasOwnProperty.call(COMMANDS, cmd) ? COMMANDS[cmd] : undefined;
    if (!spec) return failure(info, NO_SESSION, { id: "ERR-002", message: `未定義のコマンド ${cmd}`, details: { command: cmd } });
    if (spec.humanOnly) {
      return failure(info, NO_SESSION, {
        id: "ERR-005",
        message: `${cmd} は人のUIだけが行える`,
        details: { command: cmd, actor_kind: "agent" },
      });
    }
    if (!DIRECT.has(cmd)) return failure(info, NO_SESSION, { id: "ERR-006", message: "パッチを持つタブが開かれていない" });
    // 読出しなので冪等キーは無視する(§7.6)。リビジョンがないので expected_revision は比べない。
    const args = (request.args as Obj | undefined) ?? {};
    let out: Obj | ErrorSpec;
    try {
      out = cmd === "module.list_types" ? listTypes(args) : cmd === "patch.list" ? await patchList(args) : await patchRead(args);
    } catch {
      out = { id: "ERR-010", message: "想定外の失敗" };
    }
    return isErrorSpec(out) ? failure(info, NO_SESSION, out) : success(info, NO_SESSION, out);
  };

  /**
   * エージェントの要求1件(解釈前のバイト列)を処理して応答を返す。HTTP と WebSocket で共通。
   * 検査の順は §3.3: 封筒の形(ERR-011 → ERR-001 → ERR-012)→ 認証(ERR-004)→ コマンド名・権限 → セッションの有無。
   * WebSocket は接続時に認証を済ませているので `auth` は常に null。
   */
  const handleAgent = (raw: Buffer | null, auth: AuthFailure | null, clientId: string, deliver: (response: Obj) => void): void => {
    // 認証されていない相手には、セッションの値を返さない
    const shown = (): Known => (auth === null && tab ? known : NO_SESSION);
    if (raw === null || raw.byteLength > limits.maxRequestBytes) {
      deliver(failure(NO_INFO, shown(), { id: "ERR-011", message: "要求が大きすぎる", details: { limit_bytes: limits.maxRequestBytes } }));
      return;
    }
    let request: unknown;
    try {
      request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    } catch {
      deliver(failure(NO_INFO, shown(), { id: "ERR-001", message: "要求が JSON でない", details: { field: "" } }));
      return;
    }
    const info = envelopeInfo(request);
    const broken = checkEnvelope(request);
    if (broken) deliver(failure(info, shown(), broken));
    else if (auth !== null) deliver(unauthorized(info, auth));
    else if (tab) forward(request, info, clientId, deliver);
    else {
      void withoutSession(request as Obj, info)
        .catch(() => failure(info, NO_SESSION, { id: "ERR-010", message: "想定外の失敗" }))
        .then(deliver);
    }
  };

  // ---- HTTP ----
  const readBody = (req: IncomingMessage): Promise<Buffer | null> =>
    new Promise((resolve, reject) => {
      const declared = Number(req.headers["content-length"]);
      if (Number.isFinite(declared) && declared > limits.maxRequestBytes) {
        resolve(null); // 読まずに断る
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      let over = false;
      req.on("data", (c: Buffer) => {
        if (over) return;
        total += c.byteLength;
        if (total > limits.maxRequestBytes) {
          over = true;
          chunks.length = 0;
          resolve(null);
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => {
        if (!over) resolve(Buffer.concat(chunks));
      });
      req.on("error", reject);
    });

  const httpCommand = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST", "Cache-Control": "no-store" }).end();
      return;
    }
    const auth = agentAuth(req);
    const raw = await readBody(req);
    handleAgent(raw, auth, `http-${nextClient++}`, (response) => {
      const status = auth === "origin" && httpStatus(response) === 401 ? 403 : httpStatus(response);
      // 読み切っていない本文が残る場合は、応答の後で接続を閉じる
      sendJson(res, status, response, raw === null ? { Connection: "close" } : {});
    });
  };

  const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
    let path: string;
    try {
      path = new URL(req.url ?? "/", `http://${HOST}`).pathname;
    } catch {
      res.writeHead(400).end();
      return;
    }
    const api = path === "/api" || path.startsWith("/api/");
    if (!hostOk(req)) {
      if (api) sendJson(res, 403, unauthorized(NO_INFO, "host"));
      else res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).end("forbidden");
      return;
    }
    if (path === "/api/command") {
      httpCommand(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      return;
    }
    if (path === "/api/ws" || path === "/tab") {
      res.writeHead(426, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).end("upgrade required");
      return;
    }
    if (api) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).end("not found");
      return;
    }
    serveStatic(req, res);
  };

  const server = createServer(onRequest);

  // ---- WebSocket ----
  // エージェント: 上限を超えた1通にも ERR-011 を返せるよう、受信の上限は要求の上限の2倍にする(それを超えると接続を閉じる)。
  const agentWss = new WebSocketServer({ noServer: true, maxPayload: limits.maxRequestBytes * 2, perMessageDeflate: false });
  const tabWss = new WebSocketServer({ noServer: true, maxPayload: TAB_MAX_MESSAGE_BYTES, perMessageDeflate: false });

  const toBuffer = (data: Buffer | ArrayBuffer | Buffer[]): Buffer =>
    Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);

  const onAgent = (ws: WebSocket): void => {
    const conn: AgentConn = { ws, seq: 0 };
    const clientId = `ws-${nextClient++}`;
    agents.add(conn);
    ws.on("error", () => undefined);
    ws.on("close", () => agents.delete(conn));
    ws.on("message", (data) => {
      handleAgent(toBuffer(data), null, clientId, (response) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
      });
    });
  };

  const storeOp = async (m: Obj): Promise<StoreResult<unknown>> => {
    switch (m.op) {
      case "list":
        return store.list();
      case "read":
        return typeof m.name === "string" ? store.read(m.name) : { ok: false, error: "invalid_name" };
      case "write":
        if (typeof m.name !== "string") return { ok: false, error: "invalid_name" };
        if (typeof m.text !== "string" || typeof m.overwrite !== "boolean") return { ok: false, error: "failed", message: "bad_message" };
        return store.write(m.name, m.text, m.overwrite);
      case "remove":
        return typeof m.name === "string" ? store.remove(m.name) : { ok: false, error: "invalid_name" };
      default:
        return { ok: false, error: "failed", message: "unknown_op" };
    }
  };

  const onTabMessage = (ws: WebSocket, data: Buffer): void => {
    let m: unknown;
    try {
      m = JSON.parse(data.toString("utf8"));
    } catch {
      return; // 壊れた1通は捨てる
    }
    if (!isObj(m)) return;
    if (m.t === "res" && typeof m.id === "number") {
      const p = pending.get(m.id);
      if (!p) return; // 時間切れの後に届いた応答
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (isObj(m.response)) {
        learn(m.response);
        p.resolve(m.response);
      } else {
        p.resolve(failure(p.info, known, { id: "ERR-010", message: "タブの応答が不正" }));
      }
    } else if (m.t === "evt" && isObj(m.event) && typeof m.event.event === "string") {
      learn(m.event);
      const sid = typeof m.event.session_id === "string" ? m.event.session_id : known.session_id;
      broadcast(m.event.event, sid, m.event.data ?? {});
    } else if (m.t === "store" && typeof m.id === "number") {
      const id = m.id;
      void storeOp(m)
        .catch((): StoreResult<unknown> => ({ ok: false, error: "failed" }))
        .then((r) => {
          if (r.ok) sendTab(ws, { t: "store_res", id, ok: true, value: r.value });
          else sendTab(ws, { t: "store_res", id, ok: false, error: r.error, ...(r.message !== undefined ? { message: r.message } : {}) });
        });
    }
  };

  const onTab = (ws: WebSocket): void => {
    ws.on("error", () => undefined);
    if (tab) {
      // 単一タブ(data-contract DAT-25): 2つ目はセッションにしない
      ws.send(JSON.stringify({ t: "hello", accepted: false, reason: "another_tab" } satisfies ServerToTab), () =>
        ws.close(CLOSE_ANOTHER_TAB, "another_tab"),
      );
      return;
    }
    tab = ws;
    known = NO_SESSION;
    ws.on("message", (data) => onTabMessage(ws, toBuffer(data)));
    ws.on("close", () => {
      if (tab !== ws) return;
      const last = known;
      tab = null;
      known = NO_SESSION;
      // 送った要求が適用されたかは分からない → ERR-007(待たずに返す)
      for (const [id, p] of pending) {
        pending.delete(id);
        clearTimeout(p.timer);
        p.resolve(
          failure(p.info, NO_SESSION, {
            id: "ERR-007",
            message: "タブとの接続が切れた(適用されたかは不明)",
            details: { timeout_ms: limits.tabTimeoutMs, reason: "tab_disconnected" },
          }),
        );
      }
      sessionChanged(false, last);
    });
    sendTab(ws, { t: "hello", accepted: true });
    // セッションの識別子とリビジョンを知るために、読出しを1件送る(取り決めにタブからの自己紹介がないため)。
    // 応答を待って EVT-05 を出す。応答がなければ、分かっている範囲(null)で出す。
    const probe = { v: 1, request_id: "server-hello", command: "engine.get_status", client_id: "server" };
    forward(probe, envelopeInfo(probe), "server", () => {
      if (tab === ws) sessionChanged(true, known);
    });
  };

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", `http://${HOST}`);
    } catch {
      rejectUpgrade(socket, 400, {});
      return;
    }
    if (!hostOk(req)) {
      rejectUpgrade(socket, 403, unauthorized(NO_INFO, "host"));
      return;
    }
    if (url.pathname === "/api/ws") {
      const auth = agentAuth(req);
      if (auth !== null) {
        rejectUpgrade(socket, auth === "origin" ? 403 : 401, unauthorized(NO_INFO, auth));
        return;
      }
      agentWss.handleUpgrade(req, socket, head, onAgent);
    } else if (url.pathname === "/tab") {
      if (!ownOrigin(req.headers.origin)) {
        rejectUpgrade(socket, 403, unauthorized(NO_INFO, "origin"));
        return;
      }
      if (!sameToken(url.searchParams.get("token") ?? "", tabToken)) {
        rejectUpgrade(socket, 401, unauthorized(NO_INFO, "token"));
        return;
      }
      tabWss.handleUpgrade(req, socket, head, onTab);
    } else {
      rejectUpgrade(socket, 404, {});
    }
  });

  return {
    server,
    agentToken,
    tabToken,
    store,
    listen(listenPort: number = DEFAULT_PORT): Promise<number> {
      return new Promise((ok, ng) => {
        server.once("error", ng);
        // ホストは固定(127.0.0.1)。引数で変えられない。
        server.listen(listenPort, HOST, () => {
          server.removeListener("error", ng);
          const a = server.address();
          port = typeof a === "object" && a ? a.port : listenPort;
          ok(port);
        });
      });
    },
    close(): Promise<void> {
      for (const [id, p] of pending) {
        pending.delete(id);
        clearTimeout(p.timer);
        p.resolve(failure(p.info, NO_SESSION, { id: "ERR-006", message: "サーバーが終了する" }));
      }
      for (const a of agents) a.ws.terminate();
      for (const c of tabWss.clients) c.terminate();
      agentWss.close();
      tabWss.close();
      return new Promise((ok) => {
        if (!server.listening) {
          ok();
          return;
        }
        server.close(() => ok());
        server.closeAllConnections();
      });
    },
  };
}
