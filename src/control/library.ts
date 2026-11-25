// 保存パッチの一覧・読出し(CMD-14・CMD-15)と、上書きの可否の判定(operation-contract §15.3)。
// タブ側の窓口(Controller)と、タブがないときに直接答えるサーバー(src/server/app.ts)が同じものを使う。
import type { TypeCatalog } from "./catalog.js";
import { CommandError } from "./errors.js";
import { depthExceeds } from "./json.js";
import { MAX_JSON_DEPTH, MAX_PATCH_BYTES, isValidPatchName, parsePatchText } from "./patch-doc.js";
import type { PatchStore, StoreError, StoreResult } from "./store.js";
import type { ActorKind } from "./types.js";

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function bad(arg: string, reason: string, message?: string): CommandError {
  return new CommandError("ERR-003", message ?? `引数 ${arg}: ${reason}`, { arg, reason });
}

export function checkKeys(a: Obj, allowed: readonly string[]): void {
  for (const k of Object.keys(a)) {
    if (!allowed.includes(k)) throw bad(k, "unknown_key", `未知の引数 ${k}`);
  }
}

/** 引数 `name`: 文字列でなければ ERR-003、規則(DAT-31)に合わなければ ERR-201。 */
export function patchNameArg(a: Obj): string {
  if (!("name" in a)) throw bad("name", "missing");
  const name = a.name;
  if (typeof name !== "string") throw bad("name", "type");
  if (!isValidPatchName(name)) throw new CommandError("ERR-201", "パッチ名が規則に合わない", { name });
  return name;
}

/**
 * 保存先を呼ぶ。保存先の例外(Promise の拒否)と、`timeoutMs` 以内に答えが返らない場合を「読み書きの失敗」として扱う
 * (答えない保存先のために、後ろの要求が待ち続けないようにする)。`timeoutMs` が 0 以下なら時間切れはない。
 */
export async function callStore<T>(fn: () => Promise<StoreResult<T>>, timeoutMs = 0): Promise<StoreResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (timeoutMs <= 0) return await fn();
    const late = new Promise<StoreResult<T>>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, error: "unavailable", message: "保存先が時間内に応答しなかった(書き込みが行われたかは不明)" }), timeoutMs);
    });
    return await Promise.race([fn(), late]);
  } catch (e) {
    return { ok: false, error: "failed", message: e instanceof Error ? e.message : String(e) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** 保存先の失敗 → 契約のエラー。 */
export function storeError(operation: string, name: string | null, error: StoreError, message: string | undefined, maxPatchFiles: number): CommandError {
  switch (error) {
    case "not_found":
      return new CommandError("ERR-202", `保存パッチ ${name} はない`, { name });
    case "exists":
      return new CommandError("ERR-203", `保存パッチ ${name} は既にある(上書きは overwrite: true)`, { name });
    case "invalid_name":
      return new CommandError("ERR-201", "パッチ名が規則に合わない", { name });
    case "too_many":
      return new CommandError("ERR-106", "保存パッチのファイル数の上限", { limit: "patch_files", max: maxPatchFiles });
    case "too_large":
      return new CommandError("ERR-206", "パッチの大きさが上限を超える", { limit_bytes: MAX_PATCH_BYTES });
    default:
      // つながっていない(unavailable)は、コマンドの返値では今までどおり failed として返す
      return new CommandError("ERR-207", message ?? `保存先の ${operation} に失敗`, { reason: error === "unavailable" ? "failed" : error, operation });
  }
}

/**
 * 読めないファイルの `meta.saved_by.kind`(一覧の表示用。DAT-34・DAT-36)。
 * JSONとして読めない、`saved_by` がない、書式が不正のときは null。上書きの可否の判定には使わない。
 */
export function savedByKindOf(text: string): ActorKind | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(doc) || !isObj(doc.meta)) return null;
  const sb = doc.meta.saved_by;
  if (!isObj(sb)) return null;
  if (Object.keys(sb).some((k) => k !== "kind" && k !== "client_id")) return null;
  if ("client_id" in sb && typeof sb.client_id !== "string") return null;
  return sb.kind === "agent" || sb.kind === "human" ? sb.kind : null;
}

/**
 * エージェントがこのファイルを上書きしてよいか(§15.3): 文書として読めて(検証に通り)、`meta.saved_by.kind` が agent のときだけ。
 * 読めないファイル(壊れた JSON、重複キー、検証に通らない文書)は、中に何と書いてあっても上書きできない。
 */
export function agentMayOverwrite(text: string, catalog: TypeCatalog): boolean {
  const parsed = parsePatchText(text, catalog);
  return parsed.ok && parsed.patch.meta.saved_by?.kind === "agent";
}

/** CMD-14 patch.list。壊れた・読めないファイルも `readable: false` で載せる(DAT-34)。 */
export async function listPatches(store: PatchStore, catalog: TypeCatalog, args: Obj, maxPatchFiles: number, timeoutMs = 0): Promise<{ patches: Obj[] }> {
  checkKeys(args, []);
  const listed = await callStore(() => store.list(), timeoutMs);
  if (!listed.ok) throw storeError("list", null, "failed", listed.message, maxPatchFiles);
  const patches: Obj[] = [];
  const infos = listed.value.filter((f) => isValidPatchName(f.name)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const info of infos) {
    const r = await callStore(() => store.read(info.name), timeoutMs);
    if (!r.ok && r.error === "not_found") continue; // 一覧の後に消えた
    let title: string | null = null;
    let savedByKind: ActorKind | null = null;
    let readable = false;
    if (r.ok) {
      const parsed = parsePatchText(r.value.text, catalog);
      readable = parsed.ok;
      if (parsed.ok) {
        title = parsed.patch.meta.title;
        savedByKind = parsed.patch.meta.saved_by?.kind ?? null;
      } else {
        savedByKind = savedByKindOf(r.value.text);
        try {
          const doc = JSON.parse(r.value.text) as unknown;
          if (isObj(doc) && isObj(doc.meta) && typeof doc.meta.title === "string") title = doc.meta.title;
        } catch {
          // JSON として読めない
        }
      }
    }
    patches.push({ name: info.name, title, bytes: info.bytes, modified_at: info.modified_at, saved_by_kind: savedByKind, readable });
  }
  return { patches };
}

/** CMD-15 patch.read。検証・移行はしない。JSON として読めない・入れ子が深すぎる文書は ERR-204。 */
export async function readPatch(store: PatchStore, args: Obj, maxPatchFiles: number, timeoutMs = 0): Promise<{ patch: unknown; bytes: number; modified_at: string }> {
  checkKeys(args, ["name"]);
  const name = patchNameArg(args);
  const r = await callStore(() => store.read(name), timeoutMs);
  if (!r.ok) throw storeError("read", name, r.error, r.message, maxPatchFiles);
  const invalid = (message: string): CommandError => new CommandError("ERR-204", message, { issues: [{ rule: "DAT-V02", path: "", message }] });
  let patch: unknown;
  try {
    patch = JSON.parse(r.value.text);
  } catch (e) {
    throw invalid(`JSONとして解釈できない: ${e instanceof Error ? e.message : String(e)}`);
  }
  // 検証で必ず拒否される深さ(patch-doc.ts の読取りと同じ上限)。そのまま返すと、応答を文字列へ戻す処理でスタックを使い切る。
  if (depthExceeds(patch, MAX_JSON_DEPTH)) throw invalid("JSONとして解釈できない: 入れ子が深すぎる");
  return { patch, bytes: r.value.info.bytes, modified_at: r.value.info.modified_at };
}
