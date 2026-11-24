// コマンド処理(Session)と音声(エンジン+出力保護)をつなぐ実装。ブラウザにもサーバーにも依存しない。
// パッチの正本は Session が持ち、ここへは差分が渡る(DEC-105)。差分は次のブロックの先頭でまとめて適用する(product-spec §5.6・§5.7)。
import { OutputStage, OutputStageConfig, PROVISIONAL } from "../audio/output-stage.js";
import { Engine } from "../engine/engine.js";
import { ModuleFactory, SynthModule } from "../engine/module.js";
import type { MidiEventAt } from "./performance.js";
import { AudioBackend, BackendStatus, MeterReading, SetLevelResult } from "./session.js";
import { ActorKind, Cable, Patch, PatchModule } from "./types.js";

type Op = () => void;

export class EngineBackend implements AudioBackend {
  private engine: Engine;
  readonly stage: OutputStage;
  private outputId = "";
  private running = false;
  private pending: Op[] = [];
  private pendingRevision: number | null = null;
  private engineRevision: number | null = null;
  /** 予約済みの演奏入力(サンプル時刻の昇順)。`scheduleHead` より前は処理済み。 */
  private schedule: MidiEventAt[] = [];
  private scheduleHead = 0;
  /** 楽譜が動かしているパラメータ(キーは "モジュールID\u0000名前")と、動かす前のパッチの値。演奏が終わる・止まると戻す。 */
  private overrides = new Map<string, { id: string; name: string; original: number }>();
  /** 進行中の、直線で動かす変化。 */
  private ramps: { key: string; id: string; name: string; from: number; to: number; start: number; len: number }[] = [];
  /** 差分の適用に失敗して、正本とずれた可能性があるときの理由(takeDesync() で読むと消える)。 */
  private desync: string | null = null;
  /** 処理したサンプルの通算(緊急停止でエンジンを初期化しても戻らない)。 */
  private sampleTime = 0;

  constructor(
    readonly fs: number,
    private readonly registry: ReadonlyMap<string, ModuleFactory>,
    cfg: OutputStageConfig = PROVISIONAL,
  ) {
    this.engine = new Engine(fs);
    this.stage = new OutputStage(fs, cfg);
  }

  private make(m: PatchModule): SynthModule {
    const f = this.registry.get(m.type);
    if (!f) throw new Error(`未知のモジュール種別 ${m.type}`);
    const mod = f(this.fs);
    for (const [k, v] of Object.entries(m.params)) mod.setParam(k, v);
    mod.reset(); // 初期値がパラメータに依存する状態を、生成時のパラメータで初期化する(COM-10)
    return mod;
  }

  /** パッチ全体の置き換え。全モジュールを作り直し、初期状態から始める。音量は引き下げる(§2.4)。 */
  applyPatch(patch: Patch, revision: number): void {
    const e = new Engine(this.fs);
    let out = "";
    for (const m of patch.modules) {
      e.add(m.id, this.make(m));
      if (m.type === "MOD-IO-001") out = m.id;
    }
    for (const c of patch.cables) e.connect(c.from.module, c.from.port, c.to.module, c.to.port);
    if (!out) throw new Error("出力モジュール(MOD-IO-001)がない");
    this.engine = e;
    this.outputId = out;
    this.pending = [];
    this.pendingRevision = null;
    this.engineRevision = revision;
    this.desync = null; // 全体を作り直したので、ずれは解消
    // 新しいエンジンはパッチの値で始まる。楽譜が動かしていた分は、ここで終わり(予約済みの変化は、この後も届く)
    this.overrides.clear();
    this.ramps = [];
    this.stage.reduce("patch_replaced");
  }

  addModule(module: PatchModule): void {
    const mod = this.make(module); // 生成の失敗は、この場で例外にする(Session がロールバックする)
    this.pending.push(() => this.engine.add(module.id, mod));
  }

  removeModule(moduleId: string): void {
    this.pending.push(() => {
      this.engine.remove(moduleId);
      for (const [key, o] of [...this.overrides]) if (o.id === moduleId) this.overrides.delete(key);
      this.ramps = this.ramps.filter((r) => r.id !== moduleId);
    });
  }

  connect(cable: Cable): void {
    this.pending.push(() => this.engine.connect(cable.from.module, cable.from.port, cable.to.module, cable.to.port));
  }

  disconnect(cable: Cable): void {
    this.pending.push(() => this.engine.disconnect(cable.to.module, cable.to.port));
  }

  setParam(moduleId: string, param: string, value: number): void {
    this.pending.push(() => {
      this.engine.get(moduleId).setParam(param, value);
      // パッチの値が変わった: 楽譜が動かしていても、パッチの側を優先する(演奏の後に戻す先も、この値になる)
      const key = `${moduleId}\u0000${param}`;
      if (this.overrides.delete(key)) this.ramps = this.ramps.filter((r) => r.key !== key);
    });
  }

  commit(revision: number): void {
    this.pendingRevision = revision;
  }

  /** 積んだだけでまだ適用していない差分を捨てる(差分の受け取りの途中で失敗したとき)。正本とずれるので、ずれとして記録する。 */
  abortPending(reason: string): void {
    this.pending = [];
    this.pendingRevision = null;
    this.desync ??= reason;
  }

  /** 差分の適用に失敗していれば、その理由を返して記録を消す。失敗していなければ null。呼ぶ側はパッチ全体を渡し直す。 */
  takeDesync(): string | null {
    const d = this.desync;
    this.desync = null;
    return d;
  }

  /**
   * たまっている差分を適用する(ブロックの先頭で呼ぶ)。
   * 1件が失敗しても残りは適用し、例外は外へ出さない(音声の処理を止めない)。失敗は takeDesync() で分かる。
   */
  flush(): void {
    if (this.pending.length) {
      const ops = this.pending;
      this.pending = [];
      for (const op of ops) {
        try {
          op();
        } catch (e) {
          this.desync ??= e instanceof Error ? e.message : String(e);
        }
      }
    }
    if (this.pendingRevision !== null) {
      this.engineRevision = this.pendingRevision;
      this.pendingRevision = null;
    }
  }

  start(): { ok: true } | { ok: false; reason: string } {
    this.running = true;
    this.stage.start();
    return { ok: true };
  }

  stop(): void {
    this.running = false;
    this.clearSchedule(); // 止まっている間はサンプル時刻が進まないので、予約は意味を失う
    this.stage.stop();
  }

  panic(): void {
    this.flush();
    this.stage.panic();
    this.clearSchedule(); // 予約済みの楽譜は捨てる(解除の後に続きが鳴り出さない)
    this.engine.reset();
  }

  // ---- 演奏(楽譜の予約) ----

  sampleNow(): number {
    return this.sampleTime;
  }

  /**
   * サンプル時刻つきの出来事(演奏入力、パラメータの変化)を予約する。その時刻のサンプルを処理する直前に行う。
   * 演奏入力は全ての MIDI-CV モジュールへ渡す。パラメータの変化は音声側の値だけを変える(パッチは変えない)。
   */
  scheduleMidi(events: readonly MidiEventAt[]): void {
    if (events.length === 0) return;
    const rest = this.schedule.slice(this.scheduleHead);
    const add: MidiEventAt[] = events.map((e) => ("bytes" in e ? { at: e.at, bytes: [...e.bytes] } : { at: e.at, param: { ...e.param } }));
    // 既存の予約の末尾より後なら、後ろへ足すだけ(続きの楽譜はこの形)。そうでなければ並べ直す(同じ時刻は先に予約した方が先)
    const sorted = rest.length === 0 || add[0]!.at >= rest[rest.length - 1]!.at;
    this.schedule = sorted ? rest.concat(add) : rest.concat(add).sort((x, y) => x.at - y.at);
    this.scheduleHead = 0;
  }

  /**
   * 予約をすべて捨てる。捨てた予約のうちノートオフは、その場で渡す(鳴っている音を止める)。
   * 楽譜が動かしていたパラメータは、パッチの値へ戻す。
   */
  clearSchedule(): void {
    for (let i = this.scheduleHead; i < this.schedule.length; i++) {
      const e = this.schedule[i]!;
      if ("bytes" in e && ((e.bytes[0] ?? 0) & 0xf0) === 0x80) this.midi(e.bytes);
    }
    this.schedule = [];
    this.scheduleHead = 0;
    this.ramps = [];
    for (const o of this.overrides.values()) {
      try {
        this.engine.get(o.id).setParam(o.name, o.original);
      } catch {
        // モジュールがもうない
      }
    }
    this.overrides.clear();
  }

  /** 予約されていた出来事 1 つを行う(その時刻のサンプルを処理する直前)。 */
  private fire(e: MidiEventAt, t: number): void {
    if ("bytes" in e) {
      this.midi(e.bytes);
      return;
    }
    const { module: id, name, value, ramp } = e.param;
    let m: SynthModule;
    let current: number;
    try {
      m = this.engine.get(id);
      current = m.getRawParam(name);
    } catch {
      return; // 予約の後で、モジュールが削除された
    }
    const key = `${id}\u0000${name}`;
    if (!this.overrides.has(key)) this.overrides.set(key, { id, name, original: current });
    this.ramps = this.ramps.filter((r) => r.key !== key); // 同じパラメータの進行中の変化は、新しい方で置き換える
    if (ramp > 0) this.ramps.push({ key, id, name, from: current, to: value, start: t, len: ramp });
    else m.setParam(name, value);
  }

  /** 進行中の直線の変化を、1 サンプル分進める。 */
  private advanceRamps(t: number): void {
    for (let i = 0; i < this.ramps.length; i++) {
      const r = this.ramps[i]!;
      const k = t - r.start + 1;
      const done = k >= r.len;
      try {
        this.engine.get(r.id).setParam(r.name, done ? r.to : r.from + ((r.to - r.from) * k) / r.len);
      } catch {
        // モジュールがもうない
      }
      if (done) this.ramps.splice(i--, 1);
    }
  }

  /** 楽譜が今動かしているパラメータの数(診断用)。 */
  get overridden(): number {
    return this.overrides.size;
  }

  /** 予約済み(未処理)の演奏入力の数。 */
  get scheduled(): number {
    return this.schedule.length - this.scheduleHead;
  }

  releasePanic(): boolean {
    return this.stage.releasePanic();
  }

  setLevel(levelDb: number, actor: ActorKind): SetLevelResult {
    return this.stage.setLevel(levelDb, actor);
  }

  status(): BackendStatus {
    const s = this.stage.status();
    let nf = 0;
    for (const id of this.engine.ids()) nf += this.engine.get(id).nonfiniteCount;
    return {
      audioState: this.running ? "running" : "stopped",
      fs: this.running ? this.fs : null,
      sampleTime: this.sampleTime,
      panic: s.panic,
      levelDb: s.levelDb,
      agentMaxLevelDb: s.agentMaxLevelDb,
      clipCount: s.clipCount,
      nonfiniteModules: nf,
      nonfiniteOutputStage: s.nonfiniteCount,
      midiAvailable: false, // Web MIDI との接続は未実装
      engineRevision: this.running ? this.engineRevision : null,
    };
  }

  meterRead(moduleId: string, fields: readonly string[]): MeterReading {
    const m = this.engine.get(moduleId) as unknown as { read?: () => Record<string, unknown> };
    if (typeof m.read !== "function") throw new Error(`'${moduleId}' は読出し値を持たない`);
    const all = m.read();
    const values: Record<string, unknown> = {};
    for (const f of fields) values[f] = all[f];
    return { values, sampleTime: this.sampleTime, fs: this.fs, engineRevision: this.engineRevision };
  }

  /**
   * メーター(MOD-IO-003)を持つモジュールすべての読出し値。モジュールID → 項目名 → 値。
   * `skipFrame(id, frameSeq)` が true を返したモジュールは、波形フレーム(`frame`)を含めない(大きいので、変わったときだけ運ぶ)。
   */
  meters(skipFrame?: (id: string, frameSeq: number) => boolean): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const id of this.engine.ids()) {
      const m = this.engine.get(id) as unknown as { read?: (withFrame?: boolean) => Record<string, unknown> };
      if (typeof m.read !== "function") continue;
      const stats = m.read(false);
      // 波形フレームを持たない読出し値(ミキサー卓など)は、そのまま
      out[id] = !("frame_seq" in stats) || skipFrame?.(id, Number(stats.frame_seq)) ? stats : m.read(true);
    }
    return out;
  }

  /**
   * 各モジュールの、いまの出力の大きさ(全出力ポート・全チャンネルの絶対値の最大。その瞬間の値)。画面の LED 用。
   * 1 サンプルごとの処理には何も足さない(呼ばれたときに、出力の値を見るだけ)。
   */
  activity(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const id of this.engine.ids()) {
      let max = 0;
      for (const p of this.engine.get(id).outputs) {
        for (let c = 0; c < p.channels; c++) {
          const a = Math.abs(p.values[c]!);
          if (a > max) max = a;
        }
      }
      out[id] = Number.isFinite(max) ? max : 0;
    }
    return out;
  }

  /** 状態(音量・上限・緊急停止・動作中か)を、メインスレッド側の写しの値に合わせる(OutputStage.adopt)。コマンドの処理ではない。 */
  sync(state: { levelDb: number; agentMaxLevelDb: number; panic: boolean; running: boolean }): void {
    this.running = state.running === true;
    if (this.running) this.stage.start();
    else this.stage.stop();
    this.stage.adopt(state.levelDb, state.agentMaxLevelDb, state.panic);
  }

  /** 演奏入力(MIDI のバイト列)を、全ての MIDI-CV モジュールへ渡す。次のステップで到着順に処理される。 */
  midi(bytes: readonly number[]): void {
    for (const id of this.engine.ids()) {
      const m = this.engine.get(id) as unknown as { midi?: (b: readonly number[]) => void };
      if (typeof m.midi === "function") m.midi(bytes);
    }
  }

  /** 出力保護の状態(リミッターの利得など)と、観測区間のピーク(読むと 0 に戻る)。 */
  takePeak(): number {
    return this.stage.takePeak();
  }

  /** 1ブロックを処理して左右の出力を書く。ブロック長は任意(結果は1サンプル処理と一致)。 */
  processBlock(left: Float32Array, right: Float32Array): void {
    this.flush();
    if (!this.running || !this.outputId) {
      left.fill(0);
      right.fill(0);
      return;
    }
    const out = this.engine.get(this.outputId);
    const preL = out.output("PRE_L").values;
    const preR = out.output("PRE_R").values;
    const st = this.stage;
    const sched = this.schedule;
    for (let i = 0; i < left.length; i++) {
      // 予約済みの演奏入力のうち、このサンプルの時刻になったものを渡す(サンプル単位で正確。ブロック長に依らない)
      if (this.scheduleHead < sched.length) {
        const t = this.sampleTime + i;
        while (this.scheduleHead < sched.length && sched[this.scheduleHead]!.at <= t) this.fire(sched[this.scheduleHead++]!, t);
        if (this.scheduleHead === sched.length) {
          this.schedule.length = 0;
          this.scheduleHead = 0;
        }
      }
      if (this.ramps.length > 0) this.advanceRamps(this.sampleTime + i);
      this.engine.tick();
      st.step(preL[0]!, preR[0]!);
      left[i] = st.outL[0]!;
      right[i] = st.outR[0]!;
    }
    this.sampleTime += left.length;
  }
}
