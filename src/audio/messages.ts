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
  | { type: "ops"; ops: EngineOp[]; revision: number }
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
  /** これまでに受け取って処理したメッセージの数(メインスレッドが、送った分がすべて反映された状態かを見分けるのに使う)。 */
  received: number;
}

export type FromWorklet =
  | { type: "status"; status: WorkletStatus }
  /** `resync` が true なら、音声側がパッチの正本とずれた可能性がある(メインスレッドはパッチ全体を渡し直す)。 */
  | { type: "error"; message: string; resync?: boolean };
