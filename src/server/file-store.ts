// パッチファイルの保存先(data-contract §7.2): サーバーが管理する専用フォルダ1つの直下の `<name>.patch.json` だけを扱う。
// - 名前は書式で検査し(DAT-31)、それとは別に、作った経路がフォルダの直下にあることを確かめる(二重の検査)。
// - シンボリックリンクはたどらない(O_NOFOLLOW で開き、通常のファイルだけを読む)。
// - 書き込みは同じフォルダの一時ファイルに書いてから置き換える(DAT-32)。
// - 件数(§10: 1000)と大きさ(§10: 1 MiB)の上限を守る。
// 文書の中身の検証・上書きの権限(operation-contract §15.3)は呼ぶ側(コマンド処理)が行う。
import { randomBytes } from "node:crypto";
import { constants as FS } from "node:fs";
import { link, lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { MAX_PATCH_BYTES, isValidPatchName } from "../control/patch-doc.js";
import type { PatchStore, StoreError, StoreResult, StoredPatchInfo } from "../control/store.js";

/** 専用フォルダ内の保存パッチのファイル数の上限(data-contract §10、operation-contract §16。暫定値)。 */
export const MAX_PATCH_FILES = 1000;
export const PATCH_FILE_SUFFIX = ".patch.json";

export interface FilePatchStoreOptions {
  /** ファイル数の上限(既定 1000)。 */
  maxFiles?: number;
  /** 1ファイルの大きさの上限 [バイト](既定 1 MiB)。 */
  maxBytes?: number;
  /** ファイル名の末尾(既定 `.patch.json`)。演奏データは `.performance.json`。 */
  suffix?: string;
}

function fail<T>(error: StoreError, message?: string): StoreResult<T> {
  return message === undefined ? { ok: false, error } : { ok: false, error, message };
}

function errCode(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
}

function isoTime(ms: number): string {
  return new Date(ms).toISOString();
}

export class FilePatchStore implements PatchStore {
  /** 専用フォルダ(絶対パス)。 */
  readonly dir: string;
  readonly maxFiles: number;
  readonly maxBytes: number;
  readonly suffix: string;
  /** 操作を1件ずつ行うための列(件数の検査と書き込みの間に別の書き込みを挟まない)。 */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(dir: string, options: FilePatchStoreOptions = {}) {
    this.dir = resolve(dir);
    this.maxFiles = options.maxFiles ?? MAX_PATCH_FILES;
    this.maxBytes = options.maxBytes ?? MAX_PATCH_BYTES;
    this.suffix = options.suffix ?? PATCH_FILE_SUFFIX;
  }

  list(): Promise<StoreResult<StoredPatchInfo[]>> {
    return this.serial(async () => {
      const names = await this.names();
      const out: StoredPatchInfo[] = [];
      for (const name of names) {
        try {
          // リンクはたどらない(リンク自体の情報を返す。読出しは read が拒否する)
          const st = await lstat(join(this.dir, name + this.suffix));
          out.push({ name, bytes: st.size, modified_at: isoTime(st.mtimeMs) });
        } catch (e) {
          if (errCode(e) !== "ENOENT") throw e; // 一覧の途中で消えたものは載せない
        }
      }
      return { ok: true, value: out };
    });
  }

  read(name: string): Promise<StoreResult<{ text: string; info: StoredPatchInfo }>> {
    return this.serial(async () => {
      const file = this.pathOf(name);
      if (file === null) return fail("invalid_name");
      // 通常のファイルだけを開く。名前付きパイプなどを開くと、相手が現れるまで戻らず、以後の保存の操作が全部止まる。
      // 先に種類を確かめ、確かめた後で差し替えられた場合に備えて、待たない指定(O_NONBLOCK)でも開く。
      try {
        const pre = await lstat(file);
        if (pre.isSymbolicLink()) return fail("failed", "symlink");
        if (!pre.isFile()) return fail("failed", "not_a_regular_file");
      } catch (e) {
        if (errCode(e) === "ENOENT") return fail("not_found");
        throw e;
      }
      let handle;
      try {
        handle = await open(file, FS.O_RDONLY | (FS.O_NOFOLLOW ?? 0) | (FS.O_NONBLOCK ?? 0));
      } catch (e) {
        const code = errCode(e);
        if (code === "ENOENT") return fail("not_found");
        if (code === "ELOOP" || code === "EMLINK") return fail("failed", "symlink");
        throw e;
      }
      try {
        const st = await handle.stat();
        if (!st.isFile()) return fail("failed", "not_a_regular_file");
        if (st.size > this.maxBytes) return fail("too_large");
        const buf = await handle.readFile();
        if (buf.byteLength > this.maxBytes) return fail("too_large");
        let text: string;
        try {
          // BOM は取り除かない(文書の検証が拒否する: DAT-32 は BOM なし)
          text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf);
        } catch {
          return fail("failed", "not_utf8");
        }
        return { ok: true, value: { text, info: { name, bytes: buf.byteLength, modified_at: isoTime(st.mtimeMs) } } };
      } finally {
        await handle.close();
      }
    });
  }

  write(name: string, text: string, overwrite: boolean): Promise<StoreResult<StoredPatchInfo>> {
    return this.serial(async () => {
      const file = this.pathOf(name);
      if (file === null) return fail("invalid_name");
      if (typeof text !== "string") return fail("failed", "text_not_string");
      const data = Buffer.from(text, "utf8");
      if (data.byteLength > this.maxBytes) return fail("too_large");
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      const exists = await this.exists(file);
      if (exists && !overwrite) return fail("exists");
      // 新しい名前のときだけ件数を数える(上書きは数を増やさない: operation-contract §16)
      if (!exists && (await this.names()).length >= this.maxFiles) return fail("too_many");

      // 一時ファイルの名前は `.patch.json` で終わらないので、一覧にも件数にも入らない
      const tmp = join(this.dir, `.${name}.${randomBytes(8).toString("hex")}.tmp`);
      let tmpLeft = true;
      try {
        const h = await open(tmp, FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL | (FS.O_NOFOLLOW ?? 0), 0o600);
        try {
          await h.writeFile(data);
          await h.sync();
        } finally {
          await h.close();
        }
        if (overwrite) {
          await rename(tmp, file); // 置き換え先がリンクでも、リンク自体を置き換える(たどらない)
          tmpLeft = false;
        } else {
          // 既にあれば失敗する方法で名前を付ける(検査と書き込みの間に他の者が作った場合も上書きしない)
          try {
            await link(tmp, file);
          } catch (e) {
            const code = errCode(e);
            if (code === "EEXIST") return fail("exists");
            if (code !== "EPERM" && code !== "ENOTSUP" && code !== "EOPNOTSUPP" && code !== "ENOSYS") throw e;
            // ハードリンクを作れないファイルシステム: 存在を確かめてから置き換える
            if (await this.exists(file)) return fail("exists");
            await rename(tmp, file);
            tmpLeft = false;
          }
        }
        const st = await lstat(file);
        return { ok: true, value: { name, bytes: data.byteLength, modified_at: isoTime(st.mtimeMs) } };
      } finally {
        if (tmpLeft) await unlink(tmp).catch(() => undefined);
      }
    });
  }

  remove(name: string): Promise<StoreResult<null>> {
    return this.serial(async () => {
      const file = this.pathOf(name);
      if (file === null) return fail("invalid_name");
      try {
        await unlink(file); // リンクならリンク自体を消す(たどらない)
      } catch (e) {
        if (errCode(e) === "ENOENT") return fail("not_found");
        throw e;
      }
      return { ok: true, value: null };
    });
  }

  /**
   * 書き込みの途中で残った一時ファイル(`.<名前>.<乱数>.tmp`。プロセスが途中で終わると残る)のうち、
   * `olderThanMs` より古いものを消す。消した数を返す。失敗しても例外にしない。
   */
  sweepTemp(olderThanMs = 60 * 60 * 1000): Promise<number> {
    return this.tail
      .then(async () => {
        let entries: string[];
        try {
          entries = await readdir(this.dir);
        } catch {
          return 0;
        }
        let removed = 0;
        const now = Date.now();
        for (const e of entries) {
          if (!/^\.[a-z0-9][a-z0-9_-]{0,63}\.[0-9a-f]{16}\.tmp$/.test(e)) continue;
          try {
            const file = join(this.dir, e);
            const st = await lstat(file);
            if (st.isFile() && now - st.mtimeMs > olderThanMs) {
              await unlink(file);
              removed++;
            }
          } catch {
            // 消えた・消せない: 何もしない
          }
        }
        return removed;
      })
      .catch(() => 0);
  }

  // ---- 内部 ----

  /** 操作を1件ずつ実行し、想定外の失敗を "failed" にする。 */
  private serial<T>(fn: () => Promise<StoreResult<T>>): Promise<StoreResult<T>> {
    const run = this.tail.then(fn).catch((e: unknown): StoreResult<T> => fail("failed", errCode(e) || "error"));
    this.tail = run;
    return run;
  }

  /**
   * 名前から経路を作る。名前が書式に合わない、または経路が専用フォルダの直下でなければ null。
   * 書式の検査(isValidPatchName)とは別に、経路の親と末尾を確かめる(DAT-31 の二重の検査)。
   */
  private pathOf(name: unknown): string | null {
    if (!isValidPatchName(name)) return null;
    const fileName = name + this.suffix;
    const file = resolve(this.dir, fileName);
    if (dirname(file) !== this.dir || basename(file) !== fileName) return null;
    return file;
  }

  private async exists(file: string): Promise<boolean> {
    try {
      await lstat(file);
      return true;
    } catch (e) {
      if (errCode(e) === "ENOENT") return false;
      throw e;
    }
  }

  /** 名前が規則に合う `*.patch.json` の名前(昇順)。フォルダがまだなければ空。 */
  private async names(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch (e) {
      if (errCode(e) === "ENOENT") return [];
      throw e;
    }
    const out: string[] = [];
    for (const e of entries) {
      if (!e.endsWith(this.suffix)) continue;
      const name = e.slice(0, -this.suffix.length);
      if (isValidPatchName(name)) out.push(name);
    }
    return out.sort();
  }
}
