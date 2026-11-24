// 演奏データを音声ファイル(WAV)に書き出す、別スレッドの処理(サーバーの受け答えを止めないため)。
// 親(render-jobs.ts)から、演奏データの文字列・設定・出力先を受け取り、進み具合と結果を返す。
import { closeSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import { CommandError } from "../control/errors.js";
import { RenderOptions, RenderSummary, renderPerformance } from "../control/render.js";
import { REGISTRY } from "../modules/registry.js";

export interface RenderWorkerInput {
  text: string;
  options: RenderOptions;
  /** 出力先の WAV ファイル(絶対パス)。同じフォルダの一時ファイルへ書いてから、入れ替える。 */
  outPath: string;
}
export type RenderWorkerMessage =
  | { t: "progress"; done: number; total: number }
  | { t: "done"; summary: RenderSummary; bytes: number }
  | { t: "failed"; error: { id: string | null; message: string; details: Record<string, unknown> } };

/** 16 ビット・ステレオの WAV の先頭 44 バイト。 */
export function wavHeader(fs: number, frames: number): Buffer {
  const b = Buffer.alloc(44);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + frames * 4, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(2, 22); // ステレオ
  b.writeUInt32LE(fs, 24);
  b.writeUInt32LE(fs * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(frames * 4, 40);
  return b;
}

/** 演奏データを WAV に書き出す(このスレッドで実行する。CLI からも使う)。 */
export async function renderToFile(input: RenderWorkerInput, onProgress?: (done: number, total: number) => void): Promise<{ summary: RenderSummary; bytes: number }> {
  const tmp = `${input.outPath}.tmp-${process.pid}-${Date.now()}`;
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeSync(fd, Buffer.alloc(44));
    const buf = Buffer.alloc(1 << 16);
    let used = 0;
    const summary = await renderPerformance(
      input.text,
      REGISTRY,
      input.options,
      (l, r, n) => {
        for (let i = 0; i < n; i++) {
          if (used === buf.length) {
            writeSync(fd, buf, 0, used);
            used = 0;
          }
          buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l[i]!)) * 32767), used);
          buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r[i]!)) * 32767), used + 2);
          used += 4;
        }
      },
      onProgress,
    );
    if (used > 0) writeSync(fd, buf, 0, used);
    writeSync(fd, wavHeader(summary.fs, summary.frames), 0, 44, 0);
    closeSync(fd);
    renameSync(tmp, input.outPath);
    return { summary, bytes: 44 + summary.frames * 4 };
  } catch (e) {
    try {
      closeSync(fd);
    } catch {
      // 既に閉じている
    }
    rmSync(tmp, { force: true });
    throw e;
  }
}

if (parentPort && workerData && typeof (workerData as RenderWorkerInput).outPath === "string") {
  const port = parentPort;
  const post = (m: RenderWorkerMessage): void => port.postMessage(m);
  renderToFile(workerData as RenderWorkerInput, (done, total) => post({ t: "progress", done, total })).then(
    (r) => post({ t: "done", summary: r.summary, bytes: r.bytes }),
    (e: unknown) =>
      post({
        t: "failed",
        error: e instanceof CommandError ? { id: e.id, message: e.message, details: e.details } : { id: null, message: e instanceof Error ? e.message : String(e), details: {} },
      }),
  );
}
