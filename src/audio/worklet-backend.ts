// メインスレッド側の「音声バックエンド」。Session(同期)から呼ばれ、AudioWorklet へメッセージで伝える。
// 音量・緊急停止・上限の規則は、ワークレット側と同じ OutputStage をここにも1つ持って写す
// (同じ操作を同じ順に与えるので、状態は一致する)。計数とメーターは、ワークレットから届く最新の状態を使う。
//
// 写しと実体を一致させる仕組み:
// - 音声の用意ができる(attach)前の操作はワークレットへ届かない。attach のときに写しの状態を1通(sync)で送る。
// - ワークレットは、受け取ったメッセージの数を状態に入れて返す。送った分がすべて反映された状態なのに
//   音量・上限・緊急停止・動作中かが写しと違えば、写しの状態を送り直す(sync)。
// - 中断(ブラウザ・OSが音声を止めた)を知ったら、ワークレットも止める。復帰は開始と同じ扱い(音量の引き下げとフェードイン)。
import type { ScheduledEvent } from "../control/performance.js";
import type { EngineOp, FromWorklet, ToWorklet, WorkletStatus } from "./messages.js";
import { OutputStage } from "./output-stage.js";
import type { AudioBackend, BackendStatus, MeterReading, SetLevelResult } from "../control/session.js";
import type { ActorKind, Cable, Patch, PatchModule } from "../control/types.js";

export interface WorkletPort {
  postMessage(msg: ToWorklet): void;
}

const NOT_READY = "音声がまだ用意されていない";

export interface WorkletBackendOptions {
  /** 経過時間を測る時計 [ms](音声側の今のサンプル時刻を、最後に届いた状態から見積もるのに使う)。既定は performance.now()。 */
  clock?: () => number;
  /** まだ1度も測定値が届いていないメーターの読出し値(初期状態のメーターの値)。 */
  initialMeter?: () => Record<string, unknown>;
}

export class WorkletBackend implements AudioBackend {
  private port: WorkletPort | null = null;
  private fs: number | null = null;
  private mirror = new OutputStage(48000);
  private running = false;
  private suspended = false;
  private ops: EngineOp[] = [];
  private last: WorkletStatus | null = null;
  /** ワークレットへ送ったメッセージの数。 */
  private sent = 0;
  /** 届いた波形フレーム(モジュールID → frame)。状態には、変わったときだけ入ってくる。 */
  private frames = new Map<string, unknown>();
  /** 写しと実体のずれを見つけて送り直した回数(診断用)。 */
  desyncCount = 0;
  /** Web MIDI が使えるか(対応ブラウザで、利用者が許可した)。engine.get_status の `midi.available`。 */
  midiAvailable = false;
  /** 音声を開始できない理由(AudioContext がまだない等)。null なら開始できる。 */
  startBlocker: string | null = NOT_READY;

  constructor(private readonly options: WorkletBackendOptions = {}) {}

  /**
   * AudioWorklet の用意ができたら呼ぶ(人の操作の中で AudioContext を作った後)。
   * それまでに行われた操作(音量、エージェントの上限、緊急停止)を、ワークレットへ持ち越す。
   */
  attach(port: WorkletPort, fs: number): void {
    this.port = port;
    this.fs = fs;
    this.startBlocker = null;
    this.sent = 0;
    this.last = null;
    this.frames.clear();
    this.sendSync();
  }

  /** ワークレットとの接続を捨てる(音声の処理が止まった、AudioContext が閉じた)。音声は「停止」になる。 */
  detach(reason: string = NOT_READY): void {
    this.port = null;
    this.fs = null;
    this.running = false;
    this.suspended = false;
    this.ops = [];
    this.last = null;
    this.frames.clear();
    this.mirror.stop();
    this.startBlocker = reason;
  }

  get attached(): boolean {
    return this.port !== null;
  }

  private sendSync(): void {
    const m = this.mirror.status();
    this.send({ type: "sync", levelDb: m.levelDb, agentMaxLevelDb: m.agentMaxLevelDb, panic: m.panic, running: this.running && !this.suspended });
  }

  /** ワークレットから届いた状態を取り込む。ずれていたら送り直す。 */
  onMessage(msg: FromWorklet): void {
    if (msg.type !== "status") return;
    const w = msg.status;
    this.last = w;
    this.lastAt = this.clock();
    for (const [id, m] of Object.entries(w.meters)) {
      if ("frame" in m) this.frames.set(id, m.frame);
    }
    for (const id of [...this.frames.keys()]) if (!(id in w.meters)) this.frames.delete(id);
    // 送った分がすべて反映された状態だけを比べる(途中の状態は、まだ届いていない操作の分だけ違って当然)
    if (w.received !== this.sent) return;
    const m = this.mirror.status();
    const running = this.running && !this.suspended;
    if (w.levelDb !== m.levelDb || w.agentMaxLevelDb !== m.agentMaxLevelDb || w.panic !== m.panic || w.running !== running) {
      this.desyncCount++;
      this.sendSync();
    }
  }

  get lastStatus(): WorkletStatus | null {
    return this.last;
  }

  /**
   * ブラウザや OS による中断・復帰(AudioContext の状態)を反映する。
   * 中断: ワークレットも止める(復帰した瞬間に、中断前の音量のまま音が出ないようにする)。
   * 復帰: 音声の開始と同じ扱い(音量の引き下げとフェードイン。operation-contract §2.4)。
   */
  setSuspended(suspended: boolean): void {
    if (suspended === this.suspended) return;
    this.suspended = suspended;
    if (!this.running) return;
    if (suspended) {
      this.mirror.stop();
      this.send({ type: "stop" });
    } else {
      this.mirror.start();
      this.send({ type: "start" });
    }
  }

  private send(msg: ToWorklet): void {
    if (!this.port) return; // 用意ができる前の操作は写しだけに行い、attach のときに持ち越す
    this.sent++;
    this.port.postMessage(msg);
  }

  applyPatch(patch: Patch, revision: number): void {
    this.ops = [];
    this.mirror.reduce("patch_replaced");
    this.send({ type: "apply", patch, revision });
  }

  addModule(module: PatchModule): void {
    this.ops.push({ op: "add", module });
  }
  removeModule(moduleId: string): void {
    this.ops.push({ op: "remove", id: moduleId });
  }
  connect(cable: Cable): void {
    this.ops.push({ op: "connect", cable });
  }
  disconnect(cable: Cable): void {
    this.ops.push({ op: "disconnect", cable });
  }
  setParam(moduleId: string, param: string, value: number): void {
    this.ops.push({ op: "param", id: moduleId, name: param, value });
  }

  commit(revision: number): void {
    const ops = this.ops;
    this.ops = [];
    this.send(this.perfOn ? { type: "ops", ops, revision, sentAt: Date.now() } : { type: "ops", ops, revision });
  }

  /** 性能の測定(ワークレット側でのブロックごとの処理時間の集計)を始める・やめる。 */
  setPerf(enabled: boolean): void {
    this.perfOn = enabled;
    this.send({ type: "perf", enabled });
  }
  private perfOn = false;

  canStart(): { ok: true } | { ok: false; reason: string } {
    return this.startBlocker !== null || !this.port ? { ok: false, reason: this.startBlocker ?? NOT_READY } : { ok: true };
  }

  start(): { ok: true } | { ok: false; reason: string } {
    const can = this.canStart();
    if (!can.ok) return can;
    this.running = true;
    this.suspended = false;
    this.mirror.start();
    this.send({ type: "start" });
    return { ok: true };
  }

  panic(): void {
    this.mirror.panic();
    this.send({ type: "panic" });
  }

  releasePanic(): boolean {
    const r = this.mirror.releasePanic();
    this.send({ type: "release_panic" });
    return r;
  }

  setLevel(levelDb: number, actor: ActorKind): SetLevelResult {
    const r = this.mirror.setLevel(levelDb, actor);
    if (r.ok) this.send({ type: "level", db: levelDb, actor });
    return r;
  }

  status(): BackendStatus {
    const m = this.mirror.status();
    const w = this.last;
    return {
      audioState: !this.running ? "stopped" : this.suspended ? "suspended" : "running",
      fs: this.running ? this.fs : null,
      sampleTime: w?.sampleTime ?? 0,
      panic: m.panic,
      levelDb: m.levelDb,
      agentMaxLevelDb: m.agentMaxLevelDb,
      clipCount: w?.clipCount ?? 0,
      nonfiniteModules: w?.nonfiniteModules ?? 0,
      nonfiniteOutputStage: w?.nonfiniteOutputStage ?? 0,
      midiAvailable: this.midiAvailable,
      engineRevision: this.running ? (w?.engineRevision ?? null) : null,
    };
  }

  /**
   * メーターの読出し値。追加した直後で、ワークレットからまだ値が届いていないメーターは、初期状態の値を返す
   * (応答の `engine_revision` が現在のリビジョンより前なので、追加がまだ音に反映されていないことは呼ぶ側に分かる)。
   */
  meterRead(moduleId: string, fields: readonly string[]): MeterReading {
    const w = this.last;
    const all = w?.meters[moduleId] ?? this.options.initialMeter?.();
    if (!all) throw new Error(`'${moduleId}' の読出し値がまだ届いていない`);
    const values: Record<string, unknown> = {};
    for (const f of fields) values[f] = f === "frame" && w?.meters[moduleId] ? (this.frames.get(moduleId) ?? []) : all[f];
    return { values, sampleTime: w?.sampleTime ?? 0, fs: w?.fs ?? this.fs ?? 0, engineRevision: w?.engineRevision ?? null };
  }

  // ---- 演奏(楽譜の予約) ----

  private lastAt = 0;
  private clock(): number {
    return this.options.clock ? this.options.clock() : performance.now();
  }

  /**
   * 音声側の今のサンプル時刻の見積もり: 最後に届いた状態の時刻に、それからの経過時間を足す。
   * 状態は約 50 ms ごとに届く。見積もりのずれは、楽譜を始めるまでの余裕(SCORE_LIMITS.leadSeconds)の中に収まる。
   */
  sampleNow(): number {
    const w = this.last;
    if (!w) return 0;
    if (!this.running || this.suspended) return w.sampleTime;
    const elapsed = Math.min(1000, Math.max(0, this.clock() - this.lastAt)); // 状態が途絶えても、見積もりを進めすぎない
    return w.sampleTime + Math.round((elapsed / 1000) * w.fs);
  }

  scheduleMidi(events: ScheduledEvent[]): void {
    if (!this.running || this.suspended) return;
    this.send({ type: "schedule", events });
  }

  clearSchedule(): void {
    this.send({ type: "clear_schedule" });
  }

  /**
   * 演奏入力(画面鍵盤・MIDI 機器)。コマンド・履歴の対象外。
   * 音声が動作中のときだけ渡す: 止まっている間に届いたメッセージ(MIDI クロックは毎秒数十通)を音声側にためない。
   */
  midi(bytes: number[]): void {
    if (!this.running || this.suspended) return;
    this.send({ type: "midi", bytes });
  }
}
