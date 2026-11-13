# agent-modular-synth

ブラウザ・ローカル環境で動作し、人間とエージェントが操作できるオリジナルのモジュラーシンセの設計プロジェクト。

## 進行状況
| 段階 | Issue | 状態 |
|---|---|---|
| 第1段階 リファレンス調査・出典付きDB | #1 | 初期版DB作成済み(22対象、レビュー待ち) |
| 第2段階 機能別モジュール仕様 | #2 | 未着手 |
| 第3段階 製品仕様・実装計画 | #3 | 未着手 |

## 第1段階の成果物(正本はDB)
- 調査事実の正本: [`data/reference/`](data/reference/)(`targets.json` / `records/` / `sources/`)
- スキーマ・ID規則: [docs/reference/schema.md](docs/reference/schema.md)
- 調査対象・選定理由・方法: [docs/reference/scope.md](docs/reference/scope.md)
- 索引: [docs/reference/index.md](docs/reference/index.md)
- 機能比較表: [docs/reference/comparison.md](docs/reference/comparison.md)
- 不足・未確認一覧(#2への引継ぎ): [docs/reference/gaps.md](docs/reference/gaps.md)
- 検査結果: [docs/reference/validation-report.md](docs/reference/validation-report.md)
- スキーマ改善候補: [docs/reference/schema-improvements.md](docs/reference/schema-improvements.md)

## ツール
```
python3 tools/validate_reference.py      # DB検査(ID重複・必須項目・参照切れ等)
python3 tools/build_reference_docs.py    # 索引・比較表・不足一覧の再生成
```
