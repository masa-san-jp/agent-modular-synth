// メインスレッド側の「音声バックエンド」。Session(同期)から呼ばれ、AudioWorklet へメッセージで伝える。
// 音量・緊急停止・上限の規則は、ワークレット側と同じ OutputStage をここにも1つ持って写す
// (同じ操作を同じ順に与えるので、状態は一致する)。計数とメーターは、ワークレットから届く最新の状態を使う。
import type { EngineOp, FromWorklet, ToWorklet, WorkletStatus } from "./messages.js";
import { OutputStage } from "./output-stage.js";
import type { AudioBackend, BackendStatus, MeterReading, SetLevelResult } from "../control/session.js";
import type { ActorKind, Cable, Patch, PatchModule } from "../control/types.js";

export interface WorkletPort {
  postMessage(msg: ToWorklet): void;
}

export class WorkletBackend implements AudioBackend {
  private port: WorkletPort | null = null;
  private fs: number | null = null;
  private mirror = new OutputStage(48000);
  private running = false;
  private ops: EngineOp[] = [];
  private last: WorkletStatus | null = null;
  private sentRevision: number | null = null;
  /** 音声を開始できない理由(AudioContext がまだない等)。null なら開始できる。 */
  startBlocker: string | null = "音声がまだ用意されていない";

  /** AudioWorklet の用意ができたら呼ぶ(人の操作の中で AudioContext を作った後)。 */
  attach(port: WorkletPort, fs: number): void {
    this.port = port;
    this.fs = fs;
    this.startBlocker = null;
  }

  /** ワークレットから届いた状態を取り込む。 */
  onMessage(msg: FromWorklet): void {
    if (msg.type === "status") this.last = msg.status;
  }

  get lastStatus(): WorkletStatus | null {
    return this.last;
  }

  /** ブラウザや OS による中断・復帰(AudioContext の状態)を反映する。 */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
  }
  private suspended = false;

  private send(msg: ToWorklet): void {
    this.port?.postMessage(msg);
  }

  applyPatch(patch: Patch, revision: number): void {
    this.ops = [];
    this.mirror.reduce("patch_replaced");
    this.sentRevision = revision;
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
    this.sentRevision = revision;
    this.send({ type: "ops", ops, revision });
  }

  start(): { ok: true } | { ok: false; reason: string } {
    if (this.startBlocker !== null || !this.port) return { ok: false, reason: this.startBlocker ?? "音声がまだ用意されていない" };
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
      midiAvailable: false,
      engineRevision: this.running ? (w?.engineRevision ?? null) : null,
    };
  }

  meterRead(moduleId: string, fields: readonly string[]): MeterReading {
    const w = this.last;
    const all = w?.meters[moduleId];
    if (!w || !all) throw new Error(`'${moduleId}' の読出し値がまだ届いていない`);
    const values: Record<string, unknown> = {};
    for (const f of fields) values[f] = all[f];
    return { values, sampleTime: w.sampleTime, fs: w.fs, engineRevision: w.engineRevision };
  }

  /** 演奏入力(画面鍵盤)。コマンド・履歴の対象外。 */
  midi(bytes: number[]): void {
    this.send({ type: "midi", bytes });
  }
}
