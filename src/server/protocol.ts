// ローカルサーバーとタブ・エージェントの間の取り決め(DEC-103/104)。
// パッチの正本はタブ側(Session)。サーバーはエージェントの要求をタブへ中継し、パッチファイルの保存先を提供する。
//
// 経路:
//   タブ          WebSocket  GET /tab?token=<タブ用トークン>     (Origin は自サーバーのオリジンだけ)
//   エージェント  WebSocket  GET /api/ws                          (Authorization: Bearer <エージェント用トークン>)
//   エージェント  HTTP       POST /api/command                    (同上。本文は操作契約 §3 の要求。応答は §3 の応答)
// タブ用トークンは、配信する index.html に埋め込む(<meta name="synth-tab-token">)。エージェント用トークンは起動時に表示する。
// 2つのトークンは別の値。待受は 127.0.0.1 だけ。

import type { StoreError, StoredPatchInfo } from "../control/store.js";

/** 操作契約 §3 の要求・応答・通知(中身はここでは解釈しない)。 */
export type Json = unknown;

// ---- サーバー → タブ ----
export type ServerToTab =
  /** エージェントの要求を中継する。タブは Session.handle(request, "agent") で処理して res を返す。 */
  | { t: "req"; id: number; client_id: string; request: Json }
  /** 保存先の操作の結果。 */
  | { t: "store_res"; id: number; ok: true; value: Json }
  | { t: "store_res"; id: number; ok: false; error: StoreError; message?: string }
  /** このタブがセッションとして受け付けられた(単一タブ: data-contract DAT-25)。 */
  | { t: "hello"; accepted: boolean; reason?: "another_tab" };

// ---- タブ → サーバー ----
export type TabToServer =
  | { t: "res"; id: number; response: Json }
  /** 通知(操作契約 §10)。サーバーは接続中のエージェントへ配る。 */
  | { t: "evt"; event: Json }
  /** 保存先の操作(PatchStore と同じ意味)。 */
  | { t: "store"; id: number; op: "list" }
  | { t: "store"; id: number; op: "read"; name: string }
  | { t: "store"; id: number; op: "write"; name: string; text: string; overwrite: boolean }
  | { t: "store"; id: number; op: "remove"; name: string };

// ---- エージェント(WebSocket)----
// エージェント → サーバー: 操作契約 §3 の要求(JSON テキスト1通 = 1要求)。
// サーバー → エージェント: 操作契約 §3 の応答、または通知({ "event": … } の形は操作契約 §10)。

export type { StoredPatchInfo };
