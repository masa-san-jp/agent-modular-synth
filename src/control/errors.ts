// 操作契約 §5 のエラー一覧(ID → code)。ID と code は契約の表のまま。
import { ErrorBody } from "./types.js";

export const ERRORS = {
  "ERR-001": "invalid_request",
  "ERR-002": "unknown_command",
  "ERR-003": "invalid_args",
  "ERR-004": "unauthorized",
  "ERR-005": "forbidden",
  "ERR-006": "no_session",
  "ERR-007": "timeout",
  "ERR-008": "revision_conflict",
  "ERR-009": "idempotency_key_reused",
  "ERR-010": "internal_error",
  "ERR-011": "payload_too_large",
  "ERR-012": "unsupported_version",
  "ERR-101": "unknown_module_type",
  "ERR-102": "module_not_found",
  "ERR-103": "module_id_conflict",
  "ERR-104": "module_protected",
  "ERR-105": "singleton_module",
  "ERR-106": "limit_exceeded",
  "ERR-111": "port_not_found",
  "ERR-112": "port_direction",
  "ERR-113": "port_not_connectable",
  "ERR-114": "input_occupied",
  "ERR-115": "cable_not_found",
  "ERR-116": "cable_id_conflict",
  "ERR-121": "param_not_found",
  "ERR-122": "param_invalid_value",
  "ERR-123": "param_out_of_range",
  "ERR-131": "batch_failed",
  "ERR-132": "batch_op_not_allowed",
  "ERR-141": "nothing_to_undo",
  "ERR-142": "nothing_to_redo",
  "ERR-201": "invalid_patch_name",
  "ERR-202": "patch_not_found",
  "ERR-203": "patch_name_exists",
  "ERR-204": "patch_invalid",
  "ERR-205": "patch_version_unsupported",
  "ERR-206": "patch_too_large",
  "ERR-207": "storage_failed",
  "ERR-301": "audio_not_running",
  "ERR-302": "level_limit_exceeded",
  "ERR-303": "not_a_meter",
  "ERR-304": "audio_start_failed",
} as const;

export type ErrorId = keyof typeof ERRORS;
export type ErrorCode = (typeof ERRORS)[ErrorId];

/** コマンド処理の中で投げる失敗。応答の `error` になる。 */
export class CommandError extends Error {
  constructor(
    readonly id: ErrorId,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CommandError";
  }

  toBody(): ErrorBody {
    return errorBody(this.id, this.message, this.details);
  }
}

export function errorBody(id: ErrorId, message: string, details: Record<string, unknown> = {}): ErrorBody {
  return { id, code: ERRORS[id], message, details };
}
