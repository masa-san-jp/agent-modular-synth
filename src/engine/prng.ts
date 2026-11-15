// COM-11: xoshiro128** (32bit)。状態の初期化は SplitMix32 風の混合関数。全演算は uint32。

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** パラメータ値を uint32 の seed に正規化する(COM-11)。NaN/∞ は既定 seed。 */
export function normalizeSeed(v: number, defaultSeed: number): number {
  if (!Number.isFinite(v)) return defaultSeed >>> 0;
  if (v < 0) return 0;
  const t = Math.floor(v);
  return (t % 4294967296) >>> 0;
}

export class Prng {
  s0 = 0;
  s1 = 0;
  s2 = 0;
  s3 = 0;

  constructor(seed = 0) {
    this.seed(seed);
  }

  seed(seed: number): void {
    let x = seed >>> 0;
    const mix = (): number => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.s0 = mix();
    this.s1 = mix();
    this.s2 = mix();
    this.s3 = mix();
  }

  /** uint32 を返す。 */
  next(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** [0,1) の値(24bit精度)。 */
  uniform(): number {
    return (this.next() >>> 8) / 16777216.0;
  }

  getState(): number[] {
    return [this.s0, this.s1, this.s2, this.s3];
  }

  setState(s: readonly number[]): void {
    this.s0 = s[0]! >>> 0;
    this.s1 = s[1]! >>> 0;
    this.s2 = s[2]! >>> 0;
    this.s3 = s[3]! >>> 0;
  }
}
