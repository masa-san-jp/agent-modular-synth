// MIDI 機器の接続(Web MIDI。product-spec §7 の3)。受けたメッセージを、画面鍵盤と同じ経路でエンジンへ渡す。
// 演奏入力はコマンド・履歴・リビジョンの対象外(DEC-008)。SysEx は要求しない(届かない)。
// 使えるか(対応ブラウザで、利用者が許可したか)は `available` で分かり、engine.get_status の `midi.available` になる。

/** Web MIDI の型のうち、ここで使う部分(DOM の型定義の有無に依存しない)。 */
interface MidiInput {
  id: string;
  name?: string | null;
  manufacturer?: string | null;
  state?: string;
  onmidimessage: ((ev: { data: Uint8Array | null }) => void) | null;
}
interface MidiAccess {
  inputs: { forEach(fn: (input: MidiInput) => void): void };
  onstatechange: (() => void) | null;
}

export type MidiState =
  /** まだ接続を試していない。 */
  | { kind: "idle" }
  /** このブラウザは Web MIDI に対応していない。 */
  | { kind: "unsupported" }
  /** 利用者が許可しなかった、または取得に失敗した。 */
  | { kind: "denied"; reason: string }
  /** 使える。`inputs` は今つながっている入力機器の名前。 */
  | { kind: "ready"; inputs: string[] };

export interface MidiLinkOptions {
  /** MIDI メッセージ1通(バイト列)。 */
  onMessage(bytes: number[]): void;
  /** 状態(対応・許可・機器の抜き差し)が変わった。 */
  onChange(state: MidiState): void;
}

export class MidiLink {
  private state: MidiState = { kind: "idle" };
  private access: MidiAccess | null = null;
  private bound = new Set<MidiInput>();

  constructor(private readonly options: MidiLinkOptions) {}

  get current(): MidiState {
    return this.state;
  }

  /** Web MIDI が使えるか(engine.get_status の `midi.available`)。 */
  get available(): boolean {
    return this.state.kind === "ready";
  }

  /** このブラウザが Web MIDI に対応しているか。 */
  static supported(): boolean {
    return typeof (navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess === "function";
  }

  private set(state: MidiState): void {
    this.state = state;
    this.options.onChange(state);
  }

  /** MIDI の利用を求める(ブラウザが利用者に許可を尋ねる。人の操作の中で呼ぶ)。 */
  async connect(): Promise<MidiState> {
    if (this.access) return this.state;
    if (!MidiLink.supported()) {
      this.set({ kind: "unsupported" });
      return this.state;
    }
    try {
      const request = (navigator as unknown as { requestMIDIAccess(o: { sysex: boolean }): Promise<MidiAccess> }).requestMIDIAccess;
      const access = await request.call(navigator, { sysex: false });
      this.access = access;
      access.onstatechange = () => this.rebind(); // 機器の抜き差し
      this.rebind();
    } catch (e) {
      this.set({ kind: "denied", reason: e instanceof Error ? e.message : String(e) });
    }
    return this.state;
  }

  /** 今つながっている入力機器すべてから受ける。抜かれた機器の受信はやめる。 */
  private rebind(): void {
    const access = this.access;
    if (!access) return;
    const now = new Set<MidiInput>();
    const names: string[] = [];
    access.inputs.forEach((input) => {
      if (input.state === "disconnected") return;
      now.add(input);
      names.push(input.name || input.id || "名前のない機器");
      input.onmidimessage = (ev) => {
        const data = ev.data;
        if (!data || data.length === 0 || data.length > 3) return; // チャンネルメッセージとクロックだけを渡す(長いものは対象外)
        this.options.onMessage(Array.from(data));
      };
    });
    for (const old of this.bound) if (!now.has(old)) old.onmidimessage = null;
    this.bound = now;
    this.set({ kind: "ready", inputs: names.sort() });
  }
}
