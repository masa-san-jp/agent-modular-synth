// エージェント(と人)による演奏: 楽譜の予約と、人からの指示(プロンプト)。operation-contract CMD-26〜29、EVT-07。
// 楽譜 = 「どの音を、楽譜の先頭から何拍目(何秒目)に、どれだけのばすか」の並び。音声側のサンプル時刻で予約するので、通信や思考の時間は演奏のずれにならない。
// 演奏中に次の楽譜を送ると、前の楽譜の終わりに切れ目なくつながる。演奏はパッチの編集ではない(リビジョン・履歴の対象外)。
// ここは状態と検査だけを持つ(音声側への予約は Session が行う)。
import { CommandError } from "./errors.js";
import type { ActorInfo, Patch } from "./types.js";

/** 上限と時間(いずれも暫定値)。 */
export const SCORE_LIMITS = {
  /** 楽譜1つの音符の数。 */
  notes: 2000,
  /** 楽譜1つの、パラメータの変化の数。 */
  params: 2000,
  /** 楽譜1つの長さ [秒]。 */
  lengthSeconds: 600,
  /** 予約済み(まだ終わっていない)の楽譜の、音符の合計。 */
  queuedNotes: 10000,
  /** どれだけ先まで予約できるか [秒](今から、予約の末尾まで)。 */
  horizonSeconds: 900,
  /** 何も鳴っていないときに、楽譜を始めるまでの余裕 [秒](予約が音声側へ届くまでの時間)。 */
  leadSeconds: 0.1,
  /** 指示1件の長さ [文字]。 */
  promptChars: 500,
  /** 保持する指示の数(古いものから捨てる)。 */
  prompts: 20,
  /** 演奏し終えてから、この時間 [秒] 次の楽譜が来なければ、演奏データを閉じる(少し遅れて届いた続きは、同じ演奏として残す)。 */
  idleCloseSeconds: 30,
  /** あらかじめ決める演奏の長さの上限 [秒]。 */
  planMaxSeconds: 24 * 3600,
  tempoMin: 20,
  tempoMax: 1000,
} as const;

export interface ScoreNote {
  /** 楽譜の先頭から数えた、音の始まる位置 [秒]。 */
  t: number;
  /** 長さ [秒]。 */
  dur: number;
  /** MIDI ノート番号(60 = C4 = 0 V)。 */
  note: number;
  /** ベロシティ(1〜127)。 */
  vel: number;
  /** MIDI チャンネル(1〜16)。 */
  ch: number;
}

/** 楽譜の中のパラメータの変化(検査の前。モジュールとパラメータの存在・値の範囲は Session が見る)。 */
export interface ScoreParam {
  /** 楽譜の先頭から数えた位置 [秒]。 */
  t: number;
  /** 0 ならその位置で値を切り替える。正なら、その長さ [秒] をかけて、直前の値から直線で動かす。 */
  dur: number;
  moduleId: string;
  param: string;
  value: unknown;
  /** 引数の中の番号(エラーの報告用)。 */
  index: number;
}

export interface ParsedScore {
  notes: ScoreNote[];
  params: ScoreParam[];
  lengthSeconds: number;
  mode: "append" | "replace";
  ackPrompt: number | null;
}

/** 音声側へ予約する出来事: 演奏入力(MIDI のバイト列)か、パラメータの変化。 */
export type ScheduledEvent =
  | {
      /** 音声側のサンプル時刻(処理したサンプルの通算)。 */
      at: number;
      bytes: number[];
    }
  | {
      at: number;
      param: { module: string; name: string; value: number; /** 0 なら切り替え。正なら、このサンプル数をかけて直線で動かす。 */ ramp: number };
    };
/** 以前の名前(演奏入力だけだった頃)。 */
export type MidiEventAt = ScheduledEvent;

type Args = Record<string, unknown>;

function bad(arg: string, reason: string, message?: string): CommandError {
  return new CommandError("ERR-003", message ?? `引数 ${arg}: ${reason}`, { arg, reason });
}
function outOfRange(arg: string, value: unknown, min: number, max: number): CommandError {
  return new CommandError("ERR-123", `${arg} は ${min}〜${max} の範囲`, { arg, value, min, max });
}
function isObj(v: unknown): v is Args {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** score.play の引数を検査して、秒の単位の楽譜にする。検査の順: ERR-003(形・型)→ ERR-106(数)→ ERR-123(値の範囲)。 */
export function parseScore(a: Args): ParsedScore {
  for (const k of Object.keys(a)) {
    if (!["notes", "params", "length", "tempo_bpm", "mode", "ack_prompt"].includes(k)) throw bad(k, "unknown_key", `未知の引数 ${k}`);
  }
  if (!("notes" in a)) throw bad("notes", "missing");
  const raw = a.notes;
  if (!Array.isArray(raw)) throw bad("notes", "type");
  const num = (v: unknown, arg: string): number => {
    if (typeof v !== "number" || !Number.isFinite(v)) throw bad(arg, "type");
    return v;
  };
  const int = (v: unknown, arg: string): number => {
    const n = num(v, arg);
    if (!Number.isInteger(n)) throw new CommandError("ERR-122", `${arg} は整数`, { arg, value: v });
    return n;
  };
  if ("tempo_bpm" in a) num(a.tempo_bpm, "tempo_bpm");
  if ("length" in a) num(a.length, "length");
  let mode: "append" | "replace" = "append";
  if ("mode" in a) {
    if (a.mode !== "append" && a.mode !== "replace") throw bad("mode", typeof a.mode === "string" ? "unknown_value" : "type", 'mode は "append" か "replace"');
    mode = a.mode;
  }
  let ackPrompt: number | null = null;
  if ("ack_prompt" in a) {
    ackPrompt = int(a.ack_prompt, "ack_prompt");
    if (ackPrompt < 0) throw outOfRange("ack_prompt", ackPrompt, 0, Number.MAX_SAFE_INTEGER);
  }
  raw.forEach((n: unknown, i: number) => {
    if (!isObj(n)) throw bad(`notes[${i}]`, "type");
    for (const k of Object.keys(n)) {
      if (!["t", "dur", "note", "vel", "ch"].includes(k)) throw bad(`notes[${i}].${k}`, "unknown_key", `未知の引数 notes[${i}].${k}`);
    }
    for (const k of ["t", "dur", "note"]) if (!(k in n)) throw bad(`notes[${i}].${k}`, "missing");
    num(n.t, `notes[${i}].t`);
    num(n.dur, `notes[${i}].dur`);
    int(n.note, `notes[${i}].note`);
    if ("vel" in n) int(n.vel, `notes[${i}].vel`);
    if ("ch" in n) int(n.ch, `notes[${i}].ch`);
  });
  // パラメータの変化(任意)
  const rawParams: unknown[] = [];
  if ("params" in a) {
    if (!Array.isArray(a.params)) throw bad("params", "type");
    a.params.forEach((p: unknown, i: number) => {
      if (!isObj(p)) throw bad(`params[${i}]`, "type");
      for (const k of Object.keys(p)) {
        if (!["t", "dur", "module_id", "param", "value"].includes(k)) throw bad(`params[${i}].${k}`, "unknown_key", `未知の引数 params[${i}].${k}`);
      }
      for (const k of ["t", "module_id", "param", "value"]) if (!(k in p)) throw bad(`params[${i}].${k}`, "missing");
      num(p.t, `params[${i}].t`);
      if ("dur" in p) num(p.dur, `params[${i}].dur`);
      if (typeof p.module_id !== "string") throw bad(`params[${i}].module_id`, "type");
      if (typeof p.param !== "string") throw bad(`params[${i}].param`, "type");
      rawParams.push(p);
    });
  }
  if (raw.length === 0 && !("length" in a)) throw bad("length", "missing", "音符のない楽譜(休み)には length が要る");
  if (raw.length > SCORE_LIMITS.notes) throw new CommandError("ERR-106", "楽譜の音符の数の上限", { limit: "score_notes", max: SCORE_LIMITS.notes });
  if (rawParams.length > SCORE_LIMITS.params) throw new CommandError("ERR-106", "楽譜のパラメータの変化の数の上限", { limit: "score_params", max: SCORE_LIMITS.params });

  // 値の範囲。tempo_bpm があれば、t・dur・length の単位は拍
  let beat = 1;
  if ("tempo_bpm" in a) {
    const bpm = a.tempo_bpm as number;
    if (bpm < SCORE_LIMITS.tempoMin || bpm > SCORE_LIMITS.tempoMax) throw outOfRange("tempo_bpm", bpm, SCORE_LIMITS.tempoMin, SCORE_LIMITS.tempoMax);
    beat = 60 / bpm;
  }
  const maxUnits = SCORE_LIMITS.lengthSeconds / beat;
  const notes: ScoreNote[] = [];
  let lastStart = 0;
  let lastEnd = 0;
  raw.forEach((n: Args, i: number) => {
    const t = n.t as number;
    const dur = n.dur as number;
    const note = n.note as number;
    const vel = (n.vel as number | undefined) ?? 100;
    const ch = (n.ch as number | undefined) ?? 1;
    if (t < 0 || t > maxUnits) throw outOfRange(`notes[${i}].t`, t, 0, maxUnits);
    if (!(dur > 0) || dur > maxUnits) throw new CommandError("ERR-123", `notes[${i}].dur は 0 より大きく ${maxUnits} 以下`, { arg: `notes[${i}].dur`, value: dur, min: 0, max: maxUnits });
    if (note < 0 || note > 127) throw outOfRange(`notes[${i}].note`, note, 0, 127);
    if (vel < 1 || vel > 127) throw outOfRange(`notes[${i}].vel`, vel, 1, 127);
    if (ch < 1 || ch > 16) throw outOfRange(`notes[${i}].ch`, ch, 1, 16);
    notes.push({ t: t * beat, dur: dur * beat, note, vel, ch });
    lastStart = Math.max(lastStart, t);
    lastEnd = Math.max(lastEnd, t + dur);
  });
  const params: ScoreParam[] = [];
  (rawParams as Args[]).forEach((p, i) => {
    const t = p.t as number;
    const dur = (p.dur as number | undefined) ?? 0;
    if (t < 0 || t > maxUnits) throw outOfRange(`params[${i}].t`, t, 0, maxUnits);
    if (dur < 0 || dur > maxUnits) throw outOfRange(`params[${i}].dur`, dur, 0, maxUnits);
    params.push({ t: t * beat, dur: dur * beat, moduleId: p.module_id as string, param: p.param as string, value: p.value, index: i });
    lastStart = Math.max(lastStart, t);
    lastEnd = Math.max(lastEnd, t + dur);
  });
  // 長さ: 省略時は最後の音符の終わり。指定時は、どの音符の開始よりも後(音符の終わりは、次の楽譜へはみ出してよい)
  let length = lastEnd;
  if ("length" in a) {
    length = a.length as number;
    const min = notes.length > 0 || params.length > 0 ? lastStart : 0;
    if (!(length > 0) || length > maxUnits || length < min) {
      throw new CommandError("ERR-123", `length は 0 より大きく、最後の音符の開始(${min})以上、${maxUnits} 以下`, { arg: "length", value: length, min, max: maxUnits });
    }
  }
  return { notes, params, lengthSeconds: length * beat, mode, ackPrompt };
}

/** 検査を通った、パラメータの変化(値は数値)。 */
export interface CheckedParam {
  t: number;
  dur: number;
  moduleId: string;
  param: string;
  value: number;
}

/**
 * 楽譜を、音声側のサンプル時刻つきの出来事の列にする。
 * 同じ時刻での順は: パラメータの変化 → ノートオフ → ノートオン(音が鳴り始める前に音色を決める)。
 */
export function scoreEvents(notes: readonly ScoreNote[], startSample: number, fs: number, params: readonly CheckedParam[] = []): ScheduledEvent[] {
  const out: { ev: ScheduledEvent; rank: number; i: number }[] = [];
  params.forEach((p, i) => {
    const at = startSample + Math.round(p.t * fs);
    out.push({ ev: { at, param: { module: p.moduleId, name: p.param, value: p.value, ramp: Math.round(p.dur * fs) } }, rank: 0, i });
  });
  notes.forEach((n, i) => {
    const on = startSample + Math.round(n.t * fs);
    const off = Math.max(on + 1, startSample + Math.round((n.t + n.dur) * fs));
    out.push({ ev: { at: on, bytes: [0x90 | (n.ch - 1), n.note, n.vel] }, rank: 2, i });
    out.push({ ev: { at: off, bytes: [0x80 | (n.ch - 1), n.note, 0] }, rank: 1, i });
  });
  out.sort((x, y) => x.ev.at - y.ev.at || x.rank - y.rank || x.i - y.i);
  return out.map((o) => o.ev);
}

export interface QueuedScore {
  id: number;
  actor: ActorInfo;
  startSample: number;
  endSample: number;
  notes: number;
}

export interface Prompt {
  id: number;
  text: string;
  /** エージェントが、この指示を踏まえた楽譜を送ったか。 */
  acked: boolean;
}

/** 演奏データ(data-contract §15)。演奏した楽譜を、再演奏できる形で残す。時刻(started_at など)と名前は、保存する側が付ける。 */
export const PERFORMANCE_FORMAT = "modular-synth-performance";
export const PERFORMANCE_SCHEMA_VERSION = 1;
export type PerformanceEnd = "finished" | "stopped" | "panic" | "audio_stopped" | "replaced";

export interface PerformanceEntry {
  /** 演奏の先頭(最初の楽譜の開始)から数えた、この楽譜の開始位置 [秒]。 */
  at: number;
  actor: ActorInfo;
  /** score.play に渡された楽譜(notes、params、length、tempo_bpm)。mode と ack_prompt は含めない。 */
  score: Record<string, unknown>;
  /** 前の楽譜の後に、パッチが変わっていたか(再演奏は、演奏を始めた時点のパッチで行う)。 */
  patch_changed?: true;
}

export interface PerformanceRecord {
  format: typeof PERFORMANCE_FORMAT;
  schema_version: typeof PERFORMANCE_SCHEMA_VERSION;
  /** 演奏の始まり・終わりの時刻(RFC 3339、UTC)。保存する側が付ける。 */
  started_at?: string;
  ended_at?: string | null;
  /** 終わり方。演奏中は null。 */
  ended_by: PerformanceEnd | null;
  fs: number;
  /** 最後の楽譜の終わりまでの長さ [秒]。 */
  length_seconds: number;
  /** あらかじめ決めた演奏の長さ [秒]。決めていなければ null(止めるまで続ける)。 */
  plan: { duration_seconds: number | null };
  /** 再演奏のとき、元の演奏データの名前。 */
  replay_of?: string;
  /** 演奏を始めた時点のパッチ。 */
  patch: Patch;
  entries: PerformanceEntry[];
  /** 演奏中に人が送った指示。 */
  prompts: { at: number; id: number; text: string }[];
}

/** 保存する側へ渡す、演奏データの更新。`id` は、この Session の中での演奏の通し番号。 */
export interface PerformanceUpdate {
  id: number;
  record: PerformanceRecord;
  closed: boolean;
}

/** 演奏の状態(予約済みの楽譜と、人からの指示)。 */
export class Performance {
  private queue: QueuedScore[] = [];
  private nextScore = 1;
  private promptList: Prompt[] = [];
  private nextPrompt = 1;

  /** 終わった楽譜を外す。外した結果、予約がなくなったら true。 */
  prune(nowSample: number): boolean {
    const had = this.queue.length > 0;
    this.queue = this.queue.filter((s) => s.endSample > nowSample);
    return had && this.queue.length === 0;
  }

  get playing(): boolean {
    return this.queue.length > 0;
  }

  get scores(): readonly QueuedScore[] {
    return this.queue;
  }

  /** 予約の末尾のサンプル時刻(なければ null)。 */
  get endSample(): number | null {
    return this.queue.length > 0 ? this.queue[this.queue.length - 1]!.endSample : null;
  }

  get queuedNotes(): number {
    return this.queue.reduce((a, s) => a + s.notes, 0);
  }

  add(actor: ActorInfo, startSample: number, endSample: number, notes: number): QueuedScore {
    const s: QueuedScore = { id: this.nextScore++, actor, startSample, endSample, notes };
    this.queue.push(s);
    return s;
  }

  /** 予約をすべて捨てる。捨てたものがあれば true。 */
  clear(): boolean {
    const had = this.queue.length > 0;
    this.queue = [];
    return had;
  }

  // ---- 指示 ----

  addPrompt(text: string): Prompt {
    const p: Prompt = { id: this.nextPrompt++, text, acked: false };
    this.promptList.push(p);
    while (this.promptList.length > SCORE_LIMITS.prompts) this.promptList.shift();
    return p;
  }

  /** `id` 以下の指示を「反映済み」にする。変わったものがあれば true。 */
  ack(id: number): boolean {
    let changed = false;
    for (const p of this.promptList) {
      if (p.id <= id && !p.acked) {
        p.acked = true;
        changed = true;
      }
    }
    return changed;
  }

  get prompts(): Prompt[] {
    return this.promptList.map((p) => ({ ...p }));
  }

  // ---- 演奏データ(演奏した楽譜の記録) ----

  private rec: { id: number; record: PerformanceRecord; base: number; revision: number; dirty: boolean; end: number } | null = null;
  private recId = 0;
  private closedRecs: PerformanceUpdate[] = [];
  /** あらかじめ決めた演奏の長さ [秒]。null は「止めるまで続ける」。 */
  planSeconds: number | null = null;

  /** 記録中の演奏の、先頭のサンプル時刻(なければ null)。 */
  get recordBase(): number | null {
    return this.rec ? this.rec.base : null;
  }

  /** 楽譜を記録する。記録中の演奏がなければ、ここから新しい演奏が始まる。 */
  recordScore(actor: ActorInfo, score: Record<string, unknown>, start: number, end: number, fs: number, patch: Patch, revision: number, replayOf?: string): void {
    if (!this.rec) {
      this.rec = {
        id: ++this.recId,
        base: start,
        revision,
        dirty: true,
        end,
        record: {
          format: PERFORMANCE_FORMAT,
          schema_version: PERFORMANCE_SCHEMA_VERSION,
          ended_by: null,
          fs,
          length_seconds: 0,
          plan: { duration_seconds: this.planSeconds },
          ...(replayOf !== undefined ? { replay_of: replayOf } : {}),
          patch,
          entries: [],
          prompts: [],
        },
      };
    }
    const r = this.rec;
    const entry: PerformanceEntry = { at: (start - r.base) / fs, actor, score };
    if (revision !== r.revision) {
      entry.patch_changed = true;
      r.revision = revision;
    }
    r.record.entries.push(entry);
    r.end = Math.max(r.end, end);
    r.record.length_seconds = (r.end - r.base) / fs;
    r.record.plan = { duration_seconds: this.planSeconds };
    r.dirty = true;
  }

  recordPrompt(id: number, text: string, now: number): void {
    const r = this.rec;
    if (!r) return;
    r.record.prompts.push({ at: Math.max(0, (now - r.base) / r.record.fs), id, text });
    r.dirty = true;
  }

  /** 記録中の演奏を閉じる(止めた、緊急停止、置き換え、演奏し終えて次が来なかった)。 */
  closeRecord(reason: PerformanceEnd, now: number): void {
    const r = this.rec;
    if (!r) return;
    r.record.ended_by = reason;
    // 途中で止めた場合の長さは、止めた時点まで
    if (reason !== "finished") r.record.length_seconds = Math.max(0, Math.min(r.record.length_seconds, (now - r.base) / r.record.fs));
    this.closedRecs.push({ id: r.id, record: r.record, closed: true });
    this.rec = null;
  }

  /** 演奏し終えた後、次の楽譜が来ないまま時間が過ぎたら閉じる。閉じたら true。 */
  closeIfIdle(now: number): boolean {
    const r = this.rec;
    if (!r || this.queue.length > 0) return false;
    if ((now - r.end) / r.record.fs < SCORE_LIMITS.idleCloseSeconds) return false;
    this.closeRecord("finished", now);
    return true;
  }

  /**
   * タブを閉じる・再読込するときに、記録中の演奏を閉じる(DEC-024)。演奏し終えて続きを待っている間なら `finished`、
   * 演奏中なら `audio_stopped`(タブを閉じると音声も止まる)。閉じたら true。
   */
  closeOnExit(now: number): boolean {
    if (!this.rec) return false;
    this.closeRecord(this.queue.length > 0 ? "audio_stopped" : "finished", now);
    return true;
  }

  /** 前回から変わった演奏データ(閉じたものを含む)を取り出す。 */
  takeRecordUpdates(): PerformanceUpdate[] {
    const out = this.closedRecs;
    this.closedRecs = [];
    if (this.rec && this.rec.dirty) {
      this.rec.dirty = false;
      out.push({ id: this.rec.id, record: this.rec.record, closed: false });
    }
    return out;
  }
}
