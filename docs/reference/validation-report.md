# 検査結果(2026-11-12)

## 自動検査(`python3 tools/validate_reference.py`)
結果: **エラーなし**。集計: 対象10 / エンティティ98 / 事実354 / 出典82 / 未確認75。

検査項目: 必須項目、ID形式・重複、列挙値、`fact_ids`/`source_id`/`entity_id`/`tried_sources` の参照切れ、(メーカー,名称,版)の重複、確認済み値に根拠があること、未確認値に数値が入っていないこと、事実本文の長さ(転載の疑い)。

## 索引・比較表・不足一覧の生成
`python3 tools/build_reference_docs.py` で `index.md` / `comparison.md` / `gaps.md` をDBから再生成。手編集しない。

## 手動確認
- Doepfer(T-001)とVCV Rack(T-005)の電圧規約の事実を、公式ページの記述と照合した(ゲート閾値、典型レベル、1V/oct)。矛盾なし。
- 全事実の網羅的な再検証は未実施。事実は担当調査時の読解に依存する。
- 外部リンクのアクセス確認日は各出典の `accessed_on`、取得不能は `link_status: unreachable`(一覧は [不足一覧](gaps.md))。

## 既知の制限
- T-003(Mother-32)は公式マニュアル未取得のため `insufficient_sources`。
- Pd公式ドキュメントサイト(msp.ucsd.edu)など一部は取得不能で、同梱マニュアル・ソースで代替した。
- スキーマ上の課題(Vpp単位、ground-closure型トリガー、`signal_type` に note なし、版の二重管理、「規約が存在しない」の表現)は [スキーマ改善候補](schema-improvements.md) に記録。
