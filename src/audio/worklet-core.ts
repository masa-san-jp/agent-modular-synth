// AudioWorklet の中身(メッセージの処理と1ブロックの処理)。AudioWorklet の API に依存しないので、Node の試験でもそのまま動く。
// src/audio/worklet.ts はこれを AudioWorkletProcessor に包むだけ。
import { EngineBackend } from "../control/backend.js";
import type { ModuleFactory } from "../engine/module.js";
import type { FromWorklet, PerfStats, ToWorklet, WorkletStatus } from "./messages.js";

/** 負荷値の度数の区間の幅と数(0.05 × 80 = 4.0 まで。それ以上は最後の区間)。 */
const PERF_BIN = 0.05;
const PERF_BINS = 80;

export interface PerfClock {
  name: string;
  now(): number;
}

export class WorkletCore {
  readonly be: EngineBackend;
  /** 受け取って処理したメッセージの数。 */
  private received = 0;
  /** 音声の処理が例外で止まっているか。パッチ全体が届く(apply)まで無音を出す。 */
  private failed = false;
  /** 前回の状態の送信で運んだ波形フレームの番号(モジュールID → frame_seq)。 */
  private sentFrames = new Map<string, number>();
  // ---- 性能の測定(測定中だけ動く。普段は時計を読まない) ----
  private perfOn = false;
  private perfBlocks = 0;
  private perfSum = 0;
  private perfMax = 0;
  private perfOver = 0;
  private perfHist = new Uint32Array(PERF_BINS);
  private applyAt: number[] = [];
  private applyCount = 0;
  private applySum = 0;
  private applyMax = 0;

  constructor(
    readonly fs: number,
    registry: ReadonlyMap<string, ModuleFactory>,
    private readonly post: (msg: FromWorklet) => void,
    /** ブロックの処理時間を測る時計(測定用)。なければ測定はできない。 */
    private readonly perfClock: PerfClock | null = null,
  ) {
    this.be = new EngineBackend(fs, registry);
  }

  private error(e: unknown, resync: boolean): void {
    this.post({ type: "error", message: e instanceof Error ? e.message : String(e), ...(resync ? { resync: true } : {}) });
  }

  /** メインスレッドからの1通。例外は外へ出さない。 */
  onMessage(msg: ToWorklet): void {
    this.received++;
    const be = this.be;
    try {
      switch (msg.type) {
        case "apply":
          this.sentFrames.clear();
          be.applyPatch(msg.patch, msg.revision);
          this.failed = false;
          break;
        case "ops":
          try {
            for (const o of msg.ops) {
              if (o.op === "add") be.addModule(o.module);
              else if (o.op === "remove") be.removeModule(o.id);
              else if (o.op === "connect") be.connect(o.cable);
              else if (o.op === "disconnect") be.disconnect(o.cable);
              else be.setParam(o.id, o.name, o.value);
            }
            be.commit(msg.revision);
            if (this.perfOn && typeof msg.sentAt === "number") this.applyAt.push(msg.sentAt);
          } catch (e) {
            // 途中まで積んだ差分は適用しない(1コマンド分は、全部か、なしか)。正本とずれるので、全体の渡し直しを求める
            be.abortPending(e instanceof Error ? e.message : String(e));
          }
          break;
        case "start":
          be.start();
          break;
        case "stop":
          be.stop();
          break;
        case "panic":
          be.panic();
          break;
        case "release_panic":
          be.releasePanic();
          break;
        case "level":
          be.setLevel(msg.db, msg.actor);
          break;
        case "sync":
          be.sync(msg);
          break;
        case "midi":
          be.midi(msg.bytes);
          break;
        case "perf":
          this.perfOn = msg.enabled && this.perfClock !== null;
          this.perfBlocks = 0;
          this.perfSum = 0;
          this.perfMax = 0;
          this.perfOver = 0;
          this.perfHist.fill(0);
          this.applyAt = [];
          this.applyCount = 0;
          this.applySum = 0;
          this.applyMax = 0;
          break;
        case "schedule":
          be.scheduleMidi(msg.events);
          break;
        case "clear_schedule":
          be.clearSchedule();
          break;
      }
    } catch (e) {
      // apply の失敗などで、音声側がパッチの正本と合っていない
      this.error(e, msg.type === "apply" || msg.type === "panic");
    }
    this.reportDesync();
  }

  private reportDesync(): void {
    const d = this.be.takeDesync();
    if (d !== null) this.post({ type: "error", message: `音声側が差分の適用に失敗した: ${d}`, resync: true });
  }

  /** 1ブロックを処理する。例外が出たら無音にし、1回だけ知らせて、パッチ全体が届くまで無音を続ける。 */
  process(left: Float32Array, right: Float32Array): void {
    if (this.failed) {
      left.fill(0);
      right.fill(0);
      return;
    }
    try {
      if (this.perfOn && this.perfClock) {
        // 送られた差分は、このブロックの先頭で適用される(L2 の終点)
        if (this.applyAt.length > 0) {
          const wall = Date.now();
          for (const at of this.applyAt) {
            const ms = Math.max(0, wall - at);
            this.applyCount++;
            this.applySum += ms;
            if (ms > this.applyMax) this.applyMax = ms;
          }
          this.applyAt.length = 0;
        }
        const t0 = this.perfClock.now();
        this.be.processBlock(left, right);
        const load = (this.perfClock.now() - t0) / ((left.length / this.fs) * 1000);
        this.perfBlocks++;
        this.perfSum += load;
        if (load > this.perfMax) this.perfMax = load;
        if (load > 1) this.perfOver++;
        this.perfHist[Math.min(PERF_BINS - 1, Math.floor(load / PERF_BIN))]!++;
      } else {
        this.be.processBlock(left, right);
      }
    } catch (e) {
      this.failed = true;
      left.fill(0);
      right.fill(0);
      this.error(e, true);
      return;
    }
    this.reportDesync();
  }

  status(): WorkletStatus {
    const s = this.be.status();
    const st = this.be.stage.status();
    const meters = this.be.meters((id, seq) => this.sentFrames.get(id) === seq);
    for (const [id, m] of Object.entries(meters)) {
      if ("frame" in m) this.sentFrames.set(id, Number(m.frame_seq));
    }
    for (const id of [...this.sentFrames.keys()]) if (!(id in meters)) this.sentFrames.delete(id);
    return {
      fs: this.fs,
      sampleTime: s.sampleTime,
      running: s.audioState === "running",
      panic: s.panic,
      levelDb: s.levelDb,
      agentMaxLevelDb: s.agentMaxLevelDb,
      clipCount: s.clipCount,
      nonfiniteModules: s.nonfiniteModules,
      nonfiniteOutputStage: s.nonfiniteOutputStage,
      engineRevision: s.engineRevision ?? null,
      limiterGain: st.limiterGain,
      peak: this.be.takePeak(),
      activity: this.be.activity(),
      meters,
      ...(this.perfOn ? { perf: this.perfStats() } : {}),
      received: this.received,
    };
  }

  private perfStats(): PerfStats {
    return {
      clock: this.perfClock?.name ?? "なし",
      blocks: this.perfBlocks,
      meanLoad: this.perfBlocks > 0 ? this.perfSum / this.perfBlocks : 0,
      maxLoad: this.perfMax,
      over: this.perfOver,
      histogram: Array.from(this.perfHist),
      applyCount: this.applyCount,
      applySumMs: this.applySum,
      applyMaxMs: this.applyMax,
    };
  }
}
