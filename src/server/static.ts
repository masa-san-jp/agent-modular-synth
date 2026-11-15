// ローカル配信用の最小サーバー(DEC-103)。127.0.0.1 だけで待ち受け、web/ の静的ファイルを配る。
// エージェント用API・認証・パッチ保存は後続(この段階では静的配信のみ)。
import { createServer, Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

/** 既定の待受ポート(仮の値。既定ポートを固定する理由は product-spec §3.2。番号の確定は実装計画 TASK-502)。 */
export const DEFAULT_PORT = 47800;
export const HOST = "127.0.0.1";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

export function createStaticServer(rootDir: string): Server {
  const root = resolve(rootDir);
  return createServer((req, res) => {
    void (async () => {
      try {
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.writeHead(405).end();
          return;
        }
        const url = new URL(req.url ?? "/", `http://${HOST}`);
        let rel = decodeURIComponent(url.pathname);
        if (rel.endsWith("/")) rel += "index.html";
        const file = normalize(join(root, rel));
        // 配信フォルダの外(上位参照)は拒否する
        if (file !== root && !file.startsWith(root + sep)) {
          res.writeHead(403).end();
          return;
        }
        const body = await readFile(file);
        res.writeHead(200, {
          "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(req.method === "HEAD" ? undefined : body);
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("not found");
      }
    })();
  });
}

export function listen(server: Server, port = DEFAULT_PORT): Promise<number> {
  return new Promise((ok, ng) => {
    server.once("error", ng);
    server.listen(port, HOST, () => {
      const a = server.address();
      ok(typeof a === "object" && a ? a.port : port);
    });
  });
}
