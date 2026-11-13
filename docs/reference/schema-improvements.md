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
| 個人執筆の史料を公式サイトが公開している場合の `basis` 区分がない(T-015) | `third_party` + license_note | `basis` に `hosted_secondary` を追加 |
| 「典型値」と「システム上限」を同時に表せない(T-016) | unit 文字列で代用 | `range` を `typical` / `absolute` に分離 |
| `params.range` で列挙値(フィルタモード等)を表せない(T-017) | features に文章 | `enum[]` 追加 |
| 失敗した対象でも records/sources ファイルが必要 | 空ファイルに unconfirmed のみ | 空の対象はファイル省略を許可 |
