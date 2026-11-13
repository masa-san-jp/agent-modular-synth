# 機能別モジュール仕様(#2)

製品名に依存しない、モジュール挙動の正本。リファレンス(#1: [`references/`](../../references/index.md)、拡張DB [`references/db/`](../../references/db/docs/index.md))を根拠に、**入力 → 状態更新 → 出力**で再現可能な形で記述する。原機の完全な音響再現は保証しない(機能再現が対象)。

| 文書 | 役割 |
|---|---|
| [common.md](common.md) | 共通の信号・接続・時間・状態規約(COM-01〜17)。各仕様の前提 |
| [catalog.md](catalog.md) | 機能分類・対象一覧・保留/対象外とその理由 |
| [_template.md](_template.md) | 仕様の節構成(11節) |
| [traceability.md](traceability.md) | 仕様ID → リファレンスID → 出典・節(自動生成) |
| [assumptions.md](assumptions.md) | 設計仮定[A]・抽象化[X]の一覧(自動生成) |
| [open-issues.md](open-issues.md) | 未確認・保留事項(#3への引継ぎ、自動生成) |
| [validation.md](validation.md) | 検査結果と整合レビュー |

## モジュール仕様
| 仕様ID | 名称 | 検証例数 |
|---|---|---|
| [MOD-AMP-001](MOD-AMP-001.md) | VCA(電圧制御アンプ) | 10 |
| [MOD-CLK-001](MOD-CLK-001.md) | クロック | 14 |
| [MOD-CLK-002](MOD-CLK-002.md) | クロック分周 | 14 |
| [MOD-DLY-001](MOD-DLY-001.md) | ディレイ | 13 |
| [MOD-ENV-001](MOD-ENV-001.md) | ADSRエンベロープ | 18 |
| [MOD-FLT-001](MOD-FLT-001.md) | ローパスフィルタ(ラダー系) | 11 |
| [MOD-FNC-001](MOD-FNC-001.md) | スルー/関数発生器 | 11 |
| [MOD-IO-001](MOD-IO-001.md) | オーディオ出力 | 11 |
| [MOD-IO-002](MOD-IO-002.md) | MIDI-CV | 14 |
| [MOD-IO-003](MOD-IO-003.md) | メーター/スコープ | 13 |
| [MOD-LFO-001](MOD-LFO-001.md) | LFO(低周波オシレータ) | 11 |
| [MOD-LGC-001](MOD-LGC-001.md) | 論理・比較 | 10 |
| [MOD-MIX-001](MOD-MIX-001.md) | ミキサー | 8 |
| [MOD-NSE-001](MOD-NSE-001.md) | ノイズ源(白色ノイズ) | 11 |
| [MOD-OSC-001](MOD-OSC-001.md) | VCO(電圧制御オシレータ) | 11 |
| [MOD-RND-001](MOD-RND-001.md) | サンプル&ホールド/ランダム | 10 |
| [MOD-SEQ-001](MOD-SEQ-001.md) | ステップシーケンサ | 14 |
| [MOD-UTL-001](MOD-UTL-001.md) | アッテヌバータ/オフセット | 10 |

## ツール
```
python3 tools/validate_specs.py       # 仕様の検査(ID・必須節・表の空欄・参照切れ・検証例の網羅・カタログ整合)
python3 tools/build_spec_docs.py      # 追跡表・仮定一覧・保留一覧の再生成
```
