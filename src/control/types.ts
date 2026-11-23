// 操作契約(operation-contract v0.3)とデータ契約(data-contract v0.3)の型。
// パッチグラフ(§3〜§5)、要求と応答の封筒(§3)、エラー、通知(§10)。

/** 操作者の種別。受け口が決める(operation-contract §3.1)。要求からは指定できない。 */
export type ActorKind = "human" | "agent";

export type AudioState = "stopped" | "running" | "suspended";

// ---- パッチ(data-contract §3〜§5) ----

export interface PortRef {
  module: string;
  port: string;
}

export interface Cable {
  id: string;
  from: PortRef;
  to: PortRef;
}

/** UI情報(DAT-10/11)。x・y のほか、未知のキーは保持する。 */
export type ModuleUi = Record<string, unknown>;

export interface PatchModule {
  id: string;
  /** 仕様ID(例: MOD-OSC-001)。 */
  type: string;
  spec_version: string;
  /** 全パラメータ(DAT-07)。 */
  params: Record<string, number>;
  ui?: ModuleUi;
}

export interface SavedBy {
  kind: ActorKind;
  client_id?: string;
}

export interface PatchMeta {
  title: string;
  description: string;
  created_at?: string;
  modified_at?: string;
  saved_by?: SavedBy;
  app_version?: string;
}

export interface Patch {
  format: "modular-synth-patch";
  schema_version: number;
  meta: PatchMeta;
  modules: PatchModule[];
  cables: Cable[];
}

// ---- 要求(§3.1) ----

export interface CommandRequest {
  v: 1;
  request_id: string;
  command: string;
  args?: Record<string, unknown>;
  expected_revision?: number;
  idempotency_key?: string;
  client_id?: string;
}

// ---- 応答(§3.2) ----

export interface ActorInfo {
  kind: ActorKind;
  client_id?: string;
}

export type WarningCode = "type_mismatch" | "duplicate_seed" | "migrated" | "param_defaulted" | "no_midi_module" | "patch_changes_ignored";

export interface Warning {
  code: WarningCode;
  message: string;
  details: Record<string, unknown>;
}

export interface ErrorBody {
  /** `ERR-nnn`。 */
  id: string;
  /** §5 の名前。 */
  code: string;
  /** 人向けの説明(文言は契約外)。 */
  message: string;
  details: Record<string, unknown>;
}

interface ResponseBase {
  v: 1;
  /** 要求の request_id。封筒が壊れていて読めないときは null。 */
  request_id: string | null;
  /** 要求の command。封筒が壊れていて読めないときは null。 */
  command: string | null;
  /** 応答時点の現在のリビジョン。 */
  revision: number;
  session_id: string;
  actor: ActorInfo;
  audio_state: AudioState;
  replayed: boolean;
}

export interface SuccessResponse extends ResponseBase {
  ok: true;
  warnings: Warning[];
  result: Record<string, unknown>;
}

export interface FailureResponse extends ResponseBase {
  ok: false;
  error: ErrorBody;
}

export type CommandResponse = SuccessResponse | FailureResponse;

export interface HistoryFlags {
  can_undo: boolean;
  can_redo: boolean;
}

// ---- 通知(§10) ----

/** EVT-01 の `changes` の要素。 */
export type Change =
  | { kind: "module_added"; module: PatchModule }
  | { kind: "module_removed"; module_id: string }
  | { kind: "cable_added"; cable: Cable }
  | { kind: "cable_removed"; cable_id: string }
  | { kind: "param_changed"; module_id: string; param: string; value: number }
  /** `ui` は取り消しで「位置なし」へ戻るとき null。 */
  | { kind: "module_moved"; module_id: string; ui: ModuleUi | null }
  | { kind: "meta_changed"; meta: PatchMeta }
  | { kind: "patch_replaced" };

export type OutputChangeReason = "set_level" | "panic" | "release_panic" | "reset_to_default";

export interface NonfiniteDetail {
  modules: number;
  output_stage: number;
}

interface EventBase {
  v: 1;
  session_id: string;
}

/** EVT-01 */
export interface PatchChangedEvent extends EventBase {
  event: "patch.changed";
  data: {
    revision: number;
    previous_revision: number;
    actor: ActorInfo;
    command: string;
    request_id: string;
    changes: Change[];
  };
}

/** EVT-02 */
export interface EngineStateChangedEvent extends EventBase {
  event: "engine.state_changed";
  data: { audio_state: AudioState; fs: number | null; midi: { available: boolean } };
}

/** EVT-03 */
export interface OutputChangedEvent extends EventBase {
  event: "output.changed";
  data: {
    level_db: number;
    agent_max_level_db: number;
    panic: boolean;
    /** アプリ起因(自動復帰、fs の変更)のとき null。 */
    actor: ActorInfo | null;
    reason: OutputChangeReason;
  };
}

/** EVT-04 */
export interface EngineDiagnosticEvent extends EventBase {
  event: "engine.diagnostic";
  data: { nonfinite_count: number; nonfinite_detail: NonfiniteDetail; clip_count: number };
}

/**
 * Session が出す通知。`seq`(接続ごとの連番。§10)は接続を持つ輸送層が付けるので、ここにはない。
 * EVT-05(session.changed)はサーバー、EVT-06(library.changed)はファイル保存の実装が出す。
 */
/** 演奏の状態(CMD-28 の返値、EVT-07 の中身)。時間は秒。 */
export interface PerformanceStatus {
  /** 予約済み(演奏中を含む)の楽譜があるか。 */
  playing: boolean;
  /** 予約の末尾までの残り時間 [秒](なければ 0)。次の楽譜は、これが尽きる前に送る。 */
  remaining: number;
  scores: { score_id: number; actor: ActorInfo; starts_in: number; ends_in: number; notes: number }[];
  /** 人からの指示(新しいものが後)。`acked` は、エージェントがその指示を踏まえた楽譜を送ったか。 */
  prompts: { id: number; text: string; acked: boolean }[];
  /**
   * 演奏の長さの予定。`duration_seconds` は、あらかじめ決めた長さ(決めていなければ null = 止めるまで続ける)。
   * `elapsed_seconds` は、今の演奏が始まってからの経過(演奏していなければ 0)。
   */
  plan: { duration_seconds: number | null; elapsed_seconds: number };
}

/** EVT-07 */
export interface PerformanceChangedEvent extends EventBase {
  event: "performance.changed";
  data: PerformanceStatus & {
    reason: "score_queued" | "score_replaced" | "stopped" | "finished" | "prompt_sent" | "prompt_acked" | "plan_changed";
    /** 演奏が終わった・アプリが止めた(緊急停止、音声の停止)ときは null。 */
    actor: ActorInfo | null;
  };
}

export type SessionEvent = PatchChangedEvent | EngineStateChangedEvent | OutputChangedEvent | EngineDiagnosticEvent | PerformanceChangedEvent;
