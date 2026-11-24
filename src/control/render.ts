// 演奏データを、実際に演奏せずに音声へ書き出す(operation-contract CMD-34、data-contract §15)。
// 再演奏(performance.replay)と同じ処理を、音声の出口につながないエンジンで、実時間より速く回す。
// 同じ演奏データ・同じ設定からは、いつも同じサンプルの並びになる。
import { EngineBackend } from "./backend.js";
import { buildCatalog } from "./catalog.js";
import { Controller } from "./controller.js";
import { CommandError } from "./errors.js";
import { checkKeys, patchNameArg } from "./library.js";
import { SCORE_LIMITS } from "./performance.js";
import { LEVEL_MAX_DB, LEVEL_MIN_DB, Session } from "./session.js";
import type { PatchStore, StoreResult } from "./store.js";
import type { ModuleFactory } from "../engine/module.js";

export const RENDER_LIMITS = {
  /** 書き出せる演奏の長さの上限 [秒](余韻を含まない)。[暫定値] */
  maxSeconds: 1800,
  /** 余韻(演奏の終わりの後に足す時間)の上限 [秒]。 */
  maxTailSeconds: 30,
  /** 同時に待たせられる書き出しの数(実行中を含む)。 */
  maxJobs: 4,
} as const;
export const RENDER_DEFAULTS = { levelDb: -6, tailSeconds: 2 } as const;

export interface RenderOptions {
  /** マスター音量 [dB]。演奏データは音量を持たないので、書き出すときに決める。 */
  levelDb: number;
  /** 演奏の終わりの後に足す時間 [秒](残響や音の消え際のため)。 */
  tailSeconds: number;
}

/** performance.render の引数(`name` を除く)を確かめる。ERR-003(型・未知の引数)→ ERR-123(範囲)。 */
export function parseRenderArgs(args: Record<string, unknown>): { name: string; options: RenderOptions } {
  checkKeys(args, ["name", "level_db", "tail_seconds"]);
  const name = patchNameArg(args);
  const num = (key: string, fallback: number, min: number, max: number): number => {
    if (!(key in args)) return fallback;
    const v = args[key];
    if (typeof v !== "number" || !Number.isFinite(v)) throw new CommandError("ERR-003", `${key} は数値`, { arg: key, reason: "type" });
    if (v < min || v > max) throw new CommandError("ERR-123", `${key} は ${min}〜${max} の範囲`, { arg: key, value: v, min, max });
    return v;
  };
  return {
    name,
    options: {
      levelDb: num("level_db", RENDER_DEFAULTS.levelDb, LEVEL_MIN_DB, LEVEL_MAX_DB),
      tailSeconds: num("tail_seconds", RENDER_DEFAULTS.tailSeconds, 0, RENDER_LIMITS.maxTailSeconds),
    },
  };
}

export interface RenderSummary {
  fs: number;
  /** 書き出したサンプル数(左右それぞれ)。 */
  frames: number;
  seconds: number;
  /** 出力の最大の絶対値(1.0 がフルスケール)。 */
  peak: number;
  /** 最終クリップ(出力保護が頭を抑えた)サンプル数。 */
  clip_count: number;
  scores: number;
  level_db: number;
  tail_seconds: number;
}

/** 演奏データの文字列 1 つだけを持つ、読み出し専用の保存先(書き込みは捨てる)。 */
function oneFileStore(name: string, text: string): PatchStore {
  const info = { name, bytes: text.length, modified_at: "1970-01-01T00:00:00Z" };
  return {
    list: () => Promise.resolve({ ok: true, value: [info] }),
    read: (n) => Promise.resolve(n === name ? { ok: true, value: { text, info } } : { ok: false, error: "not_found" }),
    write: () => Promise.resolve({ ok: true, value: info }) as Promise<StoreResult<typeof info>>,
    remove: () => Promise.resolve({ ok: false, error: "failed" }),
  };
}

const BLOCK = 128;

/**
 * 演奏データ(JSON の文字列)を音声にする。`onBlock` に、左右のサンプル(-1〜1。`n` 個が有効)を順に渡す。
 * 失敗(形式・パッチ・楽譜の不正、長すぎる)は CommandError を投げる(performance.replay と同じエラー)。
 */
export async function renderPerformance(
  text: string,
  registry: ReadonlyMap<string, ModuleFactory>,
  options: RenderOptions,
  onBlock: (left: Float32Array, right: Float32Array, n: number) => void,
  onProgress?: (done: number, total: number) => void,
): Promise<RenderSummary> {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    doc = null;
  }
  const d = (doc !== null && typeof doc === "object" ? doc : {}) as Record<string, unknown>;
  const fs = d.fs;
  const length = d.length_seconds;
  const bad = (path: string, message: string): CommandError => new CommandError("ERR-204", `演奏データが不正: ${message}`, { issues: [{ rule: "DAT-V19", path, message }] });
  if (doc !== null && typeof doc === "object") {
    if (typeof fs !== "number" || !Number.isFinite(fs) || fs < 8000 || fs > 192000) throw bad("fs", "fs(8000〜192000 の数値)が要る");
    if (typeof length !== "number" || !Number.isFinite(length) || length < 0) throw bad("length_seconds", "length_seconds(0 以上の数値)が要る");
    if (length > RENDER_LIMITS.maxSeconds) {
      throw new CommandError("ERR-106", `書き出せる演奏の長さは ${RENDER_LIMITS.maxSeconds} 秒まで`, { limit: "render_seconds", max: RENDER_LIMITS.maxSeconds, value: length });
    }
  }
  const rate = typeof fs === "number" ? fs : 48000;
  const be = new EngineBackend(rate, registry);
  const session = new Session({ catalog: buildCatalog(registry, rate), backend: be, sessionId: "render" });
  const none = oneFileStore("-", "");
  const c = new Controller({ session, store: none, performanceStore: oneFileStore("render", text), now: () => 0 });
  let seq = 0;
  const send = async (command: string, args?: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const r = await c.handle({ v: 1, request_id: `render-${++seq}`, command, ...(args ? { args } : {}) }, "human");
    if (!r.ok) throw new CommandError(r.error.id as ConstructorParameters<typeof CommandError>[0], r.error.message, r.error.details ?? {});
    return r.result as Record<string, unknown>;
  };
  await send("engine.start");
  // 形式・版・パッチ・各楽譜の検証は、再演奏と同じ(失敗はここで出る)
  const replay = await send("performance.replay", { name: "render" });
  // パッチの置き換えで音量は既定へ下がる(§2.4)ので、音量はその後に決める
  await send("output.set_level", { level_db: options.levelDb });

  const lead = Math.round(SCORE_LIMITS.leadSeconds * rate);
  const body = Math.round((length as number) * rate);
  const tail = Math.round(options.tailSeconds * rate);
  const total = body + tail;
  const L = new Float32Array(BLOCK);
  const R = new Float32Array(BLOCK);
  let peak = 0;
  const run = (samples: number, keep: boolean, base: number): void => {
    for (let done = 0; done < samples; ) {
      const n = Math.min(BLOCK, samples - done);
      const l = n === BLOCK ? L : L.subarray(0, n);
      const r = n === BLOCK ? R : R.subarray(0, n);
      be.processBlock(l, r);
      if (keep) {
        for (let i = 0; i < n; i++) {
          const a = Math.abs(l[i]!);
          const b = Math.abs(r[i]!);
          if (a > peak) peak = a;
          if (b > peak) peak = b;
        }
        onBlock(l, r, n);
      }
      done += n;
      if (keep && onProgress && ((base + done) % (BLOCK * 256) < BLOCK || base + done === total)) onProgress(base + done, total);
    }
  };
  run(lead, false, 0); // 予約から演奏の先頭までの間(0.1 秒)は、書き出しに入れない
  run(body, true, 0);
  // 元の演奏が途中で止められていたら、同じ位置で止める。演奏し終えたら、楽譜が動かしたパラメータをパッチの値へ戻す(実際の演奏と同じ)
  if (d.ended_by !== null && d.ended_by !== undefined && d.ended_by !== "finished") await send("score.stop");
  else session.pollBackend();
  run(tail, true, body);
  return {
    fs: rate,
    frames: total,
    seconds: total / rate,
    peak,
    clip_count: be.status().clipCount,
    scores: replay.scores as number,
    level_db: options.levelDb,
    tail_seconds: options.tailSeconds,
  };
}
