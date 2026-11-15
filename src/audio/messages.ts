// メインスレッド ⇔ AudioWorklet のメッセージ(MessagePort)。
import { CoreStatus, PatchDesc } from "./core.js";

export type ToWorklet =
  | { type: "load"; patch: PatchDesc }
  | { type: "param"; module: string; name: string; value: number }
  | { type: "start" }
  | { type: "stop" }
  | { type: "panic" }
  | { type: "release_panic" }
  | { type: "level"; db: number; actor: "human" | "agent" };

export type FromWorklet =
  | { type: "status"; status: CoreStatus; peak: number }
  | { type: "error"; message: string }
  | { type: "level_result"; ok: boolean; reason?: string };
