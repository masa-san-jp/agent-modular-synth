// スナップショット用の数値の符号化。JSON は NaN/±∞/-0 を表せないので文字列にする(COM-14 のビット同一性のため)。

export type EncNum = number | "NaN" | "Infinity" | "-Infinity" | "-0";

export function encNum(x: number): EncNum {
  if (Number.isNaN(x)) return "NaN";
  if (x === Infinity) return "Infinity";
  if (x === -Infinity) return "-Infinity";
  if (Object.is(x, -0)) return "-0";
  return x;
}

export function decNum(x: EncNum): number {
  if (typeof x === "number") return x;
  switch (x) {
    case "NaN":
      return NaN;
    case "Infinity":
      return Infinity;
    case "-Infinity":
      return -Infinity;
    case "-0":
      return -0;
  }
}

export function encArr(a: ArrayLike<number>): EncNum[] {
  const o: EncNum[] = [];
  for (let i = 0; i < a.length; i++) o.push(encNum(a[i]!));
  return o;
}

export function decInto(src: readonly EncNum[], dst: { [i: number]: number; length: number }): void {
  for (let i = 0; i < dst.length; i++) dst[i] = i < src.length ? decNum(src[i]!) : 0;
}
