// オフラインでの処理速度の測定(verification-plan VER-NF-004 の「補助」。前提環境 TE-1)。
// ブラウザを使わず、製品と同じエンジン・出力保護・コマンド処理で、128 サンプルのブロックを処理する時間を測る。
// 負荷値 = 1 ブロックの処理時間 ÷ 1 ブロックの再生時間(128 / fs)。1.0 を超えると、実時間では間に合わない。
// 注意: ここでの値はエンジン単体の速さで、ブラウザでの音切れの有無を示すものではない(合否は出さない: OPEN-001)。
//
// 使い方: node dist/src/perf/offline.js [--seconds 10] [--json out.json] [--quick]
import { writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { EngineBackend } from "../control/backend.js";
import { buildCatalog } from "../control/catalog.js";
import { Session } from "../control/session.js";
import { REGISTRY } from "../modules/registry.js";
import { BPM_TYPES, BenchOp, bp0, bp1, bpAll, bpM, bpN, bpNModules, bpPoly } from "./patches.js";

const FS = 48000;
const BLOCK = 128;
const CATALOG = buildCatalog(REGISTRY);

export interface LoadStats {
  blocks: number;
  /** 負荷値(処理時間 ÷ 再生時間)。 */
  median: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
  /** 負荷値が 1.0 を超えたブロックの数。 */
  over: number;
  /** オフライン処理速度 = 描画した音声の時間 ÷ 処理時間。 */
  realtimeFactor: number;
  /** 出力のピーク(音が出ていることの確認)。 */
  peak: number;
  modules: number;
}

export function stats(loads: Float64Array, peak: number, modules: number): LoadStats {
  const s = Float64Array.from(loads).sort();
  const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  let sum = 0;
  let over = 0;
  for (const v of s) {
    sum += v;
    if (v > 1) over++;
  }
  const mean = sum / s.length;
  return { blocks: s.length, median: q(0.5), p95: q(0.95), p99: q(0.99), max: s[s.length - 1]!, mean, over, realtimeFactor: 1 / mean, peak, modules };
}

/** パッチを組み、準備区間を捨ててから、測定区間の全ブロックの負荷値を測る。 */
export function measure(ops: BenchOp[], seconds: number, opts: { warmupSeconds?: number; midi?: number[][] } = {}): LoadStats {
  const be = new EngineBackend(FS, REGISTRY);
  // 上限(256 モジュール)を超える規模も測れるよう、測定用に上限を広げる
  const s = new Session({ catalog: CATALOG, backend: be, sessionId: "bench", limits: { modules: 100000, cables: 400000, batchOps: 1000000 } });
  const send = (command: string, args?: Record<string, unknown>): void => {
    const r = s.handle({ v: 1, request_id: "b", command, ...(args ? { args } : {}) }, "human");
    if (!r.ok) throw new Error(`${command}: ${r.error.id} ${r.error.message} ${JSON.stringify(r.error.details)}`);
  };
  if (ops.length > 0) send("batch", { ops });
  send("engine.start");
  send("output.set_level", { level_db: 0 });
  for (const m of opts.midi ?? []) be.midi(m);
  const L = new Float32Array(BLOCK);
  const R = new Float32Array(BLOCK);
  const warm = Math.ceil(((opts.warmupSeconds ?? 2) * FS) / BLOCK);
  for (let i = 0; i < warm; i++) be.processBlock(L, R);
  const n = Math.ceil((seconds * FS) / BLOCK);
  const loads = new Float64Array(n);
  const blockMs = (BLOCK / FS) * 1000;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    be.processBlock(L, R);
    loads[i] = (performance.now() - t0) / blockMs;
    for (let k = 0; k < BLOCK; k += 16) peak = Math.max(peak, Math.abs(L[k]!));
  }
  return stats(loads, peak, s.getPatch().modules.length);
}

const HELD_16 = Array.from({ length: 16 }, (_, i) => [0x90, 48 + i * 2, 100]);

export interface OfflineReport {
  kind: "offline";
  at: string;
  env: Record<string, unknown>;
  seconds: number;
  results: Record<string, LoadStats>;
  /** BP-N: 負荷値の中央値が 1.0 を超えない最大の N(倍々に上げた中での値)と、超えた最小の N。 */
  bpnLimit: { lastUnder: number | null; firstOver: number | null };
  /** BP-M から求めた、種別ごとの 1 個あたりの負荷値(K = 64 と K = 0 の差 ÷ 64)。 */
  perModule: Record<string, number>;
}

export function runOffline(seconds: number, quick: boolean): OfflineReport {
  const results: Record<string, LoadStats> = {};
  const log = (name: string, st: LoadStats): void => {
    results[name] = st;
    console.log(`${name.padEnd(22)} モジュール ${String(st.modules).padStart(5)}  負荷 中央値 ${st.median.toFixed(4)}  95% ${st.p95.toFixed(4)}  99% ${st.p99.toFixed(4)}  最大 ${st.max.toFixed(4)}  実時間の ${st.realtimeFactor.toFixed(1)} 倍  ピーク ${st.peak.toFixed(3)}`);
  };
  log("BP-0", measure(bp0(), seconds));
  log("BP-1", measure(bp1(), seconds, { midi: [[0x90, 60, 100]] }));
  log("BP-POLY", measure(bpPoly(), seconds, { midi: HELD_16 }));
  log("BP-ALL", measure(bpAll(), seconds));
  // BP-N: 倍々に上げ、負荷値の中央値が 1.0 を超えたら止める
  let lastUnder: number | null = null;
  let firstOver: number | null = null;
  for (let n = 1; n <= (quick ? 64 : 4096); n *= 2) {
    const st = measure(bpN(n), Math.min(seconds, n >= 512 ? 3 : seconds), { warmupSeconds: n >= 512 ? 0.5 : 2 });
    log(`BP-N N=${n}`, st);
    if (st.median > 1) {
      firstOver = n;
      break;
    }
    lastUnder = n;
  }
  // BP-M: 種別ごとの 1 個あたりの負荷
  const perModule: Record<string, number> = {};
  const base = measure(bpM("MOD-UTL-001", 0), Math.min(seconds, 3));
  log("BP-M 駆動用のみ", base);
  const ks = quick ? [64] : [1, 16, 64];
  for (const type of BPM_TYPES) {
    for (const k of ks) {
      const st = measure(bpM(type, k), Math.min(seconds, 3), { midi: type === "MOD-IO-002" ? [[0x90, 60, 100]] : [] });
      log(`BP-M ${type} K=${k}`, st);
      if (k === 64) perModule[type] = Math.max(0, (st.mean - base.mean) / 64);
    }
  }
  const c = cpus();
  return {
    kind: "offline",
    at: new Date().toISOString(),
    env: { node: process.version, platform: `${process.platform} ${process.arch}`, cpu: c[0]?.model ?? "不明", cores: c.length, memoryGiB: Math.round(totalmem() / 2 ** 30), fs: FS, block: BLOCK },
    seconds,
    results,
    bpnLimit: { lastUnder, firstOver },
    perModule,
  };
}

function main(): void {
  const arg = (name: string): string | undefined => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const quick = process.argv.includes("--quick");
  const seconds = Number(arg("--seconds") ?? (quick ? 2 : 10));
  const report = runOffline(seconds, quick);
  console.log(`\nBP-N: 中央値が 1.0 以下だった最大の N = ${report.bpnLimit.lastUnder}(モジュール ${report.bpnLimit.lastUnder ? bpNModules(report.bpnLimit.lastUnder) : 0} 個)、超えた最小の N = ${report.bpnLimit.firstOver ?? "なし(測った範囲では超えない)"}`);
  const out = arg("--json");
  if (out) {
    writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
    console.log(`結果を ${out} に書きました`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("offline.js")) main();
