// エージェント(と人)による演奏: 楽譜の予約と、人からの指示(プロンプト)。operation-contract CMD-26〜29、EVT-07。
// 楽譜 = 「どの音を、楽譜の先頭から何拍目(何秒目)に、どれだけのばすか」の並び。音声側のサンプル時刻で予約するので、通信や思考の時間は演奏のずれにならない。
// 演奏中に次の楽譜を送ると、前の楽譜の終わりに切れ目なくつながる。演奏はパッチの編集ではない(リビジョン・履歴の対象外)。
// ここは状態と検査だけを持つ(音声側への予約は Session が行う)。
import { CommandError } from "./errors.js";
import type { ActorInfo } from "./types.js";

/** 上限と時間(いずれも暫定値)。 */
export const SCORE_LIMITS = {
  /** 楽譜1つの音符の数。 */
  notes: 2000,
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

export interface ParsedScore {
  notes: ScoreNote[];
  lengthSeconds: number;
  mode: "append" | "replace";
  ackPrompt: number | null;
}

export interface MidiEventAt {
  /** 音声側のサンプル時刻(処理したサンプルの通算)。 */
  at: number;
  bytes: number[];
}

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
    if (!["notes", "length", "tempo_bpm", "mode", "ack_prompt"].includes(k)) throw bad(k, "unknown_key", `未知の引数 ${k}`);
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
  if (raw.length === 0 && !("length" in a)) throw bad("length", "missing", "音符のない楽譜(休み)には length が要る");
  if (raw.length > SCORE_LIMITS.notes) throw new CommandError("ERR-106", "楽譜の音符の数の上限", { limit: "score_notes", max: SCORE_LIMITS.notes });

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
  // 長さ: 省略時は最後の音符の終わり。指定時は、どの音符の開始よりも後(音符の終わりは、次の楽譜へはみ出してよい)
  let length = lastEnd;
  if ("length" in a) {
    length = a.length as number;
    const min = notes.length > 0 ? lastStart : 0;
    if (!(length > 0) || length > maxUnits || length < min) {
      throw new CommandError("ERR-123", `length は 0 より大きく、最後の音符の開始(${min})以上、${maxUnits} 以下`, { arg: "length", value: length, min, max: maxUnits });
    }
  }
  return { notes, lengthSeconds: length * beat, mode, ackPrompt };
}

/** 楽譜を、音声側のサンプル時刻つきの MIDI メッセージの列にする。同じ時刻では、ノートオフがノートオンより先。 */
export function scoreEvents(notes: readonly ScoreNote[], startSample: number, fs: number): MidiEventAt[] {
  const out: (MidiEventAt & { on: boolean; i: number })[] = [];
  notes.forEach((n, i) => {
    const on = startSample + Math.round(n.t * fs);
    const off = Math.max(on + 1, startSample + Math.round((n.t + n.dur) * fs));
    out.push({ at: on, bytes: [0x90 | (n.ch - 1), n.note, n.vel], on: true, i });
    out.push({ at: off, bytes: [0x80 | (n.ch - 1), n.note, 0], on: false, i });
  });
  out.sort((x, y) => x.at - y.at || Number(x.on) - Number(y.on) || x.i - y.i);
  return out.map(({ at, bytes }) => ({ at, bytes }));
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
}
