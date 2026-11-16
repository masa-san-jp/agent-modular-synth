// コマンド処理(Session)と音声(エンジン+出力保護)をつなぐ実装。ブラウザにもサーバーにも依存しない。
// パッチの正本は Session が持ち、ここへは差分が渡る(DEC-105)。差分は次のブロックの先頭でまとめて適用する(product-spec §5.6・§5.7)。
import { OutputStage, OutputStageConfig, PROVISIONAL } from "../audio/output-stage.js";
import { Engine } from "../engine/engine.js";
import { ModuleFactory, SynthModule } from "../engine/module.js";
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
    this.stage.reduce("patch_replaced");
  }

  addModule(module: PatchModule): void {
    const mod = this.make(module); // 生成の失敗は、この場で例外にする(Session がロールバックする)
    this.pending.push(() => this.engine.add(module.id, mod));
  }

  removeModule(moduleId: string): void {
    this.pending.push(() => this.engine.remove(moduleId));
  }

  connect(cable: Cable): void {
    this.pending.push(() => this.engine.connect(cable.from.module, cable.from.port, cable.to.module, cable.to.port));
  }

  disconnect(cable: Cable): void {
    this.pending.push(() => this.engine.disconnect(cable.to.module, cable.to.port));
  }

  setParam(moduleId: string, param: string, value: number): void {
    this.pending.push(() => this.engine.get(moduleId).setParam(param, value));
  }

  commit(revision: number): void {
    this.pendingRevision = revision;
  }

  /** たまっている差分を適用する(ブロックの先頭で呼ぶ)。 */
  flush(): void {
    if (this.pending.length) {
      const ops = this.pending;
      this.pending = [];
      for (const op of ops) op();
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
    this.stage.stop();
  }

  panic(): void {
    this.flush();
    this.stage.panic();
    this.engine.reset();
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
    for (let i = 0; i < left.length; i++) {
      this.engine.tick();
      st.step(preL[0]!, preR[0]!);
      left[i] = st.outL[0]!;
      right[i] = st.outR[0]!;
    }
    this.sampleTime += left.length;
  }
}
