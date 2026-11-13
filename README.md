# agent-modular-synth

ブラウザおよびローカル環境で動作し、人間とエージェントが操作できるモジュラーシンセを目指すプロジェクトです。現在は調査・仕様設計の準備段階で、シンセ本体は未実装です。

## 調査・設計の入口

- [統合リファレンスDB](docs/reference/index.md)（確認範囲・未確認事項を区別）
- [旧DB互換入口](references/index.md)（凍結した履歴）
- [リポジトリ構成案](docs/repository-structure.md)（提案。実装用の構成は設計後に決定）
- [#1 リファレンス調査・出典付きDB](https://github.com/masa-san-jp/agent-modular-synth/issues/1)
- [#2 機能別モジュール仕様](https://github.com/masa-san-jp/agent-modular-synth/issues/2)
- [#3 オリジナルシンセの製品仕様・操作契約・実装計画](https://github.com/masa-san-jp/agent-modular-synth/issues/3)

## リファレンスDB統合（レビュー中）

現在の調査入口は [統合索引](docs/reference/index.md)、編集正本は `data/reference/` です。
[統合記録・保留事項](docs/reference/integration.md) と [旧ID対応](data/reference/legacy-map.json) を先に確認してください。
旧 `references/` は公開済みID・URLを壊さない凍結スナップショットです。
Issue #1 の完了、#2 の機能仕様、#3 の製品仕様や実装を確定する変更ではありません。
