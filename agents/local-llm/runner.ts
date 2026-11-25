// 手元の LLM(Ollama の gpt-oss:20b など)に、シンセのツールを渡して演奏させる(Issue #55、DEC-027)。
// 製品(サーバーとタブ)の外にある「外からつないだエージェント」の実例。製品の中に推論は入れない(DEC-018)。
//
//   LLM(Ollama / OpenAI 互換) <──HTTP──> このプログラム ──HTTP(127.0.0.1)──> ローカルサーバー ──> タブ(パッチと音声)
//
// ツールは MCP アダプタと同じ定義(src/mcp/tools.ts。エージェントに許されたコマンドだけ)。権限はサーバーが守る
// (音声の開始、緊急停止の解除、パッチの削除、上限を超える音量はできない)。
import { buildRequest, sendCommand } from "../../src/mcp/adapter.js";
import type { AdapterConfig } from "../../src/mcp/adapter.js";
import { ARGS, TABLE, TOOLS } from "../../src/mcp/tools.js";
import { buildCatalog } from "../../src/control/catalog.js";
import { REGISTRY } from "../../src/modules/registry.js";
import { englishizeResponse, moduleCatalogText, TOOL_TEXT_EN } from "./english.js";
import { detectStyle, STYLE_HINTS, styleSection } from "./style-hints.js";
import type { StyleName } from "./style-hints.js";
import type { ToolDef } from "../../src/mcp/tools.js";

type Obj = Record<string, unknown>;

// ---------------------------------------------------------------------------------------
// LLM との会話
// ---------------------------------------------------------------------------------------

export interface ToolCall {
  id: string;
  name: string;
  /** モデルが返した引数(オブジェクト、または JSON の文字列)。 */
  arguments: unknown;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  /** role が tool のとき: 答えているツール呼出し。 */
  toolCallId?: string;
  toolName?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Obj;
}

export interface ChatReply {
  content: string;
  toolCalls: ToolCall[];
}

export interface LlmClient {
  /** 会話を送り、モデルの返事(文章とツール呼出し)を受け取る。 */
  chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<ChatReply>;
  readonly describe: string;
}

export type ApiKind = "ollama" | "openai";

export interface LlmOptions {
  api: ApiKind;
  /** Ollama: http://127.0.0.1:11434 。OpenAI 互換: http://127.0.0.1:1234/v1 など(/chat/completions の手前まで)。 */
  baseUrl: string;
  model: string;
  /** OpenAI 互換の API の鍵(要らないサーバーが多い)。 */
  apiKey?: string;
  /** Ollama の文脈長(num_ctx)。既定 16384(ツールの説明は compact で約 4 千トークン、指示文が約 7 百トークン)。 */
  numCtx?: number;
  temperature?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

let callSeq = 0;
const newCallId = (): string => `call_${Date.now().toString(36)}_${(++callSeq).toString(36)}`;

/** LLM の口を作る。 */
export function createLlmClient(o: LlmOptions): LlmClient {
  const f = o.fetchImpl ?? fetch;
  const base = o.baseUrl.replace(/\/+$/, "");
  const timeout = o.timeoutMs ?? 600_000;
  const post = async (url: string, body: Obj, headers: Record<string, string> = {}): Promise<Obj> => {
    const res = await f(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    const text = await res.text();
    if (!res.ok) throw new Error(`LLM の応答が HTTP ${res.status}: ${text.slice(0, 500)}`);
    try {
      return JSON.parse(text) as Obj;
    } catch {
      throw new Error(`LLM の応答が JSON でない: ${text.slice(0, 200)}`);
    }
  };

  if (o.api === "ollama") {
    return {
      describe: `Ollama ${base} / ${o.model}`,
      async chat(messages, tools) {
        const body: Obj = {
          model: o.model,
          stream: false,
          messages: messages.map((m) => {
            if (m.role === "assistant") {
              return { role: "assistant", content: m.content, ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: parseArgs(c.arguments).value ?? {} } })) } : {}) };
            }
            if (m.role === "tool") return { role: "tool", content: m.content, ...(m.toolName ? { tool_name: m.toolName } : {}) };
            return { role: m.role, content: m.content };
          }),
          tools: tools.map((t) => ({ type: "function", function: t })),
          options: { num_ctx: o.numCtx ?? 16384, ...(o.temperature !== undefined ? { temperature: o.temperature } : {}) },
        };
        const r = await post(`${base}/api/chat`, body);
        const msg = (r.message ?? {}) as Obj;
        const calls = Array.isArray(msg.tool_calls) ? (msg.tool_calls as Obj[]) : [];
        return {
          content: typeof msg.content === "string" ? msg.content : "",
          toolCalls: calls.map((c) => {
            const fn = (c.function ?? {}) as Obj;
            return { id: typeof c.id === "string" ? c.id : newCallId(), name: String(fn.name ?? ""), arguments: fn.arguments ?? {} };
          }),
        };
      },
    };
  }

  return {
    describe: `OpenAI 互換 ${base} / ${o.model}`,
    async chat(messages, tools) {
      const body: Obj = {
        model: o.model,
        messages: messages.map((m) => {
          if (m.role === "assistant") {
            return {
              role: "assistant",
              content: m.content,
              ...(m.toolCalls?.length
                ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments ?? {}) } })) }
                : {}),
            };
          }
          if (m.role === "tool") return { role: "tool", content: m.content, tool_call_id: m.toolCallId ?? "" };
          return { role: m.role, content: m.content };
        }),
        tools: tools.map((t) => ({ type: "function", function: t })),
        tool_choice: "auto",
        ...(o.temperature !== undefined ? { temperature: o.temperature } : {}),
      };
      const r = await post(`${base}/chat/completions`, body, o.apiKey ? { Authorization: `Bearer ${o.apiKey}` } : {});
      const choice = (Array.isArray(r.choices) ? r.choices[0] : undefined) as Obj | undefined;
      const msg = (choice?.message ?? {}) as Obj;
      const calls = Array.isArray(msg.tool_calls) ? (msg.tool_calls as Obj[]) : [];
      return {
        content: typeof msg.content === "string" ? msg.content : "",
        toolCalls: calls.map((c) => {
          const fn = (c.function ?? {}) as Obj;
          return { id: typeof c.id === "string" && c.id ? c.id : newCallId(), name: String(fn.name ?? ""), arguments: fn.arguments ?? "{}" };
        }),
      };
    },
  };
}

/** ツールの引数を読む。文字列なら JSON として読む。 */
export function parseArgs(raw: unknown): { value: Obj | null; error?: string } {
  if (raw === undefined || raw === null || raw === "") return { value: {} };
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw) as unknown;
      return typeof v === "object" && v !== null && !Array.isArray(v) ? { value: v as Obj } : { value: null, error: "arguments are not a JSON object" };
    } catch {
      return { value: null, error: "arguments are not valid JSON" };
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) return { value: raw as Obj };
  return { value: null, error: "arguments are not an object" };
}

// ---------------------------------------------------------------------------------------
// ツール(シンセのコマンド)
// ---------------------------------------------------------------------------------------

export type ToolDetail = "compact" | "full";

/** どのツールにも付いている封筒の項目(楽観ロックと再送の鍵)。このプログラムは使わないので、compact では渡さない。 */
const ENVELOPE_KEYS = ["expected_revision", "idempotency_key"];

/**
 * LLM に渡すツールの一覧(MCP と同じ 30 個。エージェントに許されたコマンドだけ)。
 * - compact(既定): 英語で、文脈を節約する。説明は「何をするか」と使い方の注意だけ(english.ts の訳)。
 *   封筒の項目(expected_revision、idempotency_key)と検査だけの項目を除く。引数の形・値の範囲・選択肢はそのまま。
 *   訳のない説明は日本語のまま残る(試験で見つける)。
 * - full: MCP アダプタと同じ説明と引数(日本語。比べるため)。
 */
export function toolSpecs(detail: ToolDetail = "compact", defs: readonly ToolDef[] = TOOLS): ToolSpec[] {
  if (detail === "full") return defs.map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema }));
  return defs.map((t) => {
    const row = TABLE.find((r) => r.command === t.command);
    const note = ARGS[t.command]?.note;
    const readOnly = row ? !row.changes && row.undo === "na" : false;
    const ja = [`${row?.summary ?? t.command}。`, readOnly ? "読むだけ。" : "", note ?? ""].filter(Boolean).join(" ");
    const props = { ...((t.inputSchema.properties ?? {}) as Obj) };
    for (const k of ENVELOPE_KEYS) delete props[k];
    const parameters = translateSchema(slimSchema({ ...t.inputSchema, properties: props }), t.name) as Obj;
    return { name: t.name, description: TOOL_TEXT_EN[t.name] ?? ja, parameters };
  });
}

/** 引数の説明を英訳に置き換える(場所は「ツール名.properties.…」)。 */
function translateSchema(v: unknown, path: string): unknown {
  if (Array.isArray(v)) return v.map((x) => translateSchema(x, path));
  if (typeof v !== "object" || v === null) return v;
  const out: Obj = {};
  for (const [k, x] of Object.entries(v as Obj)) {
    if (k === "description" && typeof x === "string") out[k] = TOOL_TEXT_EN[path] ?? x;
    else if (k === "properties" && typeof x === "object" && x !== null) out[k] = Object.fromEntries(Object.entries(x as Obj).map(([pk, pv]) => [pk, translateSchema(pv, `${path}.properties.${pk}`)]));
    else out[k] = translateSchema(x, k === "items" ? `${path}.items` : path);
  }
  return out;
}

/** 検査だけに使う項目(数の上限、文字数、書式、余分な項目の禁止)。検査はサーバーが行うので、compact では渡さない。値の範囲と選択肢は残す。 */
const CHECK_ONLY_KEYS = new Set(["maxItems", "minItems", "minLength", "maxLength", "pattern"]);

function slimSchema(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(slimSchema);
  if (typeof v !== "object" || v === null) return v;
  const out: Obj = {};
  for (const [k, x] of Object.entries(v as Obj)) {
    if (CHECK_ONLY_KEYS.has(k)) continue;
    if (k === "additionalProperties" && x === false) continue;
    // properties の中は項目名なので、そのまま辿る(項目名が上の語と同じでも消さない)
    out[k] = k === "properties" && typeof x === "object" && x !== null ? Object.fromEntries(Object.entries(x as Obj).map(([pk, pv]) => [pk, slimSchema(pv)])) : slimSchema(x);
  }
  return out;
}

/** シンセへコマンドを送る口(試験で差し替える)。 */
export type CommandSender = (command: string, args: Obj, envelope?: Obj) => Promise<Obj>;

export function httpSender(config: AdapterConfig): CommandSender {
  const byCommand = new Map(TOOLS.map((t) => [t.command, t]));
  return async (command, args, envelope = {}) => {
    const tool = byCommand.get(command);
    if (!tool) throw new Error(`未定義のコマンド ${command}`);
    return sendCommand(config, buildRequest(tool, { ...args, ...envelope }, config.clientId));
  };
}

/** 長い文字列を切る(小さいモデルの文脈を使い切らないように)。 */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}... (${text.length - max} more characters omitted; narrow the request if you need them)`;
}

/**
 * ツール呼出し 1 件を実行し、モデルに返す文字列を作る。english なら、シンセの応答のエラーと注意の文を英語にする
 * (english.ts。人が書いた中身は変えない)。
 */
export async function runToolCall(call: ToolCall, send: CommandSender, maxChars: number, english = true): Promise<{ text: string; ok: boolean; command: string | null }> {
  const tool = TOOLS.find((t) => t.name === call.name);
  if (!tool) {
    const names = TOOLS.map((t) => t.name).join(", ");
    return { text: JSON.stringify({ ok: false, error: { code: "unknown_tool", message: `No tool named ${call.name}. Available: ${names}` } }), ok: false, command: null };
  }
  const parsed = parseArgs(call.arguments);
  if (!parsed.value) {
    return { text: JSON.stringify({ ok: false, error: { code: "bad_arguments", message: `${parsed.error}. Pass the arguments as a JSON object` } }), ok: false, command: tool.command };
  }
  const { expected_revision, idempotency_key, ...args } = parsed.value;
  const envelope: Obj = {};
  if (expected_revision !== undefined) envelope.expected_revision = expected_revision;
  if (idempotency_key !== undefined) envelope.idempotency_key = idempotency_key;
  const res = await send(tool.command, args, envelope);
  return { text: clip(JSON.stringify(english ? englishizeResponse(res) : res), maxChars), ok: res.ok === true, command: tool.command };
}

/**
 * 文脈長(トークン)から、会話の履歴とツールの結果に使える長さ(文字)を見積もる。
 * 文字とトークンの比は o200k(gpt-oss のトークナイザー)で測った値より少なめに取る:
 * 指示文(英語の文と一覧表)は 2.64 文字/トークン → 2.4、ツールの説明は compact(英語)4.22 → 3.8・full(日本語)2.33 → 2.1、
 * 会話の中身(ツールの結果と楽譜。2.07〜3.36)→ 2。モデルの返事のために 2048 トークンを空けておく。
 */
export function contextBudget(numCtx: number, detail: ToolDetail = "compact"): { fixedTokens: number; historyChars: number; toolResultChars: number; tight: boolean } {
  const toolsChars = JSON.stringify(toolSpecs(detail).map((t) => ({ type: "function", function: t }))).length;
  const fixedTokens = Math.ceil(longestPrompt() / 2.4 + toolsChars / (detail === "compact" ? 3.8 : 2.1));
  const available = numCtx - fixedTokens - 2048;
  const historyChars = Math.max(4000, Math.floor(available * 2));
  return { fixedTokens, historyChars, toolResultChars: Math.min(6000, Math.floor(historyChars / 3)), tight: available * 2 < 8000 };
}

// ---------------------------------------------------------------------------------------
// 会話の履歴を短く保つ
// ---------------------------------------------------------------------------------------

const size = (m: ChatMessage): number => m.content.length + (m.toolCalls ? JSON.stringify(m.toolCalls).length : 0) + 16;

/**
 * 先頭の固定部分(システムの指示と、最初の目標)を残し、残りは新しい方から maxChars に収まるだけ残す。
 * ツールの結果だけが、呼出しの前から切り離されて残らないようにする(API が受け付けないため)。
 */
export function trimHistory(messages: ChatMessage[], keepHead: number, maxChars: number): ChatMessage[] {
  const head = messages.slice(0, keepHead);
  const rest = messages.slice(keepHead);
  let used = 0;
  let start = rest.length;
  for (let i = rest.length - 1; i >= 0; i--) {
    used += size(rest[i]!);
    if (used > maxChars && start < rest.length) break;
    start = i;
  }
  // 切れ目が tool の結果にならないように進める(呼出しのない結果は、API が受け付けない)
  while (start < rest.length && rest[start]!.role === "tool") start++;
  return [...head, ...rest.slice(start)];
}

// ---------------------------------------------------------------------------------------
// 演奏を続ける(モデルを起こす時機)
// ---------------------------------------------------------------------------------------

export interface PerfStatus {
  audioState: string | null;
  playing: boolean;
  remaining: number;
  unackedPrompts: { id: number; text: string }[];
  plan: { duration_seconds: number | null; elapsed_seconds: number } | null;
}

/** score.get_status の応答 → 起こす判断に使う形。 */
export function readStatus(res: Obj): PerfStatus | null {
  if (res.ok !== true) return null;
  const r = (res.result ?? {}) as Obj;
  const prompts = Array.isArray(r.prompts) ? (r.prompts as Obj[]) : [];
  return {
    audioState: typeof res.audio_state === "string" ? res.audio_state : null,
    playing: r.playing === true,
    remaining: typeof r.remaining === "number" ? r.remaining : 0,
    unackedPrompts: prompts.filter((p) => p.acked === false).map((p) => ({ id: Number(p.id), text: String(p.text) })),
    plan: typeof r.plan === "object" && r.plan !== null ? (r.plan as PerfStatus["plan"]) : null,
  };
}

export type WakeReason = "remaining_low" | "new_prompt" | "audio_started" | "stopped" | null;

/**
 * モデルを起こすか。
 * - 音声が動いていない間は起こさない(エージェントは音声を開始できない)。動き出したら起こす。
 * - 予約の残りが leadSeconds 以下になったら起こす(続きの楽譜を書く時間)。
 * - まだ見せていない人の指示が来たら起こす。
 * - 演奏が止まっていて(人が止めた、終わった)、モデルが終わりを宣言していなければ起こす。
 */
export function wakeReason(st: PerfStatus, prev: { audioRunning: boolean; seenPromptIds: Set<number>; ended: boolean; wokeWhileIdle: boolean }, leadSeconds: number): WakeReason {
  const running = st.audioState === "running";
  if (!running) return null;
  if (!prev.audioRunning) return "audio_started";
  if (st.unackedPrompts.some((p) => !prev.seenPromptIds.has(p.id))) return "new_prompt";
  if (prev.ended) return null;
  if (st.playing && st.remaining <= leadSeconds) return "remaining_low";
  if (!st.playing && !prev.wokeWhileIdle) return "stopped";
  return null;
}

const REASON_TEXT: Record<Exclude<WakeReason, null>, string> = {
  remaining_low: "The queue is running low. Send the next score with score_play (mode append).",
  new_prompt: "A new prompt arrived from the human. Send a score that follows it, with ack_prompt set to its id.",
  audio_started: "The human started audio. You can start playing.",
  stopped: "Playback has stopped (nothing queued). Send a score to continue, or reply only [END] to finish.",
};

export function wakeMessage(reason: Exclude<WakeReason, null>, st: PerfStatus): string {
  return `${REASON_TEXT[reason]}\nStatus: ${JSON.stringify({ playing: st.playing, remaining: Math.round(st.remaining * 10) / 10, unacked_prompts: st.unackedPrompts, plan: st.plan })}`;
}

// ---------------------------------------------------------------------------------------
// 指示文(英語。LLM とシンセのやりとりは英語: オーナーの指示 2026-11-25)
// ---------------------------------------------------------------------------------------

export const END_MARK = "[END]";

let catalogCache: string | null = null;
/** モジュールの一覧表(実装のカタログから作る)。 */
export function moduleCatalog(): string {
  catalogCache ??= moduleCatalogText(buildCatalog(REGISTRY));
  return catalogCache;
}

/** 指示文。style があれば、その曲調の音作りの目安を足す(style-hints.ts)。 */
export function systemPrompt(style: StyleName | null = null): string {
  return [
    "You are a performer on a modular synthesizer. You operate it with tools and play it by writing scores. The synth runs in a browser tab.",
    "",
    "# Steps",
    "1. Read the current patch with patch_get. Add modules and cables with batch (several operations in one call).",
    "   - Minimal voice: MOD-IO-002 (MIDI-CV, receives the score) PITCH -> MOD-OSC-001 (VCO) pitch; VCO saw -> MOD-AMP-001 (VCA) in1; MIDI-CV GATE -> VCA cv1; VCA out -> output `out` IN_L. The output module `out` (MOD-IO-001) always exists. IN_R follows IN_L if left unconnected.",
    "   - Signals are voltages. Pitch is 1 V/oct (0 V = C4). Gates are 0/10 V. Use an envelope (MOD-ENV-001, gate -> env) on VCA cv or filter cv for shape.",
    "2. Play with score_play. A note is {t: start, dur: length, note: MIDI number (60 = middle C), vel: 1-127}. With tempo_bpm, t/dur/length are in beats. length = score length.",
    '   Example: {"tempo_bpm": 120, "notes": [{"t": 0, "dur": 0.9, "note": 57}, {"t": 1, "dur": 0.9, "note": 60}, {"t": 2, "dur": 0.9, "note": 64}, {"t": 3, "dur": 0.9, "note": 67}], "length": 4}',
    "   - To move a parameter during the score, use params: [{t, dur, module_id, param, value}].",
    "   - For several voices, give each MIDI-CV its own channel param and set ch on the notes.",
    "3. Send the next score before `remaining` (seconds left in the queue) runs out. Make each score about 8-30 s.",
    "4. Prompts from the human arrive in prompts. When a score follows a prompt with acked:false, set ack_prompt to its id.",
    "5. After sending, reply briefly without calling tools and wait. You will be woken up with the status when the next score is needed.",
    `6. To finish, send the last score, then reply only ${END_MARK}.`,
    "",
    "# Rules",
    "- You cannot start audio or release an emergency stop (humans only). If audio_state is not running, build the patch and wait.",
    "- Tool results are JSON. If ok is false, read error.code/message/details, fix the call and retry. After 3 identical failures, try another approach.",
    "- Do not raise the output level too much.",
    "",
    "# Module types (type ID, name | connectable inputs | outputs | params: name min..max def default unit)",
    moduleCatalog(),
    "",
    styleSection(style),
  ].join("\n");
}

/** 指示文のいちばん長い場合の文字数(文脈の見積もり用)。 */
function longestPrompt(): number {
  return Math.max(...(Object.keys(STYLE_HINTS) as StyleName[]).map((st) => systemPrompt(st).length));
}

export function firstUserMessage(goal: string, st: PerfStatus | null): string {
  return [`Goal of the performance: ${goal}`, `Current status: ${st ? JSON.stringify({ audio_state: st.audioState, playing: st.playing, remaining: st.remaining, plan: st.plan }) : "unavailable"}`, "Check the patch first, then start playing."].join("\n");
}

// ---------------------------------------------------------------------------------------
// 全体の流れ
// ---------------------------------------------------------------------------------------

export interface RunOptions {
  llm: LlmClient;
  send: CommandSender;
  goal: string;
  /** 1 回の起こしで、ツールを呼べる回数の上限(堂々めぐりを止める)。 */
  maxToolRounds?: number;
  /** ツールの結果 1 件の長さの上限 [文字]。 */
  maxToolResultChars?: number;
  /** 会話の履歴の長さの上限 [文字](システムの指示と最初の目標を除く)。 */
  maxHistoryChars?: number;
  /** 予約の残りがこの秒数以下になったら、モデルを起こす。 */
  leadSeconds?: number;
  pollMs?: number;
  /** ツールの説明の詳しさ(既定 compact)。 */
  toolDetail?: ToolDetail;
  /** 曲調(音作りの目安を指示文に足す)。省略時は目標の文から読み取る。null なら足さない(共通の目安だけ)。 */
  style?: StyleName | null;
  /** 起こす回数の上限(試験用。既定は無制限)。 */
  maxWakes?: number;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  /** 止める合図(Ctrl+C など)。 */
  signal?: AbortSignal;
}

export interface RunResult {
  wakes: number;
  toolCalls: number;
  ended: boolean;
  stoppedBy: "end" | "signal" | "max_wakes";
}

export async function run(o: RunOptions): Promise<RunResult> {
  const log = o.log ?? ((l: string) => console.log(l));
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRounds = o.maxToolRounds ?? 24;
  const maxResult = o.maxToolResultChars ?? 6000;
  const maxHistory = o.maxHistoryChars ?? 40000;
  const lead = o.leadSeconds ?? 8;
  const pollMs = o.pollMs ?? 1000;
  const tools = toolSpecs(o.toolDetail ?? "compact");
  const style = o.style === undefined ? detectStyle(o.goal) : o.style;
  const status = async (): Promise<PerfStatus | null> => readStatus(await o.send("score.get_status", {}));

  const st0 = await status();
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(style) },
    { role: "user", content: firstUserMessage(o.goal, st0) },
  ];
  const state = { audioRunning: st0?.audioState === "running", seenPromptIds: new Set<number>(), ended: false, wokeWhileIdle: false };
  for (const p of st0?.unackedPrompts ?? []) state.seenPromptIds.add(p.id);
  let wakes = 0;
  let toolCalls = 0;

  /** モデルに考えさせる(ツールを呼ばなくなるまで)。 */
  const think = async (): Promise<void> => {
    for (let round = 0; round < maxRounds; round++) {
      if (o.signal?.aborted) return;
      const reply = await o.llm.chat(trimHistory(messages, 2, maxHistory), tools);
      messages.push({ role: "assistant", content: reply.content, ...(reply.toolCalls.length ? { toolCalls: reply.toolCalls } : {}) });
      if (reply.content.trim()) log(`[モデル] ${reply.content.trim()}`);
      if (reply.toolCalls.length === 0) {
        if (reply.content.includes(END_MARK)) {
          state.ended = true;
          log("[終わり] モデルが演奏の終わりを宣言した。予約が鳴り終わったら終了する");
        }
        return;
      }
      for (const call of reply.toolCalls) {
        toolCalls++;
        const r = await runToolCall(call, o.send, maxResult, (o.toolDetail ?? "compact") === "compact");
        log(`[ツール] ${call.name} ${clip(typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {}), 160)} → ${r.ok ? "ok" : `失敗 ${clip(r.text, 200)}`}`);
        messages.push({ role: "tool", content: r.text, toolCallId: call.id, toolName: call.name });
      }
    }
    log(`[注意] 1 回の起こしでツールを ${maxRounds} 回呼んだので、いったん止めて状態を見る`);
    messages.push({ role: "user", content: "Too many tool calls in a row. Stop, look at the current state and decide the next step." });
  };

  log(`[開始] ${o.llm.describe}。目標: ${o.goal}。曲調: ${style ?? "指定なし(共通の目安だけ)"}`);
  if (!state.audioRunning) log("[待ち] 音声が止まっている。ブラウザで START を押すと演奏を始められる(それまでにパッチを組む)");
  await think();
  wakes++;

  for (;;) {
    if (o.signal?.aborted) return { wakes, toolCalls, ended: state.ended, stoppedBy: "signal" };
    if (o.maxWakes !== undefined && wakes >= o.maxWakes) return { wakes, toolCalls, ended: state.ended, stoppedBy: "max_wakes" };
    await sleep(pollMs);
    const st = await status();
    if (!st) continue;
    if (state.ended && !st.playing && st.unackedPrompts.every((p) => state.seenPromptIds.has(p.id))) {
      log("[終了] 演奏が終わった");
      return { wakes, toolCalls, ended: true, stoppedBy: "end" };
    }
    const reason = wakeReason(st, state, lead);
    state.audioRunning = st.audioState === "running";
    if (st.playing) state.wokeWhileIdle = false;
    if (!reason) continue;
    for (const p of st.unackedPrompts) state.seenPromptIds.add(p.id);
    if (reason === "new_prompt") state.ended = false; // 終わった後でも、人の指示が来たら続ける
    if (reason === "stopped") state.wokeWhileIdle = true;
    log(`[起こす] ${reason}`);
    messages.push({ role: "user", content: wakeMessage(reason, st) });
    await think();
    wakes++;
  }
}
