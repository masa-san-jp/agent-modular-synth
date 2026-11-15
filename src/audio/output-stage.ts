// 製品の出力保護(product-spec §8.1、DEC-004/110/111/112)。ブラウザのAPIに依存しない。
// 順序: MOD-IO-001 の PRE(クリップ前、±5 V=±1.0)→ 非有限値の検出と除去 → マスター音量(フェード)
//       → リミッター → 最終クリップ(±1.0)→ デバイス。
//
// 【仮値】下の PROVISIONAL の定数(既定音量、フェード時間、リミッターのしきい値・時定数・方式)は、
// 測定とオーナーの決定を待つ未決事項(OPEN-010)であり、確定値ではない。

export interface OutputStageConfig {
  /** マスター音量の既定値 [dB]。 */
  defaultLevelDb: number;
  /** マスター音量の範囲 [dB]。 */
  minLevelDb: number;
  maxLevelDb: number;
  /** フェードインの時間 [s]。 */
  fadeSeconds: number;
  /** マスター音量の変更を滑らかにする時定数 [s]。 */
  levelSmoothingSeconds: number;
  /** リミッターのしきい値(フルスケール比)。 */
  limiterThreshold: number;
  /** リミッターの復帰の時定数 [s]。 */
  limiterReleaseSeconds: number;
}

/** 仮値(OPEN-010)。確定値として扱わない。 */
export const PROVISIONAL: OutputStageConfig = {
  defaultLevelDb: -20,
  minLevelDb: -60,
  maxLevelDb: 0,
  fadeSeconds: 0.05,
  levelSmoothingSeconds: 0.005,
  limiterThreshold: 0.891, // 約 -1 dBFS
  limiterReleaseSeconds: 0.1,
};

export type Actor = "human" | "agent";

/** 音量を引き下げる契機(operation-contract §2.4)。 */
export type ReductionTrigger = "startup" | "patch_replaced" | "release_panic" | "audio_start" | "reinit";

export interface OutputStatus {
  levelDb: number;
  agentMaxLevelDb: number;
  panic: boolean;
  /** 出力段で 0 に置換した非有限値の数。 */
  nonfiniteCount: number;
  /** 最終クリップ(リミッターの後)が働いたサンプル数。 */
  clipCount: number;
  /** 現在のリミッターの利得(1 = 作用なし)。 */
  limiterGain: number;
  /** 直近の観測区間の最終出力のピーク(絶対値)。takePeak() で読み出すと 0 に戻る。 */
  peak: number;
}

export class OutputStage {
  readonly cfg: OutputStageConfig;
  private fs: number;
  private levelDb: number;
  private agentMaxDb: number;
  private panicOn = false;
  /** 音声が動いているか(止まっている間はフェードインを始めない)。 */
  private running = false;
  // 内部状態
  private levelGain = 0; // 平滑化した音量(線形)
  private fade = 0; // フェードの包絡(0〜1)
  private limGain = 1;
  private nonfinite = 0;
  private clips = 0;
  private peak = 0;
  // 係数
  private fadeStep = 0;
  private levelCoef = 0;
  private relCoef = 0;

  readonly outL: number[] = [0];
  readonly outR: number[] = [0];

  constructor(fs: number, cfg: OutputStageConfig = PROVISIONAL) {
    this.cfg = cfg;
    this.fs = fs;
    this.levelDb = cfg.defaultLevelDb; // 起動: 現在値がないので既定値から
    this.agentMaxDb = cfg.defaultLevelDb; // 人がまだ設定していないときの初期値
    this.setSampleRate(fs);
  }

  setSampleRate(fs: number): void {
    this.fs = fs;
    this.fadeStep = 1 / Math.max(1, Math.round(this.cfg.fadeSeconds * fs));
    this.levelCoef = Math.exp(-1 / (this.cfg.levelSmoothingSeconds * fs));
    this.relCoef = Math.exp(-1 / (this.cfg.limiterReleaseSeconds * fs));
  }

  private targetGain(): number {
    return Math.pow(10, this.levelDb / 20);
  }

  /**
   * 音量の引き下げ(DEC-111): level ← min(現在値, 既定値)。上限は変えない。
   * 音声が動いていて緊急停止中でなければ、無音からフェードインする。
   * 戻り値は level が変わったか。
   */
  reduce(_trigger: ReductionTrigger): boolean {
    const before = this.levelDb;
    this.levelDb = Math.min(this.levelDb, this.cfg.defaultLevelDb);
    this.fade = 0;
    this.levelGain = this.targetGain();
    this.limGain = 1;
    return this.levelDb !== before;
  }

  /** 音声の開始・再開。引き下げとフェードインを行う。 */
  start(): boolean {
    this.running = true;
    return this.reduce("audio_start");
  }

  /** 音声の停止・中断。 */
  stop(): void {
    this.running = false;
    this.fade = 0;
  }

  /**
   * マスター音量を設定する(operation-contract CMD-25)。
   * 人: 範囲内の値を設定し、その値がエージェントの上限になる(DEC-010)。
   * エージェント: 上限を超える値は拒否する(状態は変えない)。
   */
  setLevel(db: number, actor: Actor): { ok: true } | { ok: false; reason: "not_a_number" | "out_of_range" | "over_agent_max" } {
    if (typeof db !== "number" || !Number.isFinite(db)) return { ok: false, reason: "not_a_number" };
    if (db < this.cfg.minLevelDb || db > this.cfg.maxLevelDb) return { ok: false, reason: "out_of_range" };
    if (actor === "agent" && db > this.agentMaxDb) return { ok: false, reason: "over_agent_max" };
    this.levelDb = db;
    if (actor === "human") this.agentMaxDb = db;
    return { ok: true };
  }

  /** 緊急停止: 即時に消音する。解除は releasePanic()(人のみ)。 */
  panic(): void {
    this.panicOn = true;
    this.fade = 0;
    this.limGain = 1;
    this.nonfinite = 0; // 診断計数は緊急停止で 0 に戻る(operation-contract の設計判断)
    this.clips = 0;
  }

  /** 緊急停止を解除する。解除したら true(緊急停止中でなければ false)。音量は引き下げ、フェードインする。 */
  releasePanic(): boolean {
    if (!this.panicOn) return false;
    this.panicOn = false;
    this.reduce("release_panic");
    return true;
  }

  get isPanic(): boolean {
    return this.panicOn;
  }

  /**
   * 1サンプル処理。入力は MOD-IO-001 の PRE_L/PRE_R(フルスケール比)。
   * 結果は outL[0]/outR[0]。必ず有限で、絶対値は 1.0 以下。
   */
  step(preL: number, preR: number): void {
    // 1) 非有限値の検出と除去
    let l = preL;
    let r = preR;
    if (!Number.isFinite(l)) {
      l = 0;
      this.nonfinite++;
    }
    if (!Number.isFinite(r)) {
      r = 0;
      this.nonfinite++;
    }
    // 2) マスター音量とフェード
    const active = this.running && !this.panicOn;
    if (active) {
      if (this.fade < 1) this.fade = Math.min(1, this.fade + this.fadeStep);
      const t = this.targetGain();
      this.levelGain = t + (this.levelGain - t) * this.levelCoef;
    } else {
      this.fade = 0;
    }
    const g = active ? this.levelGain * this.fade : 0;
    l *= g;
    r *= g;
    // 3) リミッター(左右連動。しきい値を超えないよう即時に利得を下げ、時定数で復帰)
    const pk = Math.max(Math.abs(l), Math.abs(r));
    const thr = this.cfg.limiterThreshold;
    const need = pk > thr ? thr / pk : 1;
    if (need < this.limGain) this.limGain = need;
    else this.limGain = 1 + (this.limGain - 1) * this.relCoef;
    if (this.limGain > need) this.limGain = need;
    l *= this.limGain;
    r *= this.limGain;
    // 4) 最終クリップ(保険)
    if (l > 1 || l < -1 || r > 1 || r < -1) {
      this.clips++;
      l = l > 1 ? 1 : l < -1 ? -1 : l;
      r = r > 1 ? 1 : r < -1 ? -1 : r;
    }
    const a = Math.max(Math.abs(l), Math.abs(r));
    if (a > this.peak) this.peak = a;
    this.outL[0] = l;
    this.outR[0] = r;
  }

  /** 観測区間のピークを読み出して 0 に戻す。 */
  takePeak(): number {
    const p = this.peak;
    this.peak = 0;
    return p;
  }

  status(): OutputStatus {
    return {
      levelDb: this.levelDb,
      agentMaxLevelDb: this.agentMaxDb,
      panic: this.panicOn,
      nonfiniteCount: this.nonfinite,
      clipCount: this.clips,
      limiterGain: this.limGain,
      peak: this.peak,
    };
  }
}
