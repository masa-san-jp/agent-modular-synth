# スキーマ改善候補(v0.1 → v0.2 検討)

調査担当から挙がった課題。#2で必要性が確認されてから改訂する(既存レコードの互換を保つ)。

| 課題 | 現状の回避策 | 提案 |
|---|---|---|
| Vpp(peak-to-peak)を `range` で表しにくい | unit を `Vpp` とする | `range.kind: peak|pp` を追加 |
| ground-closure型トリガーの欄がない | `trigger` で range なし | `signal_type` の属性 `electrical: voltage|contact_closure` |
| `signal_type` に note がない | `event` で代用 | `note` を追加 |
| 版が `version` 1つ | 文章で併記 | `doc_version` と製品版を分離 |
| 「規約が存在しない」を事実にできない | `confidence: low` の事実 | `negative_finding` を fact に追加 |
| コマンド型の外部制御(OSC等)の構造化欄がない | `features` に文章 | `commands[]` 追加 |
| 一次資料がソースコードのとき `basis` が区別しにくい | `licensed_source` | `source_code` を別値に |
| 画像のみのマニュアルを読んだことの区別欄 | `locator` に記載 | sources に `read_method` |
