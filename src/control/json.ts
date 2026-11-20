// JSON の値についての小さな補助(コマンド処理・サーバー・タブで共有する)。

/**
 * 要求1件の入れ子の深さの上限(封筒を 1 段目と数える)。
 * 深い入れ子は、解釈(JSON.parse)は通っても、文字列へ戻す処理(JSON.stringify)や再帰の検査でスタックを使い切る。
 * 契約のコマンドが使う深さ(batch の中の patch.load で 8 段程度 + `ui` の中身)より十分大きい値にしてある。
 */
export const MAX_REQUEST_DEPTH = 64;

/** パッチ文書の `ui`(1モジュール)の入れ子の深さの上限(`ui` のオブジェクト自身を 1 段目と数える)。 */
export const MAX_UI_DEPTH = 8;

/**
 * 値の入れ子の深さが `max` を超えるか(スカラーは 0 段、`[]`・`{}` は 1 段)。
 * 再帰を使わない(深い入れ子の検査そのものでスタックを使い切らないため)。
 */
export function depthExceeds(value: unknown, max: number): boolean {
  if (typeof value !== "object" || value === null) return false;
  const stack: { v: object; d: number }[] = [{ v: value, d: 1 }];
  while (stack.length > 0) {
    const { v, d } = stack.pop() as { v: object; d: number };
    if (d > max) return true;
    const children = Array.isArray(v) ? (v as unknown[]) : Object.values(v as Record<string, unknown>);
    for (const c of children) {
      if (typeof c === "object" && c !== null) stack.push({ v: c, d: d + 1 });
    }
  }
  return false;
}

/** JSON の文字列にする。できなければ(深すぎる入れ子、循環など)null。例外は投げない。 */
export function tryStringify(value: unknown): string | null {
  try {
    const s = JSON.stringify(value);
    return typeof s === "string" ? s : null;
  } catch {
    return null;
  }
}
