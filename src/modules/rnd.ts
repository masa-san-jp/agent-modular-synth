// MOD-RND-001 サンプル&ホールド/ランダム(仕様 v0.2)。
// 主入力は IN と TRIG の両方(N = 両者のチャンネル数の最大値)。エンジン c の PRNG は (seed + c) mod 2^32。

import { EncNum, decNum, encArr } from "../engine/codec.js";
import { ModuleDef, ModuleState, SynthModule } from "../engine/module.js";
import { Prng, normalizeSeed } from "../engine/prng.js";
import { GATE_OFF, GATE_ON, MAX_CHANNELS, V_LIMIT, clamp } from "../engine/util.js";

const DEFAULT_SEED = 1;

const DEF: ModuleDef = {
  specId: "MOD-RND-001",
  specVersion: "0.2",
  title: "サンプル&ホールド/ランダム",
  inputs: [
    { name: "IN", type: "cv" }, // 未接続時は normal=NOISE[n](step 内で処理)
    { name: "TRIG", type: "trigger", unconnected: 0 },
  ],
  outputs: [
    { name: "OUT", type: "cv" },
    { name: "NOISE", type: "audio" },
  ],
  params: [
    { name: "seed", kind: "seed", min: 0, max: 4294967295, default: DEFAULT_SEED },
    { name: "level", kind: "float", min: 0, max: 10, default: 5 },
    { name: "scale", kind: "float", min: -2, max: 2, default: 1 },
    { name: "offset", kind: "float", min: -10, max: 10, default: 0 },
  ],
  stateful: true,
};

function schmitt(v: number, state: number): number {
  if (state === 0) return v >= GATE_ON ? 1 : 0;
  return v <= GATE_OFF ? 0 : 1;
}

export class RndModule extends SynthModule {
  readonly def = DEF;

  private n = 1;
  private seedUsed = DEFAULT_SEED;
  private readonly prng: Prng[] = [];
  /** 保持値(float32。scale/offset 適用前)。 */
  private readonly held = new Float32Array(MAX_CHANNELS);
  private readonly trigState = new Uint8Array(MAX_CHANNELS);

  constructor(fs: number) {
    super(fs);
    for (let c = 0; c < MAX_CHANNELS; c++) this.prng.push(new Prng(0));
    this.init();
  }

  private seedN(): number {
    return normalizeSeed(this.param("seed"), DEFAULT_SEED);
  }

  private reseed(from: number, to: number, seedN: number): void {
    for (let c = from; c < to; c++) this.prng[c]!.seed((seedN + c) % 4294967296);
  }

  private initEngines(from: number, to: number, seedN: number): void {
    this.reseed(from, to, seedN);
    for (let c = from; c < to; c++) {
      this.held[c] = 0;
      this.trigState[c] = 0;
    }
  }

  protected resetState(): void {
    const s = this.seedN();
    this.seedUsed = s;
    this.initEngines(0, MAX_CHANNELS, s);
  }

  step(): void {
    const inp = this.inputs[0]!;
    const trig = this.inputs[1]!;
    const out = this.outputs[0]!;
    const noiseOut = this.outputs[1]!;

    // 0. seed の正規化と変化の検出(全エンジンを再シード)
    const seedN = this.seedN();
    if (seedN !== this.seedUsed) {
      this.reseed(0, MAX_CHANNELS, seedN);
      this.seedUsed = seedN;
    }

    // COM-08: N = max(IN, TRIG のチャンネル数)。どちらも未接続なら 1。増えたエンジンは初期状態。
    const n = Math.max(1, this.chCount(inp), this.chCount(trig));
    if (n > this.n) this.initEngines(this.n, n, seedN);
    this.n = n;

    // COM-12: 接続された入力の全チャンネルを毎ステップ整形して数える。
    this.sanitizeInput(inp, n);
    this.sanitizeInput(trig, n);

    const level = this.param("level");
    const scale = this.param("scale");
    const offset = this.param("offset");

    out.channels = n;
    noiseOut.channels = n;
    for (let c = 0; c < n; c++) {
      // 1. ノイズ(毎サンプル1回)
      const u = this.prng[c]!.uniform();
      const noise = (2 * u - 1) * level;
      // 2. TRIG 検出
      const t = this.chan(trig, c);
      const prev = this.trigState[c]!;
      this.trigState[c] = schmitt(t, prev);
      const edge = prev === 0 && this.trigState[c] === 1;
      // 3. 取り込み
      if (edge) this.held[c] = inp.connected ? this.chan(inp, c) : noise;
      // 4. 出力
      this.writeOut(out, c, clamp(scale * this.held[c]! + offset, -V_LIMIT, V_LIMIT));
      this.writeOut(noiseOut, c, noise);
    }
  }

  override getState(): ModuleState {
    const n = this.n;
    return {
      seed_used: this.seedUsed,
      held: encArr(this.held.subarray(0, n)),
      trig_state: Array.from(this.trigState.subarray(0, n)),
      prng: this.prng.slice(0, n).map((p) => p.getState()),
    };
  }

  override setState(state: ModuleState): void {
    // 0.1 の保存データ(1組のスカラー、prng は [s0,s1,s2,s3])はエンジン0として読む(§9)。
    const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v === undefined ? [] : [v as T]);
    const held = arr<EncNum>(state.held);
    const ts = arr<number>(state.trig_state);
    let prng = arr<number[] | number>(state.prng);
    if (prng.length > 0 && typeof prng[0] === "number") prng = [prng as number[]];
    const seedUsed = typeof state.seed_used === "number" ? state.seed_used >>> 0 : this.seedN();
    const n = Math.max(1, Math.min(MAX_CHANNELS, prng.length));
    this.seedUsed = seedUsed;
    this.initEngines(0, MAX_CHANNELS, seedUsed);
    for (let c = 0; c < n; c++) {
      if (c < prng.length) this.prng[c]!.setState(prng[c] as number[]);
      this.held[c] = c < held.length ? decNum(held[c]!) : 0;
      this.trigState[c] = ts[c] ? 1 : 0;
    }
    this.n = n;
  }
}
