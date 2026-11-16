// 複数モジュールが使う共通部品(COM-02, COM-04, COM-07, COM-13, COM-17)。

export const MAX_CHANNELS = 16;
export const V_LIMIT = 12; // COM-02(3): 生成する出力は ±12 V 以内

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** COM-04: シュミットトリガ(ON 2.0 V、OFF 0.1 V)。 */
export const GATE_ON = 2.0;
// ポート値は float32 なので、0.1 V の入力は 0.100000001490116… になる。倍精度の 0.1 と比べると
// 「0.1 V 以下」が偽になるため、閾値も float32 に丸めた値で持つ(0.1 V ちょうどの入力で OFF になる)。
export const GATE_OFF = Math.fround(0.1);

export class Schmitt {
  state = 0;
  /** 値を与えて状態を更新し、立ち上がりなら true を返す。 */
  step(v: number): boolean {
    if (this.state === 0 && v >= GATE_ON) {
      this.state = 1;
      return true;
    }
    if (this.state === 1 && v <= GATE_OFF) this.state = 0;
    return false;
  }
  reset(): void {
    this.state = 0;
  }
}

/** COM-04: 生成するトリガ/クロックのパルス幅(サンプル数)。 */
export function triggerSamples(fs: number): number {
  return Math.max(1, Math.round(0.001 * fs));
}

/** COM-07: RESET 後に CLOCK を無視する区間(サンプル数)。 */
export function resetIgnoreSamples(fs: number): number {
  return Math.ceil(0.001 * fs);
}

/** COM-17: 指数区間の時間 T(残差 1/1000)から1サンプルの係数を求める。 */
export function expCoefFromTime(T: number, fs: number): number {
  const tau = T / Math.log(1000);
  return Math.exp(-1 / (tau * fs));
}

/** COM-13: 整数型パラメータは四捨五入(0.5は切り上げ)。 */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}
