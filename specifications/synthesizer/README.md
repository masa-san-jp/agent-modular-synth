# オリジナルシンセの製品仕様(#3)

本製品の採用判断・構成の正本。調査事実は [references/](../../references/index.md)、モジュール挙動は [specifications/modules/](../modules/README.md) が正本で、本書はそれらを複製せず参照する。

| 文書 | 内容 |
|---|---|
| [requirements.md](requirements.md) | 製品要求一覧(REQ-ID、範囲、根拠、受入判定) |
| [product-spec.md](product-spec.md) | 対応環境・配布形態、構成、採用機能、安全、非機能、ライセンス |
| [operation-contract.md](operation-contract.md) | UIとエージェント共通の操作契約(コマンド、状態、エラー、同期・競合・再送) |
| [data-contract.md](data-contract.md) | パッチ・状態保存のデータ契約、版互換と移行 |
| [verification-plan.md](verification-plan.md) | 検証計画(機能・接続・異常系・再現性・性能・安全・環境別) |
| [../../plans/implementation-plan.md](../../plans/implementation-plan.md) | 実装計画(タスク、依存、参照仕様、検証方法) |
| [../../plans/decisions.md](../../plans/decisions.md) | 判断記録と未決事項 |
| [../../plans/handoff-from-modules.md](../../plans/handoff-from-modules.md) | #2から引き継いだ事項の処置表 |
| [validation.md](validation.md) | 検査結果(リンク・内部参照・相互矛盾の確認) |
