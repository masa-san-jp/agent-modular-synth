# agent-modular-synth

ブラウザおよびローカル環境で動作し、人間とエージェントが操作できるモジュラーシンセを目指すプロジェクトです。現在は調査・仕様設計の準備段階で、シンセ本体は未実装です。

## 進行状況
| 段階 | Issue | 状態 |
|---|---|---|
| 第1段階 リファレンス調査・出典付きDB | [#1](https://github.com/masa-san-jp/agent-modular-synth/issues/1) | 完了(精査済みDB+拡張DB22対象) |
| 第2段階 機能別モジュール仕様 | [#2](https://github.com/masa-san-jp/agent-modular-synth/issues/2) | 完了(共通規約+18仕様) |
| 第3段階 製品仕様・操作契約・実装計画 | [#3](https://github.com/masa-san-jp/agent-modular-synth/issues/3) | 初版作成済み(レビュー待ち) |

## 調査・設計の入口
- [リポジトリ構成案](docs/repository-structure.md)(提案。実装用の構成は設計後に決定)

### #1 リファレンスDB(正本は `references/`)
- 精査済みDB(少数・高精度、主張単位の確度): [references/index.md](references/index.md)
- 拡張DB(22対象・二次資料を含む広範囲): [references/db/docs/index.md](references/db/docs/index.md)
  - [対象範囲・選定理由](references/db/docs/scope.md) / [スキーマ・ID規則](references/db/docs/schema.md) / [機能比較表](references/db/docs/comparison.md)
  - [不足・未確認一覧(#2への引継ぎ)](references/db/docs/gaps.md) / [検査結果](references/db/docs/validation-report.md) / [スキーマ改善候補](references/db/docs/schema-improvements.md)
- 両DBの対応表: [references/db/docs/crosswalk.md](references/db/docs/crosswalk.md)

### #2 機能別モジュール仕様(正本は `specifications/modules/`)
- 入口: [specifications/modules/README.md](specifications/modules/README.md)
  - [共通規約](specifications/modules/common.md) / [カタログ](specifications/modules/catalog.md) / [追跡表](specifications/modules/traceability.md) / [設計仮定](specifications/modules/assumptions.md) / [未確認・保留](specifications/modules/open-issues.md) / [検査結果](specifications/modules/validation.md)

### #3 製品仕様・操作契約・実装計画(正本は `specifications/synthesizer/` と `plans/`)
- 入口: [specifications/synthesizer/README.md](specifications/synthesizer/README.md)
  - [要求一覧](specifications/synthesizer/requirements.md) / [製品仕様](specifications/synthesizer/product-spec.md) / [操作契約](specifications/synthesizer/operation-contract.md) / [データ契約](specifications/synthesizer/data-contract.md) / [検証計画](specifications/synthesizer/verification-plan.md) / [検査結果](specifications/synthesizer/validation.md)
  - [実装計画](plans/implementation-plan.md) / [判断記録と未決事項](plans/decisions.md) / [#2からの引継ぎの処置表](plans/handoff-from-modules.md)

## 実装(作業中)
シンセ本体は実装の途中で、18種のモジュールがすべて実装済みで、**固定のデモ用パッチをブラウザで鳴らせる**ところまである(Issue #11、#14、#16)。パッチを編集する共通コマンド処理は実装済みだが、画面とサーバーにはまだつないでいない(Issue #18)。パッチの編集、保存、MIDI、エージェント操作(共通コマンドAPI、MCP)は未実装。

```
npm install          # 開発用の依存を入れる(Node.js 22 以上)
npm run dev          # ビルドして http://127.0.0.1:47800/ で配信する。ブラウザで開き「音声開始」を押す
npm test             # ビルド、型検査、単体試験、仕様の検証例の実行と網羅の確認
npm run test:browser # 実際のブラウザ(ヘッドレスの Chromium。Playwright が必要)での確認
npm run check        # npm test に加えて、仕様文書の検査
```
- 音は「音声開始」を押すまで出ない。低い音量から始まり、出力には常時リミッターが入る。「緊急停止」で即時に無音になる。
- **出力保護の定数(既定音量 −20 dB、フェード 50 ms、リミッターのしきい値・復帰時間)は仮値**で、測定後に決める(OPEN-010)。待受ポート 47800 も仮の値。
- `src/engine/`: グラフ実行(1サンプル処理、ケーブルの1サンプル遅延)、ポート(最大16チャンネル)、乱数、共通部品、スナップショット。ブラウザのAPIに依存しない。
- `src/modules/`: モジュールの実装(仕様は `specifications/modules/`)。18種すべてを実装済み(一覧は `src/modules/registry.ts`)。仕様に記述がなく実装側で補った解釈は [docs/implementation-notes.md](docs/implementation-notes.md)。
- `src/control/`: 共通コマンド処理(パッチの正本、コマンドの検証と適用、リビジョン、履歴、権限、通知: `session.ts`)、パッチ文書の検証・移行・生成(`patch-doc.ts`)、種別の定義の一覧(`catalog.ts`)、音声とつなぐ実装(`backend.ts`)。ブラウザにもサーバーにも依存しない。契約に記述がなく補った解釈は [docs/contract-notes.md](docs/contract-notes.md)。**画面とサーバーからはまだ使っていない**(次の Issue)。
- `src/audio/`: 出力保護(`output-stage.ts`)、エンジンと出力保護をまとめた中核(`core.ts`。オフラインでも動く)、AudioWorklet(`worklet.ts`)。
- `src/web/`・`web/`: 最小の画面。`src/server/`: 127.0.0.1 だけで待ち受ける静的配信(エージェント用APIと認証は未実装)。
- `test/`: 単体試験と、仕様 §10 の検証例(`tv("TV-…")`)。`test/tv-coverage.ts` が、実装済みモジュールの全検証例が登録されているかを確認する。`test/browser/` はブラウザでの確認。
- 第三者ライブラリ: [docs/third-party-licenses.md](docs/third-party-licenses.md)

## 検査・生成ツール
```
python3 references/validate.py           # 精査済みDBの検査
python3 tools/validate_reference.py      # 拡張DBの検査(ID重複・必須項目・参照切れ等)
python3 tools/build_reference_docs.py    # 拡張DBの索引・比較表・不足一覧の再生成
python3 tools/validate_specs.py          # モジュール仕様の検査
python3 tools/build_spec_docs.py         # 仕様の追跡表・仮定一覧・保留一覧の再生成
python3 tools/validate_product_spec.py   # 製品仕様群の検査(ID参照・網羅・リンク)
```
