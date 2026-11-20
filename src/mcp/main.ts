#!/usr/bin/env node
// MCP アダプタの起動(stdio)。MCP クライアントがこのプログラムを子プロセスとして起動する。
//   node dist/src/mcp/main.js
// 環境変数: SYNTH_URL(既定 http://127.0.0.1:47800)、SYNTH_AGENT_TOKEN(なければ SYNTH_TOKEN_FILE、
// 既定 ~/.agent-modular-synth/agent-token を呼出しのたびに読む)、SYNTH_CLIENT_ID(既定 mcp)。
// 標準出力は MCP の通信に使うので、案内は標準エラーへ書く。
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, createMcpServer, resolveConfig } from "./adapter.js";

async function main(): Promise<void> {
  let config;
  try {
    config = resolveConfig(process.env);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    console.error(`agent-modular-synth MCP アダプタ: 起動できません: ${e.message}`);
    process.exit(2);
  }
  const server = createMcpServer(config);
  await server.connect(new StdioServerTransport());
  console.error(`agent-modular-synth MCP アダプタ: 接続先 ${config.endpoint}(トークン: ${config.token !== null ? "環境変数" : config.tokenFile})`);
}

main().catch((e) => {
  console.error(`agent-modular-synth MCP アダプタ: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
