// 手元の LLM(Ollama の gpt-oss:20b など)に、シンセのツールを渡して演奏させる(Issue #55、DEC-027)。
// 製品(サーバーとタブ)の外にある「外からつないだエージェント」の実例。製品の中に推論は入れない(DEC-018)。
//
//   LLM(Ollama / OpenAI 互換) <──HTTP──> このプログラム ──HTTP(127.0.0.1)──> ローカルサーバー ──> タブ(パッチと音声)
//
// ツールは MCP アダプタと同じ定義(src/mcp/tools.ts。エージェントに許されたコマンドだけ)。権限はサーバーが守る
// (音声の開始、緊急停止の解除、パッチの削除、上限を超える音量はできない)。
import { buildRequest, sendCommand } from "../../src/mcp/adapter.js";
import type { AdapterConfig } from "../../src/mcp/adapter.js";
import { TOOLS } from "../../src/mcp/tools.js";
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
  /** Ollama の文脈長(num_ctx)。ツールの説明だけで約 2.6 万文字(JSON)あるので、既定は 32768。 */
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
          options: { num_ctx: o.numCtx ?? 32768, ...(o.temperature !== undefined ? { temperature: o.temperature } : {}) },
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
      return typeof v === "object" && v !== null && !Array.isArray(v) ? { value: v as Obj } : { value: null, error: "引数が JSON のオブジェクトでない" };
    } catch {
      return { value: null, error: "引数が JSON として読めない" };
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) return { value: raw as Obj };
  return { value: null, error: "引数がオブジェクトでない" };
}

// ---------------------------------------------------------------------------------------
// ツール(シンセのコマンド)
// ---------------------------------------------------------------------------------------

/** LLM に渡すツールの一覧(MCP と同じ。エージェントに許されたコマンドだけ)。 */
export function toolSpecs(defs: readonly ToolDef[] = TOOLS): ToolSpec[] {
  return defs.map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema }));
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
  return `${text.slice(0, max)}…(以下 ${text.length - max} 文字を省略。必要なら、引数で範囲を絞って呼び直す)`;
}

/** ツール呼出し 1 件を実行し、モデルに返す文字列を作る。 */
export async function runToolCall(call: ToolCall, send: CommandSender, maxChars: number): Promise<{ text: string; ok: boolean; command: string | null }> {
  const tool = TOOLS.find((t) => t.name === call.name);
  if (!tool) {
    const names = TOOLS.map((t) => t.name).join(", ");
    return { text: JSON.stringify({ ok: false, error: { code: "unknown_tool", message: `ツール ${call.name} はない(使えるのは: ${names})` } }), ok: false, command: null };
  }
  const parsed = parseArgs(call.arguments);
  if (!parsed.value) {
    return { text: JSON.stringify({ ok: false, error: { code: "bad_arguments", message: `${parsed.error}。引数は JSON のオブジェクトで渡す` } }), ok: false, command: tool.command };
  }
  const { expected_revision, idempotency_key, ...args } = parsed.value;
  const envelope: Obj = {};
  if (expected_revision !== undefined) envelope.expected_revision = expected_revision;
  if (idempotency_key !== undefined) envelope.idempotency_key = idempotency_key;
  const res = await send(tool.command, args, envelope);
  return { text: clip(JSON.stringify(res), maxChars), ok: res.ok === true, command: tool.command };
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
  remaining_low: "予約の残りが少なくなった。続きの楽譜を score_play(mode は append)で送る。",
  new_prompt: "人から新しい指示が来た。指示を踏まえた楽譜を送り、ack_prompt にその指示の id を付ける。",
  audio_started: "人が音声を開始した。演奏を始められる。",
  stopped: "演奏が止まっている(予約がない)。続けるなら楽譜を送る。終えるなら [END] とだけ書く。",
};

export function wakeMessage(reason: Exclude<WakeReason, null>, st: PerfStatus): string {
  return `${REASON_TEXT[reason]}\n状態: ${JSON.stringify({ playing: st.playing, remaining: Math.round(st.remaining * 10) / 10, unacked_prompts: st.unackedPrompts, plan: st.plan })}`;
}

// ---------------------------------------------------------------------------------------
// 指示文
// ---------------------------------------------------------------------------------------

export const END_MARK = "[END]";

export function systemPrompt(): string {
  return [
    "あなたはモジュラーシンセの演奏者。ツールでシンセを操作し、楽譜を書いて演奏する。シンセはブラウザのタブの中で動いている。",
    "",
    "# 手順",
    "1. patch_get で今のパッチを見る。足りなければ batch でまとめてモジュールを足し、ケーブルでつなぐ。",
    "   - 音が出る最小の形: MOD-IO-002(MIDI-CV。楽譜を受ける)の PITCH → MOD-OSC-001(VCO)の pitch、VCO の saw → MOD-AMP-001(VCA)の in1、MIDI-CV の GATE → VCA の cv1、VCA の out → 出力 out の IN_L。出力モジュール out(MOD-IO-001)は最初からある。",
    "   - 種別の詳しい中身は module_list_types に type を付けて 1 種ずつ読む(全部を一度に読むと長い)。",
    "2. score_play で楽譜を送る。音符は {t: 開始, dur: 長さ, note: MIDI ノート番号(60 が真ん中のド), vel: 1〜127}。tempo_bpm を付けると t・dur・length の単位が拍になる。length は楽譜の長さ。",
    "   例: {\"tempo_bpm\": 120, \"notes\": [{\"t\": 0, \"dur\": 0.9, \"note\": 57}, {\"t\": 1, \"dur\": 0.9, \"note\": 60}, {\"t\": 2, \"dur\": 0.9, \"note\": 64}, {\"t\": 3, \"dur\": 0.9, \"note\": 67}], \"length\": 4}",
    "   - パラメータを楽譜の中で動かすには params: [{t, dur, module_id, param, value}] を使う。",
    "3. 応答の remaining(予約の末尾までの秒)が尽きる前に、次の楽譜を送る。1 つの楽譜は 8〜30 秒くらいにする。",
    "4. 人からの指示は prompts に届く。acked が false の指示を踏まえた楽譜を送るときは、ack_prompt にその id を付ける。",
    "5. 楽譜を送り終えたら、ツールを呼ばずに、短く何をしたかを書いて待つ。続きが要る時機に、こちらから状態を知らせて起こす。",
    `6. 演奏を終えるときは、最後の楽譜を送った後に ${END_MARK} とだけ書く。`,
    "",
    "# 決まり",
    "- 音声の開始、緊急停止の解除はできない(人だけができる)。audio_state が running でないときは、パッチを組んで待つ。",
    "- ツールの結果は JSON。ok が false なら error.message を読んで直し、もう一度呼ぶ。同じ誤りを 3 回くり返したら、別のやり方にする。",
    "- 音量(output_set_level)は上げすぎない。",
  ].join("\n");
}

export function firstUserMessage(goal: string, st: PerfStatus | null): string {
  return [`演奏の目標: ${goal}`, `今の状態: ${st ? JSON.stringify({ audio_state: st.audioState, playing: st.playing, remaining: st.remaining, plan: st.plan }) : "読めなかった"}`, "まずパッチを確かめて、演奏を始める。"].join("\n");
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
  const tools = toolSpecs();
  const status = async (): Promise<PerfStatus | null> => readStatus(await o.send("score.get_status", {}));

  const st0 = await status();
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt() },
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
        const r = await runToolCall(call, o.send, maxResult);
        log(`[ツール] ${call.name} ${clip(typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {}), 160)} → ${r.ok ? "ok" : `失敗 ${clip(r.text, 200)}`}`);
        messages.push({ role: "tool", content: r.text, toolCallId: call.id, toolName: call.name });
      }
    }
    log(`[注意] 1 回の起こしでツールを ${maxRounds} 回呼んだので、いったん止めて状態を見る`);
    messages.push({ role: "user", content: "ツールの呼出しが多すぎる。いったん止めて、今の状態から次の一手を考える。" });
  };

  log(`[開始] ${o.llm.describe}。目標: ${o.goal}`);
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
