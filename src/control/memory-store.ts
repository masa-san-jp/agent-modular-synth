// 試験用の、メモリ上の PatchStore(store.ts)。ファイルは作らない。
// 規則(名前の書式、上書き、件数・大きさの上限)は、サーバーの専用フォルダの実装と同じ意味にしてある
// (data-contract §7.2、§10)。試験のために、失敗の注入・呼出しの記録・操作を途中で待たせる口を持つ。
import { MAX_PATCH_BYTES, isValidPatchName, utf8ByteLength } from "./patch-doc.js";
import { PatchStore, StoreError, StoreResult, StoredPatchInfo } from "./store.js";

export type StoreOp = "list" | "read" | "write" | "remove";

export interface MemoryPatchStoreOptions {
  /** 更新時刻に使う時刻。省略時は実時刻。 */
  now?: () => Date;
  /** ファイル数の上限(data-contract §10: 1000)。 */
  maxFiles?: number;
  /** 1件の大きさの上限 [バイト](data-contract §10: 1 MiB)。 */
  maxBytes?: number;
}

interface Entry {
  text: string;
  modified_at: string;
}

export class MemoryPatchStore implements PatchStore {
  private readonly files = new Map<string, Entry>();
  private readonly now: () => Date;
  readonly maxFiles: number;
  readonly maxBytes: number;
  /** 呼出しの記録: [操作, 名前(list は なし)]。 */
  readonly calls: [StoreOp, string?][] = [];
  /** 設定すると、その操作が失敗を返す(操作 → 失敗の種類)。 */
  readonly failOn = new Map<StoreOp, StoreError>();
  /** 設定すると、その操作が例外(Promise の拒否)になる。 */
  readonly throwOn = new Set<StoreOp>();
  /** 設定すると、各操作の実行の前に待つ(直列化の試験用)。 */
  before: ((op: StoreOp, name?: string) => Promise<void> | void) | null = null;

  constructor(opts: MemoryPatchStoreOptions = {}) {
    this.now = opts.now ?? (() => new Date());
    this.maxFiles = opts.maxFiles ?? 1000;
    this.maxBytes = opts.maxBytes ?? MAX_PATCH_BYTES;
  }

  // ---- 試験用の直接の出し入れ(規則を通さない。アプリの外で置かれたファイルの代わり) ----

  /** 文字列をそのまま置く。 */
  put(name: string, text: string): void {
    this.files.set(name, { text, modified_at: this.stamp() });
  }

  /** 置かれている文字列。なければ undefined。 */
  get(name: string): string | undefined {
    return this.files.get(name)?.text;
  }

  has(name: string): boolean {
    return this.files.has(name);
  }

  get size(): number {
    return this.files.size;
  }

  // ---- PatchStore ----

  async list(): Promise<StoreResult<StoredPatchInfo[]>> {
    const blocked = await this.enter("list");
    if (blocked) return blocked;
    const out = [...this.files.entries()]
      .filter(([name]) => isValidPatchName(name))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, e]) => this.info(name, e));
    return { ok: true, value: out };
  }

  async read(name: string): Promise<StoreResult<{ text: string; info: StoredPatchInfo }>> {
    const blocked = await this.enter("read", name);
    if (blocked) return blocked;
    if (!isValidPatchName(name)) return { ok: false, error: "invalid_name" };
    const e = this.files.get(name);
    if (!e) return { ok: false, error: "not_found" };
    return { ok: true, value: { text: e.text, info: this.info(name, e) } };
  }

  async write(name: string, text: string, overwrite: boolean): Promise<StoreResult<StoredPatchInfo>> {
    const blocked = await this.enter("write", name);
    if (blocked) return blocked;
    if (!isValidPatchName(name)) return { ok: false, error: "invalid_name" };
    const exists = this.files.has(name);
    if (exists && !overwrite) return { ok: false, error: "exists" };
    if (utf8ByteLength(text) > this.maxBytes) return { ok: false, error: "too_large" };
    if (!exists && [...this.files.keys()].filter((n) => isValidPatchName(n)).length >= this.maxFiles) {
      return { ok: false, error: "too_many" };
    }
    const e: Entry = { text, modified_at: this.stamp() };
    this.files.set(name, e);
    return { ok: true, value: this.info(name, e) };
  }

  async remove(name: string): Promise<StoreResult<null>> {
    const blocked = await this.enter("remove", name);
    if (blocked) return blocked;
    if (!isValidPatchName(name)) return { ok: false, error: "invalid_name" };
    if (!this.files.delete(name)) return { ok: false, error: "not_found" };
    return { ok: true, value: null };
  }

  // ---- 内部 ----

  private async enter(op: StoreOp, name?: string): Promise<{ ok: false; error: StoreError; message?: string } | null> {
    this.calls.push(name === undefined ? [op] : [op, name]);
    if (this.before) await this.before(op, name);
    if (this.throwOn.has(op)) throw new Error(`MemoryPatchStore: ${op} が例外(試験用)`);
    const error = this.failOn.get(op);
    if (error) return { ok: false, error, message: `MemoryPatchStore: ${op} が失敗(試験用)` };
    return null;
  }

  private stamp(): string {
    return this.now().toISOString().replace(/\.\d+Z$/, "Z");
  }

  private info(name: string, e: Entry): StoredPatchInfo {
    return { name, bytes: utf8ByteLength(e.text), modified_at: e.modified_at };
  }
}
