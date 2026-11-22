// 要求の封筒の検査(operation-contract §3.1、§3.3 の1)と、モジュール種別の一覧の形(CMD-01)。
// コマンド処理(Session)と、タブがないときに直接答えるサーバー(src/server/app.ts)が同じものを使う。
import type { TypeCatalog, TypeInfo } from "./catalog.js";
import type { ErrorId } from "./errors.js";
import { MAX_REQUEST_DEPTH, depthExceeds } from "./json.js";

export interface ErrorSpec {
  id: ErrorId;
  message: string;
  details?: Record<string, unknown>;
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 1〜64 文字(符号位置で数える)の文字列か。 */
export function okLen(v: unknown): v is string {
  if (typeof v !== "string" || v.length < 1 || v.length > 128) return false;
  let n = 0;
  for (const _ of v) n++;
  return n <= 64;
}

export const ENVELOPE_KEYS: readonly string[] = ["v", "request_id", "command", "args", "expected_revision", "idempotency_key", "client_id"];

/**
 * 封筒の形。問題がなければ null。順は ERR-001(形)→ ERR-012(版)。
 * 未知のフィールド、深すぎる入れ子(MAX_REQUEST_DEPTH 段を超える)は ERR-001。
 */
export function checkEnvelope(r: unknown): ErrorSpec | null {
  const invalid = (field: string, message: string, more: Obj = {}): ErrorSpec => ({ id: "ERR-001", message, details: { field, ...more } });
  if (!isObj(r)) return invalid("", "要求がオブジェクトでない");
  if (depthExceeds(r, MAX_REQUEST_DEPTH)) {
    return invalid("", `要求の入れ子が深すぎる(上限 ${MAX_REQUEST_DEPTH} 段)`, { reason: "too_deep", limit_depth: MAX_REQUEST_DEPTH });
  }
  for (const k of Object.keys(r)) {
    if (!ENVELOPE_KEYS.includes(k)) return invalid(k, `封筒に未知のフィールド ${k}`);
  }
  if (typeof r.v !== "number" || !Number.isInteger(r.v)) return invalid("v", "v は整数(必須)");
  if (!okLen(r.request_id)) return invalid("request_id", "request_id は 1〜64 文字の文字列(必須)");
  if (typeof r.command !== "string") return invalid("command", "command は文字列(必須)");
  if ("args" in r && !isObj(r.args)) return invalid("args", "args はオブジェクト");
  if ("expected_revision" in r) {
    const e = r.expected_revision;
    if (typeof e !== "number" || !Number.isInteger(e) || e < 0) {
      return invalid("expected_revision", "expected_revision は 0 以上の整数");
    }
  }
  if ("idempotency_key" in r && !okLen(r.idempotency_key)) {
    return invalid("idempotency_key", "idempotency_key は 1〜64 文字の文字列");
  }
  if ("client_id" in r && !okLen(r.client_id)) return invalid("client_id", "client_id は 1〜64 文字の文字列");
  if (r.v !== 1) return { id: "ERR-012", message: `封筒の版 ${r.v} は未対応`, details: { supported: [1] } };
  return null;
}

/** CMD-01 の `types` の1要素。`singleton`・`readouts` は種別で決まる(呼ぶ側が種別名を渡す)。 */
export function describeType(t: TypeInfo, outType: string, meterType: string, meterFields: readonly string[]): Obj {
  const port = (p: { name: string; type: string; connectable: boolean }, direction: "in" | "out"): Obj => ({
    name: p.name,
    direction,
    signal_type: p.type,
    unit: null, // 定義表(catalog)にない
    connectable: p.connectable,
    unconnected: null, // 定義表(catalog)にない
  });
  return {
    type: t.type,
    title: t.title,
    category: null, // 定義表(catalog)にない
    spec_version: t.specVersion,
    singleton: t.type === outType,
    ports: [...t.inputs.map((p) => port(p, "in")), ...t.outputs.map((p) => port(p, "out"))],
    params: t.params.map((p) => ({
      name: p.name,
      kind: p.kind === "seed" ? "int" : p.kind,
      unit: p.unit ?? null,
      min: p.min,
      max: p.max,
      default: p.default,
    })),
    readouts: t.type === meterType ? [...meterFields] : [],
  };
}

/** CMD-01 の全体。`args.type` の検査を含む。失敗は ErrorSpec。 */
export function listTypes(catalog: TypeCatalog, args: Obj, outType: string, meterType: string, meterFields: readonly string[]): { types: Obj[] } | ErrorSpec {
  for (const k of Object.keys(args)) {
    if (k !== "type") return { id: "ERR-003", message: `未知の引数 ${k}`, details: { arg: k, reason: "unknown_key" } };
  }
  let infos = [...catalog.values()];
  if ("type" in args) {
    if (typeof args.type !== "string") return { id: "ERR-003", message: "引数 type: type", details: { arg: "type", reason: "type" } };
    const one = catalog.get(args.type);
    if (!one) return { id: "ERR-101", message: `未知のモジュール種別 ${args.type}`, details: { type: args.type } };
    infos = [one];
  }
  return { types: infos.map((t) => describeType(t, outType, meterType, meterFields)) };
}
