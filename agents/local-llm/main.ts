#!/usr/bin/env node
// 手元の LLM に演奏させる(Issue #55、DEC-027)。使い方は docs/local-llm-agent.md。
//   npm run agent:local -- "暗いテクノを 3 分"
//   npm run agent:local -- --api openai --llm-url http://127.0.0.1:1234/v1 --model qwen2.5-7b-instruct "静かなアンビエント"
//
// 設定(引数が環境変数より優先):
//   --api ollama|openai     LLM_API        既定 ollama
//   --llm-url <URL>         LLM_URL        既定 ollama: http://127.0.0.1:11434 / openai: http://127.0.0.1:1234/v1
//   --model <名前>          LLM_MODEL      既定 gpt-oss:20b
//   --num-ctx <数>          LLM_NUM_CTX    Ollama の文脈長。既定 16384
//   --temperature <数>      LLM_TEMPERATURE
//   --tools compact|full    LLM_TOOLS      ツールの説明の詳しさ。既定 compact(約 4 千トークン。full は MCP と同じで約 1.1 万)
//   LLM_API_KEY             OpenAI 互換の API の鍵(要るときだけ)
//   SYNTH_URL、SYNTH_AGENT_TOKEN、SYNTH_TOKEN_FILE: シンセの接続先とトークン(MCP アダプタと同じ。既定はサーバーが書くトークンのファイル)
//   SYNTH_CLIENT_ID         既定 local-llm(画面の変更の履歴に出る名前)
import { ConfigError, resolveConfig } from "../../src/mcp/adapter.js";
import { contextBudget, createLlmClient, httpSender, run } from "./runner.js";
import type { ApiKind, ToolDetail } from "./runner.js";

function parseArgv(argv: string[]): { flags: Record<string, string>; rest: string[] } {
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") flags.help = "1";
    else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else flags[a.slice(2)] = argv[++i] ?? "";
    } else rest.push(a);
  }
  return { flags, rest };
}

const HELP = `使い方: npm run agent:local -- [オプション] "演奏の目標"

  --api ollama|openai   LLM の API の種類(既定 ollama)
  --llm-url <URL>       LLM の接続先(既定 ollama: http://127.0.0.1:11434、openai: http://127.0.0.1:1234/v1)
  --model <名前>        モデル(既定 gpt-oss:20b)
  --num-ctx <数>        Ollama の文脈長(既定 16384)
  --temperature <数>    温度
  --tools compact|full  ツールの説明の詳しさ(既定 compact: 約 4 千トークン。full は MCP と同じで約 1.1 万トークン)

先に npm run dev でシンセを起動し、ブラウザで開いて START を押しておく(音声を始められるのは人だけ)。
終了は Ctrl+C(予約済みの楽譜は最後まで鳴る)。`;

async function main(): Promise<void> {
  const { flags, rest } = parseArgv(process.argv.slice(2));
  if (flags.help) {
    console.log(HELP);
    return;
  }
  const env = process.env;
  const api = (flags.api ?? env.LLM_API ?? "ollama") as ApiKind;
  if (api !== "ollama" && api !== "openai") {
    console.error(`--api は ollama か openai: ${api}`);
    process.exit(2);
  }
  const baseUrl = flags["llm-url"] ?? env.LLM_URL ?? (api === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234/v1");
  const model = flags.model ?? env.LLM_MODEL ?? "gpt-oss:20b";
  const numCtx = Number(flags["num-ctx"] ?? env.LLM_NUM_CTX ?? 16384);
  const toolDetail = (flags.tools ?? env.LLM_TOOLS ?? "compact") as ToolDetail;
  if (toolDetail !== "compact" && toolDetail !== "full") {
    console.error(`--tools は compact か full: ${toolDetail}`);
    process.exit(2);
  }
  const tRaw = flags.temperature ?? env.LLM_TEMPERATURE;
  const temperature = tRaw !== undefined ? Number(tRaw) : undefined;
  const goal = rest.join(" ").trim() || "自由に、数分の曲を演奏する";
  try {
    new URL(baseUrl);
  } catch {
    console.error(`LLM の接続先が URL として読めない: ${baseUrl}`);
    process.exit(2);
  }
  if (!Number.isFinite(numCtx) || numCtx < 1024) {
    console.error(`--num-ctx は 1024 以上の数: ${flags["num-ctx"] ?? env.LLM_NUM_CTX}`);
    process.exit(2);
  }
  let synth;
  try {
    synth = resolveConfig({ ...env, SYNTH_CLIENT_ID: env.SYNTH_CLIENT_ID || "local-llm" });
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    console.error(`シンセの接続先の設定が誤っている: ${e.message}`);
    process.exit(2);
  }
  const llm = createLlmClient({ api, baseUrl, model, numCtx, ...(temperature !== undefined && Number.isFinite(temperature) ? { temperature } : {}), ...(env.LLM_API_KEY ? { apiKey: env.LLM_API_KEY } : {}) });
  const ac = new AbortController();
  process.on("SIGINT", () => {
    if (ac.signal.aborted) process.exit(130);
    console.log("\n[停止] Ctrl+C を受けた。今の一手が終わったら止める(もう一度押すとすぐ止める)");
    ac.abort();
  });
  const budget = contextBudget(numCtx, toolDetail);
  console.log(`シンセ: ${synth.endpoint}(名前 ${synth.clientId})`);
  console.log(`文脈: ${numCtx} トークン(ツールの説明 ${toolDetail} と指示文で約 ${budget.fixedTokens}、会話の履歴は ${budget.historyChars} 文字まで)`);
  if (budget.tight) console.log(`[注意] 文脈長 ${numCtx} では、会話の履歴をほとんど残せない。--num-ctx を ${budget.fixedTokens + 2048 + 8192} 以上にすることを勧める`);
  const r = await run({ llm, send: httpSender(synth), goal, toolDetail, maxHistoryChars: budget.historyChars, maxToolResultChars: budget.toolResultChars, signal: ac.signal });
  console.log(`[結果] 起こした回数 ${r.wakes}、ツール呼出し ${r.toolCalls}、終わり方 ${r.stoppedBy}`);
}

main().catch((e) => {
  console.error(`止まった: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
