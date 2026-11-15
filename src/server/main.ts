// 起動: npm run dev
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT, HOST, createStaticServer, listen } from "./static.js";

const here = dirname(fileURLToPath(import.meta.url)); // dist/src/server
const webRoot = join(here, "..", "..", "..", "web");
const port = Number(process.env.PORT ?? DEFAULT_PORT);
const server = createStaticServer(webRoot);
listen(server, port).then(
  (p) => console.log(`http://${HOST}:${p}/ を開いてください(終了は Ctrl+C)`),
  (e) => {
    console.error(`起動できませんでした: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  },
);
