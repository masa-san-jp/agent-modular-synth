// AudioWorklet の中身(メッセージの処理と1ブロックの処理)。AudioWorklet の API に依存しないので、Node の試験でもそのまま動く。
// src/audio/worklet.ts はこれを AudioWorkletProcessor に包むだけ。
import { EngineBackend } from "../control/backend.js";
import type { ModuleFactory } from "../engine/module.js";
import type { FromWorklet, ToWorklet, WorkletStatus } from "./messages.js";

export class WorkletCore {
  readonly be: EngineBackend;
  /** 受け取って処理したメッセージの数。 */
  private received = 0;
  /** 音声の処理が例外で止まっているか。パッチ全体が届く(apply)まで無音を出す。 */
  private failed = false;
  /** 前回の状態の送信で運んだ波形フレームの番号(モジュールID → frame_seq)。 */
  private sentFrames = new Map<string, number>();

  constructor(
    readonly fs: number,
    registry: ReadonlyMap<string, ModuleFactory>,
    private readonly post: (msg: FromWorklet) => void,
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
      this.be.processBlock(left, right);
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
      meters,
      received: this.received,
    };
  }
}
