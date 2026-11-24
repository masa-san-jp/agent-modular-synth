// グラフ実行器(COM-05/06)。全モジュールを単一の fs で1サンプルずつ同期実行し、ケーブルは1サンプル遅延。
// ブラウザのAPIに依存しない(同じコードをオフラインで実行できる)。

import { EncNum, decInto, decNum, encArr, encNum } from "./codec.js";
import { InPort, ModuleFactory, ModuleState, OutPort, SynthModule } from "./module.js";
import { MAX_CHANNELS } from "./util.js";

interface Cable {
  fromModule: string;
  fromPort: number;
  toModule: string;
  toPort: number;
}

/** 出力ポートの「前のステップの値」(ケーブルが運ぶ値)。 */
interface Latch {
  channels: number;
  values: Float32Array;
  /** 最後のステップの出力を写していない(ケーブルがつながっていない出力)。読む前に写し直す。 */
  stale: boolean;
}
interface Link {
  port: InPort;
  latch: Latch;
}
/** 1 サンプルの処理の手順。 */
interface Plan {
  modules: SynthModule[];
  /** ケーブル 1 本ごと: 入力ポートと、それが読む控え。 */
  links: Link[];
  /** ケーブルがつながっている出力と、その控え(毎サンプル写す)。 */
  kept: { out: OutPort; latch: Latch }[];
  /** ケーブルがつながっていない出力の控え(写さない)。 */
  skipped: Latch[];
}

export interface EngineSnapshot {
  format: "modular-synth-snapshot";
  fs: number;
  step: number;
  modules: {
    id: string;
    type: string;
    specVersion: string;
    params: Record<string, EncNum>;
    state: ModuleState;
    /** 各出力ポートのケーブル遅延値(COM-06、COM-14)。 */
    ports: { channels: number; values: EncNum[] }[];
  }[];
  cables: { from: [string, string]; to: [string, string] }[];
}

export class Engine {
  private readonly modules = new Map<string, SynthModule>();
  private readonly latches = new Map<string, Latch[]>();
  /** キーは "toModule\u0000toPortIndex"。1つの入力にケーブルは1本まで。 */
  private readonly cables = new Map<string, Cable>();
  private stepCount = 0;
  /**
   * 1サンプルの処理の手順(モジュールの並びと、各入力がどの出力の遅延値を読むか)。
   * 構成(モジュール・ケーブル)が変わったら null にし、次の tick で作り直す。毎サンプル名前で引き直さない。
   */
  private plan: Plan | null = null;
  /** 次の tick で、写していない出力の控えに「古い」印を付ける(手順を作り直した後と、リセットの後)。 */
  private markPending = true;

  constructor(readonly fs: number) {
    if (!(fs > 0) || !Number.isFinite(fs)) throw new Error("fs は正の有限値");
  }

  get step(): number {
    return this.stepCount;
  }

  add(id: string, module: SynthModule): SynthModule {
    if (this.modules.has(id)) throw new Error(`モジュールID '${id}' は使用中`);
    if (module.sampleRate !== this.fs) throw new Error(`'${id}' の fs がエンジンと異なる`);
    this.modules.set(id, module);
    this.plan = null;
    this.latches.set(
      id,
      module.outputs.map(() => ({ channels: 1, values: new Float32Array(MAX_CHANNELS), stale: false })),
    );
    return module;
  }

  remove(id: string): void {
    if (!this.modules.delete(id)) throw new Error(`モジュール '${id}' はない`);
    this.latches.delete(id);
    this.plan = null;
    for (const [k, c] of [...this.cables]) {
      if (c.fromModule === id || c.toModule === id) this.cables.delete(k);
    }
  }

  get(id: string): SynthModule {
    const m = this.modules.get(id);
    if (!m) throw new Error(`モジュール '${id}' はない`);
    return m;
  }

  ids(): string[] {
    return [...this.modules.keys()];
  }

  /** 出力 → 入力を接続する。自己接続・フィードバックも可(COM-06)。型違いも可(COM-01)。 */
  connect(fromModule: string, fromPort: string, toModule: string, toPort: string): void {
    const src = this.get(fromModule);
    const dst = this.get(toModule);
    const fi = src.def.outputs.findIndex((p) => p.name === fromPort);
    const ti = dst.def.inputs.findIndex((p) => p.name === toPort);
    if (fi < 0) throw new Error(`'${fromModule}' に出力 '${fromPort}' はない`);
    if (ti < 0) throw new Error(`'${toModule}' に入力 '${toPort}' はない`);
    if (src.def.outputs[fi]!.connectable === false) throw new Error(`出力 '${fromPort}' は接続できない`);
    if (dst.def.inputs[ti]!.connectable === false) throw new Error(`入力 '${toPort}' は接続できない`);
    const key = `${toModule}\u0000${ti}`;
    if (this.cables.has(key)) throw new Error(`入力 '${toModule}.${toPort}' は使用中`);
    this.cables.set(key, { fromModule, fromPort: fi, toModule, toPort: ti });
    this.plan = null;
  }

  disconnect(toModule: string, toPort: string): void {
    const dst = this.get(toModule);
    const ti = dst.def.inputs.findIndex((p) => p.name === toPort);
    if (ti < 0 || !this.cables.delete(`${toModule}\u0000${ti}`)) {
      throw new Error(`入力 '${toModule}.${toPort}' にケーブルはない`);
    }
    this.plan = null;
  }

  /**
   * 手順を作る。写すのは、ケーブルがつながっている出力と入力だけ(つながっていない出力の控えは、誰も読まないので毎サンプル写さない)。
   * 写していない控えには「古い」印を付け、必要になったとき(ケーブルをつないだ、スナップショットを取る)に出力から写し直す。
   * 出力は最後のステップの値を持ち続けているので、毎サンプル写した場合と同じ値になる。
   */
  private buildPlan(): Plan {
    this.syncStale();
    const links: Link[] = [];
    const used = new Set<Latch>();
    const modules: SynthModule[] = [];
    for (const [id, m] of this.modules) {
      modules.push(m);
      for (let i = 0; i < m.inputs.length; i++) {
        const cable = this.cables.get(`${id}\u0000${i}`);
        const port = m.inputs[i]!;
        if (!cable) {
          // ケーブルのない入力は、未接続にする(手順を作るときに 1 回だけ)
          if (port.connected) port.disconnect();
          continue;
        }
        const latch = this.latches.get(cable.fromModule)![cable.fromPort]!;
        links.push({ port, latch });
        used.add(latch);
      }
    }
    const kept: { out: OutPort; latch: Latch }[] = [];
    const skipped: Latch[] = [];
    for (const [id, m] of this.modules) {
      const ls = this.latches.get(id)!;
      for (let o = 0; o < ls.length; o++) {
        if (used.has(ls[o]!)) kept.push({ out: m.outputs[o]!, latch: ls[o]! });
        else skipped.push(ls[o]!);
      }
    }
    this.markPending = true;
    return { modules, links, kept, skipped };
  }

  /** 「古い」印の付いた控えを、出力から写し直す(毎サンプル写した場合と同じ値にする)。 */
  private syncStale(): void {
    for (const [id, m] of this.modules) {
      const ls = this.latches.get(id)!;
      for (let o = 0; o < ls.length; o++) {
        const l = ls[o]!;
        if (!l.stale) continue;
        const out = m.outputs[o]!;
        const n = out.channels;
        const upto = l.channels > n ? l.channels : n;
        l.channels = n;
        for (let c = 0; c < upto; c++) l.values[c] = out.values[c]!;
        l.stale = false;
      }
    }
    this.markPending = true;
  }

  /** 1サンプル進める。全モジュールが前のステップの出力を読み、同時に出力を書く。 */
  tick(): void {
    const plan = this.plan ?? (this.plan = this.buildPlan());
    // 1) 入力を読む(ケーブルの1サンプル遅延値)
    const links = plan.links;
    for (let k = 0; k < links.length; k++) {
      const link = links[k]!;
      const port = link.port;
      const latch = link.latch;
      // 写すのは、使われるチャンネルの分だけ(単音なら 1 個)。チャンネル数が減った直後の 1 回は、前の数の分まで写して
      // 以前の値を残さない。チャンネル数より後ろの値は、どのモジュールも読まない(COM-08)
      const n = latch.channels;
      const upto = port.connected && port.channels > n ? port.channels : n;
      port.connected = true;
      port.channels = n;
      const src = latch.values;
      const dst = port.values;
      if (upto === 1) dst[0] = src[0]!; // 単音(ほとんどのケーブル)
      else for (let c = 0; c < upto; c++) dst[c] = src[c]!;
    }
    // 2) 状態を更新し、出力を書く
    const modules = plan.modules;
    for (let k = 0; k < modules.length; k++) modules[k]!.step();
    // 3) 出力を次のステップ用に保持する(ケーブルがつながっている出力だけ)
    const kept = plan.kept;
    for (let k = 0; k < kept.length; k++) {
      const out = kept[k]!.out;
      const l = kept[k]!.latch;
      const n = out.channels;
      const upto = l.channels > n ? l.channels : n;
      l.channels = n;
      const src = out.values;
      const dst = l.values;
      if (upto === 1) dst[0] = src[0]!;
      else for (let c = 0; c < upto; c++) dst[c] = src[c]!;
    }
    if (this.markPending) {
      // 写さなかった控えは、このステップから「古い」
      for (const l of plan.skipped) l.stale = true;
      this.markPending = false;
    }
    this.stepCount++;
  }

  run(samples: number): void {
    for (let n = 0; n < samples; n++) this.tick();
  }

  /**
   * frames サンプル分を処理し、指定した出力ポートの値(このステップで書かれた値)を返す。
   * 結果は [チャンネル][フレーム]。ブロック長に依存しない(DEC-108)。
   */
  process(frames: number, moduleId: string, portName: string, channels = 1): Float32Array[] {
    const out = this.get(moduleId).output(portName);
    const buf: Float32Array[] = [];
    for (let c = 0; c < channels; c++) buf.push(new Float32Array(frames));
    for (let n = 0; n < frames; n++) {
      this.tick();
      for (let c = 0; c < channels; c++) buf[c]![n] = c < out.channels ? out.values[c]! : 0;
    }
    return buf;
  }

  /** COM-10: 全体リセット。全モジュールの内部状態とケーブル遅延値を初期値へ。パラメータと接続は変えない。 */
  reset(): void {
    for (const m of this.modules.values()) m.reset();
    for (const ls of this.latches.values()) {
      for (const l of ls) {
        l.channels = 1;
        l.values.fill(0);
        l.stale = false;
      }
    }
    this.markPending = true;
    this.stepCount = 0;
  }

  /** COM-14: スナップショット(内部状態・PRNG・ケーブル遅延値を含む検証用の完全保存)。 */
  snapshot(): EngineSnapshot {
    this.syncStale();
    const modules: EngineSnapshot["modules"] = [];
    for (const [id, m] of this.modules) {
      const params: Record<string, EncNum> = {};
      for (const [k, v] of Object.entries(m.getParams())) params[k] = encNum(v);
      modules.push({
        id,
        type: m.def.specId,
        specVersion: m.def.specVersion,
        params,
        state: m.getState(),
        ports: this.latches.get(id)!.map((l) => ({ channels: l.channels, values: encArr(l.values) })),
      });
    }
    const cables: EngineSnapshot["cables"] = [];
    for (const c of this.cables.values()) {
      cables.push({
        from: [c.fromModule, this.get(c.fromModule).def.outputs[c.fromPort]!.name],
        to: [c.toModule, this.get(c.toModule).def.inputs[c.toPort]!.name],
      });
    }
    return { format: "modular-synth-snapshot", fs: this.fs, step: this.stepCount, modules, cables };
  }

  /** スナップショットから復元する。版が違う場合は移行しない(data-contract §6)。 */
  static restore(snap: EngineSnapshot, registry: ReadonlyMap<string, ModuleFactory>): Engine {
    if (snap.format !== "modular-synth-snapshot") throw new Error("スナップショットの形式が違う");
    const e = new Engine(snap.fs);
    for (const sm of snap.modules) {
      const factory = registry.get(sm.type);
      if (!factory) throw new Error(`未知のモジュール種別 ${sm.type}`);
      const m = factory(snap.fs);
      if (m.def.specVersion !== sm.specVersion) {
        throw new Error(`${sm.type} の仕様版が違う(${sm.specVersion} → ${m.def.specVersion})。スナップショットは移行しない`);
      }
      for (const [k, v] of Object.entries(sm.params)) m.setParam(k, decNum(v));
      m.setState(sm.state);
      e.add(sm.id, m);
      const ls = e.latches.get(sm.id)!;
      sm.ports.forEach((p, i) => {
        ls[i]!.channels = p.channels;
        decInto(p.values, ls[i]!.values);
      });
    }
    for (const c of snap.cables) e.connect(c.from[0], c.from[1], c.to[0], c.to[1]);
    e.stepCount = snap.step;
    return e;
  }
}
