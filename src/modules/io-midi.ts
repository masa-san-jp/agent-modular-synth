// MOD-IO-002 MIDI-CV(仕様 v0.2)。
// MIDIメッセージ(event 型。ケーブルでは運ばない)を PITCH/GATE/VEL/RTRG(voices チャンネル)と
// PW/MOD/CLK(1チャンネル)へ変換する。ボイス割当は DEC-013 の1方式(§6)。
// メッセージは midi()/event() で受け取り、次の step() で到着順に処理する(COM-07)。

import { ModuleDef, ModuleState, SynthModule } from "../engine/module.js";
import { MAX_CHANNELS, triggerSamples } from "../engine/util.js";
import { EncNum, decNum, encArr, encNum } from "../engine/codec.js";

/** §6 のメッセージ型。ch は 1..16。範囲外の値を持つメッセージは step() で無視する(§8)。 */
export type MidiMsg =
  | { type: "note_on"; ch: number; note: number; vel: number }
  | { type: "note_off"; ch: number; note: number; vel?: number }
  | { type: "pitch_bend"; ch: number; v14: number }
  | { type: "cc"; ch: number; num: number; val: number }
  | { type: "clock" };

const DEF: ModuleDef = {
  specId: "MOD-IO-002",
  specVersion: "0.2",
  title: "MIDI-CV",
  inputs: [{ name: "MIDI", type: "event", connectable: false }],
  outputs: [
    { name: "PITCH", type: "pitch" },
    { name: "GATE", type: "gate" },
    { name: "VEL", type: "cv" },
    { name: "PW", type: "cv" },
    { name: "MOD", type: "cv" },
    { name: "RTRG", type: "trigger" },
    { name: "CLK", type: "clock" },
  ],
  params: [
    { name: "channel", kind: "int", min: 0, max: 16, default: 0 },
    { name: "transpose", kind: "int", min: -48, max: 48, default: 0 },
    { name: "voices", kind: "int", min: 1, max: 16, default: 1 },
    { name: "cc_number", kind: "int", min: 0, max: 127, default: 1 },
  ],
  stateful: true,
};

const NONE = -1; // 「なし」
const NOTES = 128;

/** 整数で lo..hi の範囲にあるか。 */
function inRange(x: number, lo: number, hi: number): boolean {
  return Number.isInteger(x) && x >= lo && x <= hi;
}

export class IoMidiModule extends SynthModule {
  readonly def = DEF;

  // §5 の内部状態
  private held: { note: number; vel: number }[] = [];
  private vNote: number[] = [];
  private pNote: number[] = [];
  private velV: number[] = [];
  private rtrgCnt: number[] = [];
  private lastVoice = 0;
  private noteVoice: number[] = new Array<number>(NOTES).fill(NONE);
  private pwV = 0;
  private modV = 0;
  private clkCnt = 0;
  private lastChannel = 0;
  private lastVoices = 1;

  /** 次の step() で処理するメッセージ(到着順)。入力であって内部状態ではない(保存しない)。 */
  private queue: MidiMsg[] = [];

  constructor(fs: number) {
    super(fs);
    this.init();
  }

  /** メッセージを1つ受け取る。次の step() で、受け取った順に処理する。 */
  event(msg: MidiMsg): void {
    this.queue.push(msg);
  }

  /**
   * 生のMIDIメッセージ(ステータスバイト+データバイト)を1つ受け取る。
   * 対応: 0x8n ノートオフ、0x9n ノートオン、0xBn CC、0xEn ピッチベンド(LSB, MSB)、0xF8 クロック。
   * それ以外・バイト不足は無視。データバイトの範囲検査は step() で行う(範囲外はメッセージごと無視)。
   */
  midi(bytes: readonly number[]): void {
    const st = bytes[0];
    if (st === undefined || !inRange(st, 0x80, 0xff)) return;
    if (st === 0xf8) {
      this.queue.push({ type: "clock" });
      return;
    }
    if (st >= 0xf0) return;
    const ch = (st & 0x0f) + 1;
    const d1 = bytes[1];
    const d2 = bytes[2];
    if (d1 === undefined || d2 === undefined) return;
    switch (st & 0xf0) {
      case 0x80:
        this.queue.push({ type: "note_off", ch, note: d1, vel: d2 });
        break;
      case 0x90:
        this.queue.push({ type: "note_on", ch, note: d1, vel: d2 });
        break;
      case 0xb0:
        this.queue.push({ type: "cc", ch, num: d1, val: d2 });
        break;
      case 0xe0:
        // データバイトが 0..127 の外なら無効な v14(−1)にして無視させる
        this.queue.push({ type: "pitch_bend", ch, v14: inRange(d1, 0, 127) && inRange(d2, 0, 127) ? d2 * 128 + d1 : -1 });
        break;
      default:
        break;
    }
  }

  private clearVoices(v: number): void {
    this.held = [];
    this.vNote = new Array<number>(v).fill(NONE);
    this.pNote = new Array<number>(v).fill(NONE);
    this.velV = new Array<number>(v).fill(0);
    this.rtrgCnt = new Array<number>(v).fill(0);
    this.lastVoice = v - 1;
    this.noteVoice.fill(NONE);
  }

  private releaseAll(): void {
    this.held = [];
    this.vNote.fill(NONE);
  }

  protected resetState(): void {
    const v = this.param("voices");
    this.clearVoices(v);
    this.pwV = 0;
    this.modV = 0;
    this.clkCnt = 0;
    this.lastChannel = this.param("channel");
    this.lastVoices = v;
  }

  private voiceOf(note: number): number {
    return this.vNote.indexOf(note);
  }

  private noteOn(note: number, vel: number, nt: number): void {
    const V = this.vNote.length;
    this.held = this.held.filter((e) => e.note !== note);
    this.held.push({ note, vel });
    let c = this.voiceOf(note);
    if (c === NONE) {
      c = this.noteVoice[note]!; // 規則①
      if (c === NONE || this.vNote[c] !== NONE) {
        c = NONE;
        for (let k = 1; k <= V; k++) {
          // 規則②
          const d = (this.lastVoice + k) % V;
          if (this.vNote[d] === NONE) {
            c = d;
            break;
          }
        }
        if (c === NONE) {
          // 規則③(奪う)
          for (const e of this.held) {
            const d = this.voiceOf(e.note);
            if (d !== NONE) {
              c = d;
              break;
            }
          }
        }
      }
      this.vNote[c] = note;
      this.noteVoice[note] = c;
      this.lastVoice = c;
    }
    this.rtrgCnt[c] = nt;
  }

  private noteOff(note: number): void {
    const c = this.voiceOf(note);
    this.held = this.held.filter((e) => e.note !== note);
    if (c === NONE) return;
    this.vNote[c] = NONE;
    for (let i = this.held.length - 1; i >= 0; i--) {
      const e = this.held[i]!;
      if (this.voiceOf(e.note) === NONE) {
        this.vNote[c] = e.note;
        this.noteVoice[e.note] = c;
        break;
      }
    }
  }

  step(): void {
    const nt = triggerSamples(this.fs);
    // 0. パラメータの整形
    const channelE = this.param("channel");
    const transposeE = this.param("transpose");
    const ccE = this.param("cc_number");
    const V = this.param("voices");
    if (V !== this.lastVoices) {
      this.clearVoices(V);
      this.lastVoices = V;
    }
    if (channelE !== this.lastChannel) {
      this.releaseAll();
      this.lastChannel = channelE;
    }
    // 1. メッセージを到着順に処理
    const msgs = this.queue;
    this.queue = [];
    for (const m of msgs) {
      if (m.type === "clock") {
        this.clkCnt = nt;
        continue;
      }
      if (!inRange(m.ch, 1, 16)) continue;
      if (channelE !== 0 && m.ch !== channelE) continue;
      switch (m.type) {
        case "note_on":
        case "note_off": {
          const vel = m.vel ?? 0;
          if (!(inRange(m.note, 0, 127) && inRange(vel, 0, 127))) continue;
          if (m.type === "note_on" && vel > 0) this.noteOn(m.note, vel, nt);
          else this.noteOff(m.note);
          break;
        }
        case "pitch_bend":
          if (inRange(m.v14, 0, 16383)) this.pwV = (5 * (m.v14 - 8192)) / 8192;
          break;
        case "cc":
          if (!(inRange(m.num, 0, 127) && inRange(m.val, 0, 127))) continue;
          if (m.num === 120 || m.num === 123) this.releaseAll();
          if (m.num === ccE) this.modV = (10 * m.val) / 127;
          break;
      }
    }
    // 2. 声ごとの保持値の更新(鳴っている声だけ)
    for (let c = 0; c < V; c++) {
      const note = this.vNote[c]!;
      if (note !== NONE) {
        this.pNote[c] = note;
        const e = this.held.find((h) => h.note === note);
        if (e) this.velV[c] = (10 * e.vel) / 127;
      }
    }
    // 3. 出力
    const [pitch, gate, velO, pw, mod, rtrg, clk] = this.outputs as [
      (typeof this.outputs)[number],
      (typeof this.outputs)[number],
      (typeof this.outputs)[number],
      (typeof this.outputs)[number],
      (typeof this.outputs)[number],
      (typeof this.outputs)[number],
      (typeof this.outputs)[number],
    ];
    pitch.channels = gate.channels = velO.channels = rtrg.channels = V;
    pw.channels = mod.channels = clk.channels = 1;
    for (let c = 0; c < MAX_CHANNELS; c++) {
      if (c >= V) {
        pitch.values[c] = gate.values[c] = velO.values[c] = rtrg.values[c] = 0;
        continue;
      }
      const p = this.pNote[c]!;
      this.writeOut(pitch, c, p === NONE ? 0 : (p + transposeE - 60) / 12);
      gate.values[c] = this.vNote[c] !== NONE ? 10 : 0;
      this.writeOut(velO, c, this.velV[c]!);
      const rc = this.rtrgCnt[c]!;
      rtrg.values[c] = rc > 0 ? 10 : 0;
      if (rc > 0) this.rtrgCnt[c] = rc - 1;
    }
    this.writeOut(pw, 0, this.pwV);
    this.writeOut(mod, 0, this.modV);
    clk.values[0] = this.clkCnt > 0 ? 10 : 0;
    if (this.clkCnt > 0) this.clkCnt -= 1;
  }

  /** COM-14(§9)。「なし」は null。未処理のメッセージ(キュー)と nonfinite_count は保存しない。 */
  override getState(): ModuleState {
    const opt = (a: readonly number[]): (number | null)[] => a.map((x) => (x === NONE ? null : x));
    return {
      held: this.held.map((e) => [e.note, e.vel]),
      v_note: opt(this.vNote),
      p_note: opt(this.pNote),
      vel_v: encArr(this.velV),
      rtrg_cnt: [...this.rtrgCnt],
      last_voice: this.lastVoice,
      note_voice: opt(this.noteVoice),
      pw_v: encNum(this.pwV),
      mod_v: encNum(this.modV),
      clk_cnt: this.clkCnt,
      last_channel: this.lastChannel,
      last_voices: this.lastVoices,
    };
  }

  override setState(state: ModuleState): void {
    const s = state;
    const unopt = (a: unknown, len: number): number[] => {
      const src = Array.isArray(a) ? (a as (number | null)[]) : [];
      return Array.from({ length: len }, (_, i) => (typeof src[i] === "number" ? (src[i] as number) : NONE));
    };
    const V = typeof s.last_voices === "number" ? s.last_voices : this.param("voices");
    this.clearVoices(V);
    this.lastVoices = V;
    if (Array.isArray(s.held)) this.held = (s.held as [number, number][]).map(([note, vel]) => ({ note, vel }));
    this.vNote = unopt(s.v_note, V);
    this.pNote = unopt(s.p_note, V);
    if (Array.isArray(s.vel_v)) {
      const src = s.vel_v as EncNum[];
      this.velV = Array.from({ length: V }, (_, i) => (i < src.length ? decNum(src[i]!) : 0));
    }
    if (Array.isArray(s.rtrg_cnt)) {
      const src = s.rtrg_cnt as number[];
      this.rtrgCnt = Array.from({ length: V }, (_, i) => src[i] ?? 0);
    }
    this.lastVoice = typeof s.last_voice === "number" ? s.last_voice : V - 1;
    this.noteVoice = unopt(s.note_voice, NOTES);
    this.pwV = s.pw_v !== undefined ? decNum(s.pw_v as EncNum) : 0;
    this.modV = s.mod_v !== undefined ? decNum(s.mod_v as EncNum) : 0;
    this.clkCnt = typeof s.clk_cnt === "number" ? s.clk_cnt : 0;
    this.lastChannel = typeof s.last_channel === "number" ? s.last_channel : this.param("channel");
  }
}
