// 全コマンドを受ける非同期の窓口(operation-contract v0.3)。
// 保存のコマンド(patch.save / load / list / read / delete。CMD-12〜16)は保存先(PatchStore。非同期)を使って
// ここで処理し、それ以外は Session.handle へ渡す。
//
// 要求は到着順に1件ずつ処理する(§1.2、§11.7): 保存先の読み書きを待つ間に来た要求は待ち行列で待ち、
// 前の要求の応答が決まってから処理する。保存のコマンド1件は次の3段で処理する。
//   A. Session.precheck          … §3.3 の 1〜6(封筒、コマンド名と権限、冪等キー、expected_revision)。状態は変えない
//   B. 保存先の読み書き(非同期)… §3.3 の 7〜9(引数、名前、存在、上書きの権限、件数、検証)と、ファイルの読み書き
//   C. Session.handleExternal    … 応答を作る。メモリ上の状態の変更(読込の置き換え、保存時刻など)、冪等キーの保存、通知
// A と C の間に他の要求は処理されないので、A の検査は C でも同じ結果になる。
//
// この層の対象外(輸送・サーバーの責務): 認証 ERR-004、セッションなし ERR-006(patch.list / patch.read を
// タブなしで応答すること)、応答待ち ERR-007、要求の大きさ ERR-011、通知の `seq`、EVT-05。
import { CommandError, ErrorId } from "./errors.js";
import { agentMayOverwrite, callStore, checkKeys, listPatches, patchNameArg as patchName, readPatch, storeError } from "./library.js";
import {
  MAX_PATCH_BYTES,
  PatchLoadResult,
  isValidPatchName,
  parsePatchText,
  serializePatchDocument,
  utf8ByteLength,
  validatePatchDocument,
} from "./patch-doc.js";
import { MAX_JSON_DEPTH } from "./patch-doc.js";
import { depthExceeds } from "./json.js";
import { RENDER_LIMITS, RenderOptions, parseRenderArgs } from "./render.js";
import { PERFORMANCE_FORMAT, PERFORMANCE_SCHEMA_VERSION, PerformanceRecord } from "./performance.js";
import { ExternalRun, Session } from "./session.js";
import { PatchStore, StoreError, StoreResult } from "./store.js";
import { ActorInfo, ActorKind, CommandResponse, PatchMeta, SavedBy, SessionEvent, Warning } from "./types.js";

/** 保存先の応答を待つ時間の既定値 [ms](契約にない実装上の値)。超えたら ERR-207(保存先の失敗)。 */
export const DEFAULT_STORE_TIMEOUT_MS = 10000;

/** 専用フォルダ内の保存パッチのファイル数の上限(operation-contract §16、data-contract §10。暫定値)。 */
export const MAX_PATCH_FILES = 1000;

/** `meta.app_version` に書く既定の値(package.json の version)。 */
export const DEFAULT_APP_VERSION = "0.0.1";

/** 保存先を使うコマンド(CMD-12〜16)。 */
export const STORAGE_COMMANDS: ReadonlySet<string> = new Set([
  "patch.save", "patch.load", "patch.list", "patch.read", "patch.delete",
  "performance.list", "performance.read", "performance.replay", "performance.render",
]);

/** 演奏データ 1 つの大きさの上限 [バイト](暫定値)。超えたら、その演奏の保存をやめて知らせる。 */
export const MAX_PERFORMANCE_BYTES = 8 * 1024 * 1024;

/** EVT-08: 演奏データを保存した(または保存に失敗した)。 */
export interface PerformanceSavedEvent {
  v: 1;
  event: "performance.saved";
  session_id: string;
  data: { name: string | null; ok: boolean; entries: number; length_seconds: number; closed: boolean; reason?: string };
}

/** EVT-06 */
export interface LibraryChangedEvent {
  v: 1;
  event: "library.changed";
  session_id: string;
  data: { name: string; action: "saved" | "deleted"; actor: ActorInfo };
}

/** Controller が出す通知(Session の通知 + EVT-06)。`seq` は輸送層が付ける。 */
export type ControllerEvent = SessionEvent | LibraryChangedEvent | PerformanceSavedEvent;

export interface ControllerOptions {
  session: Session;
  store: PatchStore;
  /** 現在時刻(保存時刻 `saved_at`・`meta.modified_at` を RFC 3339 の UTC で書くため)。Date か、エポックからのミリ秒。 */
  now: () => Date | number;
  /** `meta.app_version` に書く値(0〜32文字)。 */
  appVersion?: string;
  /** 保存パッチのファイル数の上限。 */
  maxPatchFiles?: number;
  /** 保存先の応答を待つ時間 [ms]。0 以下で無制限。 */
  storeTimeoutMs?: number;
  /**
   * 演奏データの保存先(data-contract §15)。あれば、演奏した楽譜を日時つきの名前で保存する。
   * 口は PatchStore と同じ(名前 → 文字列)。なければ、演奏データは保存されず、performance.* は ERR-207。
   */
  performanceStore?: PatchStore;
  /**
   * 演奏データを音声ファイルに書き出す口(CMD-34。サーバーが別スレッドで行う)。頼む・進み具合を聞くの両方に使う。
   * なければ performance.render は ERR-207。
   */
  renderer?: (name: string, options: RenderOptions) => Promise<StoreResult<Record<string, unknown>>>;
}

type Args = Record<string, unknown>;

interface Plan {
  run: ExternalRun;
  /** 成功したときに出す EVT-06。 */
  library?: { name: string; action: "saved" | "deleted" };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function bad(arg: string, reason: string, message?: string): CommandError {
  return new CommandError("ERR-003", message ?? `引数 ${arg}: ${reason}`, { arg, reason });
}

/** 演奏データの名前に使う、その場所の時刻(`yyyymmdd-hhmmss`)。名前の順が、そのまま時系列になる。 */
function localStamp(t: Date | number): string {
  const d = t instanceof Date ? t : new Date(t);
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${p(d.getFullYear(), 4)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** RFC 3339 の UTC(秒まで)。 */
function utcTimestamp(t: Date | number): string {
  const d = t instanceof Date ? t : new Date(t);
  return d.toISOString().replace(/\.\d+Z$/, "Z");
}

/** 演奏データのファイル 1 つの保存の状態。 */
interface PerformanceFile {
  name: string;
  startedAt: string;
  /** 保存をやめた(保存先のエラー、大きすぎる)。 */
  failed: boolean;
  /** ファイルを 1 度でも書けた。 */
  written: boolean;
  /** つながっていなかったために書けなかった、最新の状態。 */
  held: HeldPerformance | null;
}

interface HeldPerformance {
  text: string;
  entries: number;
  length_seconds: number;
  closed: boolean;
}

export class Controller {
  readonly session: Session;
  private readonly store: PatchStore;
  private readonly now: () => Date | number;
  private readonly appVersion: string;
  private readonly maxPatchFiles: number;
  private readonly storeTimeoutMs: number;
  private readonly performances: PatchStore | null;
  private readonly renderer: ControllerOptions["renderer"] | null;
  /** 演奏の通し番号 → 保存した名前と、始まりの時刻。 */
  private readonly perfNames = new Map<number, PerformanceFile>();
  private perfTail: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(ev: ControllerEvent) => void>();
  /** 待ち行列の末尾(前の要求の処理の完了)。 */
  private tail: Promise<void> = Promise.resolve();
  private waiting = 0;

  constructor(opts: ControllerOptions) {
    this.session = opts.session;
    this.store = opts.store;
    this.now = opts.now;
    this.appVersion = opts.appVersion ?? DEFAULT_APP_VERSION;
    this.maxPatchFiles = opts.maxPatchFiles ?? MAX_PATCH_FILES;
    this.storeTimeoutMs = opts.storeTimeoutMs ?? DEFAULT_STORE_TIMEOUT_MS;
    this.performances = opts.performanceStore ?? null;
    this.renderer = opts.renderer ?? null;
    this.session.subscribe((ev) => {
      this.emit(ev);
      if (ev.event === "performance.changed") this.savePerformances();
    });
  }

  /** 処理中・処理待ちの要求の数。 */
  get pending(): number {
    return this.waiting;
  }

  /** 通知(Session の EVT-01〜04 と、EVT-06)を受け取る。戻り値を呼ぶと解除する。 */
  subscribe(listener: (ev: ControllerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 要求を1件処理して応答を返す。`actor` は受け口が決めた操作者(§3.1)。
   * 要求は呼んだ順に1本の待ち行列に入り、1件ずつ処理する(前の要求の応答が決まるまで、次の要求は始めない)。
   * 例外は緊急停止(engine.panic): 待ち行列を通さず、その場で実行する(保存先の読み書きを待つ間も止められるようにする。
   * CMD-23「止める操作を妨げない」)。緊急停止はパッチもリビジョンも変えないので、待っている要求の結果に影響しない。
   * 通知は応答の後に出す(§10): `deliver` を渡すと、応答を `deliver` へ渡してから通知をリスナーへ渡す。
   * `deliver` がなければ、通知をリスナーへ渡し終えてから応答を返す。
   */
  handle(request: unknown, actor: ActorKind, deliver?: (response: CommandResponse) => void): Promise<CommandResponse> {
    // 待っている間に呼出し側が書き換えても影響しないよう、受け取った時点の内容を写す
    let req = request;
    try {
      const text = JSON.stringify(request);
      if (text !== undefined) req = JSON.parse(text) as unknown;
    } catch {
      // JSON にできない値はそのまま渡す(Session が ERR-001 にする)
    }
    if (isObj(req) && req.command === "engine.panic") {
      try {
        return Promise.resolve(this.session.handle(req, actor, deliver));
      } catch (e) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    }
    this.waiting++;
    const result = this.tail.then(() => this.handleOne(req, actor, deliver));
    this.tail = result.then(
      () => {
        this.waiting--;
      },
      () => {
        this.waiting--;
      },
    );
    return result;
  }

  /**
   * 変わった演奏データを保存する(演奏した楽譜の記録。日時つきの名前)。楽譜が足されるたびに同じファイルを書き直すので、
   * 途中でタブを閉じても、そこまでの演奏は残る。演奏の通知のたびに自動で呼ばれる。演奏し終えた後の「閉じる」を拾うため、
   * 状態の確認(Session.pollBackend)の後にも呼ぶこと。コマンドの待ち行列とは別に、順に書く。
   */
  savePerformances(): Promise<void> {
    const updates = this.session.takePerformanceUpdates();
    if (updates.length === 0 || !this.performances) return this.perfTail;
    for (const u of updates) {
      this.perfTail = this.perfTail.then(async () => {
        let entry = this.perfNames.get(u.id);
        if (entry?.failed) return;
        if (!entry) {
          entry = { name: localStamp(this.now()), startedAt: utcTimestamp(this.now()), failed: false, written: false, held: null };
          this.perfNames.set(u.id, entry);
        }
        const record = { ...u.record, started_at: entry.startedAt, ended_at: u.closed ? utcTimestamp(this.now()) : null };
        const text = JSON.stringify(record) + "\n";
        await this.writePerformance(entry, { text, entries: record.entries.length, length_seconds: record.length_seconds, closed: u.closed });
      });
    }
    return this.perfTail;
  }

  /**
   * サーバーにつながっていなかったために保存できなかった演奏データを、書き直す(DEC-025)。
   * 保存先とつながり直したときに呼ぶ。書くのは、それぞれの演奏の最新の状態(閉じた印を含む)。
   */
  retryPerformances(): Promise<void> {
    if (!this.performances) return this.perfTail;
    for (const entry of this.perfNames.values()) {
      if (!entry.held || entry.failed) continue;
      this.perfTail = this.perfTail.then(async () => {
        const held = entry.held;
        if (held && !entry.failed) await this.writePerformance(entry, held);
      });
    }
    return this.perfTail;
  }

  /** 演奏データを 1 回書く。つながっていなければ控えておき(retryPerformances で書き直す)、それ以外の失敗では、その演奏の保存をやめる。 */
  private async writePerformance(entry: PerformanceFile, w: HeldPerformance): Promise<void> {
    const store = this.performances!;
    const fail = (reason: string): void => {
      entry.failed = true;
      entry.held = null;
      this.emit({ v: 1, event: "performance.saved", session_id: this.session.sessionId, data: { name: null, ok: false, entries: w.entries, length_seconds: w.length_seconds, closed: w.closed, reason } });
    };
    if (utf8ByteLength(w.text) > MAX_PERFORMANCE_BYTES) return fail("too_large");
    const first = !entry.written;
    let r = await this.call(() => store.write(entry.name, w.text, !first));
    // 同じ秒に始まった別の演奏のファイルがあれば、名前に連番を付ける(上書きしない)
    for (let n = 2; first && !r.ok && r.error === "exists" && n <= 9; n++) {
      entry.name = `${entry.name.replace(/-[2-9]$/, "")}-${n}`;
      r = await this.call(() => store.write(entry.name, w.text, false));
    }
    if (!r.ok && r.error === "unavailable") {
      entry.held = w; // つながり直したら書く(より新しい状態が来たら、そちらに替わる)
      return;
    }
    if (!r.ok) return fail(r.error);
    entry.written = true;
    entry.held = null;
    this.emit({ v: 1, event: "performance.saved", session_id: this.session.sessionId, data: { name: entry.name, ok: true, entries: w.entries, length_seconds: w.length_seconds, closed: w.closed } });
  }

  /** 待ち行列が空になる(今までに受けた要求がすべて処理される)まで待つ。 */
  idle(): Promise<void> {
    return this.tail;
  }

  private emit(ev: ControllerEvent): void {
    for (const l of [...this.listeners]) {
      try {
        l(JSON.parse(JSON.stringify(ev)) as ControllerEvent);
      } catch {
        // リスナーの失敗でコマンド処理を止めない
      }
    }
  }

  private async handleOne(
    request: unknown,
    actor: ActorKind,
    deliver?: (response: CommandResponse) => void,
  ): Promise<CommandResponse> {
    const command = isObj(request) && typeof request.command === "string" ? request.command : null;
    if (command === null || !STORAGE_COMMANDS.has(command)) return this.session.handle(request, actor, deliver);

    // A. §3.3 の 1〜6
    const pre = this.session.precheck(request, actor);
    if (!pre.proceed) {
      if (deliver) deliver(pre.response);
      return pre.response;
    }

    // B. 保存先の読み書き。失敗は、C で同じ失敗を投げる中身にして応答の形をそろえる
    let plan: Plan;
    try {
      plan = await this.plan(pre.command, pre.args, pre.actor);
    } catch (e) {
      plan = {
        run: () => {
          throw e; // CommandError はその応答、それ以外は ERR-010(Session)
        },
      };
    }

    // C. 応答、メモリ上の状態、冪等キー、通知(Session の通知は応答の後に出る)
    const response = this.session.handleExternal(request, actor, plan.run, deliver);
    if (response.ok && !response.replayed && plan.library) {
      this.emit({
        v: 1,
        event: "library.changed",
        session_id: this.session.sessionId,
        data: { name: plan.library.name, action: plan.library.action, actor: response.actor },
      });
    }
    return response;
  }

  private plan(command: string, args: Args, actor: ActorInfo): Promise<Plan> {
    switch (command) {
      case "patch.save":
        return this.planSave(args, actor);
      case "patch.load":
        return this.planLoad(args);
      case "patch.list":
        return this.planList(args);
      case "patch.read":
        return this.planRead(args);
      case "performance.list":
        return this.planPerformanceList(args);
      case "performance.read":
        return this.planPerformanceRead(args);
      case "performance.replay":
        return this.planPerformanceReplay(args);
      case "performance.render":
        return this.planPerformanceRender(args);
      default:
        return this.planDelete(args);
    }
  }

  // ---- 保存先の呼出し ----

  /** 保存先の例外(Promise の拒否)と時間切れも「読み書きの失敗」として扱う。 */
  private call<T>(fn: () => Promise<StoreResult<T>>): Promise<StoreResult<T>> {
    return callStore(fn, this.storeTimeoutMs);
  }

  /** 保存先の失敗 → 契約のエラー。 */
  private storeError(operation: string, name: string | null, error: StoreError, message?: string): CommandError {
    return storeError(operation, name, error, message, this.maxPatchFiles);
  }

  private loadError(r: Extract<PatchLoadResult, { ok: false }>): CommandError {
    return new CommandError(r.error.id as ErrorId, r.error.message, r.error.details);
  }

  // ---- CMD-12 patch.save ----

  private async planSave(args: Args, actor: ActorInfo): Promise<Plan> {
    checkKeys(args, ["name", "overwrite"]);
    if ("overwrite" in args && typeof args.overwrite !== "boolean") throw bad("overwrite", "type");
    const name = patchName(args);
    const overwrite = args.overwrite === true;

    // 同名の有無と、上書きの可否(ERR-203 → ERR-005。§15.3、DAT-33、DAT-36)
    const current = await this.call(() => this.store.read(name));
    let existed = false;
    if (current.ok) {
      existed = true;
      if (!overwrite) throw this.storeError("read", name, "exists");
      if (actor.kind === "agent") {
        // 判定に使うのは、上書きされる側のファイルの今の内容だけ: 文書として読めて、meta.saved_by.kind が agent のときだけ許す。
        // 読めないファイル(壊れた JSON、重複キー、検証に通らない文書)は、人が保存したものとして扱う(§15.3)。
        if (!agentMayOverwrite(current.value.text, this.session.typeCatalog)) {
          throw new CommandError("ERR-005", "エージェントが上書きできるのは、最後にエージェントが保存したファイルだけ", {
            command: "patch.save",
            actor_kind: actor.kind,
            name,
          });
        }
      }
    } else if (current.error !== "not_found") {
      throw this.storeError("read", name, current.error, current.message);
    }

    // 新しい名前での保存: ファイル数の上限(ERR-106。上書きは対象外)
    if (!existed) {
      const listed = await this.call(() => this.store.list());
      if (!listed.ok) throw this.storeError("list", null, listed.error === "not_found" ? "failed" : listed.error, listed.message);
      const count = listed.value.filter((f) => isValidPatchName(f.name)).length;
      if (count >= this.maxPatchFiles) throw this.storeError("write", name, "too_many");
    }

    // 書く内容: 現在のパッチの meta を DAT-35 のとおり更新したもの
    const patch = this.session.getPatch();
    const at = utcTimestamp(this.now());
    const savedBy: SavedBy = { kind: actor.kind, ...(actor.client_id !== undefined ? { client_id: actor.client_id } : {}) };
    const stamp: Pick<PatchMeta, "created_at" | "modified_at" | "saved_by" | "app_version"> = {
      created_at: patch.meta.created_at ?? at,
      modified_at: at,
      saved_by: savedBy,
      app_version: this.appVersion,
    };
    const doc = { ...patch, meta: { title: patch.meta.title, description: patch.meta.description, ...stamp } };
    const text = serializePatchDocument(doc);
    if (utf8ByteLength(text) > MAX_PATCH_BYTES) throw this.storeError("write", name, "too_large");

    const written = await this.call(() => this.store.write(name, text, existed));
    if (!written.ok) throw this.storeError("write", name, written.error === "not_found" ? "failed" : written.error, written.message);
    const bytes = written.value.bytes;

    return {
      run: (ops) => {
        ops.setSaveStamp(stamp);
        return { result: { name, bytes, saved_at: at, overwritten: existed } };
      },
      library: { name, action: "saved" },
    };
  }

  // ---- CMD-13 patch.load ----

  private async planLoad(args: Args): Promise<Plan> {
    checkKeys(args, ["name", "patch"]);
    const hasName = "name" in args;
    const hasPatch = "patch" in args;
    if (hasName === hasPatch) {
      throw bad(hasName ? "patch" : "name", hasName ? "exclusive" : "missing", "name か patch のどちらか一方を指定する");
    }
    const catalog = this.session.typeCatalog;
    let loaded: PatchLoadResult;
    if (hasName) {
      const name = patchName(args);
      const r = await this.call(() => this.store.read(name));
      if (!r.ok) throw this.storeError("read", name, r.error, r.message);
      loaded = parsePatchText(r.value.text, catalog);
    } else {
      if (!isObj(args.patch)) throw bad("patch", "type");
      loaded = validatePatchDocument(args.patch, catalog);
    }
    // 検証に通らなければ現在のパッチは不変(DAT-40)。エラーID・details は検証の結果のまま
    if (!loaded.ok) throw this.loadError(loaded);
    const { patch, warnings, migrated } = loaded;
    return {
      run: (ops) => {
        ops.replacePatch(patch);
        return { result: { patch: this.session.getPatch(), migrated }, warnings: warnings as Warning[] };
      },
    };
  }

  // ---- CMD-14 patch.list ----

  private async planList(args: Args): Promise<Plan> {
    const result = await listPatches(this.store, this.session.typeCatalog, args, this.maxPatchFiles, this.storeTimeoutMs);
    return { run: () => ({ result }) };
  }

  // ---- CMD-15 patch.read ----

  private async planRead(args: Args): Promise<Plan> {
    const result = await readPatch(this.store, args, this.maxPatchFiles, this.storeTimeoutMs);
    return { run: () => ({ result }) };
  }

  // ---- 演奏データ(CMD-30〜32。data-contract §15) ----

  private performanceStoreOrFail(): PatchStore {
    if (!this.performances) throw new CommandError("ERR-207", "演奏データの保存先がない", { reason: "not_configured" });
    return this.performances;
  }

  /** CMD-30 performance.list: 保存された演奏データの名前(新しい順。名前の頭が日時なので、名前の降順)。 */
  private async planPerformanceList(args: Args): Promise<Plan> {
    checkKeys(args, []);
    const store = this.performanceStoreOrFail();
    await this.perfTail; // 書きかけの保存を待つ(直前の楽譜まで見える)
    const listed = await this.call(() => store.list());
    if (!listed.ok) throw this.storeError("list", null, "failed", listed.message);
    const performances = listed.value
      .filter((f) => isValidPatchName(f.name))
      .sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))
      .map((f) => ({ name: f.name, bytes: f.bytes, modified_at: f.modified_at }));
    return { run: () => ({ result: { performances } }) };
  }

  private async readPerformance(args: Args): Promise<{ name: string; doc: unknown; bytes: number; modified_at: string }> {
    checkKeys(args, ["name"]);
    const name = patchName(args);
    const store = this.performanceStoreOrFail();
    await this.perfTail; // 書きかけの保存を待つ
    const r = await this.call(() => store.read(name));
    if (!r.ok) {
      if (r.error === "not_found") throw new CommandError("ERR-202", `演奏データ ${name} はない`, { name });
      throw this.storeError("read", name, r.error, r.message);
    }
    const invalid = (message: string): CommandError => new CommandError("ERR-204", message, { issues: [{ rule: "DAT-V02", path: "", message }] });
    let doc: unknown;
    try {
      doc = JSON.parse(r.value.text);
    } catch (e) {
      throw invalid(`JSONとして解釈できない: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (depthExceeds(doc, MAX_JSON_DEPTH)) throw invalid("JSONとして解釈できない: 入れ子が深すぎる");
    return { name, doc, bytes: r.value.info.bytes, modified_at: r.value.info.modified_at };
  }

  /** CMD-31 performance.read: 演奏データの中身(演奏を始めた時点のパッチと、演奏した楽譜の並び)。 */
  private async planPerformanceRead(args: Args): Promise<Plan> {
    const { doc, bytes, modified_at } = await this.readPerformance(args);
    return { run: () => ({ result: { performance: doc, bytes, modified_at } }) };
  }

  /** CMD-34 performance.render: 演奏データを、演奏せずに音声ファイルへ書き出す(頼む・進み具合を聞く)。 */
  private async planPerformanceRender(args: Args): Promise<Plan> {
    const { name, options } = parseRenderArgs(args);
    if (!this.renderer) throw new CommandError("ERR-207", "音声ファイルへ書き出す口がない", { reason: "not_configured" });
    const renderer = this.renderer;
    await this.perfTail; // 書きかけの保存を待つ(直前の楽譜まで書き出しに入る)
    const r = await this.call(() => renderer(name, options));
    if (!r.ok) {
      if (r.error === "not_found") throw new CommandError("ERR-202", `演奏データ ${name} はない`, { name });
      if (r.error === "too_many") throw new CommandError("ERR-106", `同時に待たせられる書き出しは ${RENDER_LIMITS.maxJobs} 件まで`, { limit: "render_jobs", max: RENDER_LIMITS.maxJobs });
      throw this.storeError("read", name, r.error, r.message);
    }
    const state = r.value;
    return { run: () => ({ result: { name, ...state } }) };
  }

  /** CMD-32 performance.replay: 演奏データのパッチへ置き換え、記録された楽譜をすべて予約する。 */
  private async planPerformanceReplay(args: Args): Promise<Plan> {
    const { name, doc } = await this.readPerformance(args);
    const bad204 = (path: string, message: string): CommandError => new CommandError("ERR-204", `演奏データが不正: ${message}`, { issues: [{ rule: "DAT-V19", path, message }] });
    if (!isObj(doc)) throw bad204("", "オブジェクトでない");
    if (doc.format !== PERFORMANCE_FORMAT) throw new CommandError("ERR-205", "演奏データの形式が違う", { format: doc.format ?? null });
    if (doc.schema_version !== PERFORMANCE_SCHEMA_VERSION) throw new CommandError("ERR-205", "演奏データの版が未対応", { schema_version: doc.schema_version ?? null, supported: [PERFORMANCE_SCHEMA_VERSION] });
    if (!Array.isArray(doc.entries) || doc.entries.length === 0) throw bad204("entries", "楽譜がない");
    doc.entries.forEach((e: unknown, i: number) => {
      if (!isObj(e) || typeof e.at !== "number" || !Number.isFinite(e.at) || e.at < 0 || !isObj(e.score)) throw bad204(`entries[${i}]`, "at(0 以上の数値)と score(オブジェクト)が要る");
    });
    const loaded = validatePatchDocument(doc.patch, this.session.typeCatalog);
    if (!loaded.ok) throw this.loadError(loaded);
    const record = doc as unknown as PerformanceRecord;
    return {
      run: (ops) => {
        const r = ops.replayPerformance(loaded.patch, record, name);
        return { result: { name, scores: r.scores, length_seconds: r.length_seconds, migrated: loaded.migrated }, warnings: [...(loaded.warnings as Warning[]), ...r.warnings] };
      },
    };
  }

  // ---- CMD-16 patch.delete(人のみ。権限は precheck が見る) ----

  private async planDelete(args: Args): Promise<Plan> {
    checkKeys(args, ["name"]);
    const name = patchName(args);
    const r = await this.call(() => this.store.remove(name));
    if (!r.ok) throw this.storeError("remove", name, r.error, r.message);
    return { run: () => ({ result: { name } }), library: { name, action: "deleted" } };
  }
}
