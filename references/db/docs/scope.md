# 調査対象範囲・選定理由・調査方法

固定日: 2026-11-12。対象の正本は [`references/db/data/targets.json`](../data/targets.json)。

## 選定方針
- ハードのモジュラー、セミモジュラー、ソフトのモジュラー/環境を区別し、歴史的代表例と現行例の両方を含める。
- 本体だけでなく、信号規約、パッチ保存、プログラムによる制御の資料が入手できるものを優先。
- 件数の水増しはしない。途中の追加・除外は `status_note` に理由を残す。
- 技術スタックや製品の採用機能は先に固定しない(#3で決定)。

## 初期版の対象(22件)
| ID | 名称 | 種別 | 時代 | 選定理由 | 最終状態 |
|---|---|---|---|---|---|
| T-001 | Doepfer A-100(Eurorack規格と代表モジュール) | hardware_modular | current | Eurorack形式の事実上の基準。電圧規約・ゲート/トリガー仕様・基本機能モジュールの公式資料が公開されている。 | confirmed |
| T-002 | Make Noise(Maths等の代表モジュール) | hardware_modular | current | 多機能モジュールの現行例。エンベロープ/LFO/関数発生器の統合設計の参考。 | confirmed |
| T-003 | Moog Mother-32 | semi_modular | current | 現行セミモジュラーの代表。正規化接続とパッチ点の関係を比較できる。 | insufficient_sources |
| T-004 | Korg MS-20 系(MS-20 mini) | semi_modular | historical | 歴史的な代表的セミモジュラー(原機1978年)の系譜。現行再発版のマニュアルを根拠にする。 | confirmed |
| T-005 | VCV Rack | software_modular | current | ソフトのモジュラーとして電圧規約・ポリフォニー・パッチ保存・公開APIが公開されている主要例。 | confirmed |
| T-006 | Cardinal | software_modular | current | VCV Rack由来のプラグイン形式実装。ホスト統合・ライセンス構成の比較対象。 | confirmed |
| T-007 | BespokeSynth | software_modular | current | ライブコーディング/スクリプトを備えたソフトのモジュラー。プログラムによる制御の参考。 | confirmed |
| T-008 | Pure Data(Pd) | software_environment | historical | データフロー型パッチング環境の歴史的代表。パッチ保存形式と制御/信号レートの区別の参考。 | confirmed |
| T-009 | SuperCollider | software_environment | current | サーバー/クライアント分離とOSC制御により、プログラムによる制御の代表例。 | confirmed |
| T-010 | Max / MSP | software_environment | current | 商用データフロー環境の代表。信号/メッセージの区別と外部制御の公式資料が公開されている。 | confirmed |
| T-011 | Moog 大型モジュラー系(System 15/35/55、Behringer System 55) | hardware_modular | historical | 歴史的な大型モジュラーの代表系譜。原機(Moog)と再発売(Behringer)の関係を比較できる。 | confirmed |
| T-012 | Buchla 系(Buchla 100/200、TipTop Buchla 200t、Buchla 266 Classic Reissue) | hardware_modular | historical | Moogと異なる設計思想(電圧規約・ペンタ/ファンクション系)の歴史的代表系譜と現行再発売。 | confirmed |
| T-013 | ARP 系(ARP 2500、ARP 2600、Behringer 2500) | semi_modular | historical | マトリクス式パッチ(2500)とセミモジュラー(2600)の歴史的代表。再発売との関係を比較できる。 | confirmed |
| T-014 | Roland System 系(System-100m、System-700、System-500、Behringer System 100) | hardware_modular | historical | 国産モジュラーの歴史的系譜と現行のEurorack展開(System-500)・再発売の比較。 | confirmed |
| T-015 | EMS 系(VCS3、Synthi 100) | semi_modular | historical | ピンマトリクス式パッチの歴史的代表。他のパッチ方式との比較材料。 | confirmed |
| T-016 | Serge 系(Serge Modular、Random*Source Serge) | hardware_modular | historical | Serge独自の信号規約・モジュール思想の歴史的代表と現行供給。 | confirmed |
| T-017 | 現行個別モジュール(AJH MiniMod、Intellijel Morgasmatron / Korgasmatron、Behringer SPACE FX) | hardware_modular | current | 歴史的機種のモジュール単位再現・派生と現行エフェクトの設計例。 | confirmed |
| T-018 | ブラウザ型モジュラー(DreamRack、Mod Synth 0、Plinth、Patchcab、Modulator、web-synth、Eurorack-js) | software_modular | current | 本製品と同じ『ブラウザ上で動くモジュラー』の先行例。パッチグラフ、状態保存、音声エンジン(Web Audio/AudioWorklet)の設計差を比較できる。 | confirmed |
| T-019 | エージェント/MCP連携シンセ(MCP Synth Controller、SuperCollider OSC MCP、VCV Rack MCP、synthlab-mcp、osc-bridge) | software_environment | current | エージェント操作の先行例。コマンド体系、状態取得、認証・安全性、OSC/MIDIブリッジの設計を比較できる。 | confirmed |
| T-020 | Mutable Instruments(オープンソースEurorack: Plaits/Braids/Rings/Clouds/Tides/Marbles等) | hardware_modular | historical | 公開ソース・マニュアルが豊富で、現代的なデジタルモジュールのアルゴリズム・I/O規約の参考になる。ライセンス条件は個別に記録。 | confirmed |
| T-021 | Web Audio API(AudioContext/AudioWorklet、自動再生制限) | software_environment | current | ブラウザでの音声処理の制約(開始条件、レイテンシ、スレッド)の根拠資料。技術スタックの採用決定ではなく制約調査(#3で判断)。 | confirmed |
| T-022 | 外部制御規格(MIDI 1.0/2.0、OSC) | software_environment | current | MIDI/外部接続・エージェント接続の共通基盤の仕様。ノート/CC/クロックの扱いとOSCのアドレス/型体系を比較できる。 | confirmed |

状態の詳細・根拠は `targets.json` の `status_note`、未確認は [不足一覧](gaps.md)。

## 除外範囲
- **商用ソフトモジュラー(Softube Modular, Voltage Modular等)**: 公式資料の公開範囲が限られ、VCV Rack等で代表可能。後続追加候補。
- **商用ソフトモジュラー(Arturia Modular V、NI Reaktor Blocks 等)・ModularGrid等の目録サイト**: 後続追加候補。初期版ではVCV Rack・Cardinal・BespokeSynth・Pd・SC・Maxで代表。

(T-011〜T-017は2026-11-12、T-018〜T-022は2026-11-13にオーナー指示で追加。原機の一次資料が乏しい系譜は、再発売品・現行権利者の資料を根拠にし、原機自体の仕様は未確認として扱う。)

## 調査方法
1. 公式マニュアル・仕様書・公開API・ライセンス付きソースを優先して取得し、実際に読んだ範囲を出典台帳 `checked_scope` に記録。
2. 事実は自分の言葉で要約し、節/ページ/ファイルパスを `locator` に記録。原文の長文転載はしない。
3. 公式の仕様表・マニュアルは `manufacturer_doc`、製品ページの宣伝文は `advertising`、ソースコードは `licensed_source`、第三者評価は `third_party`、実測は `measurement` として区別。
4. 取得できない値は推測せず `unconfirmed` に記録。アクセス不能な資料は `link_status: unreachable`。
5. 取得はネットワーク許可ホスト内で実施。TLS検証は無効化していない。

## 既知の制約
- ソースコード・アセットは参照のみで再利用していない。ライセンス条件は各出典の `license_note` に記録。
- 一部の対象は、公式マニュアルの取得可否により確認範囲が異なる(例: T-003は製品ページの仕様表のみ)。
