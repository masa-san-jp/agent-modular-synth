// LLM とシンセのやりとりを英語にするための文言(Issue #55、DEC-027 の改訂。オーナーの指示 2026-11-25)。
// - ツールの説明: MCP アダプタの説明(日本語)の場所ごとの英訳。MCP 側に説明が増えて訳がないと、試験が落ちる
//   (LLM に渡す文字に日本語が残らないことを test/local-llm.test.ts が確かめる)。
// - エラー: 共通コマンドのエラーの code ごとの英語の説明(日本語の message の代わり)。
// - モジュールの一覧表: 種別の英語の名前、単位、選択肢の名前。
// ターミナルに出すログは日本語のまま(読むのはオーナー)。人が画面に書いた指示など、人が書いた中身は訳さない。
import type { TypeCatalog } from "../../src/control/catalog.js";

type Obj = Record<string, unknown>;

/** ツールの説明の英訳。鍵は「ツール名」または「ツール名.properties.…」(引数の説明の場所)。 */
export const TOOL_TEXT_EN: Readonly<Record<string, string>> = {
  module_list_types: "List module type definitions (ports, params, ranges). Read-only. The system prompt already has a summary; call with type for one type's details.",
  "module_list_types.properties.type": "Type ID. If given, return only that type",
  module_add: "Add a module.",
  "module_add.properties.type": "Type ID (e.g. MOD-OSC-001). MOD-IO-001 (the fixed output `out`) cannot be added",
  "module_add.properties.id": "Module ID. Auto-assigned (m<N>) if omitted",
  "module_add.properties.params": "Param name -> number. Unspecified params use defaults. Out-of-range values are rejected (not clamped)",
  "module_add.properties.ui": "Position on screen. The UI places it if omitted",
  module_remove: "Remove a module.",
  "module_remove.properties.module_id": "Module ID",
  module_get: "Read one module's state. Read-only.",
  "module_get.properties.module_id": "Module ID",
  module_move: "Move a module on screen.",
  "module_move.properties.module_id": "Module ID",
  "module_move.properties.ui": "Position on screen (finite numbers)",
  cable_connect: "Connect an output to an input.",
  "cable_connect.properties.from": "Output port",
  "cable_connect.properties.from.properties.module": "Module ID",
  "cable_connect.properties.from.properties.port": "Port name, case-sensitive (e.g. IN_L, saw)",
  "cable_connect.properties.to": "Input port (one cable per input)",
  "cable_connect.properties.to.properties.module": "Module ID",
  "cable_connect.properties.to.properties.port": "Port name, case-sensitive (e.g. IN_L, saw)",
  "cable_connect.properties.id": "Cable ID. Auto-assigned (c<N>) if omitted",
  cable_disconnect: "Remove a cable. Give exactly one of cable_id or to.",
  "cable_disconnect.properties.cable_id": "Cable ID",
  "cable_disconnect.properties.to": "Input port (removes the cable plugged into it)",
  "cable_disconnect.properties.to.properties.module": "Module ID",
  "cable_disconnect.properties.to.properties.port": "Port name, case-sensitive (e.g. IN_L, saw)",
  param_set: "Set a parameter.",
  "param_set.properties.module_id": "Module ID",
  "param_set.properties.param": "Param name",
  "param_set.properties.value": "Value. Out-of-range values are rejected (not clamped)",
  "param_set.properties.coalesce_key": "Key to merge consecutive changes into one history entry",
  batch: "Apply several operations at once.",
  "batch.properties.ops": "Operations, validated and applied in order; if one fails, nothing is applied. Later ops can refer to modules added earlier (set their id)",
  "batch.properties.ops.items.properties.command": "Command name (dotted, e.g. module.add — not the tool name)",
  "batch.properties.ops.items.properties.args": "Arguments of that command",
  patch_get: "Read the whole patch and its revision. Read-only.",
  patch_new: "Replace the patch with an empty one.",
  patch_save: "Save the patch to a file under a name.",
  "patch_save.properties.name": "Patch name (saved as <name>.patch.json)",
  "patch_save.properties.overwrite": "Overwrite an existing file (default false). Agents may only overwrite files last saved by an agent",
  patch_load: "Load a saved patch (or patch JSON). Give exactly one of name or patch.",
  "patch_load.properties.name": "Saved patch name",
  "patch_load.properties.patch": "Patch JSON object (passed directly)",
  patch_list: "List saved patches. Read-only.",
  patch_read: "Read a saved patch without loading it. Read-only.",
  "patch_read.properties.name": "Saved patch name",
  patch_set_meta: "Change the title/description. At least one is required.",
  "patch_set_meta.properties.title": "Title",
  "patch_set_meta.properties.description": "Description",
  history_undo: "Undo the last change.",
  history_redo: "Redo an undone change.",
  meter_read: "Read meter/scope values. Read-only.",
  "meter_read.properties.module_id": "Module ID of a MOD-IO-003 (meter/scope)",
  "meter_read.properties.fields": "Fields to read. Default: all except frame (frame only when asked)",
  engine_get_status: "Read audio state, level and diagnostics. Read-only.",
  engine_panic: "Emergency stop (mute everything).",
  output_set_level: "Set the master level.",
  "output_set_level.properties.level_db": "Master level [dB]. 0 dB = unity. Agents are limited to output.agent_max_level_db (see engine_get_status)",
  score_play:
    "Queue a score (notes with start and length) and play it. To keep playing, send the next score before `remaining` (seconds to the end of the queue) runs out. Before sending, read prompts with acked:false (from score_get_status or this response) and set ack_prompt on a score that follows them. Sound needs a MIDI-CV (MOD-IO-002) in the patch, and a human must have started audio.",
  "score_play.properties.notes": "Notes, any order. A chord = notes with the same t. A rest = no note",
  "score_play.properties.notes.items.properties.t": "Start from the top of the score (beats if tempo_bpm is set, else seconds)",
  "score_play.properties.notes.items.properties.dur": "Length (same unit as t)",
  "score_play.properties.notes.items.properties.note": "MIDI note number. 60 = C4 (middle C). +1 = one semitone",
  "score_play.properties.notes.items.properties.vel": "Velocity. Default 100",
  "score_play.properties.notes.items.properties.ch": "MIDI channel. Default 1",
  "score_play.properties.params":
    "Parameter changes (optional): move a module param at a position in the score (open a filter, deepen a delay...). Only the sound changes; the patch, revision and history do not. Reverts to the patch value when playback ends or stops",
  "score_play.properties.params.items.properties.t": "Position from the top of the score (same unit as notes)",
  "score_play.properties.params.items.properties.dur": "0 or omitted: switch at t. Positive: ramp linearly from the previous value over that length (int/bool/enum params only switch)",
  "score_play.properties.params.items.properties.module_id": "Module ID",
  "score_play.properties.params.items.properties.param": "Param name",
  "score_play.properties.params.items.properties.value": "Target value. Same range as param_set",
  "score_play.properties.length": "Score length (same unit as t). The next score starts after it. Default: end of the last note. Align to bar lines so continuations stay in time",
  "score_play.properties.tempo_bpm": "If set, t, dur and length are in beats. Default: seconds",
  "score_play.properties.mode": "append (default): continue seamlessly after the queue, or start now if empty. replace: drop the queue and start now",
  "score_play.properties.ack_prompt": "Mark human prompts with ID <= this as followed (shows the human this score reflects them)",
  score_stop: "Drop all queued scores and stop the sound.",
  score_get_status: "Read playback state and prompts from the human. Read-only.",
  performance_list: "List saved performances (records of played scores). Read-only.",
  performance_read: "Read a saved performance. Read-only. Use it to look back at what was played (also works on the current one).",
  "performance_read.properties.name": "Performance name (from performance_list; starts with yyyymmdd-hhmmss)",
  performance_replay: "Replay a saved performance. Replaces the patch with the one stored in it and drops queued scores. Audio must be running.",
  "performance_replay.properties.name": "Performance name",
  performance_set_plan: "Set the planned length of the performance (otherwise it goes on until stopped). Informational: playback does not stop by itself. Watch plan (planned/elapsed) in score_get_status and write an ending.",
  "performance_set_plan.properties.duration_seconds": "Planned length in seconds. null = until stopped",
  performance_render:
    "Render a saved performance to a WAV file without playing it (no sound, no audio start needed). The first call starts it and returns status queued/rendering; call again with the same arguments for progress. When done, path, peak and clip_count are set. If clip_count > 0, render again with a lower level_db.",
  "performance_render.properties.name": "Performance name",
  "performance_render.properties.level_db": "Master level for the render [dB]. Default -6",
  "performance_render.properties.tail_seconds": "Extra time after the end, for reverb tails [s]. Default 2",
};

/** 共通コマンドのエラー(operation-contract §5)の、code ごとの英語の説明。 */
export const ERROR_TEXT_EN: Readonly<Record<string, string>> = {
  invalid_request: "Malformed request envelope.",
  unknown_command: "Unknown command.",
  invalid_args: "Missing, unknown or wrongly typed argument (see details.arg and details.reason).",
  unauthorized: "Missing or wrong token.",
  forbidden: "Agents are not allowed to do this (human only).",
  no_session: "No browser tab holding the patch is open. Ask the human to open the synth page.",
  timeout: "The browser tab did not answer in time. It is unknown whether the change was applied; read the state before retrying.",
  revision_conflict: "expected_revision does not match the current revision.",
  idempotency_key_reused: "The same idempotency_key was used with different content.",
  internal_error: "Unexpected failure. Nothing was changed.",
  payload_too_large: "Request too large.",
  unsupported_version: "Unsupported envelope version.",
  unknown_module_type: "Unknown module type. Use a type ID from the module list.",
  module_not_found: "No module with that ID. Read the patch with patch_get.",
  module_id_conflict: "That module ID is already used.",
  module_protected: "The fixed output module `out` cannot be removed.",
  singleton_module: "MOD-IO-001 cannot be added; the patch always has exactly one (`out`).",
  limit_exceeded: "A limit was exceeded (see details.limit).",
  port_not_found: "The module has no port with that name (names are case-sensitive).",
  port_direction: "`from` must be an output and `to` must be an input.",
  port_not_connectable: "That port cannot take a cable.",
  input_occupied: "That input already has a cable. Disconnect it first, or use another input.",
  cable_not_found: "No such cable.",
  cable_id_conflict: "That cable ID is already used.",
  param_not_found: "The module has no parameter with that name.",
  param_invalid_value: "The value is not a finite number, or not an integer for an int/enum/bool param.",
  param_out_of_range: "The value is out of range (see details.min and details.max).",
  batch_failed: "An operation in the batch failed (see details.failed_index and details.cause). Nothing was applied.",
  batch_op_not_allowed: "That command cannot be used inside batch.",
  nothing_to_undo: "Nothing to undo.",
  nothing_to_redo: "Nothing to redo.",
  invalid_patch_name: "Invalid name (letters, digits, - and _ only).",
  patch_not_found: "No saved patch with that name.",
  patch_name_exists: "A saved patch with that name exists. Use another name or overwrite:true.",
  patch_invalid: "The patch JSON is invalid (see details.issues).",
  patch_version_unsupported: "Unknown format or too new a version.",
  patch_too_large: "The patch is too large.",
  storage_failed: "Reading or writing the storage failed.",
  audio_not_running: "Audio is not running (or is in emergency stop). Only a human can start audio; build the patch and wait.",
  level_limit_exceeded: "The level exceeds the agent's limit (details.max_db).",
  not_a_meter: "That module is not a MOD-IO-003 meter.",
  audio_start_failed: "Audio could not be started.",
  // アダプタ自身の失敗(src/mcp/adapter.ts)
  adapter_no_token: "No agent token. The synth server may not be running (start it with npm run dev).",
  adapter_server_unreachable: "Cannot reach the synth server. It is unknown whether the request was applied if it was sent.",
  adapter_bad_response: "The synth server returned an unexpected response.",
  // 成功時の注意
  no_midi_module: "The patch has no MIDI-CV (MOD-IO-002), so the score will not make sound.",
};

const JAPANESE = /[぀-ヿ㐀-鿿＀-￯]/;

/** 文字列に日本語(かな・漢字・全角)が入っているか。 */
export function hasJapanese(s: string): boolean {
  return JAPANESE.test(s);
}

/**
 * シンセの応答を、LLM に渡す前に英語にする。エラーと注意の message(日本語)を、code ごとの英語の説明に置き換える。
 * 訳がない message は外す(code と details は残る)。種別の一覧の名前・単位・選択肢の名前も英語にする。
 * 人が書いた中身(指示の文、パッチの題名など)は変えない。
 */
export function englishizeResponse(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(englishizeResponse);
  if (typeof v !== "object" || v === null) return v;
  const o = v as Obj;
  const out: Obj = {};
  for (const [k, x] of Object.entries(o)) out[k] = englishizeResponse(x);
  if (typeof o.code === "string" && typeof o.message === "string") {
    const en = ERROR_TEXT_EN[o.code];
    if (en) out.message = en;
    else if (hasJapanese(o.message)) delete out.message;
  }
  // 種別の一覧(module.list_types): 種別の名前、単位、選択肢の名前
  if (typeof o.type === "string" && typeof o.title === "string" && TYPE_NAME_EN[o.type]) out.title = TYPE_NAME_EN[o.type];
  if (typeof o.unit === "string" && o.unit in UNIT_EN) out.unit = UNIT_EN[o.unit];
  if (typeof o.label === "string" && ENUM_LABEL_EN[o.label]) out.label = ENUM_LABEL_EN[o.label];
  return out;
}

// ---- モジュールの一覧表 ----

/** 種別の英語の名前。 */
export const TYPE_NAME_EN: Readonly<Record<string, string>> = {
  "MOD-AMP-001": "VCA",
  "MOD-CLK-001": "Clock",
  "MOD-CLK-002": "Clock divider",
  "MOD-DLY-001": "Delay",
  "MOD-ENV-001": "ADSR envelope",
  "MOD-FLT-001": "Low-pass filter (ladder)",
  "MOD-FNC-001": "Slew / function generator",
  "MOD-IO-001": "Audio output (fixed, id `out`)",
  "MOD-IO-002": "MIDI-CV (receives the score)",
  "MOD-IO-003": "Meter / scope",
  "MOD-LFO-001": "LFO",
  "MOD-LGC-001": "Logic / comparator",
  "MOD-MIX-001": "Mixer (4 in)",
  "MOD-MIX-002": "Mixing desk (8 ch, stereo + send)",
  "MOD-NSE-001": "White noise",
  "MOD-OSC-001": "VCO",
  "MOD-RND-001": "Sample & hold / random",
  "MOD-SAT-001": "Saturator (distortion / wavefolder)",
  "MOD-SEQ-001": "Step sequencer",
  "MOD-UTL-001": "Attenuverter / offset",
};

/** 単位の英語(空文字は書かない)。 */
export const UNIT_EN: Readonly<Record<string, string>> = {
  無次元: "",
  秒: "s",
  ミリ秒: "ms",
  線形倍率: "x",
  倍率: "x",
  比: "",
  "比/10 V": "per 10 V",
  メッセージ: "message",
  MIDIチャンネル: "",
  チャンネル番号: "",
  CC番号: "",
  半音: "semitones",
  同時発音数: "voices",
  サンプル: "samples",
  "ティック/拍": "ticks/beat",
  周期の倍率: "x period",
  クロック数: "clocks",
  ステップ: "steps",
};

/** 選択肢の名前の英語。 */
export const ENUM_LABEL_EN: Readonly<Record<string, string>> = {
  線形: "linear",
  指数: "exponential",
  連続: "free",
  立ち上がり: "rising",
  立ち下がり: "falling",
  ソフト: "soft",
  ハード: "hard",
  フォールド: "fold",
};

const num = (n: number): string => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));

/**
 * 指示文に入れる、モジュールの一覧表(英語。1 種 1 行)。カタログ(実装)から作るので、実装と食い違わない。
 * 番号つきのパラメータ(level[1]〜level[8] など)は、範囲と既定値が同じなら 1 つにまとめる。
 */
export function moduleCatalogText(catalog: TypeCatalog): string {
  const lines: string[] = [];
  for (const t of catalog.values()) {
    const ins = t.inputs.filter((p) => p.connectable).map((p) => p.name);
    const outs = t.outputs.filter((p) => p.connectable).map((p) => p.name);
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const p of t.params) {
      const m = /^(.+)\[(\d+)\]$/.exec(p.name);
      const same = m ? t.params.filter((q) => q.name.startsWith(`${m[1]}[`) && q.min === p.min && q.max === p.max && q.default === p.default) : [];
      const name = m && same.length > 1 ? `${m[1]}[1..${same.length}]` : p.name;
      if (seen.has(name)) continue;
      seen.add(name);
      if (p.values) {
        parts.push(`${name} {${p.values.map((v) => `${v.value}=${ENUM_LABEL_EN[v.label] ?? v.label}`).join(",")}} def ${num(p.default)}`);
      } else {
        const unit = p.unit === undefined ? "" : (UNIT_EN[p.unit] ?? p.unit);
        parts.push(`${name} ${num(p.min)}..${num(p.max)} def ${num(p.default)}${unit ? ` ${unit}` : ""}`);
      }
    }
    lines.push(`${t.type} ${TYPE_NAME_EN[t.type] ?? t.type} | in: ${ins.join(",") || "-"} | out: ${outs.join(",") || "-"} | params: ${parts.join("; ")}`);
  }
  return lines.join("\n");
}
