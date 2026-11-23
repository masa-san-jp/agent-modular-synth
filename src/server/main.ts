// 起動: npm run dev
// 127.0.0.1 だけで待ち受け、URL とエージェント用トークンを表示する(product-spec §3.2、REQ-S-005)。
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalog } from "../control/catalog.js";
import { REGISTRY } from "../modules/registry.js";
import { removeTokenFile, tokenFilePath, writeTokenFile } from "../mcp/token-file.js";
import { createApp } from "./app.js";
import { DEFAULT_PORT, HOST } from "./static.js";

const here = dirname(fileURLToPath(import.meta.url)); // dist/src/server
const webRoot = join(here, "..", "..", "..", "web");
// 待受ポート: 環境変数 PORT(0〜65535 の整数。0 は「空いているポートを自動で選ぶ」)。未設定・空文字なら既定値。
// それ以外の値では起動しない(空文字を 0 と解釈して、意図せず別のポートで待ち受けることがないようにする)。
const portText = process.env.PORT;
const port = portText === undefined || portText === "" ? DEFAULT_PORT : /^[0-9]{1,5}$/.test(portText) ? Number(portText) : NaN;
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`PORT は 0〜65535 の整数で指定する: ${JSON.stringify(portText)}`);
  process.exit(1);
}
// パッチファイルの専用フォルダ(data-contract DAT-30)。場所は**仮の値**:
// 環境変数 SYNTH_PATCH_DIR、なければホームの下の .agent-modular-synth/patches。
// リポジトリの中ではなく、利用者のデータ用の場所に置く。確定は実装計画で行う。
const patchDir = resolve(process.env.SYNTH_PATCH_DIR ?? join(homedir(), ".agent-modular-synth", "patches"));
// 演奏データの専用フォルダ(data-contract §15)。環境変数 SYNTH_PERFORMANCE_DIR、なければホームの下の .agent-modular-synth/performances。
const performanceDir = resolve(process.env.SYNTH_PERFORMANCE_DIR ?? join(homedir(), ".agent-modular-synth", "performances"));
// エージェント用トークンの受け渡し用ファイル(MCP アダプタが読む。docs/mcp-setup.md)。
// 場所は環境変数 SYNTH_TOKEN_FILE、なければ ~/.agent-modular-synth/agent-token。所有者だけが読める(0600)。終了時に消す。
const tokenFile = tokenFilePath(process.env);

const app = createApp({ webRoot, patchDir, performanceDir, catalog: buildCatalog(REGISTRY) });
app.listen(port).then(
  (p) => {
    console.log(`http://${HOST}:${p}/ を開いてください(終了は Ctrl+C)`);
    console.log(`パッチの保存フォルダ: ${patchDir}`);
    console.log(`演奏データの保存フォルダ: ${performanceDir}`);
    console.log("エージェント用API:");
    console.log(`  WebSocket  ws://${HOST}:${p}/api/ws`);
    console.log(`  HTTP       POST http://${HOST}:${p}/api/command`);
    console.log(`  トークン   ${app.agentToken}`);
    console.log("  (要求に Authorization: Bearer <トークン> を付ける。トークンは起動のたびに変わる)");
    try {
      writeTokenFile(tokenFile, app.agentToken);
      console.log(`  トークンのファイル ${tokenFile}(MCP アダプタ用。終了時に消す)`);
    } catch (e) {
      // 書けなくてもサーバーは使える(トークンは上に表示済み。MCP アダプタには SYNTH_AGENT_TOKEN で渡せる)
      console.error(`  トークンのファイル ${tokenFile} を書けませんでした: ${e instanceof Error ? e.message : e}`);
    }
  },
  (e) => {
    console.error(`起動できませんでした: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  },
);

// 終了時にトークンのファイルを消す(自分が書いた内容のままのときだけ)。
process.on("exit", () => removeTokenFile(tokenFile, app.agentToken));
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => process.exit(0));
}
