# agent-modular-synth

ブラウザおよびローカル環境で動作し、人間とエージェントが操作できるモジュラーシンセを目指すプロジェクトです。仕様(リファレンスDB、機能別モジュール仕様、製品仕様・操作契約)を先に作り、それに沿って実装しています。現在は、18種のモジュールと編集画面、エージェント用API、MCP アダプタまで動きます(下の「実装」)。

## 進行状況
| 段階 | Issue | 状態 |
|---|---|---|
| 第1段階 リファレンス調査・出典付きDB | [#1](https://github.com/masa-san-jp/agent-modular-synth/issues/1) | 完了(精査済みDB+拡張DB22対象) |
| 第2段階 機能別モジュール仕様 | [#2](https://github.com/masa-san-jp/agent-modular-synth/issues/2) | 完了(共通規約+18仕様) |
| 第3段階 製品仕様・操作契約・実装計画 | [#3](https://github.com/masa-san-jp/agent-modular-synth/issues/3) | 完了(仕様 v0.4。実装で補った解釈を反映済み: #24) |
| 実装 第1〜6弾(エンジン、音声、全モジュール、コマンド処理、サーバーと保存、MCP と編集画面) | #11、#14、#16、#18、#20、#22 | 完了 |
| 独立レビューと、仕様・契約の更新 | [#24](https://github.com/masa-san-jp/agent-modular-synth/issues/24) | レビュー指摘を修正(記録: [docs/review-issue24.md](docs/review-issue24.md)) |

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
18種のモジュール、音声エンジン、出力保護、共通コマンド処理、ローカルサーバーまで実装済み。**ブラウザの編集画面でパッチを組んで鳴らしながら、エージェントがローカルサーバー経由(HTTP・WebSocket・MCP)で同じパッチを操作できる**(Issue #11、#14、#16、#18、#20、#22)。**エージェントは楽譜を書いて演奏でき、人は画面から演奏への指示を送れる**(Issue #29、DEC-018)。MIDI 機器は「MIDI を接続」でつなげる(Web MIDI 対応のブラウザ)。配線を線で描く表示は未実装。

```
npm install          # 依存を入れる(Node.js 22 以上)
npm run dev          # ビルドして起動する。表示された URL(既定 http://127.0.0.1:47800/)をブラウザで開く
npm test             # ビルド、型検査、単体試験、仕様の検証例の実行と網羅の確認
npm run test:browser # 実際のブラウザ(ヘッドレスの Chromium。Playwright が必要)での端から端の確認
npm run test:ui      # 編集画面の操作の確認(同上)
npm run test:mcp-browser # MCP クライアント → アダプタ → サーバー → タブ の確認(同上)
npm run test:review-browser # 独立レビュー(#24)で見つかった不具合の再発防止の確認(同上)
npm run test:midi-browser # MIDI 機器の接続の確認(試験用の機器を使う。同上)
npm run test:score-browser # エージェントの演奏(楽譜と指示)の確認(同上)
npm run test:e2e     # 上のブラウザ試験6つをまとめて実行
npm run mcp          # MCP アダプタを stdio で起動する(通常は MCP クライアントが起動する)
npm run check        # npm test に加えて、仕様文書の検査
```
### 使い方
1. `npm run dev` を実行すると、URL と**エージェント用トークン**が表示される。
2. ブラウザで URL を開き、「音声開始」を押す(押すまで音は出ない)。「デモ用パッチを組む」を押し、画面の鍵盤を押すと鳴る。画面で、モジュールの追加・削除、パラメータの変更、ケーブルの接続・切断、取り消し、保存・読込ができる。
3. エージェント(または手元の道具)から、同じパッチを操作できる。待受は 127.0.0.1 だけで、トークンが要る。
   ```
   curl -s http://127.0.0.1:47800/api/command \
     -H "Authorization: Bearer <エージェント用トークン>" -H "Content-Type: application/json" \
     -d '{"v":1,"request_id":"1","command":"patch.get"}'
   ```
   コマンドの一覧と引数は [操作契約](specifications/synthesizer/operation-contract.md)。通知を受けるには WebSocket(`ws://127.0.0.1:47800/api/ws`、同じトークン)で接続する。
4. **MCP 対応のクライアント**から使う場合は、MCP アダプタを登録する。手順は [docs/mcp-setup.md](docs/mcp-setup.md)。サーバーは起動時にエージェント用トークンを利用者のデータ用フォルダのファイル(既定 `~/.agent-modular-synth/agent-token`、本人だけが読める権限、終了時に削除)へ書き、アダプタがそれを読む。
- 低い音量から始まり、出力には常時リミッターが入る。「緊急停止」で即時に無音になる(エージェントも実行できる。解除は人だけ)。
- エージェントは、音声の開始、緊急停止の解除、パッチファイルの削除、人が決めた上限を超える音量の設定ができない。
- **演奏**: エージェントは楽譜(時刻つきの音符の並び)を送って演奏する。演奏中に次の楽譜を送ると切れ目なく続く。画面の「演奏への指示」に書いた内容を、エージェントは次の楽譜を書くときに読む。手順は [docs/mcp-setup.md](docs/mcp-setup.md) の「演奏のしかた」。
- 編集に使えるタブは1つだけ(2つ目のタブは案内を出して操作を受け付けない)。画面は他のページの枠(iframe)には表示されない。
- 作業中のパッチはブラウザ内に自動保存され、再読込で復元される。名前を付けた保存は、サーバーの専用フォルダ(既定 `~/.agent-modular-synth/patches`、環境変数 `SYNTH_PATCH_DIR` で変更)に入る。
- **仮の値**: 出力保護の定数(既定音量 −20 dB、フェード 50 ms、リミッターのしきい値・復帰時間: OPEN-010)、待受ポート 47800、保存フォルダの既定の場所。

### 構成
- `src/engine/`: グラフ実行(1サンプル処理、ケーブルの1サンプル遅延)、ポート(最大16チャンネル)、乱数、共通部品、スナップショット。ブラウザのAPIに依存しない。
- `src/modules/`: モジュールの実装(仕様は `specifications/modules/`)。18種すべてを実装済み(一覧は `src/modules/registry.ts`)。仕様に記述がなく実装側で補った解釈は [docs/implementation-notes.md](docs/implementation-notes.md)。
- `src/control/`: 共通コマンド処理(パッチの正本、コマンドの検証と適用、リビジョン、履歴、権限、通知: `session.ts`)、保存のコマンドを含む非同期の窓口(`controller.ts`)、楽譜の予約と人からの指示(`performance.ts`)、タブ側とサーバーが共有する部品(封筒の検査と種別一覧 `envelope.ts`、保存パッチの一覧・読出し `library.ts`、入れ子の深さ `json.ts`)、パッチ文書の検証・移行・生成(`patch-doc.ts`)、種別の定義の一覧(`catalog.ts`。分類・単位・選択肢は、仕様から `tools/build_module_meta.py` で生成した `src/modules/meta.generated.ts`)、音声とつなぐ実装(`backend.ts`)。ブラウザにもサーバーにも依存しない。契約に記述がなく補った解釈は [docs/contract-notes.md](docs/contract-notes.md)。
- `src/audio/`: 出力保護(`output-stage.ts`)、AudioWorklet(`worklet.ts`。中身は試験できる形の `worklet-core.ts`)、メインスレッド側の窓口(`worklet-backend.ts`。音量・緊急停止の写しと、ワークレットとの合わせ直し)。
- `src/server/`: ローカルサーバー(`app.ts`: エージェント用API、認証、タブへの中継。`file-store.ts`: 専用フォルダへの保存)。127.0.0.1 だけで待ち受ける。
- `src/mcp/`: MCP アダプタ(stdio)。共通コマンドを1対1でツールにする薄い変換層で、ローカルサーバーの `POST /api/command` だけを呼ぶ。
- `src/web/`・`web/`: タブ側の本体と編集画面(`ui.ts`)、MIDI 機器の接続(`midi.ts`)。パッチの正本(Session)はタブにあり、サーバーは中継する。
- `test/`: 単体試験と、仕様 §10 の検証例(`tv("TV-…")`)、契約の受入例(`AX-…`、`DX-…`)。`test/browser/` は実際のブラウザでの端から端の確認。
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
