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
export const STORAGE_COMMANDS: ReadonlySet<string> = new Set(["patch.save", "patch.load", "patch.list", "patch.read", "patch.delete"]);

/** EVT-06 */
export interface LibraryChangedEvent {
  v: 1;
  event: "library.changed";
  session_id: string;
  data: { name: string; action: "saved" | "deleted"; actor: ActorInfo };
}

/** Controller が出す通知(Session の通知 + EVT-06)。`seq` は輸送層が付ける。 */
export type ControllerEvent = SessionEvent | LibraryChangedEvent;

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

/** RFC 3339 の UTC(秒まで)。 */
function utcTimestamp(t: Date | number): string {
  const d = t instanceof Date ? t : new Date(t);
  return d.toISOString().replace(/\.\d+Z$/, "Z");
}

export class Controller {
  readonly session: Session;
  private readonly store: PatchStore;
  private readonly now: () => Date | number;
  private readonly appVersion: string;
  private readonly maxPatchFiles: number;
  private readonly storeTimeoutMs: number;
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
    this.session.subscribe((ev) => this.emit(ev));
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

  // ---- CMD-16 patch.delete(人のみ。権限は precheck が見る) ----

  private async planDelete(args: Args): Promise<Plan> {
    checkKeys(args, ["name"]);
    const name = patchName(args);
    const r = await this.call(() => this.store.remove(name));
    if (!r.ok) throw this.storeError("remove", name, r.error, r.message);
    return { run: () => ({ result: { name } }), library: { name, action: "deleted" } };
  }
}
