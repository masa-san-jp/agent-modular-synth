# agent-modular-synth

ブラウザおよびローカル環境で動作し、人間とエージェントが操作できるモジュラーシンセを目指すプロジェクトです。現在は調査・仕様設計の準備段階で、シンセ本体は未実装です。

## 進行状況
| 段階 | Issue | 状態 |
|---|---|---|
| 第1段階 リファレンス調査・出典付きDB | [#1](https://github.com/masa-san-jp/agent-modular-synth/issues/1) | 完了(精査済みDB+拡張DB22対象) |
| 第2段階 機能別モジュール仕様 | [#2](https://github.com/masa-san-jp/agent-modular-synth/issues/2) | 着手 |
| 第3段階 製品仕様・操作契約・実装計画 | [#3](https://github.com/masa-san-jp/agent-modular-synth/issues/3) | 未着手 |

## 調査・設計の入口
- [リポジトリ構成案](docs/repository-structure.md)(提案。実装用の構成は設計後に決定)

### #1 リファレンスDB(正本は `references/`)
- 精査済みDB(少数・高精度、主張単位の確度): [references/index.md](references/index.md)
- 拡張DB(22対象・二次資料を含む広範囲): [references/db/docs/index.md](references/db/docs/index.md)
  - [対象範囲・選定理由](references/db/docs/scope.md) / [スキーマ・ID規則](references/db/docs/schema.md) / [機能比較表](references/db/docs/comparison.md)
  - [不足・未確認一覧(#2への引継ぎ)](references/db/docs/gaps.md) / [検査結果](references/db/docs/validation-report.md) / [スキーマ改善候補](references/db/docs/schema-improvements.md)
- 両DBの対応表: [references/db/docs/crosswalk.md](references/db/docs/crosswalk.md)

## 検査・生成ツール
```
python3 references/validate.py           # 精査済みDBの検査
python3 tools/validate_reference.py      # 拡張DBの検査(ID重複・必須項目・参照切れ等)
python3 tools/build_reference_docs.py    # 拡張DBの索引・比較表・不足一覧の再生成
```
