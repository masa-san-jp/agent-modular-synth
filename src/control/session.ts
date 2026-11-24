// 共通コマンド処理の本体(operation-contract v0.3)。
// Session はパッチの正本(パッチグラフ・リビジョン・履歴)を持ち、要求を1件ずつ
// 「検証 → 適用 → 履歴 → リビジョン → 応答 → 通知」の順で処理する(§1.2)。
// ブラウザにもサーバーにも依存しない同期の純粋ロジック。音声側は AudioBackend 越しに扱う。
//
// この層の対象外(輸送・サーバーの責務): 認証 ERR-004、セッションなし ERR-006、応答待ち ERR-007、
// 要求の大きさ ERR-011(JSON として解釈する前のバイト数が要る)、通知の `seq`、EVT-05/06。
// ファイル保存(patch.save / load / list / read / delete)は保存先が非同期なので、Controller(controller.ts)が
// `precheck` と `handleExternal` を使って処理する。Session.handle に直接渡すと ERR-207(reason: "not_implemented")を返す。

import { TypeCatalog, TypeInfo, ParamInfo, PortInfo } from "./catalog.js";
import { MIX2_READOUTS } from "../modules/mix2.js";
import { checkEnvelope, listTypes } from "./envelope.js";
import { CheckedParam, MidiEventAt, ParsedScore, Performance, PerformanceRecord, PerformanceUpdate, QueuedScore, SCORE_LIMITS, parseScore, scoreEvents } from "./performance.js";
import { CommandError } from "./errors.js";
import { MAX_UI_DEPTH, depthExceeds } from "./json.js";
import {
  ActorInfo,
  ActorKind,
  AudioState,
  Cable,
  Change,
  CommandResponse,
  HistoryFlags,
  ModuleUi,
  OutputChangeReason,
  Patch,
  PatchMeta,
  PatchModule,
  PerformanceChangedEvent,
  PerformanceStatus,
  PortRef,
  SessionEvent,
  Warning,
} from "./types.js";

// =====================================================================================
// 音声バックエンド
// =====================================================================================

export interface BackendStatus {
  audioState: AudioState;
  /** サンプルレート。エンジンがまだないときは null。 */
  fs: number | null;
  /** エンジンの通算サンプル番号。 */
  sampleTime: number;
  panic: boolean;
  /** マスター音量 [dB]。 */
  levelDb: number;
  /** エージェントが設定できる上限 [dB](DEC-010)。 */
  agentMaxLevelDb: number;
  /** 出力保護の最終クリップが働いたサンプルの累計(CMD-21)。 */
  clipCount: number;
  /** 各モジュールが COM-12 で置換した回数の合計。 */
  nonfiniteModules: number;
  /** 出力段で置換した回数。 */
  nonfiniteOutputStage: number;
  /** Web MIDI が使えるか。 */
  midiAvailable: boolean;
  /**
   * エンジンに反映済みの最新リビジョン(§11.3)。エンジンがなければ null。
   * 省略(undefined)のときは、Session が最後に渡したリビジョンを使う。
   */
  engineRevision?: number | null;
}

export type SetLevelResult = { ok: true } | { ok: false; reason: "not_a_number" | "out_of_range" | "over_agent_max" };

export interface MeterReading {
  /** 項目名 → 値(MOD-IO-003 §3)。 */
  values: Record<string, unknown>;
  sampleTime: number;
  fs: number;
  /** 省略時は BackendStatus と同じ扱い。 */
  engineRevision?: number | null;
}

/**
 * 音声側(エンジン+出力保護)への接続。実体は src/control/backend.ts(別担当)。
 *
 * Session からの呼び方:
 * - **パッチ全体の置き換え**(patch.new、置き換えの取り消し・やり直し)と、`stopped` からの音声開始の直前、
 *   Session の生成時(音声が `stopped` でないとき)は `applyPatch` を呼ぶ。音声状態によらず呼ぶ。
 * - それ以外の変更は、音声が `stopped` でないときだけ、差分を適用順に `addModule` / `removeModule` /
 *   `connect` / `disconnect` / `setParam` で渡し、1コマンド(batch を含む)の終わりに `commit` を呼ぶ。
 *   `stopped` の間の差分は渡さない(開始時に `applyPatch` で現在のパッチ全体を渡す。§2.3)。
 *   `suspended` の間にためるのはバックエンドの責務(§11.5)。
 * - 音量の引き下げとフェードイン(§2.4)はバックエンドが行う: `applyPatch`・`start`・`releasePanic` の中で
 *   level ← min(現在値, 既定値)。Session は呼出しの前後の `status()` を比べて通知(EVT-03)を出す。
 * - 音声状態・音量・緊急停止は Session が持たず、常に `status()` から読む。
 * - メソッドが例外を投げたら、Session はパッチを適用前へ戻して ERR-010 を返し、`applyPatch` で合わせ直す。
 */
export interface AudioBackend {
  /** パッチ全体の置き換え。全モジュールを作り直し、初期状態から始める(COM-10)。§2.4 の引き下げを行う。 */
  applyPatch(patch: Patch, revision: number): void;
  addModule(module: PatchModule): void;
  /** モジュールを取り除く。つながるケーブルは、先に `disconnect` で渡してある。 */
  removeModule(moduleId: string): void;
  connect(cable: Cable): void;
  disconnect(cable: Cable): void;
  setParam(moduleId: string, param: string, value: number): void;
  /** 1コマンド分の差分の終わり。同じブロック境界でまとめて適用し、反映後に engineRevision をこの値にする(§11.2)。 */
  commit?(revision: number): void;
  /** 今 `start()` を呼べば成功するか。状態は変えない。ないバックエンドは「常に成功する」とみなす。 */
  canStart?(): { ok: true } | { ok: false; reason: string };
  /** 音声の開始・再開(人の操作でだけ呼ばれる)。§2.4 の引き下げを行う。 */
  start(): { ok: true } | { ok: false; reason: string };
  /** 緊急停止: 即時に消音し、全モジュールの内部状態を初期化する。 */
  panic(): void;
  /** 緊急停止の解除。§2.4 の引き下げを行う。解除したら true。 */
  releasePanic(): boolean;
  /** マスター音量の設定。人が設定したら上限も同じ値にする。Session が先に検証するので、通常は成功する。 */
  setLevel(levelDb: number, actor: ActorKind): SetLevelResult;
  status(): BackendStatus;
  /** MOD-IO-003 の読出し値。「ある処理ブロックが終わった直後」の同一時点の組。`fields` にある項目だけを返す。 */
  meterRead(moduleId: string, fields: readonly string[]): MeterReading;
  // ---- 演奏(楽譜の予約。operation-contract CMD-26〜29)。持たないバックエンドでは score.play は ERR-010 ----
  /** 音声側の今のサンプル時刻(処理したサンプルの通算)の見積もり。 */
  sampleNow?(): number;
  /** サンプル時刻つきの MIDI メッセージを予約する(時刻の昇順)。過ぎた時刻のものは、すぐに処理される。 */
  scheduleMidi?(events: MidiEventAt[]): void;
  /** 予約をすべて捨て、鳴っている音を止める(捨てた予約のうちノートオフだけは、その場で処理する)。 */
  clearSchedule?(): void;
}

/**
 * 試験用の、呼出しを記録するだけのダミー。音は出さない。
 * 音量の規則(§2.4、DEC-010)だけは出力段(OutputStage)と同じにしてある。
 */
export class RecordingBackend implements AudioBackend {
  /** 呼出しの記録: [メソッド名, ...引数]。 */
  readonly calls: unknown[][] = [];
  audioState: AudioState;
  fs: number;
  defaultLevelDb: number;
  levelDb: number;
  agentMaxLevelDb: number;
  panicOn = false;
  sampleTime = 0;
  clipCount = 0;
  nonfiniteModules = 0;
  nonfiniteOutputStage = 0;
  midiAvailable = false;
  /** 設定すると start() がこの理由で失敗する(canStart() も同じ理由で失敗を返す)。 */
  startFailure: string | null = null;
  /** 設定すると、canStart() は成功を返すのに start() だけがこの理由で失敗する(起きにくい場合の試験用)。 */
  lateStartFailure: string | null = null;
  canStart(): { ok: true } | { ok: false; reason: string } {
    return this.startFailure !== null ? { ok: false, reason: this.startFailure } : { ok: true };
  }
  /** 設定すると、その名前のメソッドが例外を投げる(ERR-010 の試験用)。 */
  throwOn: string | null = null;
  /** meterRead が返す値(項目名 → 値)。 */
  meterValues: Record<string, unknown> = {
    level: 0,
    peak: 0,
    rms: 0,
    mean: 0,
    vmin: 0,
    vmax: 0,
    windows: 0,
    peak_hold: 0,
    nonfinite_count: 0,
    frame: [],
    frame_seq: 0,
  };

  constructor(opts: { audioState?: AudioState; fs?: number; defaultLevelDb?: number } = {}) {
    this.audioState = opts.audioState ?? "stopped";
    this.fs = opts.fs ?? 48000;
    this.defaultLevelDb = opts.defaultLevelDb ?? -20;
    this.levelDb = this.defaultLevelDb;
    this.agentMaxLevelDb = this.defaultLevelDb;
  }

  private rec(name: string, ...args: unknown[]): void {
    if (this.throwOn === name) throw new Error(`RecordingBackend: ${name} が失敗(試験用)`);
    this.calls.push([name, ...args]);
  }

  private reduce(): void {
    this.levelDb = Math.min(this.levelDb, this.defaultLevelDb);
  }

  /** 記録のうち、名前が一致する呼出し。 */
  callsOf(name: string): unknown[][] {
    return this.calls.filter((c) => c[0] === name);
  }

  applyPatch(patch: Patch, revision: number): void {
    this.rec("applyPatch", patch, revision);
    this.reduce();
  }
  addModule(module: PatchModule): void {
    this.rec("addModule", module);
  }
  removeModule(moduleId: string): void {
    this.rec("removeModule", moduleId);
  }
  connect(cable: Cable): void {
    this.rec("connect", cable);
  }
  disconnect(cable: Cable): void {
    this.rec("disconnect", cable);
  }
  setParam(moduleId: string, param: string, value: number): void {
    this.rec("setParam", moduleId, param, value);
  }
  commit(revision: number): void {
    this.rec("commit", revision);
  }
  start(): { ok: true } | { ok: false; reason: string } {
    this.rec("start");
    if (this.startFailure !== null || this.lateStartFailure !== null) return { ok: false, reason: (this.startFailure ?? this.lateStartFailure)! };
    this.audioState = "running";
    this.reduce();
    return { ok: true };
  }
  panic(): void {
    this.rec("panic");
    this.panicOn = true;
    this.clipCount = 0;
    this.nonfiniteModules = 0;
    this.nonfiniteOutputStage = 0;
  }
  releasePanic(): boolean {
    this.rec("releasePanic");
    if (!this.panicOn) return false;
    this.panicOn = false;
    this.reduce();
    return true;
  }
  setLevel(levelDb: number, actor: ActorKind): SetLevelResult {
    this.rec("setLevel", levelDb, actor);
    if (typeof levelDb !== "number" || !Number.isFinite(levelDb)) return { ok: false, reason: "not_a_number" };
    if (levelDb < -60 || levelDb > 0) return { ok: false, reason: "out_of_range" };
    if (actor === "agent" && levelDb > this.agentMaxLevelDb) return { ok: false, reason: "over_agent_max" };
    this.levelDb = levelDb;
    if (actor === "human") this.agentMaxLevelDb = levelDb;
    return { ok: true };
  }
  status(): BackendStatus {
    return {
      audioState: this.audioState,
      fs: this.audioState === "stopped" ? null : this.fs,
      sampleTime: this.sampleTime,
      panic: this.panicOn,
      levelDb: this.levelDb,
      agentMaxLevelDb: this.agentMaxLevelDb,
      clipCount: this.clipCount,
      nonfiniteModules: this.nonfiniteModules,
      nonfiniteOutputStage: this.nonfiniteOutputStage,
      midiAvailable: this.midiAvailable,
    };
  }
  meterRead(moduleId: string, fields: readonly string[]): MeterReading {
    this.rec("meterRead", moduleId, [...fields]);
    const values: Record<string, unknown> = {};
    for (const f of fields) values[f] = this.meterValues[f];
    return { values, sampleTime: this.sampleTime, fs: this.fs };
  }
  sampleNow(): number {
    return this.sampleTime;
  }
  scheduleMidi(events: MidiEventAt[]): void {
    this.rec("scheduleMidi", events);
  }
  clearSchedule(): void {
    this.rec("clearSchedule");
  }
}

// =====================================================================================
// 定数
// =====================================================================================

/** 常設の出力モジュール(§2.2)。 */
export const OUT_ID = "out";
export const OUT_TYPE = "MOD-IO-001";
export const METER_TYPE = "MOD-IO-003";
export const MIDI_TYPE = "MOD-IO-002";
export const PATCH_FORMAT = "modular-synth-patch";
export const SCHEMA_VERSION = 1;

/** 上限(§16、§7、§9。いずれも暫定値)。 */
export interface Limits {
  modules: number;
  cables: number;
  batchOps: number;
  history: number;
  idempotencyKeys: number;
  /** 冪等キーで保存する応答の合計の大きさ [JSON の文字数]。超えたら古いものから捨てる(最新の1件は残す)。 */
  idempotencyChars: number;
  /** 履歴のうち、パッチ全体の置き換え(patch.new / patch.load)が持つパッチの合計の大きさ [JSON の文字数]。超えたら古い履歴から捨てる。 */
  historyChars: number;
  uiBytes: number;
}

export const DEFAULT_LIMITS: Limits = {
  modules: 256,
  cables: 1024,
  batchOps: 500,
  history: 200,
  idempotencyKeys: 1000,
  idempotencyChars: 16 * 1024 * 1024,
  historyChars: 32 * 1024 * 1024,
  uiBytes: 1024,
};

/** `output.set_level` の範囲 [dB](CMD-25。暫定値)。 */
export const LEVEL_MIN_DB = -60;
export const LEVEL_MAX_DB = 0;

/** `meter.read` で読める項目(MOD-IO-003 §3)。 */
export const METER_FIELDS = [
  "level",
  "peak",
  "rms",
  "mean",
  "vmin",
  "vmax",
  "windows",
  "peak_hold",
  "nonfinite_count",
  "frame",
  "frame_seq",
] as const;

/** 読出し値を持つ種別 → `meter.read` で読める項目(各モジュール仕様 §3)。 */
export const READOUTS: Readonly<Record<string, readonly string[]>> = {
  [METER_TYPE]: METER_FIELDS,
  "MOD-MIX-002": MIX2_READOUTS,
};
/** どれかの種別が持つ読出し値の名前すべて。 */
export const ALL_READOUT_NAMES: readonly string[] = [...new Set(Object.values(READOUTS).flat())];

const ID_RE = /^[a-z][a-z0-9_]{0,31}$/;
const PATCH_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
/** seed の自動割当の間隔(§14)。 */
const SEED_STEP = 16;

interface CommandSpec {
  /** 人のみ(§15)。 */
  humanOnly?: boolean;
  /** 冪等キーで応答を保存するか(§7.1)。 */
  keyed?: boolean;
  /** batch に入れられるか(§6)。 */
  batch?: boolean;
}

/** §6 のコマンド表。 */
export const COMMANDS: Readonly<Record<string, CommandSpec>> = {
  "module.list_types": {},
  "module.add": { keyed: true, batch: true },
  "module.remove": { keyed: true, batch: true },
  "module.get": {},
  "module.move": { keyed: true, batch: true },
  "cable.connect": { keyed: true, batch: true },
  "cable.disconnect": { keyed: true, batch: true },
  "param.set": { keyed: true, batch: true },
  batch: { keyed: true },
  "patch.get": {},
  "patch.new": { keyed: true },
  "patch.save": { keyed: true },
  "patch.load": { keyed: true },
  "patch.list": {},
  "patch.read": {},
  "patch.delete": { keyed: true, humanOnly: true },
  "patch.set_meta": { keyed: true, batch: true },
  "history.undo": { keyed: true },
  "history.redo": { keyed: true },
  "meter.read": {},
  "engine.get_status": {},
  "engine.start": { keyed: true, humanOnly: true },
  "engine.panic": {},
  "engine.release_panic": { keyed: true, humanOnly: true },
  "output.set_level": { keyed: true },
  "score.play": { keyed: true },
  "score.stop": {},
  "score.get_status": {},
  "prompt.send": { keyed: true, humanOnly: true },
  "performance.list": {},
  "performance.read": {},
  "performance.replay": { keyed: true },
  "performance.set_plan": { keyed: true },
  "performance.render": {},
};

// =====================================================================================
// 内部の型
// =====================================================================================

type Args = Record<string, unknown>;
type Stamp = Pick<PatchMeta, "created_at" | "modified_at" | "saved_by" | "app_version">;

/** パッチの内容。作り直しで更新する(モジュール・ケーブルのオブジェクトは書き換えない)ので、履歴と共有できる。 */
interface State {
  title: string;
  description: string;
  /** 保存時刻など(DAT-35)。リビジョン・履歴の対象外。 */
  stamp: Stamp;
  modules: readonly PatchModule[];
  cables: readonly Cable[];
}

/** 内部の変更。`cable_removed` は音声側へ渡すためにケーブルの中身も持つ。 */
type IChange = Exclude<Change, { kind: "cable_removed" }> | { kind: "cable_removed"; cable_id: string; cable: Cable };

/** 作業用の写し(batch の全体ロールバック用。§6 CMD-09)。 */
interface Draft {
  title: string;
  description: string;
  modules: PatchModule[];
  cables: Cable[];
  nextM: number;
  nextC: number;
  changes: IChange[];
  /** パッチ全体の置き換えで、置き換え後のパッチが持つ保存時刻など(DAT-35)。省略時は「なし」。 */
  stamp?: Stamp;
}

interface Coalesce {
  actor: ActorInfo;
  key: string;
  moduleId: string;
  param: string;
}

interface HistoryEntry {
  command: string;
  actor: ActorInfo;
  /** その変更が作ったリビジョン。 */
  revision: number;
  before: State;
  after: State;
  /** パッチ全体の置き換えか(§2.4 の契機)。 */
  replaced: boolean;
  coalesce?: Coalesce;
  /** 置き換えの履歴が持つパッチ(前後)のおおよその大きさ [JSON の文字数]。置き換えでなければ 0(前後で大部分を共有するため)。 */
  chars: number;
}

interface OpOutput {
  result: Record<string, unknown>;
  changed: boolean;
  warnings: Warning[];
  coalesce?: Coalesce;
}

interface Ctx {
  actor: ActorInfo;
  requestId: string;
  command: string;
  events: SessionEvent[];
  /** 保存のコマンドの中身(handleExternal から)。 */
  external?: ExternalRun;
}

/** `handleExternal` の中身に渡す、Session の状態を変える口。 */
export interface ExternalOps {
  /** 受け口が決めた操作者(§3.1)。 */
  readonly actor: ActorInfo;
  /**
   * パッチ全体を置き換える(patch.load。検証・正規化済みのパッチであること)。履歴1件、リビジョン +1、
   * EVT-01(patch_replaced)、音声側は applyPatch(§2.4 の引き下げ)。次番号は §2.2 の規則4。
   * `meta` の保存時刻などは、渡したパッチに書かれていた値になる(DAT-35)。
   */
  replacePatch(patch: Patch): void;
  /**
   * メモリ上の `meta` の保存時刻・saved_by など(DAT-35)を差し替える(patch.save の成功時)。
   * リビジョン・履歴・EVT-01 の対象外。
   */
  setSaveStamp(stamp: Pick<PatchMeta, "created_at" | "modified_at" | "saved_by" | "app_version">): void;
  /**
   * 演奏データを再演奏する(performance.replay): パッチを演奏データのもの(検証・正規化済み)へ置き換え、記録された楽譜をすべて予約する。
   * 音声が動作中でなければ ERR-301。演奏データの楽譜が検証に通らなければ、そのエラー。失敗したら、何も変えない(パッチも元のまま)。
   */
  replayPerformance(patch: Patch, record: PerformanceRecord, name: string): { scores: number; length_seconds: number; warnings: Warning[] };
}

/** 保存のコマンドの中身。同期で、CommandError を投げれば失敗の応答になる。 */
export type ExternalRun = (ops: ExternalOps) => { result: Record<string, unknown>; warnings?: Warning[] };

/** `precheck` の結果。 */
export type PrecheckResult =
  | { proceed: false; response: CommandResponse }
  | { proceed: true; command: string; args: Record<string, unknown>; actor: ActorInfo; requestId: string };

interface ProcessExt {
  precheck?: boolean;
  run?: ExternalRun;
  admitted?: { command: string; args: Args; actor: ActorInfo; requestId: string };
}

interface ExecOutput {
  result: Record<string, unknown>;
  warnings: Warning[];
}

interface SessionSnapshot {
  state: State;
  revision: number;
  undo: HistoryEntry[];
  redo: HistoryEntry[];
  nextM: number;
  nextC: number;
  pushedRevision: number | null;
}

export interface SessionOptions {
  catalog: TypeCatalog;
  backend: AudioBackend;
  /** タブの読込ごとに新しく発行する識別子(§2.1)。発行は呼出し側。 */
  sessionId: string;
  /**
   * 起動時のパッチ(自動保存から復元したもの。検証済みであること)。省略時は空のパッチ(data-contract §3.3)。
   * 書かれていないパラメータは既定値で補う。
   */
  patch?: Patch;
  /** 起動時のリビジョン(自動保存の値)。省略時は 0(§4.4)。 */
  revision?: number;
  limits?: Partial<Limits>;
}

// =====================================================================================
// 補助
// =====================================================================================

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 自動採番の対象にする番号の桁数の上限(これより大きい番号のIDは、採番の計算に入れない)。 */
const MAX_NUMBERED_DIGITS = 9;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function charLen(s: string): number {
  return Array.from(s).length;
}

function utf8Bytes(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/** キーの順に依らない文字列化(冪等キーの「同じ内容」の判定用)。 */
function stable(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (isObj(v)) {
    return (
      "{" +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stable(v[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(v) ?? "null";
}

function bad(arg: string, reason: string, message?: string): CommandError {
  return new CommandError("ERR-003", message ?? `引数 ${arg}: ${reason}`, { arg, reason });
}

function checkKeys(a: Args, allowed: readonly string[], prefix = ""): void {
  for (const k of Object.keys(a)) {
    if (!allowed.includes(k)) throw bad(prefix + k, "unknown_key", `未知の引数 ${prefix}${k}`);
  }
}

function reqString(a: Args, key: string): string {
  if (!(key in a)) throw bad(key, "missing");
  const v = a[key];
  if (typeof v !== "string") throw bad(key, "type");
  return v;
}

function parsePortRef(a: Args, key: string): PortRef {
  if (!(key in a)) throw bad(key, "missing");
  const v = a[key];
  if (!isObj(v)) throw bad(key, "type");
  checkKeys(v, ["module", "port"], key + ".");
  if (typeof v.module !== "string") throw bad(key + ".module", "module" in v ? "type" : "missing");
  if (typeof v.port !== "string") throw bad(key + ".port", "port" in v ? "type" : "missing");
  return { module: v.module, port: v.port };
}

function parseNewId(a: Args, key: string): string | undefined {
  if (!(key in a)) return undefined;
  const v = a[key];
  if (typeof v !== "string") throw bad(key, "type");
  if (!ID_RE.test(v)) throw bad(key, "format", `${key} は ^[a-z][a-z0-9_]{0,31}$ の書式`);
  return v;
}

function parseUi(a: Args, key: string, required: boolean, maxBytes: number): ModuleUi | undefined {
  if (!(key in a)) {
    if (required) throw bad(key, "missing");
    return undefined;
  }
  const v = a[key];
  if (!isObj(v)) throw bad(key, "type");
  for (const k of ["x", "y"]) {
    if (!(k in v)) throw bad(`${key}.${k}`, "missing");
    if (typeof v[k] !== "number" || !Number.isFinite(v[k])) throw bad(`${key}.${k}`, "type");
  }
  if (depthExceeds(v, MAX_UI_DEPTH)) throw bad(key, "too_deep", `${key} の入れ子は ${MAX_UI_DEPTH} 段以内`);
  if (utf8Bytes(JSON.stringify(v)) > maxBytes) throw bad(key, "too_large", `${key} は ${maxBytes} バイト以内`);
  return clone(v);
}

function numberedId(prefix: string, id: string): number | null {
  if (!id.startsWith(prefix)) return null;
  const rest = id.slice(prefix.length);
  // 桁数の多い番号(m9007199254740991 など)は対象外: 次番号が整数で表せる範囲を超えると、採番が進まなくなる
  if (!/^[0-9]+$/.test(rest) || rest.replace(/^0+/, "").length > MAX_NUMBERED_DIGITS) return null;
  return Number(rest);
}

function maxNumbered(prefix: string, ids: Iterable<string>): number {
  let max = 0;
  for (const id of ids) {
    const n = numberedId(prefix, id);
    if (n !== null && n > max) max = n;
  }
  return max;
}

function sameActor(a: ActorInfo, b: ActorInfo): boolean {
  return a.kind === b.kind && a.client_id === b.client_id;
}

function metaOf(s: { title: string; description: string }, stamp: Stamp): PatchMeta {
  return clone({ title: s.title, description: s.description, ...stamp });
}

function publicChange(c: IChange): Change {
  return c.kind === "cable_removed" ? { kind: "cable_removed", cable_id: c.cable_id } : clone(c);
}

function samePort(a: PortRef, b: PortRef): boolean {
  return a.module === b.module && a.port === b.port;
}

// =====================================================================================
// Session
// =====================================================================================

export class Session {
  readonly sessionId: string;
  private readonly catalog: TypeCatalog;
  private readonly backend: AudioBackend;
  private readonly limits: Limits;
  private readonly paramIndex = new Map<string, Map<string, ParamInfo>>();

  private state: State;
  private rev: number;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private nextM: number;
  private nextC: number;
  /** 冪等キー → 保存済みの成功応答(§7)。 */
  private readonly keyed = new Map<string, { fingerprint: string; response: CommandResponse; chars: number }>();
  private keyedChars = 0;
  private readonly listeners = new Set<(ev: SessionEvent) => void>();
  /** 音声側へ最後に渡したリビジョン(バックエンドが engineRevision を返さないときに使う)。 */
  private pushedRevision: number | null = null;
  private backendDirty = false;
  /** 演奏の状態(予約済みの楽譜、人からの指示)。パッチ・リビジョン・履歴とは別。 */
  private readonly perf = new Performance();
  /** pollBackend() が変化を見つけるための、最後に見た音声側の状態。 */
  private seen: BackendStatus;

  constructor(opts: SessionOptions) {
    this.catalog = opts.catalog;
    this.backend = opts.backend;
    this.sessionId = opts.sessionId;
    this.limits = { ...DEFAULT_LIMITS, ...(opts.limits ?? {}) };
    this.rev = opts.revision ?? 0;
    if (!Number.isInteger(this.rev) || this.rev < 0) throw new Error("revision は 0 以上の整数");
    this.state = opts.patch ? this.importPatch(opts.patch) : this.emptyState();
    // §2.2 自動採番の規則1
    this.nextM = maxNumbered("m", this.state.modules.map((m) => m.id)) + 1;
    this.nextC = maxNumbered("c", this.state.cables.map((c) => c.id)) + 1;
    if (this.backend.status().audioState !== "stopped") {
      this.backend.applyPatch(this.exportPatch(), this.rev);
      this.pushedRevision = this.rev;
    }
    this.seen = this.backend.status();
  }

  // ---- 公開の読出し ----

  get revision(): number {
    return this.rev;
  }

  /** 現在のパッチ(data-contract §3 の形の写し)。 */
  getPatch(): Patch {
    return this.exportPatch();
  }

  /** モジュール種別の定義表(読込時の検証に使う)。 */
  get typeCatalog(): TypeCatalog {
    return this.catalog;
  }

  get history(): HistoryFlags {
    return { can_undo: this.undoStack.length > 0, can_redo: this.redoStack.length > 0 };
  }

  /**
   * 音声側を、現在のパッチ全体から作り直す(音声側が差分の適用に失敗して、正本とずれたときに呼ぶ)。
   * パッチ・リビジョン・履歴は変えない。全体の置き換えと同じく音量は引き下げられ、変われば EVT-03 が出る。
   */
  resyncBackend(): void {
    if (this.backend.status().audioState === "stopped") return; // 止まっている間は、開始時に全体を渡す
    this.backend.applyPatch(this.exportPatch(), this.rev);
    this.pushedRevision = this.rev;
    this.pollBackend();
  }

  /** 前回から変わった演奏データ(演奏した楽譜の記録)を取り出す。保存する側(Controller)が呼ぶ。 */
  takePerformanceUpdates(): PerformanceUpdate[] {
    return this.perf.takeRecordUpdates().map((u) => ({ id: u.id, closed: u.closed, record: clone(u.record) }));
  }

  /** 演奏の状態(予約済みの楽譜と、人からの指示。CMD-28 の返値と同じ)。 */
  get performance(): PerformanceStatus {
    return this.performanceStatus();
  }

  /** 通知(EVT)を受け取る。戻り値を呼ぶと解除する。 */
  subscribe(listener: (ev: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ---- 要求の処理 ----

  /**
   * 要求を1件処理して応答を返す。`actor` は受け口が決めた操作者(§3.1)。
   * 通知は応答の後に出す(§10): `deliver` を渡すと、応答を `deliver` へ渡してから通知をリスナーへ渡す。
   * `deliver` がなければ、通知をリスナーへ渡し終えてから応答を返す。
   */
  handle(request: unknown, actor: ActorKind, deliver?: (response: CommandResponse) => void): CommandResponse {
    const events: SessionEvent[] = [];
    const response = clone(this.process(request, actor, events) as CommandResponse);
    if (deliver) deliver(response);
    this.emit(events);
    return response;
  }

  /**
   * §3.3 の 1〜6(封筒、コマンド名と権限、冪等キー、expected_revision)だけを検査する。状態は変えない。
   * 通らない(または冪等キーで保存済みの応答がある)ときは、返すべき応答を返す。
   * 保存のコマンドで、非同期の保存先を使う前に呼ぶ(Controller)。
   */
  precheck(request: unknown, actor: ActorKind): PrecheckResult {
    const ext: ProcessExt = { precheck: true };
    const response = this.process(request, actor, [], ext);
    if (response) return { proceed: false, response: clone(response) };
    const a = ext.admitted!;
    return { proceed: true, command: a.command, args: clone(a.args), actor: clone(a.actor), requestId: a.requestId };
  }

  /**
   * `handle` と同じ手順(検査、冪等キーの保存、想定外の失敗でのロールバック、応答の後の通知)で要求を処理するが、
   * 保存のコマンド(patch.save / load / list / read / delete)の中身(§3.3 の7以降)は `run` が行う。
   * 保存先の非同期の読み書きを済ませた後に呼ぶ(Controller)。保存のコマンド以外では `run` は使わない。
   */
  handleExternal(
    request: unknown,
    actor: ActorKind,
    run: ExternalRun,
    deliver?: (response: CommandResponse) => void,
  ): CommandResponse {
    const events: SessionEvent[] = [];
    const response = clone(this.process(request, actor, events, { run }) as CommandResponse);
    if (deliver) deliver(response);
    this.emit(events);
    return response;
  }

  /**
   * アプリ起因の変化(ブラウザ・OSによる中断と自動復帰、fs の変更、診断計数の増加)を調べ、通知を出す。
   * 音声状態・fs・MIDI の変化は EVT-02、音量・緊急停止の変化は EVT-03(actor: null、reason: reset_to_default)、
   * 非有限値の置換・最終クリップの増加は EVT-04。呼ぶ頻度(間引き)は呼出し側が決める。
   */
  pollBackend(): void {
    const events: SessionEvent[] = [];
    const before = this.seen;
    const now = this.backend.status();
    if (now.audioState !== before.audioState || now.fs !== before.fs || now.midiAvailable !== before.midiAvailable) {
      events.push(this.stateEvent(now));
    }
    if (now.levelDb !== before.levelDb || now.agentMaxLevelDb !== before.agentMaxLevelDb || now.panic !== before.panic) {
      events.push(this.outputEvent(now, null, "reset_to_default"));
    }
    // 演奏: 音声が動作中でなくなったら予約を捨てる。最後まで演奏し終えたら知らせる
    if (now.audioState !== "running") {
      this.perf.closeRecord("audio_stopped", now.sampleTime);
      if (this.perf.playing) {
        this.backend.clearSchedule?.();
        this.perf.clear();
        events.push(this.performanceEvent("stopped", null));
      }
    } else {
      const sample = this.backend.sampleNow?.() ?? now.sampleTime;
      if (this.perf.prune(sample)) {
        // 演奏し終えた: 楽譜が動かしていたパラメータを、パッチの値へ戻す
        this.backend.clearSchedule?.();
        events.push(this.performanceEvent("finished", null));
      }
      // 演奏し終えた後、次の楽譜が来ないまま時間が過ぎたら、演奏データを閉じる(少し遅れた続きは、同じ演奏として残す)
      this.perf.closeIfIdle(sample);
    }
    if (
      now.clipCount > before.clipCount ||
      now.nonfiniteModules > before.nonfiniteModules ||
      now.nonfiniteOutputStage > before.nonfiniteOutputStage
    ) {
      events.push({
        v: 1,
        event: "engine.diagnostic",
        session_id: this.sessionId,
        data: {
          nonfinite_count: now.nonfiniteModules + now.nonfiniteOutputStage,
          nonfinite_detail: { modules: now.nonfiniteModules, output_stage: now.nonfiniteOutputStage },
          clip_count: now.clipCount,
        },
      });
    }
    this.seen = now;
    this.emit(events);
  }

  private emit(events: SessionEvent[]): void {
    for (const ev of events) {
      for (const l of [...this.listeners]) {
        try {
          l(clone(ev));
        } catch {
          // リスナーの失敗でコマンド処理を止めない
        }
      }
    }
  }

  /** §3.3 の順に検査して実行する。 */
  private process(request: unknown, actorKind: ActorKind, events: SessionEvent[], ext?: ProcessExt): CommandResponse | null {
    const r: Record<string, unknown> = isObj(request) ? request : {};
    const okLen = (v: unknown): v is string => typeof v === "string" && charLen(v) >= 1 && charLen(v) <= 64;
    const requestId = typeof r.request_id === "string" ? r.request_id : null;
    const command = typeof r.command === "string" ? r.command : null;
    const actor: ActorInfo = { kind: actorKind, ...(okLen(r.client_id) ? { client_id: r.client_id } : {}) };
    const base = () => ({
      v: 1 as const,
      request_id: requestId,
      command,
      revision: this.rev,
      session_id: this.sessionId,
      actor,
      audio_state: this.backend.status().audioState,
      replayed: false,
    });
    const snapshot = this.snapshot();
    try {
      // 1. 封筒の形(ERR-001 → ERR-012)
      const broken = checkEnvelope(request);
      if (broken) throw new CommandError(broken.id, broken.message, broken.details ?? {});
      if (!isObj(request) || typeof r.command !== "string" || typeof r.request_id !== "string") throw new Error("unreachable");
      const cmd = r.command;
      const args: Args = (r.args as Args | undefined) ?? {};
      const expected = r.expected_revision as number | undefined;
      const key = r.idempotency_key as string | undefined;

      // 3. コマンド名と権限
      const spec = Object.prototype.hasOwnProperty.call(COMMANDS, cmd) ? COMMANDS[cmd] : undefined;
      if (!spec) throw new CommandError("ERR-002", `未定義のコマンド ${cmd}`, { command: cmd });
      if (spec.humanOnly && actorKind !== "human") {
        throw new CommandError("ERR-005", `${cmd} は人のUIだけが行える`, { command: cmd, actor_kind: actorKind });
      }

      // 5. 冪等キー(読出しと engine.panic では無視する。§7.6)
      // 鍵は操作者の種別ごとに別の空間にする: 人が使った鍵をエージェントが再送しても、人の応答は返らない
      const useKey = spec.keyed === true && key !== undefined;
      const slot = `${actorKind}\u0000${key ?? ""}`;
      const fingerprint = useKey ? stable({ command: cmd, args, expected_revision: expected ?? null }) : "";
      if (useKey) {
        const saved = this.keyed.get(slot);
        if (saved) {
          if (saved.fingerprint !== fingerprint) {
            throw new CommandError("ERR-009", "同じ冪等キーで内容の違う要求", { idempotency_key: key });
          }
          return { ...clone(saved.response), request_id: requestId, replayed: true };
        }
      }

      // 6. expected_revision(engine.panic は無視する。CMD-23)
      if (expected !== undefined && cmd !== "engine.panic" && expected !== this.rev) {
        throw new CommandError("ERR-008", "expected_revision が現在のリビジョンと違う", {
          expected_revision: expected,
          current_revision: this.rev,
        });
      }

      if (ext?.precheck) {
        ext.admitted = { command: cmd, args, actor, requestId: r.request_id };
        return null;
      }

      // 7〜10. 引数・対象・値の検査と適用
      const ctx: Ctx = { actor, requestId: r.request_id, command: cmd, events };
      if (ext?.run) ctx.external = ext.run;
      const out = this.execute(cmd, args, ctx);
      const response: CommandResponse = { ...base(), ok: true, warnings: out.warnings, result: out.result };
      this.seen = this.backend.status();
      if (useKey) {
        const text = JSON.stringify(response);
        this.keyed.set(slot, { fingerprint, response: JSON.parse(text) as CommandResponse, chars: text.length });
        this.keyedChars += text.length;
        // 件数と合計の大きさの上限。古いものから捨てる(最新の1件は残す)
        while (this.keyed.size > this.limits.idempotencyKeys || (this.keyed.size > 1 && this.keyedChars > this.limits.idempotencyChars)) {
          const oldest = this.keyed.keys().next().value as string;
          this.keyedChars -= this.keyed.get(oldest)!.chars;
          this.keyed.delete(oldest);
        }
      }
      return response;
    } catch (e) {
      if (e instanceof CommandError) return { ...base(), ok: false, error: e.toBody() };
      // 想定外の失敗: 状態を適用前へ戻す(§3.3 の10)
      this.restore(snapshot);
      events.length = 0;
      if (this.backendDirty) {
        this.backendDirty = false;
        try {
          this.backend.applyPatch(this.exportPatch(), this.rev);
        } catch {
          // 合わせ直しも失敗した場合は、パッチの正本だけを守る
        }
      }
      const err = new CommandError("ERR-010", "想定外の失敗。状態は適用前へ戻した", {});
      try {
        return { ...base(), ok: false, error: err.toBody() };
      } catch {
        return {
          v: 1,
          request_id: requestId,
          command,
          revision: this.rev,
          session_id: this.sessionId,
          actor,
          audio_state: this.seen.audioState,
          replayed: false,
          ok: false,
          error: err.toBody(),
        };
      }
    }
  }

  private snapshot(): SessionSnapshot {
    return {
      state: this.state,
      revision: this.rev,
      undo: [...this.undoStack],
      redo: [...this.redoStack],
      nextM: this.nextM,
      nextC: this.nextC,
      pushedRevision: this.pushedRevision,
    };
  }

  private restore(s: SessionSnapshot): void {
    this.state = s.state;
    this.rev = s.revision;
    this.undoStack = s.undo;
    this.redoStack = s.redo;
    this.nextM = s.nextM;
    this.nextC = s.nextC;
    this.pushedRevision = s.pushedRevision;
  }

  private execute(cmd: string, args: Args, ctx: Ctx): ExecOutput {
    switch (cmd) {
      case "module.add":
      case "module.remove":
      case "module.move":
      case "cable.connect":
      case "cable.disconnect":
      case "param.set":
      case "patch.set_meta": {
        const d = this.newDraft();
        const out = this.applyOp(d, cmd, args, ctx.actor);
        if (out.changed) this.commit(ctx, d, false, out.coalesce);
        return { result: out.result, warnings: out.warnings };
      }
      case "batch":
        return this.cmdBatch(args, ctx);
      case "module.list_types":
        return this.cmdListTypes(args);
      case "module.get":
        return this.cmdModuleGet(args);
      case "patch.get":
        checkKeys(args, []);
        return { result: { patch: this.exportPatch(), history: this.history }, warnings: [] };
      case "patch.new":
        return this.cmdPatchNew(args, ctx);
      case "history.undo":
        return this.cmdUndoRedo(args, ctx, "undo");
      case "history.redo":
        return this.cmdUndoRedo(args, ctx, "redo");
      case "meter.read":
        return this.cmdMeterRead(args);
      case "engine.get_status":
        return this.cmdGetStatus(args);
      case "engine.start":
        return this.cmdStart(args, ctx);
      case "engine.panic":
        return this.cmdPanic(args, ctx);
      case "engine.release_panic":
        return this.cmdReleasePanic(args, ctx);
      case "output.set_level":
        return this.cmdSetLevel(args, ctx);
      case "score.play":
        return this.cmdScorePlay(args, ctx);
      case "score.stop":
        return this.cmdScoreStop(args, ctx);
      case "score.get_status":
        checkKeys(args, []);
        return { result: { ...this.performanceStatus() }, warnings: [] };
      case "prompt.send":
        return this.cmdPromptSend(args, ctx);
      case "performance.set_plan":
        return this.cmdSetPlan(args, ctx);
      case "performance.list":
      case "performance.read":
      case "performance.replay":
      case "performance.render":
        return ctx.external ? this.runExternal(ctx, ctx.external) : this.cmdPerformanceUnsupported();
      case "patch.save":
      case "patch.load":
      case "patch.list":
      case "patch.read":
      case "patch.delete":
        return ctx.external ? this.runExternal(ctx, ctx.external) : this.cmdStorageUnsupported(cmd, args);
      default:
        throw new CommandError("ERR-002", `未定義のコマンド ${cmd}`, { command: cmd });
    }
  }

  // ---- パッチの入出力 ----

  private typeInfo(type: string): TypeInfo {
    const info = this.catalog.get(type);
    if (!info) throw new CommandError("ERR-101", `未知のモジュール種別 ${type}`, { type });
    return info;
  }

  private paramsOf(type: string): Map<string, ParamInfo> {
    let m = this.paramIndex.get(type);
    if (!m) {
      m = new Map(this.typeInfo(type).params.map((p) => [p.name, p]));
      this.paramIndex.set(type, m);
    }
    return m;
  }

  private defaultParams(info: TypeInfo): Record<string, number> {
    const params: Record<string, number> = {};
    for (const p of info.params) params[p.name] = p.default;
    return params;
  }

  private emptyState(): State {
    const info = this.typeInfo(OUT_TYPE);
    return {
      title: "",
      description: "",
      stamp: {},
      modules: [{ id: OUT_ID, type: OUT_TYPE, spec_version: info.specVersion, params: this.defaultParams(info) }],
      cables: [],
    };
  }

  /** 起動時のパッチを取り込む(検証済みが前提。省略パラメータだけ既定値で補う)。 */
  private importPatch(patch: Patch): State {
    const p = clone(patch);
    const modules = p.modules.map((m) => {
      const info = this.catalog.get(m.type);
      if (!info) throw new Error(`起動時のパッチに未知のモジュール種別 ${m.type}`);
      const mod: PatchModule = {
        id: m.id,
        type: m.type,
        spec_version: m.spec_version,
        params: { ...this.defaultParams(info), ...(m.params ?? {}) },
      };
      if (m.ui) mod.ui = m.ui;
      return mod;
    });
    if (modules.filter((m) => m.type === OUT_TYPE).length !== 1 || !modules.some((m) => m.id === OUT_ID && m.type === OUT_TYPE)) {
      throw new Error("起動時のパッチに常設の出力 out(MOD-IO-001)がちょうど1つ必要");
    }
    const meta = p.meta ?? { title: "", description: "" };
    const stamp: Stamp = {};
    if (meta.created_at !== undefined) stamp.created_at = meta.created_at;
    if (meta.modified_at !== undefined) stamp.modified_at = meta.modified_at;
    if (meta.saved_by !== undefined) stamp.saved_by = meta.saved_by;
    if (meta.app_version !== undefined) stamp.app_version = meta.app_version;
    return { title: meta.title ?? "", description: meta.description ?? "", stamp, modules, cables: p.cables ?? [] };
  }

  private exportPatch(s: State = this.state): Patch {
    return clone({
      format: PATCH_FORMAT,
      schema_version: SCHEMA_VERSION,
      meta: metaOf(s, s.stamp),
      modules: s.modules as PatchModule[],
      cables: s.cables as Cable[],
    });
  }

  // ---- 変更の確定 ----

  private newDraft(): Draft {
    return {
      title: this.state.title,
      description: this.state.description,
      modules: [...this.state.modules],
      cables: [...this.state.cables],
      nextM: this.nextM,
      nextC: this.nextC,
      changes: [],
    };
  }

  /** 作業用の写しを現在のパッチにする: 履歴 → リビジョン → 音声側 → 通知。 */
  private commit(ctx: Ctx, d: Draft, replaced: boolean, coalesce?: Coalesce): void {
    const before = this.state;
    const after: State = {
      title: d.title,
      description: d.description,
      stamp: replaced ? (d.stamp ?? {}) : before.stamp,
      modules: d.modules,
      cables: d.cables,
    };
    this.nextM = d.nextM;
    this.nextC = d.nextC;
    const top = this.undoStack[this.undoStack.length - 1];
    const merge =
      coalesce !== undefined &&
      top?.coalesce !== undefined &&
      sameActor(top.coalesce.actor, coalesce.actor) &&
      top.coalesce.key === coalesce.key &&
      top.coalesce.moduleId === coalesce.moduleId &&
      top.coalesce.param === coalesce.param;
    const revision = this.rev + 1;
    if (merge) {
      // §9.4: 履歴上は1件(戻り先は最初の変更の前の値)
      this.undoStack[this.undoStack.length - 1] = { ...top!, after, revision };
    } else {
      const size = (st: State): number => JSON.stringify(st.modules).length + JSON.stringify(st.cables).length;
      const entry: HistoryEntry = { command: ctx.command, actor: ctx.actor, revision, before, after, replaced, chars: replaced ? size(before) + size(after) : 0 };
      if (coalesce) entry.coalesce = coalesce;
      this.undoStack.push(entry);
      while (this.undoStack.length > this.limits.history) this.undoStack.shift();
      // 置き換えの履歴はパッチ全体を2つ持つ。合計が上限を超えたら古い履歴から捨てる(最新の1件は残す)
      let total = 0;
      for (const e of this.undoStack) total += e.chars;
      while (this.undoStack.length > 1 && total > this.limits.historyChars) total -= this.undoStack.shift()!.chars;
    }
    this.redoStack = [];
    this.install(ctx, after, d.changes, replaced);
  }

  /** 状態を差し替え、リビジョンを進め、音声側へ渡し、EVT-01(と音量が下がれば EVT-03)を積む。 */
  private install(ctx: Ctx, next: State, changes: IChange[], replaced: boolean): void {
    const previous = this.rev;
    this.state = next;
    this.rev = previous + 1;
    const statusBefore = this.backend.status();
    this.backendDirty = true;
    if (replaced) {
      this.backend.applyPatch(this.exportPatch(), this.rev);
      this.pushedRevision = this.rev;
    } else if (statusBefore.audioState !== "stopped") {
      for (const c of changes) {
        switch (c.kind) {
          case "module_added":
            this.backend.addModule(clone(c.module));
            break;
          case "module_removed":
            this.backend.removeModule(c.module_id);
            break;
          case "cable_added":
            this.backend.connect(clone(c.cable));
            break;
          case "cable_removed":
            this.backend.disconnect(clone(c.cable));
            break;
          case "param_changed":
            this.backend.setParam(c.module_id, c.param, c.value);
            break;
          default:
            break; // 位置・メタ情報は音に影響しない
        }
      }
      this.backend.commit?.(this.rev);
      this.pushedRevision = this.rev;
    }
    this.backendDirty = false;
    ctx.events.push({
      v: 1,
      event: "patch.changed",
      session_id: this.sessionId,
      data: {
        revision: this.rev,
        previous_revision: previous,
        actor: ctx.actor,
        command: ctx.command,
        request_id: ctx.requestId,
        changes: replaced ? [{ kind: "patch_replaced" }] : changes.map(publicChange),
      },
    });
    if (replaced) {
      // §2.4 の4: level_db が変わったときだけ EVT-03(reset_to_default)
      const statusAfter = this.backend.status();
      if (statusAfter.levelDb !== statusBefore.levelDb) {
        ctx.events.push(this.outputEvent(statusAfter, ctx.actor, "reset_to_default"));
      }
    }
  }

  private outputEvent(s: BackendStatus, actor: ActorInfo | null, reason: OutputChangeReason): SessionEvent {
    return {
      v: 1,
      event: "output.changed",
      session_id: this.sessionId,
      data: { level_db: s.levelDb, agent_max_level_db: s.agentMaxLevelDb, panic: s.panic, actor, reason },
    };
  }

  private stateEvent(s: BackendStatus): SessionEvent {
    return {
      v: 1,
      event: "engine.state_changed",
      session_id: this.sessionId,
      data: {
        audio_state: s.audioState,
        fs: s.audioState === "stopped" ? null : s.fs,
        midi: { available: s.midiAvailable },
      },
    };
  }

  // ---- パッチを変える操作(batch に入れられるもの) ----

  private applyOp(d: Draft, cmd: string, a: Args, actor: ActorInfo): OpOutput {
    switch (cmd) {
      case "module.add":
        return this.opModuleAdd(d, a);
      case "module.remove":
        return this.opModuleRemove(d, a);
      case "module.move":
        return this.opModuleMove(d, a);
      case "cable.connect":
        return this.opCableConnect(d, a);
      case "cable.disconnect":
        return this.opCableDisconnect(d, a);
      case "param.set":
        return this.opParamSet(d, a, actor);
      case "patch.set_meta":
        return this.opSetMeta(d, a);
      default:
        throw new Error(`applyOp: ${cmd}`);
    }
  }

  private findModule(d: Draft, id: string): PatchModule {
    const m = d.modules.find((x) => x.id === id);
    if (!m) throw new CommandError("ERR-102", `モジュール ${id} は存在しない`, { module_id: id });
    return m;
  }

  /** §12.1: パラメータ値の検証。範囲外・型違いは拒否(クランプも四捨五入もしない)。 */
  private checkParamValue(moduleId: string | null, p: ParamInfo, value: unknown): number {
    const integral = p.kind !== "float";
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new CommandError("ERR-122", `${p.name} の値が有限の数値でない`, {
        module_id: moduleId,
        param: p.name,
        expected: integral ? "integer" : "finite_number",
      });
    }
    if (integral && !Number.isInteger(value)) {
      throw new CommandError("ERR-122", `${p.name} は整数`, { module_id: moduleId, param: p.name, expected: "integer" });
    }
    if (value < p.min || value > p.max) {
      throw new CommandError("ERR-123", `${p.name} は ${p.min}〜${p.max} の範囲`, {
        module_id: moduleId,
        param: p.name,
        value,
        min: p.min,
        max: p.max,
      });
    }
    return value === 0 ? 0 : value; // −0 を 0 にそろえる(JSON では区別できない)
  }

  /** パッチ内の `seed` 型パラメータの値(§14)。 */
  private seedsIn(d: Draft, exceptModule?: string): { module_id: string; param: string; value: number }[] {
    const out: { module_id: string; param: string; value: number }[] = [];
    for (const m of d.modules) {
      if (m.id === exceptModule) continue;
      const info = this.catalog.get(m.type);
      if (!info) continue;
      for (const p of info.params) {
        if (p.kind === "seed") out.push({ module_id: m.id, param: p.name, value: m.params[p.name]! });
      }
    }
    return out;
  }

  private seedWarning(d: Draft, moduleId: string, param: string, value: number): Warning[] {
    const near = this.seedsIn(d, moduleId).filter((s) => Math.abs(s.value - value) < SEED_STEP);
    if (near.length === 0) return [];
    return [
      {
        code: "duplicate_seed",
        message: `${moduleId}.${param} = ${value} は他のモジュールの seed と同じか、差が ${SEED_STEP} 未満`,
        details: { module_id: moduleId, param, value, conflicts: near },
      },
    ];
  }

  private allocId(prefix: "m" | "c", d: Draft): string {
    for (;;) {
      const n = prefix === "m" ? d.nextM : d.nextC;
      if (!Number.isSafeInteger(n + 1)) throw new Error("自動採番の番号が大きすぎる"); // 起きない(番号は桁数の上限つき)。固まらないための保険
      const id = prefix + (prefix === "m" ? d.nextM++ : d.nextC++);
      const used = prefix === "m" ? d.modules.some((m) => m.id === id) : d.cables.some((c) => c.id === id);
      if (!used) return id;
    }
  }

  private opModuleAdd(d: Draft, a: Args): OpOutput {
    checkKeys(a, ["type", "id", "params", "ui"]);
    const type = reqString(a, "type");
    const givenId = parseNewId(a, "id");
    if ("params" in a && !isObj(a.params)) throw bad("params", "type");
    const given: Args = (a.params as Args | undefined) ?? {};
    const ui = parseUi(a, "ui", false, this.limits.uiBytes);

    const info = this.typeInfo(type);
    if (type === OUT_TYPE) throw new CommandError("ERR-105", `${OUT_TYPE} は追加できない(常に1つ)`, { type });
    if (givenId !== undefined && d.modules.some((m) => m.id === givenId)) {
      throw new CommandError("ERR-103", `モジュールID ${givenId} は既に使われている`, { module_id: givenId });
    }
    if (d.modules.length >= this.limits.modules) {
      throw new CommandError("ERR-106", "モジュール数の上限", { limit: "modules", max: this.limits.modules });
    }
    const defs = this.paramsOf(type);
    for (const name of Object.keys(given)) {
      if (!defs.has(name)) {
        throw new CommandError("ERR-121", `${type} にパラメータ ${name} はない`, { module_id: givenId ?? null, param: name });
      }
    }
    const params: Record<string, number> = {};
    for (const p of info.params) {
      params[p.name] = p.name in given ? this.checkParamValue(givenId ?? null, p, given[p.name]) : p.default;
    }

    let id: string;
    if (givenId !== undefined) {
      id = givenId;
      const n = numberedId("m", id);
      if (n !== null) d.nextM = Math.max(d.nextM, n + 1); // §2.2 の規則5
    } else {
      id = this.allocId("m", d);
    }
    const warnings: Warning[] = [];
    for (const p of info.params) {
      if (p.kind !== "seed") continue;
      if (p.name in given) {
        warnings.push(...this.seedWarning(d, id, p.name, params[p.name]!));
      } else {
        // §14: 既定 + 16k のうち、どのモジュールの値も [候補, 候補+15] に入っていない最小の候補
        const used = this.seedsIn(d).map((s) => s.value);
        let cand = p.default;
        while (cand <= p.max && used.some((v) => v >= cand && v <= cand + SEED_STEP - 1)) cand += SEED_STEP;
        params[p.name] = cand <= p.max ? cand : p.default;
      }
    }
    const module: PatchModule = { id, type, spec_version: info.specVersion, params };
    if (ui) module.ui = ui;
    d.modules.push(module);
    d.changes.push({ kind: "module_added", module });
    return { result: { module }, changed: true, warnings };
  }

  private opModuleRemove(d: Draft, a: Args): OpOutput {
    checkKeys(a, ["module_id"]);
    const id = reqString(a, "module_id");
    this.findModule(d, id);
    if (id === OUT_ID) throw new CommandError("ERR-104", "常設モジュール out は削除できない", { module_id: id });
    const removed = d.cables.filter((c) => c.from.module === id || c.to.module === id);
    d.cables = d.cables.filter((c) => !removed.includes(c));
    d.modules = d.modules.filter((m) => m.id !== id);
    for (const c of removed) d.changes.push({ kind: "cable_removed", cable_id: c.id, cable: c });
    d.changes.push({ kind: "module_removed", module_id: id });
    return {
      result: { removed_module_id: id, removed_cable_ids: removed.map((c) => c.id) },
      changed: true,
      warnings: [],
    };
  }

  private opModuleMove(d: Draft, a: Args): OpOutput {
    checkKeys(a, ["module_id", "ui"]);
    const id = reqString(a, "module_id");
    const given = parseUi(a, "ui", true, this.limits.uiBytes)!;
    const m = this.findModule(d, id);
    // x・y 以外の保持しているキー(DAT-11)は残す
    const ui: ModuleUi = { ...(m.ui ?? {}), ...given };
    if (utf8Bytes(JSON.stringify(ui)) > this.limits.uiBytes) throw bad("ui", "too_large");
    const changed = stable(ui) !== stable(m.ui ?? null);
    if (changed) {
      d.modules[d.modules.indexOf(m)] = { ...m, ui };
      d.changes.push({ kind: "module_moved", module_id: id, ui });
    }
    return { result: { module_id: id, ui, changed }, changed, warnings: [] };
  }

  /** ポートを探す。向きが違えば ERR-112、名前がなければ ERR-111。 */
  private findPort(d: Draft, ref: PortRef, want: "out" | "in"): PortInfo {
    const m = this.findModule(d, ref.module);
    const info = this.typeInfo(m.type);
    const right = (want === "out" ? info.outputs : info.inputs).find((p) => p.name === ref.port);
    if (right) return right;
    const wrong = (want === "out" ? info.inputs : info.outputs).find((p) => p.name === ref.port);
    if (!wrong) {
      throw new CommandError("ERR-111", `${ref.module}(${m.type})にポート ${ref.port} はない`, {
        module_id: ref.module,
        port: ref.port,
      });
    }
    throw new CommandError(
      "ERR-112",
      want === "out" ? `${ref.module}.${ref.port} は出力でない` : `${ref.module}.${ref.port} は入力でない`,
      { module_id: ref.module, port: ref.port, direction: want === "out" ? "in" : "out" },
    );
  }

  private opCableConnect(d: Draft, a: Args): OpOutput {
    checkKeys(a, ["from", "to", "id"]);
    const from = parsePortRef(a, "from");
    const to = parsePortRef(a, "to");
    const givenId = parseNewId(a, "id");

    // 対象の存在(ERR-102, ERR-111)を両端で見てから、規則(ERR-112 以降)を見る
    const ends: [PortRef, "out" | "in"][] = [
      [from, "out"],
      [to, "in"],
    ];
    const found: (PortInfo | CommandError)[] = [];
    for (const [ref, want] of ends) {
      try {
        found.push(this.findPort(d, ref, want));
      } catch (e) {
        if (e instanceof CommandError && e.id === "ERR-112") found.push(e);
        else throw e;
      }
    }
    for (const f of found) if (f instanceof CommandError) throw f;
    const [src, dst] = found as [PortInfo, PortInfo];
    for (const [ref, port] of [
      [from, src],
      [to, dst],
    ] as [PortRef, PortInfo][]) {
      if (!port.connectable) {
        throw new CommandError("ERR-113", `${ref.module}.${ref.port} はケーブルで接続できない`, {
          module_id: ref.module,
          port: ref.port,
        });
      }
    }
    const existing = d.cables.find((c) => samePort(c.to, to));
    if (existing) {
      throw new CommandError("ERR-114", `入力 ${to.module}.${to.port} には既にケーブル ${existing.id} がある`, {
        existing_cable_id: existing.id,
        same_source: samePort(existing.from, from),
      });
    }
    if (givenId !== undefined && d.cables.some((c) => c.id === givenId)) {
      throw new CommandError("ERR-116", `ケーブルID ${givenId} は既に使われている`, { cable_id: givenId });
    }
    if (d.cables.length >= this.limits.cables) {
      throw new CommandError("ERR-106", "ケーブル数の上限", { limit: "cables", max: this.limits.cables });
    }

    let id: string;
    if (givenId !== undefined) {
      id = givenId;
      const n = numberedId("c", id);
      if (n !== null) d.nextC = Math.max(d.nextC, n + 1);
    } else {
      id = this.allocId("c", d);
    }
    const cable: Cable = { id, from, to };
    d.cables.push(cable);
    d.changes.push({ kind: "cable_added", cable });
    const warnings: Warning[] = [];
    if (src.type !== dst.type) {
      warnings.push({
        code: "type_mismatch",
        message: `型の違う接続(${src.type} → ${dst.type})`,
        details: { cable_id: id, from_type: src.type, to_type: dst.type },
      });
    }
    return { result: { cable }, changed: true, warnings };
  }

  private opCableDisconnect(d: Draft, a: Args): OpOutput {
    checkKeys(a, ["cable_id", "to"]);
    const hasId = "cable_id" in a;
    const hasTo = "to" in a;
    if (hasId === hasTo) throw bad(hasId ? "to" : "cable_id", hasId ? "exclusive" : "missing", "cable_id か to のどちらか一方を指定する");
    let cable: Cable | undefined;
    if (hasId) {
      const id = reqString(a, "cable_id");
      cable = d.cables.find((c) => c.id === id);
      if (!cable) throw new CommandError("ERR-115", `ケーブル ${id} は存在しない`, { cable_id: id });
    } else {
      const to = parsePortRef(a, "to");
      const m = this.findModule(d, to.module);
      if (!this.typeInfo(m.type).inputs.some((p) => p.name === to.port)) {
        throw new CommandError("ERR-111", `${to.module}(${m.type})に入力ポート ${to.port} はない`, {
          module_id: to.module,
          port: to.port,
        });
      }
      cable = d.cables.find((c) => samePort(c.to, to));
      if (!cable) throw new CommandError("ERR-115", `入力 ${to.module}.${to.port} にケーブルはない`, { to });
    }
    d.cables = d.cables.filter((c) => c !== cable);
    d.changes.push({ kind: "cable_removed", cable_id: cable.id, cable });
    return { result: { removed_cable: cable }, changed: true, warnings: [] };
  }

  private opParamSet(d: Draft, a: Args, actor: ActorInfo): OpOutput {
    checkKeys(a, ["module_id", "param", "value", "coalesce_key"]);
    const id = reqString(a, "module_id");
    const name = reqString(a, "param");
    if (!("value" in a)) throw bad("value", "missing");
    let coalesceKey: string | undefined;
    if ("coalesce_key" in a) {
      const k = a.coalesce_key;
      if (typeof k !== "string") throw bad("coalesce_key", "type");
      if (charLen(k) < 1 || charLen(k) > 64) throw bad("coalesce_key", "length");
      coalesceKey = k;
    }
    const m = this.findModule(d, id);
    const p = this.paramsOf(m.type).get(name);
    if (!p) throw new CommandError("ERR-121", `${id}(${m.type})にパラメータ ${name} はない`, { module_id: id, param: name });
    const value = this.checkParamValue(id, p, a.value);
    const previous = m.params[name]!;
    const changed = value !== previous;
    if (changed) {
      d.modules[d.modules.indexOf(m)] = { ...m, params: { ...m.params, [name]: value } };
      d.changes.push({ kind: "param_changed", module_id: id, param: name, value });
    }
    const out: OpOutput = {
      result: { module_id: id, param: name, value, previous, changed },
      changed,
      warnings: p.kind === "seed" ? this.seedWarning(d, id, name, value) : [],
    };
    if (coalesceKey !== undefined) out.coalesce = { actor, key: coalesceKey, moduleId: id, param: name };
    return out;
  }

  private opSetMeta(d: Draft, a: Args): OpOutput {
    checkKeys(a, ["title", "description"]);
    if (!("title" in a) && !("description" in a)) throw bad("title", "missing", "title か description の少なくとも一方が必要");
    const text = (key: "title" | "description", max: number): string | undefined => {
      if (!(key in a)) return undefined;
      const v = a[key];
      if (typeof v !== "string") throw bad(key, "type");
      if (charLen(v) > max) throw bad(key, "length", `${key} は ${max} 文字以内`);
      return v;
    };
    const title = text("title", 120);
    const description = text("description", 2000);
    const before = { title: d.title, description: d.description };
    if (title !== undefined) d.title = title;
    if (description !== undefined) d.description = description;
    const changed = d.title !== before.title || d.description !== before.description;
    const meta = metaOf(d, this.state.stamp);
    if (changed) d.changes.push({ kind: "meta_changed", meta });
    return { result: { meta, changed }, changed, warnings: [] };
  }

  // ---- batch(CMD-09) ----

  private cmdBatch(args: Args, ctx: Ctx): ExecOutput {
    checkKeys(args, ["ops"]);
    if (!("ops" in args)) throw bad("ops", "missing");
    const ops = args.ops;
    if (!Array.isArray(ops)) throw bad("ops", "type");
    if (ops.length === 0) throw bad("ops", "empty", "ops は 1 件以上");
    if (ops.length > this.limits.batchOps) {
      throw new CommandError("ERR-106", "batch の操作数の上限", { limit: "batch_ops", max: this.limits.batchOps });
    }
    const parsed: { command: string; args: Args }[] = [];
    ops.forEach((op: unknown, i: number) => {
      if (!isObj(op)) throw bad(`ops[${i}]`, "type");
      checkKeys(op, ["command", "args"], `ops[${i}].`);
      if (typeof op.command !== "string") throw bad(`ops[${i}].command`, "command" in op ? "type" : "missing");
      if ("args" in op && !isObj(op.args)) throw bad(`ops[${i}].args`, "type");
      parsed.push({ command: op.command, args: (op.args as Args | undefined) ?? {} });
    });
    // 1件でも入れられないコマンドがあれば、何も検証せず拒否
    parsed.forEach((op, i) => {
      const spec = Object.prototype.hasOwnProperty.call(COMMANDS, op.command) ? COMMANDS[op.command] : undefined;
      if (!spec?.batch) {
        throw new CommandError("ERR-132", `batch に入れられないコマンド ${op.command}`, { index: i, command: op.command });
      }
    });
    const d = this.newDraft();
    const results: Record<string, unknown>[] = [];
    const warnings: Warning[] = [];
    let changed = false;
    parsed.forEach((op, i) => {
      let out: OpOutput;
      try {
        out = this.applyOp(d, op.command, op.args, ctx.actor);
      } catch (e) {
        if (!(e instanceof CommandError)) throw e;
        throw new CommandError("ERR-131", `batch の ${i} 番目(${op.command})が失敗。全体を適用しない`, {
          failed_index: i,
          cause: e.toBody(),
        });
      }
      results.push(out.result);
      for (const w of out.warnings) warnings.push({ ...w, details: { ...w.details, index: i } });
      if (out.changed) changed = true;
    });
    if (changed) this.commit(ctx, d, false);
    return { result: { results, changed }, warnings };
  }

  // ---- 読出し ----

  private cmdListTypes(args: Args): ExecOutput {
    const out = listTypes(this.catalog, args, OUT_TYPE, READOUTS);
    if ("id" in out) throw new CommandError(out.id, out.message, out.details ?? {});
    return { result: out, warnings: [] };
  }

  private cmdModuleGet(args: Args): ExecOutput {
    checkKeys(args, ["module_id"]);
    const id = reqString(args, "module_id");
    const module = this.state.modules.find((m) => m.id === id);
    if (!module) throw new CommandError("ERR-102", `モジュール ${id} は存在しない`, { module_id: id });
    const cables = this.state.cables.filter((c) => c.from.module === id || c.to.module === id);
    return { result: { module, cables }, warnings: [] };
  }

  private engineRevision(s: BackendStatus, reported?: number | null): number | null {
    if (s.audioState === "stopped") return null;
    if (reported !== undefined) return reported;
    return s.engineRevision !== undefined ? s.engineRevision : this.pushedRevision;
  }

  private cmdGetStatus(args: Args): ExecOutput {
    checkKeys(args, []);
    const s = this.backend.status();
    const stopped = s.audioState === "stopped";
    const modules = stopped ? 0 : s.nonfiniteModules;
    const stage = stopped ? 0 : s.nonfiniteOutputStage;
    return {
      result: {
        audio_state: s.audioState,
        panic: s.panic,
        fs: stopped ? null : s.fs,
        engine_revision: this.engineRevision(s),
        sample_time: s.sampleTime,
        output: {
          level_db: s.levelDb,
          agent_max_level_db: s.agentMaxLevelDb,
          clip_count: stopped ? 0 : s.clipCount,
          nonfinite_count: modules + stage,
          nonfinite_detail: { modules, output_stage: stage },
        },
        midi: { available: s.midiAvailable },
        history: this.history,
      },
      warnings: [],
    };
  }

  private cmdMeterRead(args: Args): ExecOutput {
    checkKeys(args, ["module_id", "fields"]);
    const id = reqString(args, "module_id");
    const module = this.state.modules.find((m) => m.id === id);
    const known: readonly string[] | undefined = module ? READOUTS[module.type] : undefined;
    // 既定は、波形フレーム(大きい)以外の全項目。種別が分からないうちは、どの読出し値の名前でも通す(存在の検査が先: ERR-102)
    let fields: string[] = (known ?? []).filter((f) => f !== "frame");
    if ("fields" in args) {
      const f = args.fields;
      if (!Array.isArray(f)) throw bad("fields", "type");
      const names: readonly string[] = known ?? ALL_READOUT_NAMES;
      f.forEach((name: unknown, i: number) => {
        if (typeof name !== "string") throw bad(`fields[${i}]`, "type");
        if (!names.includes(name)) throw bad(`fields[${i}]`, "unknown_field", `未知の項目 ${name}`);
      });
      fields = [...new Set(f as string[])];
    }
    if (!module) throw new CommandError("ERR-102", `モジュール ${id} は存在しない`, { module_id: id });
    if (!known) {
      throw new CommandError("ERR-303", `${id}(${module.type})は読出し値を持たない`, { module_id: id, type: module.type });
    }
    const s = this.backend.status();
    if (s.audioState !== "running") {
      throw new CommandError("ERR-301", "音声が動作中でない", { audio_state: s.audioState });
    }
    const reading = this.backend.meterRead(id, fields);
    const values: Record<string, unknown> = {};
    for (const f of fields) values[f] = reading.values[f];
    return {
      result: {
        values,
        sample_time: reading.sampleTime,
        fs: reading.fs,
        engine_revision: this.engineRevision(s, reading.engineRevision),
      },
      warnings: [],
    };
  }

  // ---- パッチ全体の置き換えと履歴 ----

  private cmdPatchNew(args: Args, ctx: Ctx): ExecOutput {
    checkKeys(args, []);
    const empty = this.emptyState();
    const d = this.newDraft();
    d.title = empty.title;
    d.description = empty.description;
    d.modules = [...empty.modules];
    d.cables = [];
    this.commit(ctx, d, true); // 次番号は戻さない(§2.2 の規則3)
    return { result: { patch: this.exportPatch() }, warnings: [] };
  }

  private cmdUndoRedo(args: Args, ctx: Ctx, dir: "undo" | "redo"): ExecOutput {
    checkKeys(args, []);
    const from = dir === "undo" ? this.undoStack : this.redoStack;
    const entry = from[from.length - 1];
    if (!entry) {
      throw dir === "undo"
        ? new CommandError("ERR-141", "取り消せる履歴がない", {})
        : new CommandError("ERR-142", "やり直せる履歴がない", {});
    }
    const target = dir === "undo" ? entry.before : entry.after;
    // 保存時刻など(DAT-35)は履歴の対象外。置き換えのときだけ、置き換わるパッチが持っていた値になる
    const next: State = entry.replaced ? target : { ...target, stamp: this.state.stamp };
    const changes = entry.replaced ? [] : this.diff(this.state, next);
    from.pop();
    // 取り消し・やり直しを挟んだら、連続操作のまとめ(§9.4)は切る
    const { coalesce: _drop, ...plain } = entry;
    if (entry.replaced) {
      // DAT-35: 置き換わる(今から離れる)側のパッチは、今の保存時刻など(置き換えの後の patch.save の分を含む)を持つ
      if (dir === "undo") plain.after = { ...entry.after, stamp: this.state.stamp };
      else plain.before = { ...entry.before, stamp: this.state.stamp };
    }
    (dir === "undo" ? this.redoStack : this.undoStack).push(plain);
    // 取り消しで履歴の先頭に戻ってきた項目も、まとめの続きにしない(間に他の変更とその取り消しが入っている)
    const top = this.undoStack[this.undoStack.length - 1];
    if (top?.coalesce !== undefined) {
      const { coalesce: _cut, ...rest } = top;
      this.undoStack[this.undoStack.length - 1] = rest;
    }
    // §2.2 の規則4: 次番号は下げない
    this.nextM = Math.max(this.nextM, maxNumbered("m", next.modules.map((m) => m.id)) + 1);
    this.nextC = Math.max(this.nextC, maxNumbered("c", next.cables.map((c) => c.id)) + 1);
    this.install(ctx, next, changes, entry.replaced);
    const info = { command: entry.command, actor: entry.actor, revision: entry.revision };
    return { result: { [dir === "undo" ? "undone" : "redone"]: info, history: this.history }, warnings: [] };
  }

  /** a から b への変更の列(取り消し・やり直しで実際に起きた変更。§10)。 */
  private diff(a: State, b: State): IChange[] {
    const changes: IChange[] = [];
    const sameCable = (x: Cable, y: Cable) => samePort(x.from, y.from) && samePort(x.to, y.to);
    const aMods = new Map(a.modules.map((m) => [m.id, m]));
    const bMods = new Map(b.modules.map((m) => [m.id, m]));
    const aCables = new Map(a.cables.map((c) => [c.id, c]));
    const bCables = new Map(b.cables.map((c) => [c.id, c]));
    // 同じIDで種別が変わるモジュールは「削除して追加」になる。音声側は削除でつながるケーブルも外すので、
    // そのモジュールにつながるケーブルは、IDと両端が同じでも「外して、つなぎ直す」として扱う。
    const swapped = new Set<string>();
    for (const m of a.modules) {
      const other = bMods.get(m.id);
      if (other && other.type !== m.type) swapped.add(m.id);
    }
    const touchesSwapped = (c: Cable) => swapped.has(c.from.module) || swapped.has(c.to.module);
    for (const c of a.cables) {
      const other = bCables.get(c.id);
      if (!other || !sameCable(c, other) || touchesSwapped(c)) changes.push({ kind: "cable_removed", cable_id: c.id, cable: c });
    }
    for (const m of a.modules) {
      const other = bMods.get(m.id);
      if (!other || other.type !== m.type) changes.push({ kind: "module_removed", module_id: m.id });
    }
    for (const m of b.modules) {
      const old = aMods.get(m.id);
      if (!old || old.type !== m.type) {
        changes.push({ kind: "module_added", module: m });
        continue;
      }
      if (old === m) continue;
      for (const [name, value] of Object.entries(m.params)) {
        if (old.params[name] !== value) changes.push({ kind: "param_changed", module_id: m.id, param: name, value });
      }
      if (stable(old.ui ?? null) !== stable(m.ui ?? null)) {
        changes.push({ kind: "module_moved", module_id: m.id, ui: m.ui ?? null });
      }
    }
    for (const c of b.cables) {
      const old = aCables.get(c.id);
      if (!old || !sameCable(old, c) || touchesSwapped(c)) changes.push({ kind: "cable_added", cable: c });
    }
    if (a.title !== b.title || a.description !== b.description) {
      changes.push({ kind: "meta_changed", meta: metaOf(b, b.stamp) });
    }
    return changes;
  }

  // ---- 音声・音量(リビジョンと履歴の対象外) ----

  private cmdStart(args: Args, ctx: Ctx): ExecOutput {
    checkKeys(args, []);
    const before = this.backend.status();
    if (before.audioState !== "running") {
      // 開始できないと分かっているなら、何も変えずに失敗する(§5: エラーで状態は変わらない。音量の引き下げも行わない)
      const can = this.backend.canStart?.();
      if (can && !can.ok) throw new CommandError("ERR-304", "音声を開始できなかった", { reason: can.reason });
      if (before.audioState === "stopped") {
        // 開始時に現在のパッチ全体から構築する(§2.3、§11.4)
        this.backend.applyPatch(this.exportPatch(), this.rev);
        this.pushedRevision = this.rev;
      }
      const r = this.backend.start();
      if (!r.ok) {
        // 事前の確認を通ったのに失敗した場合: パッチの渡し直しで音量が下がっていれば、失敗でもその通知は出す(下がったことを隠さない)
        const failed = this.backend.status();
        this.seen = failed;
        if (failed.levelDb !== before.levelDb) ctx.events.push(this.outputEvent(failed, null, "reset_to_default"));
        throw new CommandError("ERR-304", "音声を開始できなかった", { reason: r.reason });
      }
      const after = this.backend.status();
      if (after.audioState !== before.audioState || after.fs !== before.fs) ctx.events.push(this.stateEvent(after));
      if (after.levelDb !== before.levelDb) ctx.events.push(this.outputEvent(after, ctx.actor, "reset_to_default"));
    }
    const s = this.backend.status();
    return { result: { audio_state: s.audioState, fs: s.audioState === "stopped" ? null : s.fs }, warnings: [] };
  }

  private cmdPanic(args: Args, ctx: Ctx): ExecOutput {
    checkKeys(args, []);
    const before = this.backend.status();
    this.backend.panic(); // 緊急停止中でも毎回実行する(§7.1)
    const after = this.backend.status();
    if (!before.panic) ctx.events.push(this.outputEvent(after, ctx.actor, "panic"));
    // 予約済みの楽譜はすべて捨てる(解除した後に、続きが鳴り出さない)
    this.backend.clearSchedule?.();
    const stopped = this.perf.clear();
    this.perf.closeRecord("panic", this.backend.sampleNow?.() ?? after.sampleTime);
    if (stopped) ctx.events.push(this.performanceEvent("stopped", ctx.actor));
    return { result: { panic: true }, warnings: [] };
  }

  // ---- 演奏(楽譜の予約と、人からの指示。operation-contract CMD-26〜29。リビジョンと履歴の対象外) ----

  /** 演奏の状態。終わった楽譜は外してから返す。 */
  private performanceStatus(): PerformanceStatus {
    const s = this.backend.status();
    const fs = s.fs ?? 48000;
    const now = this.backend.sampleNow?.() ?? s.sampleTime;
    // 読むだけ(予約は捨てない)。終わった楽譜を捨てて「演奏し終えた」を知らせるのは、状態の確認(pollBackend)と score.play だけ。
    // ここで捨てると、通知(EVT-07 finished)と、楽譜が動かしたパラメータの戻しが抜ける
    const live = this.perf.scores.filter((q) => q.endSample > now);
    const sec = (samples: number): number => Math.max(0, Math.round(((samples - now) / fs) * 1000) / 1000);
    const end = live.length > 0 ? live[live.length - 1]!.endSample : null;
    return {
      playing: live.length > 0,
      remaining: end === null ? 0 : sec(end),
      scores: live.map((q) => ({ score_id: q.id, actor: q.actor, starts_in: sec(q.startSample), ends_in: sec(q.endSample), notes: q.notes })),
      prompts: this.perf.prompts,
      plan: {
        duration_seconds: this.perf.planSeconds,
        elapsed_seconds: this.perf.recordBase === null ? 0 : Math.max(0, Math.round(((now - this.perf.recordBase) / fs) * 1000) / 1000),
      },
    };
  }

  private performanceEvent(reason: PerformanceChangedEvent["data"]["reason"], actor: ActorInfo | null): SessionEvent {
    return { v: 1, event: "performance.changed", session_id: this.sessionId, data: { ...this.performanceStatus(), reason, actor } };
  }

  /** 演奏できる状態かを確かめ、音声側のサンプルレートと今のサンプル時刻を返す(ERR-301)。 */
  private performable(): { fs: number; now: number } {
    const s = this.backend.status();
    if (s.audioState !== "running") throw new CommandError("ERR-301", "音声が動作中でない", { audio_state: s.audioState });
    if (s.panic) throw new CommandError("ERR-301", "緊急停止中は演奏できない", { audio_state: s.audioState, panic: true });
    if (!this.backend.sampleNow || !this.backend.scheduleMidi || !this.backend.clearSchedule || s.fs === null) {
      throw new Error("この音声側は楽譜の予約に対応していない");
    }
    return { fs: s.fs, now: this.backend.sampleNow() };
  }

  /** 楽譜の中のパラメータの変化を、param.set と同じ規則で確かめる(ERR-102 → ERR-121 → ERR-122 → ERR-123)。パッチは変えない。 */
  private checkScoreParams(score: ParsedScore): CheckedParam[] {
    return score.params.map((p) => {
      const m = this.state.modules.find((x) => x.id === p.moduleId);
      if (!m) throw new CommandError("ERR-102", `モジュール ${p.moduleId} は存在しない`, { module_id: p.moduleId, arg: `params[${p.index}].module_id` });
      const info = this.paramsOf(m.type).get(p.param);
      if (!info) throw new CommandError("ERR-121", `${p.moduleId}(${m.type})にパラメータ ${p.param} はない`, { module_id: p.moduleId, param: p.param, arg: `params[${p.index}].param` });
      if (info.kind === "seed") throw new CommandError("ERR-123", "seed は楽譜では動かせない", { module_id: p.moduleId, param: p.param, arg: `params[${p.index}].param` });
      return { t: p.t, dur: info.kind === "float" ? p.dur : 0, moduleId: p.moduleId, param: p.param, value: this.checkParamValue(p.moduleId, info, p.value) };
    });
  }

  /** 楽譜を音声側へ予約し、演奏の状態と演奏データに足す。 */
  private queueScore(actor: ActorInfo, raw: Args, score: ParsedScore, checked: CheckedParam[], start: number, fs: number, replayOf?: string): QueuedScore {
    const end = start + Math.max(1, Math.round(score.lengthSeconds * fs));
    this.backend.scheduleMidi!(scoreEvents(score.notes, start, fs, checked));
    const queued = this.perf.add(actor, start, end, score.notes.length);
    // 演奏データには、渡された楽譜をそのまま残す(mode と ack_prompt は、演奏の内容ではないので除く)
    const { mode: _m, ack_prompt: _a, ...kept } = raw;
    this.perf.recordScore(clone(actor), clone(kept), start, end, fs, this.exportPatch(), this.rev, replayOf);
    return queued;
  }

  private cmdScorePlay(args: Args, ctx: Ctx): ExecOutput {
    const score = parseScore(args);
    const { fs, now } = this.performable();
    const checked = this.checkScoreParams(score);
    if (this.perf.prune(now)) {
      // 前の演奏は、状態の確認より先に終わっていた: ここで「演奏し終えた」を済ませる(パラメータを戻し、知らせる)
      this.backend.clearSchedule!();
      ctx.events.push(this.performanceEvent("finished", null));
    }
    const replace = score.mode === "replace";
    // 開始: 予約があれば、その末尾に切れ目なく続ける。なければ(または置き換えなら)、少しの余裕を置いて今から
    const earliest = now + Math.round(SCORE_LIMITS.leadSeconds * fs);
    const tail = replace ? null : this.perf.endSample;
    const start = tail !== null && tail > earliest ? tail : earliest;
    const end = start + Math.max(1, Math.round(score.lengthSeconds * fs));
    if (!replace && this.perf.queuedNotes + score.notes.length > SCORE_LIMITS.queuedNotes) {
      throw new CommandError("ERR-106", "予約済みの音符の数の上限", { limit: "queued_notes", max: SCORE_LIMITS.queuedNotes });
    }
    if ((end - now) / fs > SCORE_LIMITS.horizonSeconds) {
      throw new CommandError("ERR-106", "予約できる時間の上限", { limit: "score_horizon_seconds", max: SCORE_LIMITS.horizonSeconds });
    }
    // ここから状態を変える
    if (replace) {
      this.backend.clearSchedule!();
      this.perf.clear();
      this.perf.closeRecord("replaced", now); // 置き換えは、新しい演奏の始まり(演奏データも分ける)
    }
    const queued = this.queueScore(ctx.actor, args, score, checked, start, fs);
    const acked = score.ackPrompt !== null && this.perf.ack(score.ackPrompt);
    ctx.events.push(this.performanceEvent(replace ? "score_replaced" : "score_queued", ctx.actor));
    if (acked) ctx.events.push(this.performanceEvent("prompt_acked", ctx.actor));
    const warnings: Warning[] = [];
    if (!this.state.modules.some((m) => m.type === MIDI_TYPE)) {
      warnings.push({ code: "no_midi_module", message: `パッチに ${MIDI_TYPE}(MIDI-CV)がないので、楽譜は音にならない`, details: {} });
    }
    const st = this.performanceStatus();
    const mine = st.scores.find((q) => q.score_id === queued.id);
    return {
      result: { score_id: queued.id, starts_in: mine?.starts_in ?? 0, ends_in: mine?.ends_in ?? 0, remaining: st.remaining, queued_scores: st.scores.length, prompts: st.prompts, plan: st.plan },
      warnings,
    };
  }

  /**
   * 保存した演奏データを再演奏する(performance.replay の中身。パッチは、呼ぶ側が先に置き換えてある)。
   * 予約済みの楽譜を捨て、記録された位置のとおりに、すべての楽譜を予約する。予約の数と時間の上限は掛けない
   * (演奏データの大きさの上限で抑えられている)。
   */
  private replayRecord(ctx: Ctx, record: PerformanceRecord, name: string): { scores: number; length_seconds: number; warnings: Warning[] } {
    const { fs, now } = this.performable();
    const parsed = record.entries.map((e, i) => {
      try {
        const score = parseScore(e.score);
        return { at: e.at, raw: e.score, score, checked: this.checkScoreParams(score), actor: e.actor };
      } catch (err) {
        if (err instanceof CommandError) throw new CommandError(err.id, `演奏データの楽譜 ${i + 1}: ${err.message}`, { ...err.details, entry: i });
        throw err;
      }
    });
    this.backend.clearSchedule!();
    this.perf.clear();
    this.perf.closeRecord("replaced", now);
    const base = now + Math.round(SCORE_LIMITS.leadSeconds * fs);
    for (const p of parsed) this.queueScore(ctx.actor, p.raw, p.score, p.checked, base + Math.round(p.at * fs), fs, name);
    ctx.events.push(this.performanceEvent("score_replaced", ctx.actor));
    const warnings: Warning[] = [];
    if (record.entries.some((e) => e.patch_changed)) {
      warnings.push({ code: "patch_changes_ignored", message: "元の演奏では途中でパッチが変わっていた。再演奏は、演奏を始めた時点のパッチで行う", details: {} });
    }
    return { scores: parsed.length, length_seconds: record.length_seconds, warnings };
  }

  /** CMD-33 performance.set_plan: 演奏の長さの予定(エージェントへの情報。この長さで自動的に止めることはしない)。 */
  private cmdSetPlan(args: Args, ctx: Ctx): ExecOutput {
    checkKeys(args, ["duration_seconds"]);
    if (!("duration_seconds" in args)) throw bad("duration_seconds", "missing");
    const d = args.duration_seconds;
    if (d !== null && (typeof d !== "number" || !Number.isFinite(d))) throw bad("duration_seconds", "type");
    if (d !== null && (d < 1 || d > SCORE_LIMITS.planMaxSeconds)) {
      throw new CommandError("ERR-123", `duration_seconds は 1〜${SCORE_LIMITS.planMaxSeconds}(または null)`, { arg: "duration_seconds", value: d, min: 1, max: SCORE_LIMITS.planMaxSeconds });
    }
    const changed = this.perf.planSeconds !== d;
    this.perf.planSeconds = d;
    if (changed) ctx.events.push(this.performanceEvent("plan_changed", ctx.actor));
    return { result: { plan: this.performanceStatus().plan }, warnings: [] };
  }

  private cmdScoreStop(args: Args, ctx: Ctx): ExecOutput {
    checkKeys(args, []);
    this.backend.clearSchedule?.(); // 予約がなくても毎回実行する(鳴り続けている音を止める)
    const had = this.perf.clear();
    this.perf.closeRecord("stopped", this.backend.sampleNow?.() ?? this.backend.status().sampleTime);
    if (had) ctx.events.push(this.performanceEvent("stopped", ctx.actor));
    return { result: { stopped: had }, warnings: [] };
  }

  private cmdPromptSend(args: Args, ctx: Ctx): ExecOutput {
    checkKeys(args, ["text"]);
    if (!("text" in args)) throw bad("text", "missing");
    const text = args.text;
    if (typeof text !== "string") throw bad("text", "type");
    const n = charLen(text.trim());
    if (n < 1 || n > SCORE_LIMITS.promptChars) throw bad("text", n < 1 ? "empty" : "too_long", `text は 1〜${SCORE_LIMITS.promptChars} 文字`);
    const p = this.perf.addPrompt(text.trim());
    this.perf.recordPrompt(p.id, p.text, this.backend.sampleNow?.() ?? this.backend.status().sampleTime);
    ctx.events.push(this.performanceEvent("prompt_sent", ctx.actor));
    return { result: { prompt: p }, warnings: [] };
  }

  private cmdReleasePanic(args: Args, ctx: Ctx): ExecOutput {
    checkKeys(args, []);
    if (this.backend.status().panic) {
      this.backend.releasePanic();
      ctx.events.push(this.outputEvent(this.backend.status(), ctx.actor, "release_panic"));
    }
    return { result: { panic: false }, warnings: [] };
  }

  private cmdSetLevel(args: Args, ctx: Ctx): ExecOutput {
    checkKeys(args, ["level_db"]);
    if (!("level_db" in args)) throw bad("level_db", "missing");
    const db = args.level_db;
    if (typeof db !== "number" || !Number.isFinite(db)) throw bad("level_db", "type");
    const outOfRange = () =>
      new CommandError("ERR-123", `level_db は ${LEVEL_MIN_DB}〜${LEVEL_MAX_DB} の範囲`, {
        arg: "level_db",
        value: db,
        min: LEVEL_MIN_DB,
        max: LEVEL_MAX_DB,
      });
    const before = this.backend.status();
    const overMax = () =>
      new CommandError("ERR-302", "エージェントの音量上限を超える", { level_db: db, max_db: before.agentMaxLevelDb });
    if (db < LEVEL_MIN_DB || db > LEVEL_MAX_DB) throw outOfRange();
    if (ctx.actor.kind === "agent" && db > before.agentMaxLevelDb) throw overMax();
    const r = this.backend.setLevel(db, ctx.actor.kind);
    if (!r.ok) {
      if (r.reason === "out_of_range") throw outOfRange();
      if (r.reason === "over_agent_max") throw overMax();
      throw bad("level_db", "type");
    }
    const after = this.backend.status();
    const changed = after.levelDb !== before.levelDb;
    // CMD-25: 現在と同じ値なら通知は出さない(人の設定による上限の更新は行われている)
    if (changed) ctx.events.push(this.outputEvent(after, ctx.actor, "set_level"));
    return {
      result: { level_db: after.levelDb, agent_max_level_db: after.agentMaxLevelDb, changed },
      warnings: [],
    };
  }

  // ---- ファイル保存 ----

  /** 保存のコマンドの中身(Controller が保存先の読み書きを済ませて渡したもの)を実行する。 */
  private runExternal(ctx: Ctx, run: ExternalRun): ExecOutput {
    const replacePatch = (patch: Patch): void => {
        const next = this.importPatch(patch);
        const d = this.newDraft();
        d.title = next.title;
        d.description = next.description;
        d.modules = [...next.modules];
        d.cables = [...next.cables];
        d.stamp = next.stamp;
        // §2.2 の規則4: 次番号は「現在の次番号」と「置き換え後のパッチ内の最大値+1」の大きい方
        d.nextM = Math.max(d.nextM, maxNumbered("m", next.modules.map((m) => m.id)) + 1);
        d.nextC = Math.max(d.nextC, maxNumbered("c", next.cables.map((c) => c.id)) + 1);
        this.commit(ctx, d, true);
    };
    const out = run({
      actor: clone(ctx.actor),
      replacePatch,
      setSaveStamp: (stamp) => {
        // 履歴の中の状態とは別のオブジェクトにする(履歴・リビジョンの対象外)
        this.state = { ...this.state, stamp: clone(stamp) };
      },
      replayPerformance: (patch, record, name) => {
        this.performable(); // 先に確かめる(演奏できないなら、パッチも変えない)
        const before = this.snapshot();
        const kept = ctx.events.length;
        try {
          replacePatch(patch);
          return this.replayRecord(ctx, record, name);
        } catch (e) {
          // 楽譜の検証で失敗した: パッチの置き換えを取り消す
          this.restore(before);
          ctx.events.length = kept;
          this.backend.applyPatch(this.exportPatch(), this.rev);
          this.pushedRevision = this.rev;
          throw e;
        }
      },
    });
    return { result: out.result, warnings: out.warnings ?? [] };
  }

  /** 保存先を持たない Session に performance.list / read / replay を直接渡したとき(Controller を通さないとき)。 */
  private cmdPerformanceUnsupported(): ExecOutput {
    throw new CommandError("ERR-207", "演奏データの保存先がない", { reason: "not_implemented" });
  }

  /**
   * 保存先を持たない Session に patch.save / load / list / read / delete を直接渡したとき(Controller を通さないとき)。
   * 引数の形(ERR-003)と名前の書式(ERR-201)までは検査し、その先は ERR-207(reason: "not_implemented")。
   */
  private cmdStorageUnsupported(cmd: string, args: Args): ExecOutput {
    const checkName = () => {
      const name = reqString(args, "name");
      if (!PATCH_NAME_RE.test(name) || RESERVED_NAMES.test(name)) {
        throw new CommandError("ERR-201", "パッチ名が規則に合わない", { name });
      }
    };
    switch (cmd) {
      case "patch.save":
        checkKeys(args, ["name", "overwrite"]);
        if ("overwrite" in args && typeof args.overwrite !== "boolean") throw bad("overwrite", "type");
        checkName();
        break;
      case "patch.load": {
        checkKeys(args, ["name", "patch"]);
        const hasName = "name" in args;
        const hasPatch = "patch" in args;
        if (hasName === hasPatch) throw bad(hasName ? "patch" : "name", hasName ? "exclusive" : "missing", "name か patch のどちらか一方を指定する");
        if (hasName) checkName();
        else if (!isObj(args.patch)) throw bad("patch", "type");
        break;
      }
      case "patch.list":
        checkKeys(args, []);
        break;
      default: // patch.read, patch.delete
        checkKeys(args, ["name"]);
        checkName();
        break;
    }
    throw new CommandError("ERR-207", `${cmd} は未対応(ファイル保存は未実装)`, { reason: "not_implemented", command: cmd });
  }
}
