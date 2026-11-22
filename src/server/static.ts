// ローカル配信用の最小サーバー(DEC-103)。127.0.0.1 だけで待ち受け、web/ の静的ファイルを配る。
// エージェント用API・認証・パッチ保存は src/server/app.ts(このファイルは静的配信だけ)。
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

/** 既定の待受ポート(仮の値。既定ポートを固定する理由は product-spec §3.2。番号の確定は実装計画 TASK-502)。 */
export const DEFAULT_PORT = 47800;
export const HOST = "127.0.0.1";

/**
 * すべての応答に付けるヘッダ。画面を他のページの枠(iframe 等)に入れさせない:
 * 透明な枠に重ねてクリックさせる方法で、人のみの操作(音声開始、緊急停止の解除、パッチの削除)を実行させないため。
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
};

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

export interface StaticOptions {
  /** index.html を配るときに本文を書き換える(タブ用トークンの埋め込みに使う)。 */
  transformIndex?: (html: string) => string;
}

export type StaticHandler = (req: IncomingMessage, res: ServerResponse) => void;

export function createStaticServer(rootDir: string): Server {
  return createServer(createStaticHandler(rootDir));
}

/** 静的配信の処理だけを返す(サーバー本体 app.ts が使う)。 */
export function createStaticHandler(rootDir: string, options: StaticOptions = {}): StaticHandler {
  const root = resolve(rootDir);
  const indexFile = join(root, "index.html");
  return (req, res) => {
    void (async () => {
      try {
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.writeHead(405, SECURITY_HEADERS).end();
          return;
        }
        const url = new URL(req.url ?? "/", `http://${HOST}`);
        let rel = decodeURIComponent(url.pathname);
        if (rel.endsWith("/")) rel += "index.html";
        const file = normalize(join(root, rel));
        // 配信フォルダの外(上位参照)は拒否する
        if (file !== root && !file.startsWith(root + sep)) {
          res.writeHead(403, SECURITY_HEADERS).end();
          return;
        }
        let body: Buffer = await readFile(file);
        if (options.transformIndex && file === indexFile) {
          body = Buffer.from(options.transformIndex(body.toString("utf8")), "utf8");
        }
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
        });
        res.end(req.method === "HEAD" ? undefined : body);
      } catch {
        if (res.headersSent) {
          res.end();
          return;
        }
        res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" }).end("not found");
      }
    })();
  };
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
