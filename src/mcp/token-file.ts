// エージェント用トークンのファイル(MCP アダプタがローカルサーバーのトークンを知るための受け渡し)。
// ローカルサーバー(src/server/main.ts)が起動時に書き、終了時に消す。MCP アダプタ(src/mcp/adapter.ts)は
// 環境変数 SYNTH_AGENT_TOKEN がないときにこのファイルを読む。
// 方針: 同じ利用者の権限で動くプログラムは信頼する(plans/decisions.md DEC-014)。ファイルは所有者だけが読める(0600)。
import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** トークンの形(src/server/app.ts の TOKEN_RE と同じ)。 */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,256}$/;

/** ファイルの場所: 環境変数 SYNTH_TOKEN_FILE、なければ利用者データの場所 `~/.agent-modular-synth/agent-token`。 */
export function tokenFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const given = env.SYNTH_TOKEN_FILE;
  return resolve(given !== undefined && given !== "" ? given : join(homedir(), ".agent-modular-synth", "agent-token"));
}

/**
 * トークンを書く(所有者だけが読み書きできる 0600。一時ファイルに書いてから名前を付ける)。
 * フォルダがなければ所有者だけが入れる 0700 で作る。失敗したら例外。
 */
export function writeTokenFile(path: string, token: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${token}\n`, { mode: 0o600, flag: "wx" });
    chmodSync(tmp, 0o600); // umask に関わらず 0600
    renameSync(tmp, path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      // 一時ファイルがない
    }
    throw e;
  }
}

/** 自分が書いたトークンのままなら消す(後から起動した別のサーバーが書き換えたファイルは消さない)。 */
export function removeTokenFile(path: string, token: string): void {
  try {
    if (readFileSync(path, "utf8").trim() === token) unlinkSync(path);
  } catch {
    // ない・読めない: 何もしない
  }
}

export type TokenFileResult = { ok: true; token: string } | { ok: false; reason: "missing" | "unreadable" | "malformed" };

/** トークンを読む。通常のファイルだけを読み、形が合わなければ使わない。 */
export function readTokenFile(path: string): TokenFileResult {
  let text: string;
  try {
    if (!lstatSync(path).isFile()) return { ok: false, reason: "unreadable" };
    text = readFileSync(path, "utf8");
  } catch (e) {
    return { ok: false, reason: (e as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable" };
  }
  const token = text.trim();
  return TOKEN_RE.test(token) ? { ok: true, token } : { ok: false, reason: "malformed" };
}
