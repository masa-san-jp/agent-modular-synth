// 画面に出す値の名前(パネルの印字と同じ短い語)。仕様の列挙型の値の名前(日本語)を、画面用の語に対応させる。
// 画面には文章を書かない(docs/design/…single-hue-wash.md §10、DEC-023)。対応のない名前が増えたら、試験が落ちる。
export const VALUE_LABEL: Readonly<Record<string, string>> = {
  線形: "LIN",
  指数: "EXP",
  連続: "FREE",
  立ち上がり: "RISE",
  立ち下がり: "FALL",
  ソフト: "SOFT",
  ハード: "HARD",
  フォールド: "FOLD",
};
/** 列挙型の値の、画面用の名前(対応がなければ、元の名前)。 */
export const valueLabel = (label: string): string => VALUE_LABEL[label] ?? label;
