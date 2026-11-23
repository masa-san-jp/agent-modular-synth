// メインスレッド ⇔ AudioWorklet のメッセージ(MessagePort)。
// パッチの正本はメインスレッドの Session。ワークレットへは、全体の置き換えか差分を送る(DEC-105)。
import type { Cable, Patch, PatchModule } from "../control/types.js";

export type EngineOp =
  | { op: "add"; module: PatchModule }
  | { op: "remove"; id: string }
  | { op: "connect"; cable: Cable }
  | { op: "disconnect"; cable: Cable }
  | { op: "param"; id: string; name: string; value: number };

export type ToWorklet =
  | { type: "apply"; patch: Patch; revision: number }
  /** 1コマンド分の差分。次のブロックの先頭でまとめて適用する。 */
  | { type: "ops"; ops: EngineOp[]; revision: number; /** 送った時刻(Date.now())。性能の測定中だけ使う。 */ sentAt?: number }
  /** 性能の測定(ブロックごとの処理時間の集計)を始める・やめる。始めるたびに集計を 0 に戻す。 */
  | { type: "perf"; enabled: boolean }
  | { type: "start" }
  | { type: "stop" }
  | { type: "panic" }
  | { type: "release_panic" }
  | { type: "level"; db: number; actor: "human" | "agent" }
  /**
   * メインスレッド側の写しの状態に合わせる(コマンドではない)。音声の用意ができた直後(それまでの操作の持ち越し)と、
   * 状態のずれを見つけたときに送る。
   */
  | { type: "sync"; levelDb: number; agentMaxLevelDb: number; panic: boolean; running: boolean }
  /** 楽譜の予約(サンプル時刻つきの演奏入力。時刻の昇順)。 */
  | { type: "schedule"; events: { at: number; bytes: number[] }[] }
  /** 予約をすべて捨て、鳴っている音を止める。 */
  | { type: "clear_schedule" }
  /** 演奏入力(画面鍵盤・Web MIDI)。全ての MIDI-CV モジュールへ渡す。コマンド・履歴の対象外(DEC-008)。 */
  | { type: "midi"; bytes: number[] };

export interface WorkletStatus {
  fs: number;
  sampleTime: number;
  running: boolean;
  panic: boolean;
  levelDb: number;
  agentMaxLevelDb: number;
  clipCount: number;
  nonfiniteModules: number;
  nonfiniteOutputStage: number;
  engineRevision: number | null;
  limiterGain: number;
  /** 直近の観測区間の最終出力のピーク。 */
  peak: number;
  /**
   * メーター(MOD-IO-003)の読出し値。モジュールID → 項目名 → 値。ブロックが終わった直後の同一時点の組。
   * 波形フレーム(`frame`)は、前回送ったときから `frame_seq` が変わったモジュールだけに含める。
   */
  meters: Record<string, Record<string, unknown>>;
  /** 性能の測定の集計(測定中だけ)。 */
  perf?: PerfStats;
  /** これまでに受け取って処理したメッセージの数(メインスレッドが、送った分がすべて反映された状態かを見分けるのに使う)。 */
  received: number;
}

/** ブロックごとの処理時間の集計(verification-plan VER-NF-004 の負荷値。負荷値 = 処理時間 ÷ 1 ブロックの再生時間)。 */
export interface PerfStats {
  /** 使った時計("performance.now" か "Date.now"。後者は 1 ms 刻みなので、平均だけが意味を持つ)。 */
  clock: string;
  blocks: number;
  /** 負荷値の平均と最大。 */
  meanLoad: number;
  maxLoad: number;
  /** 負荷値が 1.0 を超えたブロックの数。 */
  over: number;
  /** 負荷値の度数(幅 0.05 ごと。最後の区間はそれ以上すべて)。 */
  histogram: number[];
  /** 差分を送ってから、音声側が適用するまでの時間 [ms](L2)。件数・合計・最大。 */
  applyCount: number;
  applySumMs: number;
  applyMaxMs: number;
}

export type FromWorklet =
  | { type: "status"; status: WorkletStatus }
  /** `resync` が true なら、音声側がパッチの正本とずれた可能性がある(メインスレッドはパッチ全体を渡し直す)。 */
  | { type: "error"; message: string; resync?: boolean };
