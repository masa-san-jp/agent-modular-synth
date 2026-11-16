// モジュールの共通インターフェース(COM-01〜COM-14)。
// 値は V(ボルト相当)。ポート値は float32(COM-02)。内部状態の精度は各モジュールが決める(COM-05)。

import { MAX_CHANNELS, clamp, roundHalfUp } from "./util.js";

export type SignalType = "audio" | "cv" | "pitch" | "gate" | "trigger" | "clock" | "event";

export interface PortDef {
  name: string;
  type: SignalType;
  /** 入力が未接続のときの値(COM-09)。既定 0 V。 */
  unconnected?: number;
  /** ケーブルを接続できないポート(製品内部の出力など)。既定 true。 */
  connectable?: boolean;
}

/** bool は真偽(0/1)。外部操作層は 0 と 1 だけを受け付ける。エンジン内では「有限の0以外は1」。 */
export type ParamKind = "float" | "int" | "bool" | "seed";

export interface ParamDef {
  name: string;
  kind: ParamKind;
  min: number;
  max: number;
  default: number;
  unit?: string;
}

export interface ModuleDef {
  /** 仕様ID(例: MOD-UTL-001)。 */
  specId: string;
  specVersion: string;
  title: string;
  inputs: readonly PortDef[];
  outputs: readonly PortDef[];
  params: readonly ParamDef[];
  /** 内部状態を持つか(仕様フロントマターの stateful)。 */
  stateful: boolean;
}

/** 入力ポートの実行時の値。エンジン(またはテスト)が毎ステップ書き込む。 */
export class InPort {
  connected = false;
  channels = 1;
  readonly values = new Float32Array(MAX_CHANNELS);
  constructor(readonly def: PortDef) {}

  /** 未接続にする。 */
  disconnect(): void {
    this.connected = false;
    this.channels = 1;
    this.values.fill(0);
  }

  /** 接続し、値を与える(テスト・エンジン用)。 */
  set(values: ArrayLike<number>): void {
    const n = Math.min(values.length, MAX_CHANNELS);
    this.connected = true;
    this.channels = Math.max(1, n);
    for (let c = 0; c < MAX_CHANNELS; c++) this.values[c] = c < n ? values[c]! : 0;
  }
}

/** 出力ポートの実行時の値。モジュールが毎ステップ書き込む。 */
export class OutPort {
  channels = 1;
  readonly values = new Float32Array(MAX_CHANNELS);
  constructor(readonly def: PortDef) {}
}

/** COM-12/13: パラメータ値の正規化(NaN/∞ は既定値、整数型は四捨五入、範囲はクランプ)。seed は COM-11 に従い各モジュールが正規化する。 */
export function normalizeParam(def: ParamDef, v: number): number {
  if (def.kind === "seed") return v;
  if (!Number.isFinite(v)) return def.default;
  if (def.kind === "bool") return v !== 0 ? 1 : 0;
  const x = def.kind === "int" ? roundHalfUp(v) : v;
  return clamp(x, def.min, def.max);
}

export type ModuleState = Record<string, unknown>;

/**
 * モジュールの基底クラス。
 * 1ステップ(1サンプル)は「入力を読む → 状態を更新 → 出力を書く」(COM-05)。
 * ケーブルの1サンプル遅延(COM-06)はエンジンが与えるので、step() は同じステップの入力から出力を計算する。
 */
export abstract class SynthModule {
  abstract readonly def: ModuleDef;
  readonly inputs: InPort[] = [];
  readonly outputs: OutPort[] = [];
  /** 設定されたパラメータ値(正規化前)。 */
  protected readonly rawParams = new Map<string, number>();
  /** COM-12: 置換カウンタ(診断値。出力には影響しない)。 */
  nonfiniteCount = 0;
  protected fs: number;

  constructor(fs: number) {
    this.fs = fs;
  }

  /** 派生クラスのコンストラクタの最後で呼ぶ。 */
  protected init(): void {
    for (const p of this.def.inputs) this.inputs.push(new InPort(p));
    for (const p of this.def.outputs) this.outputs.push(new OutPort(p));
    for (const p of this.def.params) this.rawParams.set(p.name, p.default);
    this.resetState();
  }

  get sampleRate(): number {
    return this.fs;
  }

  input(name: string): InPort {
    const i = this.def.inputs.findIndex((p) => p.name === name);
    if (i < 0) throw new Error(`${this.def.specId}: 入力ポート '${name}' はない`);
    return this.inputs[i]!;
  }

  output(name: string): OutPort {
    const i = this.def.outputs.findIndex((p) => p.name === name);
    if (i < 0) throw new Error(`${this.def.specId}: 出力ポート '${name}' はない`);
    return this.outputs[i]!;
  }

  /** パラメータを設定する。次のステップから有効(COM-13)。 */
  setParam(name: string, value: number): void {
    if (!this.rawParams.has(name)) throw new Error(`${this.def.specId}: パラメータ '${name}' はない`);
    this.rawParams.set(name, value);
  }

  /** 設定されたままの値(正規化前)。 */
  getRawParam(name: string): number {
    const v = this.rawParams.get(name);
    if (v === undefined) throw new Error(`${this.def.specId}: パラメータ '${name}' はない`);
    return v;
  }

  /** 正規化後の有効値(COM-12/13)。 */
  param(name: string): number {
    const def = this.def.params.find((p) => p.name === name);
    if (!def) throw new Error(`${this.def.specId}: パラメータ '${name}' はない`);
    return normalizeParam(def, this.rawParams.get(name)!);
  }

  /**
   * 入力ポートの先頭 count チャンネルを読んで整形する(COM-12)。
   * 接続されていて NaN/∞ の値は 0 V に置換し、置換した値1つにつき置換カウンタを1増やす。
   * 未接続なら何もしない。count がポートのチャンネル数より大きい分は読まない。
   */
  protected sanitizeInput(port: InPort, count: number): void {
    if (!port.connected) return;
    const n = Math.min(count, port.channels);
    const v = port.values;
    for (let c = 0; c < n; c++) {
      if (!Number.isFinite(v[c]!)) {
        v[c] = 0;
        this.nonfiniteCount++;
      }
    }
  }

  /**
   * COM-08 の副入力(および N 未満の主入力)の割当: 未接続なら未接続時の値、
   * 1チャンネルなら全エンジンへコピー、c がチャンネル数未満ならその値、不足分は 0 V。
   * 事前に sanitizeInput を呼んでおくこと。
   */
  protected chan(port: InPort, c: number): number {
    if (!port.connected) return port.def.unconnected ?? 0;
    if (port.channels === 1) return port.values[0]!;
    return c < port.channels ? port.values[c]! : 0;
  }

  /** 接続されていればチャンネル数、未接続なら 0。 */
  protected chCount(port: InPort): number {
    return port.connected ? port.channels : 0;
  }

  /** 出力へ書く。NaN/∞ なら 0 を書いて置換カウンタを増やす(COM-12)。 */
  protected writeOut(port: OutPort, c: number, v: number): void {
    if (!Number.isFinite(v)) {
      port.values[c] = 0;
      this.nonfiniteCount++;
    } else {
      port.values[c] = v;
    }
  }

  /** 1サンプル処理。 */
  abstract step(): void;

  /** 内部状態を初期値へ戻す(パラメータは変えない)。派生クラスが実装する。 */
  protected abstract resetState(): void;

  /** COM-10: 全体リセット。内部状態を初期値へ、置換カウンタを 0 へ。パラメータは変えない。 */
  reset(): void {
    this.resetState();
    this.nonfiniteCount = 0;
  }

  /** サンプルレートを変える。全状態を再初期化する(COM-05)。 */
  setSampleRate(fs: number): void {
    this.fs = fs;
    this.reset();
  }

  /** COM-14: 内部状態(JSON にできる値)。状態を持たないモジュールは空。 */
  getState(): ModuleState {
    return {};
  }

  setState(_state: ModuleState): void {}

  /** パラメータ(設定されたままの値)。 */
  getParams(): Record<string, number> {
    const o: Record<string, number> = {};
    for (const [k, v] of this.rawParams) o[k] = v;
    return o;
  }
}

export type ModuleFactory = (fs: number) => SynthModule;
