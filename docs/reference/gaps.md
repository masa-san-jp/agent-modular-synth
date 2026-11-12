# 不足・未確認一覧と次段への引継ぎ

自動生成。#2(機能別仕様)が調査のやり直しなしに使える範囲と、保留すべき範囲を判断するための一覧。

## 対象ごとの状態

| 対象 | 状態 | 備考 |
|---|---|---|
| T-001 Doepfer A-100(Eurorack規格と代表モジュール) | 確認済み | doepfer.de のA-100概要・Technical Details・Construction Details と代表8件(A-110-1,A-120,A-140-1,A-145-1,A-138s,A-160-1,A-190-3)の公式説明ページを確認。各モジュールのPDFマニュアルは未取得で、パラメータ範囲の一部は未確認。 |
| T-002 Make Noise(Maths等の代表モジュール) | 確認済み | makenoisemusic.com の製品ページと makenoise-manuals.com のPDFマニュアル(Maths、Wogglebug、Mimeophon)を確認。ポート電圧と主要仕様は確認済み。つまみの数値範囲・MIDI系モジュール・メーカー全体の規約は未確認。指定のmakenoise.comは別組織のサイトで不採用。 |
| T-003 Moog Mother-32 | 資料不足 | 公式ユーザーマニュアルPDFを取得できず(ダウンロード一覧はクライアント描画、PDFホストはプロキシで拒否)。moogmusic.com製品ページのSpecs表(パッチベイ32点、正規化、32ステップ/64シーケンス、MIDI/アサイナブル出力)のみ確認。電圧・ゲート規約、パッチ点名、サウンド保存の有無は未確認。 |
| T-004 Korg MS-20 系(MS-20 mini) | 確認済み | korg.comの公式マニュアル(原機オーナーズマニュアル復刻、MS-20 miniオーナーズマニュアル、MIDI Implementation、Patch Book)を確認。原機1978年との関係はminiマニュアルの記述の範囲のみ。miniのパッチパネルのジャック数・電圧表の再掲、音色メモリの明示的有無は未確認。 |
| T-005 VCV Rack | 確認済み | 確認済み。公式マニュアル(電圧規約・ポリフォニー・Core・メニュー)とGitHub v2のソースを読んだ。OSC等の外部制御は本体に確認できず未確認項目に記録。 |
| T-006 Cardinal | 確認済み | 確認済み(一部)。README/LICENSES/FAQ/DIFFERENCESを読んだ。GitHub APIは接続拒否のためバージョン未確認。パッチ保存形式とOSCは未確認。 |
| T-007 BespokeSynth | 確認済み | 確認済み(ソース中心)。公式ドキュメントサイト(bespokesynth.com/docs)は接続拒否のため未取得。README・GPLソース(raw.githubusercontent.com)で確認。モジュール別の公式パラメータ記述は未確認。 |
| T-008 Pure Data(Pd) | 確認済み | 一次情報はGitHub(pure-data/pure-data)のマニュアル/ヘルプ/ソースで確認。msp.ucsd.eduはアクセス不能(unreachable)でpuredata.infoは根拠未使用。FUDI厳密形式・.pd完全文法・OSC送出側は未確認としてunconfirmedに記録。 |
| T-009 SuperCollider | 確認済み | 一次情報は doc.sccode.org(3.14.0ヘルプ)と公式GitHubで確認。Pdほか他ツールとの比較に必要なクライアント/サーバ分離・OSC・ノード順序・SynthDef形式を取得。電圧規約相当や状態保存機構は未確認としてunconfirmedに記録。 |
| T-010 Max / MSP | 確認済み | 一次情報は docs.cycling74.com のユーザガイド/リファレンスで確認。.maxpat内部スキーマ・既定OSCポート・利用条件(/legalは404)は未確認としてunconfirmedに記録。gen~/RNBOは範囲限定。 |

## 未確認項目

### T-001 Doepfer A-100(Eurorack規格と代表モジュール)

| 対象エンティティ | 不足項目 | 試した資料 | 仕様化への影響 |
|---|---|---|---|
| REF-001-001 | A-100の電子的なパッチ保存機能の有無 | SRC-001-01, SRC-001-02 | 保存機能がないと仮定して良いか未確定。DAW等の保存要件は別途決める必要がある。 |
| REF-001-002 | ゲート/トリガのパルス幅・立ち上がり時間の最小要件 | SRC-001-02 | トリガ検出の最小パルス幅をモデル化できない。 |
| REF-001-005 | A-110-1のCV入力感度・Tune/Range・パルス幅の数値範囲 | SRC-001-04 | パラメータ範囲はA-110_man.pdf未取得のため未確定。 |
| REF-001-006 | A-120のカットオフ範囲とCV感度 | SRC-001-05 | フィルタのパラメータ範囲を仕様化できない。 |
| REF-001-004 | A-190-3の英語マニュアル(ベンド範囲等の詳細) | SRC-001-10 | MIDI対応詳細は説明ページのみに基づく。 |
| (対象全体) | 各モジュールのPDFマニュアル(A110_man.pdf等) | SRC-001-04 | ページ記載を超えるポート詳細は未確認。 |

### T-002 Make Noise(Maths等の代表モジュール)

| 対象エンティティ | 不足項目 | 試した資料 | 仕様化への影響 |
|---|---|---|---|
| REF-002-002 | Mathsのつまみの時間範囲数値(Rise/Fall時間)と各Attenuverterの利得範囲 | SRC-002-06 | 時間範囲は概要上の『約25分〜1kHz』のみ。つまみのマッピングは未確認。 |
| REF-002-003 | Wogglebugの各ポートの厳密な入力電圧と各つまみの範囲 | SRC-002-07 | Heart入力の許容範囲は10Vpp max記載のみ(符号付き範囲は未確認)。 |
| REF-002-004 | Mimeophonの音声入出力の符号付き範囲(10Vppのみ記載) | SRC-002-08 | 音声範囲は仮定せず約±5Vを10Vppの便宜表現としている点に注意。 |
| REF-002-001 | MIDI Inlet等Make Noiseのコントロール系モジュールのマニュアル | SRC-002-02 | control_interfaceエンティティを作っていない。 |
| REF-002-001 | Make Noise全体としての電圧規約(1V/oct明記等)の公式な規定文書 | SRC-002-06, SRC-002-07, SRC-002-08 | 3モジュールの記載から傾向を述べるに留まる。 |
| REF-002-001 | 各モジュールのバージョン・マニュアル版番号 | SRC-002-06, SRC-002-07, SRC-002-08 | doc_versionをunknownとしている。 |
| (対象全体) | makenoise.com は調査対象と別組織のサイトだった(経緯記録) | SRC-002-01 | 出典として採用しない。 |

### T-003 Moog Mother-32

| 対象エンティティ | 不足項目 | 試した資料 | 仕様化への影響 |
|---|---|---|---|
| REF-003-001 | User manual contents (panel layout, jack list, normalling details, voltages) | SRC-003-02, SRC-003-01 | Patch-point names, voltage and gate levels, and normalled paths beyond the spec table are unknown. |
| REF-003-002 | Gate/trigger voltage thresholds, CV ranges per jack | SRC-003-01, SRC-003-02 | Signal standard cannot be fully specified. |
| REF-003-009 | Whether panel/patch settings can be saved; sequence retention at power-off | SRC-003-01, SRC-003-02 | State save model unknown for sound settings. |
| REF-003-007 | Sequencer detail (ratchet, gate length, accent, hold behaviour) | SRC-003-01, SRC-003-02 | Only capacity and panel controls are specified. |
| REF-003-010 | MIDI channel selection, CC mappings beyond assign list | SRC-003-01, SRC-003-02 | MIDI spec limited to the product page summary. |

### T-004 Korg MS-20 系(MS-20 mini)

| 対象エンティティ | 不足項目 | 試した資料 | 仕様化への影響 |
|---|---|---|---|
| REF-004-001 | Number and layout of patch-panel jacks on the mini, and whether every printed voltage matches the original | SRC-004-02, SRC-004-01 | Port list for the mini is taken from the original manual; verify against the mini panel before implementing. |
| REF-004-002 | Original MS-20 release date in the original manual itself | SRC-004-01 | Only the mini manual's 1978 statement is available as an official source. |
| REF-004-010 | Whether the mini has any sound or patch memory (explicit statement) | SRC-004-02, SRC-004-01, SRC-004-04 | Treated as no memory (manual recall) but not explicitly stated. |
| REF-004-004 | Master Tune range (+/-2 semitones vs +/-1/2 octave) | SRC-004-01 | Do not hard-code tuning range from this source alone. |
| REF-004-003 | Meaning of '20CT/V' for filter cutoff CV; exact trigger thresholds | SRC-004-01 | Filter CV scaling cannot be specified numerically. |
| REF-004-001 | MS-20 mini Setting Examples PDF and setting charts | SRC-004-01 | Example sound settings not captured; image-only PDFs not reviewed. |
| REF-004-011 | MIDI implementation chart table in the mini manual (text extraction garbled) | SRC-004-02, SRC-004-03 | MIDI behaviour taken from the manual's text and the MIDI Implementation file only. |

### T-005 VCV Rack

| 対象エンティティ | 不足項目 | 試した資料 | 仕様化への影響 |
|---|---|---|---|
| REF-005-009 | patch.jsonのモジュール/ケーブルの詳細スキーマ(キー名・型) | SRC-005-04 | 本DBでは保存形式の概要のみ。自前形式設計の参考範囲では十分だが、互換読込を目指すなら追加調査が必要。 |
| REF-005-010 | OSCによる外部制御(Core/Fundamentalに該当モジュールが見当たらない。サードパーティ前提の可能性) | SRC-005-01, SRC-005-05 | 外部制御をOSC前提で設計する場合、Rack本体の根拠がない。MIDI/APIを根拠にする。 |
| REF-005-010 | スクリプト/リモートAPI(WebSocket等)の公式機能の有無 | SRC-005-01, SRC-005-04 | プログラム制御はC++プラグイン経由に限られる可能性。確証なし。 |
| (対象全体) | Rack Pro/VCV+価格・配布条件の詳細(仕様化に不要のため未調査) | SRC-005-01 | 影響小。 |
| REF-005-005 | VCF各ノブの数値範囲・既定値 | SRC-005-02 | パラメータrangeは未記録。実装時に別途調査が必要。 |
| REF-005-004 | VCOの周波数ノブの絶対範囲(Hz)とPWM範囲 | SRC-005-02 | 範囲を数値化できない。 |

### T-006 Cardinal

| 対象エンティティ | 不足項目 | 試した資料 | 仕様化への影響 |
|---|---|---|---|
| REF-006-002 | Cardinal固有の電圧規約差異の有無(Rack規約との差) | SRC-006-01, SRC-006-02, SRC-006-03 | 規約をRackと同一とみなす根拠は間接的。T-005の規約を共通扱いにする場合、要注意。 |
| REF-006-007 | ホストプロジェクト内のパッチ状態保存形式(.vcvとの互換含む) | SRC-006-01, SRC-006-02, SRC-006-03 | DAW保存時のシリアライズ形式が不明。パッチ形式の互換性は主張できない。 |
| REF-006-008 | OSCやスクリプトによる外部制御の有無 | SRC-006-01, SRC-006-03 | プログラム制御は主にホスト経由と推定されるが、確証なし。 |
| REF-006-001 | 最新リリースのバージョン番号(GitHub APIへの接続が拒否された) | SRC-006-01, SRC-006-04 | versionをnull扱い。 |

### T-007 BespokeSynth

| 対象エンティティ | 不足項目 | 試した資料 | 仕様化への影響 |
|---|---|---|---|
| REF-007-002 | 音声信号の振幅の規約(±1正規化などの数値範囲) | SRC-007-03, SRC-007-04, SRC-007-05, SRC-007-06 | 音声レベルは本DBで未確認。ソフトの内部は浮動小数と推定されるが記録しない。 |
| REF-007-002 | CV相当のモジュレータ値の単位・範囲の一般則(対象スライダの最小/最大に依存するとみられる) | SRC-007-08 | 電圧規約はなく対象範囲正規化とみなす案は仮説。 |
| REF-007-005 | ステップ数・各ステップのパラメータ範囲 | SRC-007-11 | 数値範囲は未記録。 |
| REF-007-006 | 確率パラメータの範囲・既定値 | SRC-007-03 | 詳細を読んでいない。 |
| REF-007-009 | 保存状態リビジョン番号(kSaveStateRev)の値と変遷 | SRC-007-15 | 互換読込を設計する場合に必要。 |
| REF-007-009 | レイアウトJSONの各モジュールのキー定義 | SRC-007-15 | 自前形式との相互運用には不十分。 |
| (対象全体) | 公式ドキュメント(bespokesynth.com/docs)の内容(接続が拒否された) | SRC-007-17 | モジュール別の公式パラメータ記述を確認できていない。パラメータは一部ソースから補完。 |
| (対象全体) | サンプルレート・音声バッファの標準値 | SRC-007-05 | 本DBでは数値化しない。 |
| REF-007-001 | リリースバージョン | SRC-007-01, SRC-007-17 | versionをnullにしている。 |

### T-008 Pure Data(Pd)

| 対象エンティティ | 不足項目 | 試した資料 | 仕様化への影響 |
|---|---|---|---|
| REF-008-003 | パッチファイル形式の正式な文法定義(全#Xコマンド、座標・フォント指定の意味) | SRC-008-03, SRC-008-05 | 保存形式をインポート/エクスポートする仕様化では、観察できた行種別のみ実装根拠にでき、完全な文法は別途確認が要る |
| REF-008-004 | FUDIメッセージの厳密なワイヤ形式(区切り・エスケープ) | SRC-008-04, SRC-008-05 | 外部制御クライアントを実装する際、メッセージ終端規則を別資料で確認する必要がある |
| REF-008-004 | [oscformat]の仕様とOSC送出側の扱い | SRC-008-04 | OSC出力経路の仕様化にはoscformatの資料確認が必要 |
| REF-008-004 | netsend/netreceiveのヘルプパッチ(ポート、プロトコル既定値の公式説明) | SRC-008-03, SRC-008-04 | ヘルプパッチのURLが取得できず、引数仕様はソースのみから部分的にしか確認できていない |
| REF-008-005 | 周波数入力の許容範囲(下限・上限) | SRC-008-03 | 周波数入力の範囲検証は仕様側で決める必要がある |
| REF-008-006 | カットオフの有効範囲と極値での挙動 | SRC-008-03 | フィルタ係数の安全域を仕様化できない |
| REF-008-007 | ランプ時間・目標値の許容範囲と最大リスト長 | SRC-008-03 | エンベロープ生成のパラメータ範囲を仕様化できない |
| REF-008-008 | 最小間隔や最大精度 | SRC-008-03 | クロック精度の下限を仕様化できない |
| REF-008-009 | 乱数アルゴリズムの詳細 | SRC-008-03 | 再現性は同一実装内に限られ、他実装との一致は仕様化できない |
| (対象全体) | msp.ucsd.edu の Pd ドキュメント(マニュアル原本) | SRC-008-05 | アクセス不能のためGitHub上の同梱マニュアルで代替。内容差異は未確認 |

### T-009 SuperCollider

| 対象エンティティ | 不足項目 | 試した資料 | 仕様化への影響 |
|---|---|---|---|
| REF-009-004 | 音声レートのサンプル値範囲(正規化-1〜1の規約) | SRC-009-03, SRC-009-05 | 出力振幅の標準範囲を仕様化する際に別資料で確認が要る |
| REF-009-004 | モジュラー的な電圧規約の有無(ヘルプ上は未確認) | SRC-009-05 | ハードウェア的な電圧対応は定義されない可能性があるが断定できない |
| REF-009-005 | SynthDef書き出しAPI(writeDefFile)の詳細と既定ディレクトリ | SRC-009-05 | 保存先やファイル配置を仕様化する際に別途確認が要る |
| REF-009-005 | 実行中ノードの状態(コントロール値)を保存・復元する標準機構 | SRC-009-02, SRC-009-03 | プリセット/状態保存の仕様化に影響 |
| REF-009-006 | OSCメッセージのワイヤ形式の詳細(型タグ)とbundle構造 | SRC-009-03 | 独自クライアント実装時にOSC仕様側での確認が要る |
| REF-009-008 | 出力振幅の標準範囲(mul=1時) | SRC-009-05 | 出力レンジをポートへ記載できない |
| REF-009-009 | カットオフの有効範囲(上限・ナイキスト関連) | SRC-009-05 | 周波数入力の検証範囲を決められない |
| REF-009-010 | gate/出力の電圧相当レンジ | SRC-009-05 | CV範囲を仕様に書けない |
| REF-009-012 | 乱数生成アルゴリズムとシード制御 | SRC-009-05 | 再現性の仕様化に影響 |
| (対象全体) | supernova(代替サーバ)固有の挙動 | SRC-009-04, SRC-009-10 | 並列グループ以外のサーバ差異は未確認 |

### T-010 Max / MSP

| 対象エンティティ | 不足項目 | 試した資料 | 仕様化への影響 |
|---|---|---|---|
| REF-010-001 | Max本体の正確なバージョン(ドキュメントは現行表記のみ) | SRC-010-01, SRC-010-10 | 版固有の挙動差を仕様化できない |
| REF-010-001 | 利用条件(商用ソフトの出力/ドキュメント利用規約) | SRC-010-13 | 仕様転記の可否判断に影響。本DBは要約のみ記録 |
| REF-010-002 | 信号の共通値域規約と信号ベクタ長の既定値 | SRC-010-05, SRC-010-10 | 信号範囲・ブロック長の仕様化に影響 |
| REF-010-003 | .maxpat内部のJSONスキーマ(キー名・座標・接続の記述) | SRC-010-06, SRC-010-07 | パッチ形式を相互運用する場合、実ファイルまたは別資料の確認が必須 |
| REF-010-004 | OSCアドレスの既定ポート・内蔵UDPサーバの既定ポート | SRC-010-08 | 外部制御の既定接続設定を仕様化できない |
| REF-010-004 | 外部プロセスからMaxパッチを起動/操作するAPIの全体像(Node for Max, js等は範囲外) | SRC-010-08 | プログラム制御の完全な比較には追加調査が必要 |
| REF-010-005 | 出力振幅範囲と周波数の有効範囲 | SRC-010-10 | ポート範囲を記載できない |
| REF-010-006 | カットオフ有効範囲と実際のフィルタ形式(次数) | SRC-010-10 | フィルタ特性の仕様化に影響 |
| REF-010-007 | 出力値域と最小ランプ時間 | SRC-010-10 | エンベロープ範囲の仕様化に影響 |
| REF-010-008 | 最大精度・ジッタ | SRC-010-10, SRC-010-04 | クロック精度を仕様化できない |
| REF-010-011 | Gen/RNBOの個別演算子と書き出しコードのライセンス条件(範囲外) | SRC-010-09, SRC-010-13 | gen~/RNBOの利用範囲を限定した調査にとどまる |

## アクセス不能だった資料

| 出典ID | 資料 | URL |
|---|---|---|
| SRC-003-02 | Mother-32 User Manual / Quickstart (Moog downloads listing) | https://www.moogmusic.com/downloads/?product=Mother 32&type=User Manual |
| SRC-006-04 | GitHub API releases/latest (DISTRHO/Cardinal) | https://api.github.com/repos/DISTRHO/Cardinal/releases/latest |
| SRC-007-17 | BespokeSynth 公式ドキュメント | https://www.bespokesynth.com/docs/ |
| SRC-008-05 | Pd Documentation(msp.ucsd.edu) | https://msp.ucsd.edu/Pd_documentation/index.htm |
| SRC-010-13 | Legal / 利用条件ページ | https://docs.cycling74.com/legal |
