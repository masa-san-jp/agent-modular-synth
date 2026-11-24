// 演奏データの音声ファイルへの書き出し(operation-contract CMD-34)の、順番待ちと結果の管理。
// 書き出しは別スレッド(render-worker.ts)で 1 つずつ行う。出力は、演奏データと同じフォルダの `<名前>.wav`。
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { RENDER_LIMITS, RenderOptions } from "../control/render.js";
import type { StoreResult } from "../control/store.js";
import type { FilePatchStore } from "./file-store.js";
import type { RenderWorkerInput, RenderWorkerMessage } from "./render-worker.js";

export type RenderState =
  | { status: "queued" | "rendering"; progress: number }
  | { status: "done"; file: string; path: string; bytes: number; fs: number; seconds: number; peak: number; clip_count: number; scores: number; level_db: number; tail_seconds: number }
  | { status: "failed"; error: { id: string | null; message: string; details: Record<string, unknown> } };

interface Job {
  name: string;
  /** 演奏データの更新時刻・大きさ・設定。変わっていたら、書き出し直す。 */
  signature: string;
  input: RenderWorkerInput;
  state: RenderState;
}

export class RenderJobs {
  private readonly jobs = new Map<string, Job>();
  private readonly queue: Job[] = [];
  private running: { job: Job; worker: Worker } | null = null;
  private closed = false;

  constructor(
    private readonly store: FilePatchStore,
    private readonly workerUrl: URL = new URL("./render-worker.js", import.meta.url),
  ) {}

  /**
   * 書き出しを頼む、または進み具合を聞く。同じ演奏データ・同じ設定で既に書き出してあれば、その結果を返す(書き出し直さない)。
   * 失敗した書き出しは、結果を 1 回返したら忘れる(もう一度頼めば、やり直す)。
   */
  async request(name: string, options: RenderOptions): Promise<StoreResult<RenderState>> {
    const read = await this.store.read(name);
    if (!read.ok) return read;
    const signature = JSON.stringify([read.value.info.modified_at, read.value.info.bytes, options.levelDb, options.tailSeconds]);
    const outPath = join(this.store.dir, `${name}.wav`);
    const known = this.jobs.get(name);
    if (known && known.signature === signature) {
      if (known.state.status === "failed") this.jobs.delete(name);
      if (known.state.status !== "done" || (await stat(outPath).then((s) => s.isFile(), () => false))) return { ok: true, value: known.state };
    }
    if (known && (known.state.status === "queued" || known.state.status === "rendering")) {
      // 演奏が続いていて演奏データが変わった: 今の書き出しが終わってから、頼み直してもらう
      return { ok: true, value: known.state };
    }
    if (this.queue.length + (this.running ? 1 : 0) >= RENDER_LIMITS.maxJobs) return { ok: false, error: "too_many" };
    const job: Job = { name, signature, input: { text: read.value.text, options, outPath }, state: { status: "queued", progress: 0 } };
    this.jobs.set(name, job);
    this.queue.push(job);
    this.next();
    return { ok: true, value: job.state };
  }

  private next(): void {
    if (this.running || this.closed) return;
    const job = this.queue.shift();
    if (!job) return;
    job.state = { status: "rendering", progress: 0 };
    const worker = new Worker(this.workerUrl, { workerData: job.input });
    this.running = { job, worker };
    const finish = (state: RenderState): void => {
      if (this.running?.job !== job) return;
      job.state = state;
      job.input = { ...job.input, text: "" }; // 演奏データの文字列は、もう要らない
      this.running = null;
      void worker.terminate();
      this.next();
    };
    worker.on("message", (m: RenderWorkerMessage) => {
      if (m.t === "progress") {
        if (job.state.status === "rendering") job.state = { status: "rendering", progress: m.total > 0 ? Math.min(1, m.done / m.total) : 1 };
      } else if (m.t === "done") {
        finish({ status: "done", file: `${job.name}.wav`, path: job.input.outPath, bytes: m.bytes, ...m.summary });
      } else finish({ status: "failed", error: m.error });
    });
    worker.on("error", (e) => finish({ status: "failed", error: { id: null, message: e instanceof Error ? e.message : String(e), details: {} } }));
    worker.on("exit", () => finish({ status: "failed", error: { id: null, message: "書き出しが途中で止まった", details: {} } }));
  }

  /** 実行中の書き出しを止め、順番待ちを捨てる(サーバーの終了時)。 */
  async close(): Promise<void> {
    this.closed = true;
    this.queue.length = 0;
    const r = this.running;
    this.running = null;
    if (r) await r.worker.terminate();
  }
}
