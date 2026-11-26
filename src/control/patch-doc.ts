// パッチ文書(JSON)の検証・正規化・移行・生成。正本は specifications/synthesizer/data-contract.md(§3〜§5、§8〜§10)。
// 同期的な純粋ロジック(DOM・ファイル・時刻・乱数に依らない)。入力は書き換えない(DAT-57、DAT-60)。
import { ParamInfo, TypeCatalog, TypeInfo } from "./catalog.js";
import { MAX_UI_DEPTH, depthExceeds } from "./json.js";
import type { Cable, PatchMeta as Meta, ModuleUi, PatchModule as Module, Patch, PortRef, SavedBy } from "./types.js";

// ---- 契約の定数 ----
/** §3.1 `format` の固定値。 */
export const PATCH_FORMAT = "modular-synth-patch";
/** §3.1 現在の `schema_version`。 */
export const PATCH_SCHEMA_VERSION = 1;
/** §10 パッチJSONの大きさの上限(UTF-8のバイト数)。 */
export const MAX_PATCH_BYTES = 1024 * 1024;
/** §10 モジュール数の上限。 */
export const MAX_MODULES = 256;
/** §10 ケーブル数の上限。 */
export const MAX_CABLES = 1024;
/** §10 `meta.title` の上限(文字数)。 */
export const MAX_TITLE_CHARS = 120;
/** §10 `meta.description` の上限(文字数)。 */
export const MAX_DESCRIPTION_CHARS = 2000;
/** §3.2 `meta.app_version` の上限(文字数)。 */
export const MAX_APP_VERSION_CHARS = 32;
/** §10 `ui`(1モジュール)の上限(バイト数)。 */
export const MAX_UI_BYTES = 1024;
/** §8 `issues` の最大件数。 */
export const MAX_ISSUES = 50;
/** §4・§5 モジュールID・ケーブルIDの書式(最大32文字)。 */
export const ID_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
/** §4 `spec_version` の書式。 */
export const SPEC_VERSION_PATTERN = /^[0-9]+\.[0-9]+$/;
/** §7.2 DAT-31 パッチ名の書式。 */
export const PATCH_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** 常設の出力モジュールのIDと種別(DAT-V09)。 */
export const OUT_MODULE_ID = "out";
export const OUT_MODULE_TYPE = "MOD-IO-001";

// ---- 型 ----
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

// 文書の型は types.ts のもの(コマンド処理と同じ型)。ここでは契約の節に合わせた別名だけを置く。
/** §4.2 UI情報。`x`・`y` 以外のキーはそのまま保持する(DAT-11)。 */
export type PatchUi = ModuleUi;
export type PatchSavedBy = SavedBy;
/** §3.2。 */
export type PatchMeta = Meta;
/** §4。正規化済みの文書では `params` はその種別の全パラメータを持つ(DAT-07)。 */
export type PatchModule = Module;
export type PatchPortRef = PortRef;
/** §5。 */
export type PatchCable = Cable;
/** §3.1。 */
export type PatchDocument = Patch;

/** §8 `error.details.issues` の要素。 */
export interface PatchIssue {
  rule: string;
  path: string;
  message: string;
}

/** 成功時の注意(operation-contract §3.2 の `warnings` の要素)。`code` は `param_defaulted` か `migrated`。 */
export interface PatchWarning {
  code: "param_defaulted" | "migrated";
  message: string;
  details: Record<string, unknown>;
}

/** §9.4 移行の報告。 */
export interface PatchMigrationReport {
  schema_from: number;
  schema_to: number;
  modules: { id: string; type: string; spec_from: string; spec_to: string }[];
}

export interface PatchLoadError {
  /** `ERR-204` / `ERR-205` / `ERR-206`。`issues` の先頭の規則が定めるもの(§8)。 */
  id: string;
  /** operation-contract §5 の名前。 */
  code: string;
  /** `issues` の先頭の規則(`DAT-Vnn`)。 */
  rule: string;
  message: string;
  /** 不合格になった段階の問題(最大50件。規則番号順、配列の先頭に近い順)。 */
  issues: PatchIssue[];
  /** operation-contract §5 の `details`(ERR-204: `issues`、ERR-205: `found`・`supported`、ERR-206: `limit_bytes`)。 */
  details: Record<string, unknown>;
}

export type PatchLoadResult =
  | { ok: true; patch: PatchDocument; warnings: PatchWarning[]; migrated: PatchMigrationReport | null }
  | { ok: false; error: PatchLoadError };

/** モジュールの移行(DAT-56)の1段。「仕様版 from → 次の仕様版 to」。 */
export interface SpecMigrationStep {
  from: string;
  to: string;
  /** `to` で増えたパラメータ名(`from` のパラメータの組 = `to` の組 − これ)。省略パラメータの補完(DAT-59)の対象を決めるのに使う。 */
  added?: readonly string[];
  /** 純粋関数。入力を書き換えず、知らない名前・数値でない値はそのまま通す。 */
  migrate(params: Readonly<Record<string, unknown>>): Record<string, unknown>;
  /** このモジュールのポート名の改名(旧名 → 新名)。 */
  renamePorts?: Readonly<Record<string, string>>;
}

/** 検証の環境の差し替え(試験用: DAT-61 の「仮の旧版」など)。省略時は契約の現行値。 */
export interface PatchLoadOptions {
  /** 対応する最新の `schema_version`。 */
  schemaVersion?: number;
  /** パッチ形式の移行。キー N の関数が「版 N → 版 N+1」(DAT-55)。 */
  schemaMigrations?: ReadonlyMap<number, (doc: Readonly<Record<string, unknown>>) => Record<string, unknown>>;
  /** 種別ごとの移行の鎖(古い順)。指定した種別は既定の鎖の代わりに使う。 */
  specMigrations?: ReadonlyMap<string, readonly SpecMigrationStep[]>;
}

// ---- 移行の登録(§9.5: 仕様版 0.1 → 0.2。18種すべて。MOD-OSC-001 は 0.2 → 0.3 も) ----
function addParam(name: string, value: number): SpecMigrationStep {
  return {
    from: "0.1",
    to: "0.2",
    added: [name],
    migrate: (params) => (hasOwn(params, name) ? { ...params } : { ...params, [name]: value }),
  };
}
const NOOP_01_02: SpecMigrationStep = { from: "0.1", to: "0.2", migrate: (params) => ({ ...params }) };
const NOOP_CHAIN: readonly SpecMigrationStep[] = [NOOP_01_02];
/** 帯域制限した波形への置き換え(MOD-OSC-001 §9、DEC-028)。パラメータの組と意味は同じ。 */
const NOOP_OSC_02_03: SpecMigrationStep = { from: "0.2", to: "0.3", migrate: (params) => ({ ...params }) };
const SPEC_MIGRATIONS: ReadonlyMap<string, readonly SpecMigrationStep[]> = new Map([
  ["MOD-OSC-001", [NOOP_01_02, NOOP_OSC_02_03]],
  ["MOD-IO-002", [addParam("voices", 1)]], // 単音。0.1 と全出力が一致(MOD-IO-002 §9)
  ["MOD-IO-003", [addParam("channel", 1)]], // 0.1 の「1チャンネル目のみ測定」と同じ(MOD-IO-003 §9)
]);

// ---- 小道具 ----
type Obj = Record<string, unknown>;

function hasOwn(o: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key);
}
function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function get(o: Obj, key: string): unknown {
  return hasOwn(o, key) ? o[key] : undefined;
}
function setOwn(o: Obj, key: string, value: unknown): void {
  if (key === "__proto__") Object.defineProperty(o, key, { value, enumerable: true, writable: true, configurable: true });
  else o[key] = value;
}
function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "配列";
  switch (typeof v) {
    case "object": return "オブジェクト";
    case "string": return "文字列";
    case "number": return "数値";
    case "boolean": return "真偽値";
    default: return typeof v;
  }
}
function show(v: unknown): string {
  if (typeof v === "number") return String(v);
  try {
    const s = JSON.stringify(v);
    if (s === undefined) return typeName(v);
    return s.length > 60 ? s.slice(0, 57) + "..." : s;
  } catch {
    return typeName(v);
  }
}
/** UTF-8 にしたときのバイト数。 */
export function utf8ByteLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}
function charCount(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}
function deepClone(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(deepClone);
  if (isObj(v)) {
    const out: Obj = {};
    for (const k of Object.keys(v)) setOwn(out, k, deepClone(v[k]));
    return out;
  }
  return v;
}
function isJsonValue(v: unknown, depth = 0): boolean {
  if (v === null || typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (depth > MAX_JSON_DEPTH) return false;
  if (Array.isArray(v)) return v.every((e) => isJsonValue(e, depth + 1));
  if (isObj(v)) return Object.keys(v).every((k) => isJsonValue(v[k], depth + 1));
  return false;
}
function parseSpecVersion(s: string): [number, number] {
  const [a, b] = s.split(".");
  return [Number(a), Number(b)];
}
/** `spec_version` の大小(主・副を整数として比べる。§9.1)。 */
export function compareSpecVersions(a: string, b: string): number {
  const [a1, a2] = parseSpecVersion(a);
  const [b1, b2] = parseSpecVersion(b);
  return a1 !== b1 ? Math.sign(a1 - b1) : Math.sign(a2 - b2);
}

/** §7.2 DAT-31: 保存パッチ名として使えるか(書式と、OSの予約名の拒否)。 */
export function isValidPatchName(name: unknown): name is string {
  return typeof name === "string" && PATCH_NAME_PATTERN.test(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(name);
}

// ---- 厳密なJSONの解釈(DAT-V02: 拡張表記・重複キー・コメントは不可) ----
export const MAX_JSON_DEPTH = 512;
class JsonError extends Error {}
const NUMBER_RE = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

function parseJsonStrict(text: string): unknown {
  let i = 0;
  const fail = (what: string): never => {
    throw new JsonError(`${what}(${i} 文字目)`);
  };
  const ws = (): void => {
    for (;;) {
      const c = text.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++;
      else return;
    }
  };
  const str = (): string => {
    const start = i;
    i++;
    for (;;) {
      if (i >= text.length) fail("文字列が閉じていない");
      const c = text.charCodeAt(i);
      if (c === 0x22) break;
      i += c === 0x5c ? 2 : 1;
    }
    i++;
    try {
      return JSON.parse(text.slice(start, i)) as string;
    } catch {
      i = start;
      return fail("文字列が不正");
    }
  };
  const value = (depth: number): unknown => {
    if (depth > MAX_JSON_DEPTH) fail("入れ子が深すぎる");
    ws();
    if (i >= text.length) fail("JSONが途中で終わっている");
    const c = text[i]!;
    if (c === "{") {
      i++;
      const out: Obj = {};
      ws();
      if (text[i] === "}") {
        i++;
        return out;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') fail(i >= text.length ? "JSONが途中で終わっている" : "キー(文字列)が必要");
        const key = str();
        if (hasOwn(out, key)) fail(`キー ${JSON.stringify(key)} が重複している`);
        ws();
        if (text[i] !== ":") fail(i >= text.length ? "JSONが途中で終わっている" : "\":\" が必要");
        i++;
        setOwn(out, key, value(depth + 1));
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") {
          i++;
          return out;
        }
        fail(i >= text.length ? "JSONが途中で終わっている" : "\",\" か \"}\" が必要");
      }
    }
    if (c === "[") {
      i++;
      const out: unknown[] = [];
      ws();
      if (text[i] === "]") {
        i++;
        return out;
      }
      for (;;) {
        out.push(value(depth + 1));
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") {
          i++;
          return out;
        }
        fail(i >= text.length ? "JSONが途中で終わっている" : "\",\" か \"]\" が必要");
      }
    }
    if (c === '"') return str();
    if (text.startsWith("true", i)) {
      i += 4;
      return true;
    }
    if (text.startsWith("false", i)) {
      i += 5;
      return false;
    }
    if (text.startsWith("null", i)) {
      i += 4;
      return null;
    }
    NUMBER_RE.lastIndex = i;
    const m = NUMBER_RE.exec(text);
    if (m) {
      // "-Infinity" の "-" だけ、"1." のような途中までの一致を通さない
      const next = text[i + m[0].length];
      if (next !== undefined && /[0-9A-Za-z.+_$]/.test(next)) fail("数値が不正");
      i += m[0].length;
      return Number(m[0]);
    }
    return fail("JSONの値として解釈できない");
  };
  const v = value(0);
  ws();
  if (i < text.length) fail("JSONの値の後に余分な文字がある");
  return v;
}

// ---- 検証の本体 ----
interface Issue extends PatchIssue {
  errId: string;
  details?: Record<string, unknown>;
}

const ERR_CODES: Record<string, string> = {
  "ERR-204": "patch_invalid",
  "ERR-205": "patch_version_unsupported",
  "ERR-206": "patch_too_large",
};

function failure(issues: Issue[]): PatchLoadResult {
  const first = issues[0]!;
  const list: PatchIssue[] = issues.slice(0, MAX_ISSUES).map(({ rule, path, message }) => ({ rule, path, message }));
  return {
    ok: false,
    error: {
      id: first.errId,
      code: ERR_CODES[first.errId]!,
      rule: first.rule,
      message: first.message,
      issues: list,
      details: first.errId === "ERR-204" ? { issues: list } : { ...first.details },
    },
  };
}
function issue204(rule: string, path: string, message: string): Issue {
  return { errId: "ERR-204", rule, path, message };
}
function tooLarge(bytes: number): PatchLoadResult {
  return failure([{
    errId: "ERR-206", rule: "DAT-V01", path: "",
    message: `パッチJSONが大きすぎる(${bytes} バイト。上限 ${MAX_PATCH_BYTES} バイト)`,
    details: { limit_bytes: MAX_PATCH_BYTES },
  }]);
}

/** JSON 文字列からパッチを読む(§8 の段階1〜9)。大きさは文字列の UTF-8 バイト数で測る。 */
export function parsePatchText(text: string, catalog: TypeCatalog, options: PatchLoadOptions = {}): PatchLoadResult {
  const bytes = utf8ByteLength(text);
  if (bytes > MAX_PATCH_BYTES) return tooLarge(bytes);
  let doc: unknown;
  try {
    doc = parseJsonStrict(text);
  } catch (e) {
    if (!(e instanceof JsonError)) throw e;
    return failure([issue204("DAT-V02", "", `JSONとして解釈できない: ${e.message}`)]);
  }
  return validateFromStage2(doc, catalog, options);
}

/**
 * 解釈済みの値からパッチを読む(§8 の段階1〜9)。
 * 大きさ(DAT-V01)は、値を空白なしのJSONにしたときの UTF-8 バイト数で測る。
 */
export function validatePatchDocument(doc: unknown, catalog: TypeCatalog, options: PatchLoadOptions = {}): PatchLoadResult {
  let text: string | undefined;
  try {
    text = JSON.stringify(doc);
  } catch {
    // 循環参照や BigInt など、JSONにできない値
    return failure([issue204("DAT-V02", "", "JSONの値として表せない")]);
  }
  if (text !== undefined) {
    const bytes = utf8ByteLength(text);
    if (bytes > MAX_PATCH_BYTES) return tooLarge(bytes);
  }
  return validateFromStage2(doc, catalog, options);
}

interface ModuleWork {
  id: string;
  type: string;
  info: TypeInfo;
  specFrom: string;
  params: Obj;
  ui: Obj | undefined;
  defaulted: string[];
}

function stepsFor(type: string, options: PatchLoadOptions): readonly SpecMigrationStep[] {
  return options.specMigrations?.get(type) ?? SPEC_MIGRATIONS.get(type) ?? NOOP_CHAIN;
}
/** `from` から最新版 `latest` までの移行の列。同じ版なら空、道がなければ null。 */
function migrationPath(steps: readonly SpecMigrationStep[], from: string, latest: string): SpecMigrationStep[] | null {
  const path: SpecMigrationStep[] = [];
  let v = from;
  while (compareSpecVersions(v, latest) !== 0) {
    const step = steps.find((s) => compareSpecVersions(s.from, v) === 0);
    if (!step || path.length > steps.length) return null;
    path.push(step);
    v = step.to;
  }
  return path;
}
function supportedSpecVersions(steps: readonly SpecMigrationStep[], latest: string): string[] {
  const out = steps.map((s) => s.from).filter((v) => migrationPath(steps, v, latest) !== null);
  out.push(latest);
  return out.sort(compareSpecVersions);
}

function validateFromStage2(input: unknown, catalog: TypeCatalog, options: PatchLoadOptions): PatchLoadResult {
  const latestSchema = options.schemaVersion ?? PATCH_SCHEMA_VERSION;

  // 段階2: DAT-V02
  if (!isObj(input)) return failure([issue204("DAT-V02", "", `最上位がオブジェクトでない(${typeName(input)})`)]);

  // 段階3: DAT-V03
  const format = get(input, "format");
  if (format !== PATCH_FORMAT) {
    return failure([{
      errId: "ERR-205", rule: "DAT-V03", path: "format",
      message: `format が "${PATCH_FORMAT}" でない(${format === undefined ? "なし" : show(format)})`,
      details: { found: format === undefined ? null : format, supported: [PATCH_FORMAT] },
    }]);
  }

  // 段階4: DAT-V04
  const schemaFrom = get(input, "schema_version");
  if (typeof schemaFrom !== "number" || !Number.isInteger(schemaFrom) || schemaFrom < 1) {
    return failure([issue204("DAT-V04", "schema_version",
      `schema_version が 1 以上の整数でない(${schemaFrom === undefined ? "なし" : show(schemaFrom)})`)]);
  }
  if (schemaFrom > latestSchema) {
    const supported: number[] = [];
    for (let v = 1; v <= latestSchema; v++) supported.push(v);
    return failure([{
      errId: "ERR-205", rule: "DAT-V04", path: "schema_version",
      message: `schema_version ${schemaFrom} は未対応(対応する最新版は ${latestSchema})`,
      details: { found: schemaFrom, supported },
    }]);
  }
  // ① パッチ形式の移行(DAT-55)
  let doc: Obj = input;
  for (let v = schemaFrom; v < latestSchema; v++) {
    const fn = options.schemaMigrations?.get(v);
    if (!fn) throw new Error(`パッチ形式の移行 ${v} → ${v + 1} が登録されていない`);
    doc = fn(deepClone(doc) as Obj);
  }

  // 段階5: DAT-V05(構造)
  let issues: Issue[] = [];
  const v05 = (path: string, message: string): void => {
    issues.push(issue204("DAT-V05", path, message));
  };
  const join = (path: string, key: string): string => (path === "" ? key : `${path}.${key}`);
  type Kind = "string" | "number" | "object" | "array";
  const kindOk = (v: unknown, kind: Kind): boolean =>
    kind === "array" ? Array.isArray(v) : kind === "object" ? isObj(v) : typeof v === kind;
  const kindName: Record<Kind, string> = { string: "文字列", number: "数値", object: "オブジェクト", array: "配列" };
  /** 必須・型・未知のキーを見る。fields の値は [型, 必須か]。 */
  const shape = (o: Obj, path: string, fields: Record<string, [Kind, boolean]>): void => {
    for (const [key, [kind, required]] of Object.entries(fields)) {
      if (!hasOwn(o, key)) {
        if (required) v05(join(path, key), `必須フィールド ${key} がない`);
      } else if (!kindOk(o[key], kind)) {
        v05(join(path, key), `${key} が${kindName[kind]}でない(${typeName(o[key])})`);
      }
    }
    for (const key of Object.keys(o)) {
      if (!hasOwn(fields, key)) v05(join(path, key), `未知のキー ${JSON.stringify(key)}`);
    }
  };
  shape(doc, "", {
    format: ["string", true], schema_version: ["number", true], meta: ["object", false],
    modules: ["array", true], cables: ["array", true],
  });
  const metaIn = get(doc, "meta");
  if (isObj(metaIn)) {
    shape(metaIn, "meta", {
      title: ["string", false], description: ["string", false], created_at: ["string", false],
      modified_at: ["string", false], saved_by: ["object", false], app_version: ["string", false],
    });
    const sb = get(metaIn, "saved_by");
    if (isObj(sb)) shape(sb, "meta.saved_by", { kind: ["string", true], client_id: ["string", false] });
  }
  const modulesIn = get(doc, "modules");
  if (Array.isArray(modulesIn)) {
    modulesIn.forEach((m: unknown, i) => {
      const path = `modules[${i}]`;
      if (!isObj(m)) return v05(path, `モジュールがオブジェクトでない(${typeName(m)})`);
      shape(m, path, {
        id: ["string", true], type: ["string", true], spec_version: ["string", true],
        params: ["object", false], ui: ["object", false],
      });
    });
  }
  const cablesIn = get(doc, "cables");
  if (Array.isArray(cablesIn)) {
    cablesIn.forEach((c: unknown, i) => {
      const path = `cables[${i}]`;
      if (!isObj(c)) return v05(path, `ケーブルがオブジェクトでない(${typeName(c)})`);
      shape(c, path, { id: ["string", true], from: ["object", true], to: ["object", true] });
      for (const end of ["from", "to"]) {
        const ref = get(c, end);
        if (isObj(ref)) shape(ref, `${path}.${end}`, { module: ["string", true], port: ["string", true] });
      }
    });
  }
  if (issues.length > 0) return failure(issues);

  // ここから先は構造が保証されている
  const rawModules = modulesIn as Obj[];
  const rawCables = cablesIn as { id: string; from: PatchPortRef; to: PatchPortRef }[];
  const rawMeta: Obj = isObj(metaIn) ? metaIn : {};

  // 段階6: DAT-V06、DAT-V07
  issues = [];
  rawModules.forEach((m, i) => {
    if (!catalog.has(m.type as string)) {
      issues.push(issue204("DAT-V06", `modules[${i}].type`, `未知のモジュール種別 ${show(m.type)}`));
    }
  });
  const paths: (SpecMigrationStep[] | null)[] = [];
  rawModules.forEach((m, i) => {
    const sv = m.spec_version as string;
    const path = `modules[${i}].spec_version`;
    paths.push(null);
    if (!SPEC_VERSION_PATTERN.test(sv)) {
      issues.push(issue204("DAT-V07", path, `spec_version の書式が不正(${show(sv)})`));
      return;
    }
    const info = catalog.get(m.type as string);
    if (!info) return; // 種別が未知なら、実装している版と比べられない(DAT-V06 で不合格)
    const steps = stepsFor(info.type, options);
    const mp = migrationPath(steps, sv, info.specVersion);
    if (mp) {
      paths[i] = mp;
      return;
    }
    const newer = compareSpecVersions(sv, info.specVersion) > 0;
    issues.push({
      errId: "ERR-205", rule: "DAT-V07", path,
      message: newer
        ? `${info.type} の spec_version ${sv} は新しすぎる(実装している版は ${info.specVersion})`
        : `${info.type} の spec_version ${sv} は未知の版(移行が登録されていない)`,
      details: { found: sv, supported: supportedSpecVersions(steps, info.specVersion) },
    });
  });
  if (issues.length > 0) return failure(issues);

  // ② 省略パラメータの補完(元の spec_version の既定値。DAT-59)→ ③ モジュールごとの移行(DAT-56)
  const portRenames = new Map<string, Map<string, string>>(); // モジュールID → 旧ポート名 → 新ポート名
  const work: ModuleWork[] = rawModules.map((m, i) => {
    const info = catalog.get(m.type as string)!;
    const path = paths[i]!;
    const added = new Set<string>();
    for (const step of path) for (const name of step.added ?? []) added.add(name);
    const src: Obj = isObj(m.params) ? m.params : {};
    let params: Obj = {};
    for (const k of Object.keys(src)) setOwn(params, k, src[k]);
    const defaulted: string[] = [];
    for (const p of info.params) {
      if (added.has(p.name) || hasOwn(params, p.name)) continue;
      params[p.name] = p.default;
      defaulted.push(p.name);
    }
    const id = m.id as string;
    for (const step of path) {
      params = step.migrate(params);
      if (step.renamePorts) {
        let map = portRenames.get(id);
        if (!map) portRenames.set(id, (map = new Map()));
        const olds = new Map<string, string>(); // 現在の名前 → 元の名前
        for (const [orig, cur] of map) olds.set(cur, orig);
        for (const [from, to] of Object.entries(step.renamePorts)) {
          map.set(olds.get(from) ?? from, to);
        }
      }
    }
    return {
      id, type: info.type, info, specFrom: m.spec_version as string, params,
      ui: isObj(m.ui) ? m.ui : undefined, defaulted,
    };
  });
  const renamed = (ref: PatchPortRef): PatchPortRef => ({
    module: ref.module,
    port: portRenames.get(ref.module)?.get(ref.port) ?? ref.port,
  });
  const cables: PatchCable[] = rawCables.map((c) => ({ id: c.id, from: renamed(c.from), to: renamed(c.to) }));

  // 段階7: DAT-V08〜V12
  issues = [];
  const seenModules = new Map<string, ModuleWork>();
  work.forEach((m, i) => {
    const path = `modules[${i}].id`;
    if (!ID_PATTERN.test(m.id)) issues.push(issue204("DAT-V08", path, `モジュールIDの書式が不正(${show(m.id)})`));
    if (seenModules.has(m.id)) issues.push(issue204("DAT-V08", path, `モジュールID ${show(m.id)} が重複している`));
    else seenModules.set(m.id, m);
  });
  const outCount = work.filter((m) => m.id === OUT_MODULE_ID && m.type === OUT_MODULE_TYPE).length;
  if (outCount !== 1) {
    issues.push(issue204("DAT-V09", "modules",
      `ID "${OUT_MODULE_ID}"・種別 ${OUT_MODULE_TYPE} のモジュールが ${outCount} 個ある(ちょうど1つ必要)`));
  }
  work.forEach((m, i) => {
    if (m.type === OUT_MODULE_TYPE && m.id !== OUT_MODULE_ID) {
      issues.push(issue204("DAT-V09", `modules[${i}]`, `${OUT_MODULE_TYPE} は ID "${OUT_MODULE_ID}" の1つだけ(${show(m.id)})`));
    }
  });
  const known = work.map((m) => new Map<string, ParamInfo>(m.info.params.map((p) => [p.name, p])));
  work.forEach((m, i) => {
    for (const name of Object.keys(m.params)) {
      if (!known[i]!.has(name)) {
        issues.push(issue204("DAT-V10", `modules[${i}].params.${name}`, `${m.type} に未知のパラメータ ${show(name)}`));
      }
    }
  });
  work.forEach((m, i) => {
    for (const name of Object.keys(m.params)) {
      const def = known[i]!.get(name);
      if (!def) continue;
      const v = m.params[name];
      const path = `modules[${i}].params.${name}`;
      if (typeof v !== "number" || !Number.isFinite(v)) {
        issues.push(issue204("DAT-V11", path, `パラメータ ${name} の値が有限の数値でない(${show(v)})`));
      } else if (def.kind !== "float" && !Number.isInteger(v)) {
        issues.push(issue204("DAT-V11", path, `パラメータ ${name} は整数(${v})`));
      }
    }
  });
  work.forEach((m, i) => {
    for (const name of Object.keys(m.params)) {
      const def = known[i]!.get(name);
      const v = m.params[name];
      if (!def || typeof v !== "number" || !Number.isFinite(v)) continue;
      if (v < def.min || v > def.max) {
        issues.push(issue204("DAT-V12", `modules[${i}].params.${name}`,
          `パラメータ ${name} の値 ${v} が範囲外(${def.min}〜${def.max})`));
      }
    }
  });
  if (issues.length > 0) return failure(issues);

  // 段階8: DAT-V13〜V16
  issues = [];
  const seenCables = new Set<string>();
  cables.forEach((c, i) => {
    const path = `cables[${i}].id`;
    if (!ID_PATTERN.test(c.id)) issues.push(issue204("DAT-V13", path, `ケーブルIDの書式が不正(${show(c.id)})`));
    if (seenCables.has(c.id)) issues.push(issue204("DAT-V13", path, `ケーブルID ${show(c.id)} が重複している`));
    else seenCables.add(c.id);
  });
  type End = { dir: "input" | "output"; connectable: boolean } | null;
  const ends: { from: End; to: End }[] = [];
  cables.forEach((c, i) => {
    const resolve = (key: "from" | "to"): End => {
      const ref = c[key];
      const m = seenModules.get(ref.module);
      if (!m) {
        issues.push(issue204("DAT-V14", `cables[${i}].${key}.module`, `モジュール ${show(ref.module)} がない`));
        return null;
      }
      const out = m.info.outputs.find((p) => p.name === ref.port);
      const inp = m.info.inputs.find((p) => p.name === ref.port);
      // 同名の入力と出力がある種別では、from は出力、to は入力を優先する
      const first = key === "from" ? out ?? inp : inp ?? out;
      if (!first) {
        issues.push(issue204("DAT-V14", `cables[${i}].${key}.port`, `${m.id}(${m.type})にポート ${show(ref.port)} がない`));
        return null;
      }
      return { dir: first === out ? "output" : "input", connectable: first.connectable };
    };
    ends.push({ from: resolve("from"), to: resolve("to") });
  });
  cables.forEach((c, i) => {
    const { from, to } = ends[i]!;
    const ref = (r: PatchPortRef): string => `${r.module}.${r.port}`;
    if (from) {
      if (from.dir !== "output") issues.push(issue204("DAT-V15", `cables[${i}].from`, `from の ${ref(c.from)} は出力ポートでない`));
      else if (!from.connectable) issues.push(issue204("DAT-V15", `cables[${i}].from`, `${ref(c.from)} は接続できないポート`));
    }
    if (to) {
      if (to.dir !== "input") issues.push(issue204("DAT-V15", `cables[${i}].to`, `to の ${ref(c.to)} は入力ポートでない`));
      else if (!to.connectable) issues.push(issue204("DAT-V15", `cables[${i}].to`, `${ref(c.to)} は接続できないポート`));
    }
  });
  const usedInputs = new Map<string, string>(); // "モジュールID ポート名" → 最初のケーブルID
  cables.forEach((c, i) => {
    const key = `${c.to.module} ${c.to.port}`; // モジュールIDは空白を含まない(DAT-V08 を通過済みのものだけが対象になる)
    const first = usedInputs.get(key);
    if (first === undefined) usedInputs.set(key, c.id);
    else {
      issues.push(issue204("DAT-V16", `cables[${i}].to`,
        `入力 ${c.to.module}.${c.to.port} に2本目以降のケーブル(先のケーブルは ${show(first)})`));
    }
  });
  if (issues.length > 0) return failure(issues);

  // 段階9: DAT-V17、DAT-V18
  issues = [];
  if (work.length > MAX_MODULES) {
    issues.push(issue204("DAT-V17", "modules", `モジュール数 ${work.length} が上限 ${MAX_MODULES} を超えている`));
  }
  if (cables.length > MAX_CABLES) {
    issues.push(issue204("DAT-V17", "cables", `ケーブル数 ${cables.length} が上限 ${MAX_CABLES} を超えている`));
  }
  const v18 = (path: string, message: string): void => {
    issues.push(issue204("DAT-V18", path, message));
  };
  const maxChars = (key: string, limit: number): void => {
    const v = get(rawMeta, key);
    if (typeof v === "string" && charCount(v) > limit) v18(`meta.${key}`, `meta.${key} が ${limit} 文字を超えている(${charCount(v)} 文字)`);
  };
  maxChars("title", MAX_TITLE_CHARS);
  maxChars("description", MAX_DESCRIPTION_CHARS);
  for (const key of ["created_at", "modified_at"]) {
    const v = get(rawMeta, key);
    if (typeof v === "string" && !isUtcTimestamp(v)) v18(`meta.${key}`, `meta.${key} が RFC 3339 の UTC の時刻でない(${show(v)})`);
  }
  const savedBy = get(rawMeta, "saved_by");
  if (isObj(savedBy) && savedBy.kind !== "human" && savedBy.kind !== "agent") {
    v18("meta.saved_by.kind", `meta.saved_by.kind が "human" でも "agent" でもない(${show(savedBy.kind)})`);
  }
  maxChars("app_version", MAX_APP_VERSION_CHARS);
  work.forEach((m, i) => {
    if (!m.ui) return;
    const path = `modules[${i}].ui`;
    for (const key of ["x", "y"]) {
      if (!hasOwn(m.ui, key)) continue;
      const v = m.ui[key];
      if (typeof v !== "number" || !Number.isFinite(v)) v18(`${path}.${key}`, `ui.${key} が有限の数値でない(${show(v)})`);
    }
    if (!isJsonValue(m.ui)) {
      v18(path, "ui にJSONの値でないものがある");
      return;
    }
    if (depthExceeds(m.ui, MAX_UI_DEPTH)) {
      v18(path, `ui の入れ子が深すぎる(上限 ${MAX_UI_DEPTH} 段)`);
      return;
    }
    const bytes = utf8ByteLength(JSON.stringify(m.ui));
    if (bytes > MAX_UI_BYTES) v18(path, `ui が ${MAX_UI_BYTES} バイトを超えている(${bytes} バイト)`);
  });
  if (issues.length > 0) return failure(issues);

  // 正規化した文書を作る
  const meta: PatchMeta = {
    title: typeof rawMeta.title === "string" && hasOwn(rawMeta, "title") ? rawMeta.title : "",
    description: typeof rawMeta.description === "string" && hasOwn(rawMeta, "description") ? rawMeta.description : "",
  };
  if (hasOwn(rawMeta, "created_at")) meta.created_at = rawMeta.created_at as string;
  if (hasOwn(rawMeta, "modified_at")) meta.modified_at = rawMeta.modified_at as string;
  if (isObj(savedBy)) {
    meta.saved_by = { kind: savedBy.kind as "human" | "agent" };
    if (hasOwn(savedBy, "client_id")) meta.saved_by.client_id = savedBy.client_id as string;
  }
  if (hasOwn(rawMeta, "app_version")) meta.app_version = rawMeta.app_version as string;

  const modules: PatchModule[] = work.map((m) => {
    const params: Record<string, number> = {};
    for (const p of m.info.params) params[p.name] = hasOwn(m.params, p.name) ? (m.params[p.name] as number) : p.default;
    const out: PatchModule = { id: m.id, type: m.type, spec_version: m.info.specVersion, params };
    if (m.ui) out.ui = deepClone(m.ui) as PatchUi;
    return out;
  });
  const patch: PatchDocument = { format: PATCH_FORMAT, schema_version: latestSchema, meta, modules, cables };

  const warnings: PatchWarning[] = [];
  for (const m of work) {
    if (m.defaulted.length === 0) continue;
    warnings.push({
      code: "param_defaulted",
      message: `${m.id} の省略されたパラメータを仕様版 ${m.specFrom} の既定値で補った: ${m.defaulted.join(", ")}`,
      details: { module_id: m.id, type: m.type, spec_version: m.specFrom, params: [...m.defaulted] },
    });
  }
  const migratedModules = work
    .filter((m) => compareSpecVersions(m.specFrom, m.info.specVersion) !== 0)
    .map((m) => ({ id: m.id, type: m.type, spec_from: m.specFrom, spec_to: m.info.specVersion }));
  let migrated: PatchMigrationReport | null = null;
  if (schemaFrom !== latestSchema || migratedModules.length > 0) {
    migrated = { schema_from: schemaFrom, schema_to: latestSchema, modules: migratedModules };
    warnings.push({ code: "migrated", message: "古い版のパッチを最新版へ移行して読み込んだ", details: { ...migrated } });
  }
  return { ok: true, patch, warnings, migrated };
}

/** RFC 3339 の UTC の時刻(`YYYY-MM-DDTHH:MM:SS[.fff]Z`)か。 */
function isUtcTimestamp(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  if (mo < 1 || mo > 12 || h > 23 || mi > 59 || se > 60) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]!;
  return d >= 1 && d <= days;
}

/**
 * 保存時の文字列。キーは契約 §3〜§5 の表の順、配列は現在の並びのまま(DAT-03)、`params` は持っている全項目(DAT-07)。
 * 2文字の字下げ、末尾に改行、BOMなし(DAT-32)。ただし各モジュールの `ui` の値は改行・字下げなしの1行で書く:
 * `ui` は中身が自由な値で、字下げすると要素1つごとに行と空白が増え、上限内のパッチ(256 モジュール・1024 ケーブル・
 * `ui` 1024 バイト)でも保存文書が 1 MiB を超えてしまうため。
 */
export function serializePatchDocument(patch: PatchDocument): string {
  const meta: Obj = { title: patch.meta.title, description: patch.meta.description };
  if (patch.meta.created_at !== undefined) meta.created_at = patch.meta.created_at;
  if (patch.meta.modified_at !== undefined) meta.modified_at = patch.meta.modified_at;
  if (patch.meta.saved_by !== undefined) {
    const sb: Obj = { kind: patch.meta.saved_by.kind };
    if (patch.meta.saved_by.client_id !== undefined) sb.client_id = patch.meta.saved_by.client_id;
    meta.saved_by = sb;
  }
  if (patch.meta.app_version !== undefined) meta.app_version = patch.meta.app_version;
  const pretty = (v: unknown, indent: string): string => JSON.stringify(v, null, 2).replace(/\n/g, "\n" + indent);
  const modules = patch.modules.map((m) => {
    const lines = [
      `      "id": ${JSON.stringify(m.id)}`,
      `      "type": ${JSON.stringify(m.type)}`,
      `      "spec_version": ${JSON.stringify(m.spec_version)}`,
      `      "params": ${pretty(m.params, "      ")}`,
    ];
    if (m.ui !== undefined) lines.push(`      "ui": ${JSON.stringify(m.ui)}`);
    return `    {\n${lines.join(",\n")}\n    }`;
  });
  const cables = patch.cables.map((c) =>
    pretty({ id: c.id, from: { module: c.from.module, port: c.from.port }, to: { module: c.to.module, port: c.to.port } }, "    "),
  );
  const list = (items: string[], indentFirst: boolean): string =>
    items.length === 0 ? "[]" : `[\n${items.map((t) => (indentFirst ? "    " + t : t)).join(",\n")}\n  ]`;
  return (
    "{\n" +
    `  "format": ${JSON.stringify(patch.format)},\n` +
    `  "schema_version": ${JSON.stringify(patch.schema_version)},\n` +
    `  "meta": ${pretty(meta, "  ")},\n` +
    `  "modules": ${list(modules, false)},\n` +
    `  "cables": ${list(cables, true)}\n` +
    "}\n"
  );
}
