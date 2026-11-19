// 起動: npm run dev
// 127.0.0.1 だけで待ち受け、URL とエージェント用トークンを表示する(product-spec §3.2、REQ-S-005)。
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalog } from "../control/catalog.js";
import { REGISTRY } from "../modules/registry.js";
import { createApp } from "./app.js";
import { DEFAULT_PORT, HOST } from "./static.js";

const here = dirname(fileURLToPath(import.meta.url)); // dist/src/server
const webRoot = join(here, "..", "..", "..", "web");
const port = Number(process.env.PORT ?? DEFAULT_PORT);
// パッチファイルの専用フォルダ(data-contract DAT-30)。場所は**仮の値**:
// 環境変数 SYNTH_PATCH_DIR、なければホームの下の .agent-modular-synth/patches。
// リポジトリの中ではなく、利用者のデータ用の場所に置く。確定は実装計画で行う。
const patchDir = resolve(process.env.SYNTH_PATCH_DIR ?? join(homedir(), ".agent-modular-synth", "patches"));

const app = createApp({ webRoot, patchDir, catalog: buildCatalog(REGISTRY) });
app.listen(port).then(
  (p) => {
    console.log(`http://${HOST}:${p}/ を開いてください(終了は Ctrl+C)`);
    console.log(`パッチの保存フォルダ: ${patchDir}`);
    console.log("エージェント用API:");
    console.log(`  WebSocket  ws://${HOST}:${p}/api/ws`);
    console.log(`  HTTP       POST http://${HOST}:${p}/api/command`);
    console.log(`  トークン   ${app.agentToken}`);
    console.log("  (要求に Authorization: Bearer <トークン> を付ける。トークンは起動のたびに変わる)");
  },
  (e) => {
    console.error(`起動できませんでした: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  },
);
