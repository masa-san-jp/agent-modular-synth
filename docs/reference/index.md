# リファレンスDB 索引

自動生成(`tools/build_reference_docs.py`)。事実の正本は `data/reference/`。本書はDBへの入口で、事実本文を複製しない。

## 対象一覧

| 対象ID | 名称 | 種別 | 時代 | 状態 | エンティティ | 事実 | 出典 | 未確認 | DB |
|---|---|---|---|---|---|---|---|---|---|
| T-001 | Doepfer A-100(Eurorack規格と代表モジュール) | ハード モジュラー | 現行 | 確認済み | 10 | 36 | 10 | 6 | [records](../../data/reference/records/T-001.json) / [sources](../../data/reference/sources/T-001.json) |
| T-002 | Make Noise(Maths等の代表モジュール) | ハード モジュラー | 現行 | 確認済み | 6 | 32 | 8 | 7 | [records](../../data/reference/records/T-002.json) / [sources](../../data/reference/sources/T-002.json) |
| T-003 | Moog Mother-32 | セミモジュラー | 現行 | 資料不足 | 10 | 25 | 2 | 5 | [records](../../data/reference/records/T-003.json) / [sources](../../data/reference/sources/T-003.json) |
| T-004 | Korg MS-20 系(MS-20 mini) | セミモジュラー | 歴史的 | 確認済み | 11 | 51 | 4 | 7 | [records](../../data/reference/records/T-004.json) / [sources](../../data/reference/sources/T-004.json) |
| T-005 | VCV Rack | ソフト モジュラー | 現行 | 確認済み | 10 | 42 | 5 | 6 | [records](../../data/reference/records/T-005.json) / [sources](../../data/reference/sources/T-005.json) |
| T-006 | Cardinal | ソフト モジュラー | 現行 | 確認済み | 8 | 19 | 4 | 4 | [records](../../data/reference/records/T-006.json) / [sources](../../data/reference/sources/T-006.json) |
| T-007 | BespokeSynth | ソフト モジュラー | 現行 | 確認済み | 10 | 26 | 17 | 9 | [records](../../data/reference/records/T-007.json) / [sources](../../data/reference/sources/T-007.json) |
| T-008 | Pure Data(Pd) | ソフト 環境 | 歴史的 | 確認済み | 9 | 40 | 7 | 10 | [records](../../data/reference/records/T-008.json) / [sources](../../data/reference/sources/T-008.json) |
| T-009 | SuperCollider | ソフト 環境 | 現行 | 確認済み | 13 | 47 | 11 | 10 | [records](../../data/reference/records/T-009.json) / [sources](../../data/reference/sources/T-009.json) |
| T-010 | Max / MSP | ソフト 環境 | 現行 | 確認済み | 11 | 36 | 14 | 11 | [records](../../data/reference/records/T-010.json) / [sources](../../data/reference/sources/T-010.json) |

## エンティティ索引

### T-001 Doepfer A-100(Eurorack規格と代表モジュール)

選定理由: Eurorack形式の事実上の基準。電圧規約・ゲート/トリガー仕様・基本機能モジュールの公式資料が公開されている。

| ID | 種別 | 名称 | 機能カテゴリ | 事実数 |
|---|---|---|---|---|
| REF-001-001 | system | Doepfer A-100 | system | 4 |
| REF-001-002 | signal_standard | A-100 信号・電圧規約 | 入出力・ユーティリティ | 6 |
| REF-001-003 | patch_storage | A-100 パッチ保存(ハードウェア) | system | 1 |
| REF-001-004 | control_interface | Doepfer A-190-3 USB/MIDI-to-CV/Gate | 入出力・ユーティリティ | 3 |
| REF-001-005 | module | A-110-1 Standard VCO | 発振 | 6 |
| REF-001-006 | module | A-120 24dB Low Pass (Transistor Ladder) | フィルタ | 2 |
| REF-001-007 | module | A-140-1 ADSR Envelope Generator | エンベロープ | 4 |
| REF-001-008 | module | A-145-1 Low Frequency Oscillator | LFO | 4 |
| REF-001-009 | module | A-138s Mini Stereo Mixer | 増幅・ミックス | 3 |
| REF-001-010 | module | A-160-1 Clock/Trigger Divider | クロック・シーケンス | 3 |

### T-002 Make Noise(Maths等の代表モジュール)

選定理由: 多機能モジュールの現行例。エンベロープ/LFO/関数発生器の統合設計の参考。

| ID | 種別 | 名称 | 機能カテゴリ | 事実数 |
|---|---|---|---|---|
| REF-002-001 | system | Make Noise(Eurorackモジュール群) | system | 3 |
| REF-002-002 | module | Maths | その他変調 | 12 |
| REF-002-003 | module | Wogglebug | ランダム・論理 | 7 |
| REF-002-004 | module | Mimeophon | 時間系 | 7 |
| REF-002-005 | signal_standard | Make Noise モジュールの信号レベル(マニュアル記載) | 入出力・ユーティリティ | 2 |
| REF-002-006 | patch_storage | Make Noise パッチ保存(3モジュールのマニュアル範囲) | system | 1 |

### T-003 Moog Mother-32

選定理由: 現行セミモジュラーの代表。正規化接続とパッチ点の関係を比較できる。

| ID | 種別 | 名称 | 機能カテゴリ | 事実数 |
|---|---|---|---|---|
| REF-003-001 | system | Mother-32 | system | 7 |
| REF-003-002 | signal_standard | Mother-32 CV/gate/audio conventions | 入出力・ユーティリティ | 4 |
| REF-003-003 | module | VCO | 発振 | 2 |
| REF-003-004 | module | VCF | フィルタ | 1 |
| REF-003-005 | module | Envelope (EG) | エンベロープ | 1 |
| REF-003-006 | module | LFO | LFO | 1 |
| REF-003-007 | module | 32-step sequencer | クロック・シーケンス | 4 |
| REF-003-008 | module | Voltage controlled mixer | 増幅・ミックス | 1 |
| REF-003-009 | patch_storage | Mother-32 sequence memory | クロック・シーケンス | 2 |
| REF-003-010 | control_interface | Mother-32 MIDI and assignable output | 入出力・ユーティリティ | 2 |

### T-004 Korg MS-20 系(MS-20 mini)

選定理由: 歴史的な代表的セミモジュラー(原機1978年)の系譜。現行再発版のマニュアルを根拠にする。

| ID | 種別 | 名称 | 機能カテゴリ | 事実数 |
|---|---|---|---|---|
| REF-004-001 | system | MS-20 mini | system | 7 |
| REF-004-002 | system | MS-20 (original) | system | 9 |
| REF-004-003 | signal_standard | MS-20 patch panel voltage conventions | 入出力・ユーティリティ | 9 |
| REF-004-004 | module | VCO 1 / VCO 2 | 発振 | 5 |
| REF-004-005 | module | VCHPF + VCLPF | フィルタ | 3 |
| REF-004-006 | module | Envelope Generator 2 (EG-2) | エンベロープ | 3 |
| REF-004-007 | module | Modulation Generator (MG) | LFO | 2 |
| REF-004-008 | module | External Signal Processor (ESP) | 入出力・ユーティリティ | 4 |
| REF-004-009 | module | Sample and Hold (S/H) | ランダム・論理 | 2 |
| REF-004-010 | patch_storage | MS-20 mini sound recall (charts and patch book) | system | 3 |
| REF-004-011 | control_interface | MS-20 mini MIDI IN / USB MIDI | 入出力・ユーティリティ | 4 |

### T-005 VCV Rack

選定理由: ソフトのモジュラーとして電圧規約・ポリフォニー・パッチ保存・公開APIが公開されている主要例。

| ID | 種別 | 名称 | 機能カテゴリ | 事実数 |
|---|---|---|---|---|
| REF-005-001 | system | VCV Rack (Rack 2, Free) | system | 7 |
| REF-005-002 | signal_standard | VCV Rack 電圧規約 | system | 8 |
| REF-005-003 | signal_standard | VCV Rack ポリフォニックケーブル | ルーティング | 6 |
| REF-005-004 | module | VCV VCO | 発振 | 5 |
| REF-005-005 | module | VCV VCF | フィルタ | 2 |
| REF-005-006 | module | VCV ADSR EG | エンベロープ | 1 |
| REF-005-007 | module | VCV Noise | ノイズ | 2 |
| REF-005-008 | module | MIDI-CV (Core) | 入出力・ユーティリティ | 3 |
| REF-005-009 | patch_storage | VCV Rack パッチ保存(.vcv) | system | 3 |
| REF-005-010 | control_interface | VCV Rack 外部制御(MIDI/ヘッドレス/プラグインAPI) | 入出力・ユーティリティ | 5 |

### T-006 Cardinal

選定理由: VCV Rack由来のプラグイン形式実装。ホスト統合・ライセンス構成の比較対象。

| ID | 種別 | 名称 | 機能カテゴリ | 事実数 |
|---|---|---|---|---|
| REF-006-001 | system | Cardinal | system | 9 |
| REF-006-002 | signal_standard | Cardinal 信号規約(Rack由来) | system | 1 |
| REF-006-003 | module | Host Parameters | 入出力・ユーティリティ | 1 |
| REF-006-004 | module | Host Time | クロック・シーケンス | 1 |
| REF-006-005 | module | Audio to CV Pitch | 入出力・ユーティリティ | 1 |
| REF-006-006 | module | Carla Plugin Host / Ildaeil Host | ルーティング | 1 |
| REF-006-007 | patch_storage | Cardinal パッチ保存 | system | 2 |
| REF-006-008 | control_interface | Cardinal ホスト統合/MIDI/CVポート | 入出力・ユーティリティ | 3 |

### T-007 BespokeSynth

選定理由: ライブコーディング/スクリプトを備えたソフトのモジュラー。プログラムによる制御の参考。

| ID | 種別 | 名称 | 機能カテゴリ | 事実数 |
|---|---|---|---|---|
| REF-007-001 | system | BespokeSynth | system | 6 |
| REF-007-002 | signal_standard | BespokeSynth 信号の種類(音声・ノート・パルス・モジュレータ) | system | 3 |
| REF-007-003 | module | SingleOscillator (oscillator) | 発振 | 2 |
| REF-007-004 | module | EnvelopeModulator (envelope) | エンベロープ | 2 |
| REF-007-005 | module | NoteStepSequencer (notesequencer) | クロック・シーケンス | 1 |
| REF-007-006 | module | PulseChance (pulsechance) | ランダム・論理 | 1 |
| REF-007-007 | module | OSCOutput (oscoutput) | 入出力・ユーティリティ | 1 |
| REF-007-008 | module | ScriptModule (script) | other | 4 |
| REF-007-009 | patch_storage | BespokeSynth ステート保存(.bsk)とレイアウト | system | 3 |
| REF-007-010 | control_interface | BespokeSynth 外部制御(MIDI/OSC/Pythonスクリプト) | 入出力・ユーティリティ | 3 |

### T-008 Pure Data(Pd)

選定理由: データフロー型パッチング環境の歴史的代表。パッチ保存形式と制御/信号レートの区別の参考。

| ID | 種別 | 名称 | 機能カテゴリ | 事実数 |
|---|---|---|---|---|
| REF-008-001 | system | Pure Data (Pd) | system | 7 |
| REF-008-002 | signal_standard | Pd メッセージ/音声信号規約 | system | 9 |
| REF-008-003 | patch_storage | Pd パッチファイル(.pd) | 入出力・ユーティリティ | 3 |
| REF-008-004 | control_interface | Pd 外部制御(FUDI/netsend/pdsend/起動フラグ/OSC解析) | 入出力・ユーティリティ | 5 |
| REF-008-005 | module | osc~ | 発振 | 4 |
| REF-008-006 | module | lop~ | フィルタ | 3 |
| REF-008-007 | module | line~ | エンベロープ | 3 |
| REF-008-008 | module | metro | クロック・シーケンス | 3 |
| REF-008-009 | module | random | ランダム・論理 | 3 |

### T-009 SuperCollider

選定理由: サーバー/クライアント分離とOSC制御により、プログラムによる制御の代表例。

| ID | 種別 | 名称 | 機能カテゴリ | 事実数 |
|---|---|---|---|---|
| REF-009-001 | system | SuperCollider | system | 6 |
| REF-009-002 | system | scsynth (Synth Server) | system | 3 |
| REF-009-003 | system | sclang (言語インタプリタ/クライアント) | system | 3 |
| REF-009-004 | signal_standard | SuperCollider 信号・バス・ノード規約 | ルーティング | 11 |
| REF-009-005 | patch_storage | SynthDef ファイル(.scsyndef, SCgf形式) | 入出力・ユーティリティ | 4 |
| REF-009-006 | control_interface | scsynth OSCコマンド | 入出力・ユーティリティ | 6 |
| REF-009-007 | control_interface | 外部アプリとのOSC通信(sclang側) | 入出力・ユーティリティ | 2 |
| REF-009-008 | module | SinOsc | 発振 | 2 |
| REF-009-009 | module | LPF | フィルタ | 3 |
| REF-009-010 | module | EnvGen | エンベロープ | 3 |
| REF-009-011 | module | Impulse | クロック・シーケンス | 2 |
| REF-009-012 | module | Dust | ランダム・論理 | 1 |
| REF-009-013 | module | Out | 入出力・ユーティリティ | 1 |

### T-010 Max / MSP

選定理由: 商用データフロー環境の代表。信号/メッセージの区別と外部制御の公式資料が公開されている。

| ID | 種別 | 名称 | 機能カテゴリ | 事実数 |
|---|---|---|---|---|
| REF-010-001 | system | Max / MSP | system | 7 |
| REF-010-002 | signal_standard | Max メッセージ/MSP信号規約 | system | 6 |
| REF-010-003 | patch_storage | Max パッチ(.maxpat)と状態保存 | 入出力・ユーティリティ | 4 |
| REF-010-004 | control_interface | Max 外部制御(OSC/UDP/パラメータ) | 入出力・ユーティリティ | 6 |
| REF-010-005 | module | cycle~ | 発振 | 2 |
| REF-010-006 | module | lores~ | フィルタ | 2 |
| REF-010-007 | module | line~ | エンベロープ | 2 |
| REF-010-008 | module | metro | クロック・シーケンス | 2 |
| REF-010-009 | module | random | ランダム・論理 | 2 |
| REF-010-010 | module | noise~ | ノイズ | 1 |
| REF-010-011 | module | gen~ | other | 2 |

## 出典台帳

| 出典ID | 資料名 | 種別 | 版 | 確認日 | リンク状態 |
|---|---|---|---|---|---|
| SRC-001-01 | A-100 English Main Page | manufacturer_manual | unknown | 2026-11-12 | ok |
| SRC-001-02 | A-100 Technical Details | manufacturer_manual | unknown | 2026-11-12 | ok |
| SRC-001-03 | A-100 Construction Details | manufacturer_manual | unknown | 2026-11-12 | ok |
| SRC-001-04 | A-110-1 Standard VCO | manufacturer_manual | unknown | 2026-11-12 | ok |
| SRC-001-05 | A-120 24dB Low Pass (Transistor Ladder) | manufacturer_manual | unknown | 2026-11-12 | ok |
| SRC-001-06 | A-140-1 ADSR Envelope Generator | manufacturer_manual | unknown | 2026-11-12 | ok |
| SRC-001-07 | A-145-1 Low Frequency Oscillator | manufacturer_manual | unknown | 2026-11-12 | ok |
| SRC-001-08 | A-138s Mini Stereo Mixer | manufacturer_manual | unknown | 2026-11-12 | ok |
| SRC-001-09 | A-160-1 Clock/Trigger Divider | manufacturer_manual | unknown | 2026-11-12 | ok |
| SRC-001-10 | A-190-3 USB/MIDI-to-CV/Gate Interface | manufacturer_manual | unknown | 2026-11-12 | ok |
| SRC-002-01 | makenoise.com トップページ(別組織のサイト) | other | unknown | 2026-11-12 | ok |
| SRC-002-02 | MATHS product page | manufacturer_manual | unknown | 2026-11-12 | ok |
| SRC-002-03 | Wogglebug product page | manufacturer_manual | unknown | 2026-11-12 | ok |
| SRC-002-04 | Mimeophon product page | manufacturer_manual | unknown | 2026-11-12 | ok |
| SRC-002-05 | MATHS/Wogglebug/Mimeophon Manual (HTML版) | manufacturer_manual | unknown | 2026-11-12 | ok |
| SRC-002-06 | MATHS Manual (PDF) | manufacturer_manual | unknown | 2026-11-12 | ok |
| SRC-002-07 | Wogglebug Manual (PDF) | manufacturer_manual | unknown | 2026-11-12 | ok |
| SRC-002-08 | Mimeophon Manual (PDF) | manufacturer_manual | unknown | 2026-11-12 | ok |
| SRC-003-01 | Mother-32 | Moog Music (product page, Specs and Overview) | spec | unknown | 2026-11-12 | ok |
| SRC-003-02 | Mother-32 User Manual / Quickstart (Moog downloads listing) | manufacturer_manual | unknown | 2026-11-12 | unreachable |
| SRC-004-01 | MS-20 mini/MS-20 Original Owner's Manual (reprint of 1978 manual) | manufacturer_manual | 2015.07.07 posting (original text) | 2026-11-12 | ok |
| SRC-004-02 | MS-20 mini Owner's Manual | manufacturer_manual | 2015.06.01 | 2026-11-12 | ok |
| SRC-004-03 | MS-20 mini MIDI Implementation | spec | Revision 1.0 (2012.10.25) | 2026-11-12 | ok |
| SRC-004-04 | MS-20 mini/MS-20 Patch Book | manufacturer_manual | 2015.07.07 posting | 2026-11-12 | ok |
| SRC-005-01 | VCV Rack Manual(Voltage Standards, Polyphony, Core, Menu Bar, Installing, Version, Rack Pro, Plugin Licensing) | manufacturer_manual | Rack 2 manual (unknown date) | 2026-11-12 | ok |
| SRC-005-02 | VCV Free Modules(Fundamental)モジュールマニュアル | manufacturer_manual | unknown | 2026-11-12 | ok |
| SRC-005-03 | VCV Rack LICENSE.md / README.md (v2 branch) | source_code | v2 branch | 2026-11-12 | ok |
| SRC-005-04 | VCV Rack src/patch.cpp, include/engine/Port.hpp (v2) | source_code | v2 branch | 2026-11-12 | ok |
| SRC-005-05 | VCV Rack include/engine/Module.hpp (v2) | api_doc | v2 branch | 2026-11-12 | ok |
| SRC-006-01 | DISTRHO Cardinal README.md | source_code | main branch | 2026-11-12 | ok |
| SRC-006-02 | Cardinal docs/LICENSES.md, LICENSE, docs/FAQ.md | source_code | main branch | 2026-11-12 | ok |
| SRC-006-03 | Cardinal docs/DIFFERENCES.md | source_code | main branch | 2026-11-12 | ok |
| SRC-006-04 | GitHub API releases/latest (DISTRHO/Cardinal) | other | unknown | 2026-11-12 | unreachable |
| SRC-007-01 | BespokeSynth README.md (main) | source_code | main branch | 2026-11-12 | ok |
| SRC-007-02 | BespokeSynth LICENSE | source_code | main branch | 2026-11-12 | ok |
| SRC-007-03 | BespokeSynth Source/ModuleFactory.cpp | source_code | main branch | 2026-11-12 | ok |
| SRC-007-04 | BespokeSynth Source/Transport.cpp, Transport.h | source_code | main branch | 2026-11-12 | ok |
| SRC-007-05 | BespokeSynth Source/SynthGlobals.h | source_code | main branch | 2026-11-12 | ok |
| SRC-007-06 | BespokeSynth Source/INoteReceiver.h | source_code | main branch | 2026-11-12 | ok |
| SRC-007-07 | BespokeSynth Source/IPulseReceiver.h | source_code | main branch | 2026-11-12 | ok |
| SRC-007-08 | BespokeSynth Source/IModulator.h | source_code | main branch | 2026-11-12 | ok |
| SRC-007-09 | BespokeSynth Source/SingleOscillator.cpp/.h | source_code | main branch | 2026-11-12 | ok |
| SRC-007-10 | BespokeSynth Source/EnvelopeModulator.cpp/.h | source_code | main branch | 2026-11-12 | ok |
| SRC-007-11 | BespokeSynth Source/NoteStepSequencer.h | source_code | main branch | 2026-11-12 | ok |
| SRC-007-12 | BespokeSynth Source/OSCOutput.h, OSCOutput.cpp | source_code | main branch | 2026-11-12 | ok |
| SRC-007-13 | BespokeSynth Source/ScriptModule.cpp | source_code | main branch | 2026-11-12 | ok |
| SRC-007-14 | BespokeSynth Source/ScriptModule.h | source_code | main branch | 2026-11-12 | ok |
| SRC-007-15 | BespokeSynth Source/ModularSynth.cpp | source_code | main branch | 2026-11-12 | ok |
| SRC-007-16 | BespokeSynth Source/OscController.h | source_code | main branch | 2026-11-12 | ok |
| SRC-007-17 | BespokeSynth 公式ドキュメント | manufacturer_manual | unknown | 2026-11-12 | unreachable |
| SRC-008-01 | Pd Manual - Chapter 2: Theory of operation | manufacturer_manual | master (取得日時点) | 2026-11-12 | ok |
| SRC-008-02 | Pd Manual - Chapter 3: Installing and configuring | manufacturer_manual | master (取得日時点) | 2026-11-12 | ok |
| SRC-008-03 | Pd 付属ヘルプパッチ(osc~, lop~, line~, metro, random) | manufacturer_manual | help各ファイルの更新表記: osc~ 0.55, lop~ 0.54, line~ 0.33, metro 0.48, random 0.56 | 2026-11-12 | ok |
| SRC-008-04 | Pd ソースコード(u_pdsend.c, x_net.c, x_misc.c, m_pd.h) | source_code | master: PD_MAJOR/MINOR/BUGFIX = 0.57.0 | 2026-11-12 | ok |
| SRC-008-05 | Pd Documentation(msp.ucsd.edu) | manufacturer_manual | unknown | 2026-11-12 | unreachable |
| SRC-008-06 | Pure Data コミュニティサイト(puredata.info) | other | unknown | 2026-11-12 | ok |
| SRC-008-07 | Pure Data LICENSE.txt | other | master (取得日時点) | 2026-11-12 | ok |
| SRC-009-01 | Client vs Server | manufacturer_manual | SuperCollider 3.14.0 Help | 2026-11-12 | ok |
| SRC-009-02 | Server Command Reference | api_doc | SuperCollider 3.14.0 Help | 2026-11-12 | ok |
| SRC-009-03 | Server Architecture | manufacturer_manual | SuperCollider 3.14.0 Help(注記: 一部古い記述あり) | 2026-11-12 | ok |
| SRC-009-04 | Order of execution | manufacturer_manual | SuperCollider 3.14.0 Help | 2026-11-12 | ok |
| SRC-009-05 | UGenクラスヘルプ(SinOsc, LPF, EnvGen, Impulse, Dust, Out) | api_doc | SuperCollider 3.14.0 Help | 2026-11-12 | ok |
| SRC-009-06 | Bus / Group クラスヘルプ | api_doc | SuperCollider 3.14.0 Help | 2026-11-12 | ok |
| SRC-009-07 | Synth Definition File Format | spec | SuperCollider 3.14.0 Help | 2026-11-12 | ok |
| SRC-009-08 | OSC Communication | manufacturer_manual | SuperCollider 3.14.0 Help | 2026-11-12 | ok |
| SRC-009-09 | Scheduling and Server timing | manufacturer_manual | SuperCollider 3.14.0 Help | 2026-11-12 | ok |
| SRC-009-10 | SuperCollider 公式サイト | other | 公式サイト(現行版 3.14.1 と記載) | 2026-11-12 | ok |
| SRC-009-11 | SuperCollider COPYING | other | develop | 2026-11-12 | ok |
| SRC-010-01 | Messages(Max User Guide) | manufacturer_manual | docs.cycling74.com 現行(Max 9系の注記あり) | 2026-11-12 | ok |
| SRC-010-02 | Message Types(Max User Guide) | manufacturer_manual | 同上 | 2026-11-12 | ok |
| SRC-010-03 | Patch Cords(Max User Guide) | manufacturer_manual | 同上 | 2026-11-12 | ok |
| SRC-010-04 | Scheduler and Priority | manufacturer_manual | 同上 | 2026-11-12 | ok |
| SRC-010-05 | Sample Accurate Messages | manufacturer_manual | 同上 | 2026-11-12 | ok |
| SRC-010-06 | File Types | manufacturer_manual | 同上 | 2026-11-12 | ok |
| SRC-010-07 | Saving State with pattr | manufacturer_manual | 同上 | 2026-11-12 | ok |
| SRC-010-08 | OpenSoundControl | manufacturer_manual | 同上 | 2026-11-12 | ok |
| SRC-010-09 | Gen overview / RNBO | manufacturer_manual | 同上 | 2026-11-12 | ok |
| SRC-010-10 | Object Reference: cycle~, lores~, line~, metro, random, noise~, gen~, udpreceive, udpsend, adsr~ | api_doc | 同上(udpreceive等に >=9.2.0 の記述あり) | 2026-11-12 | ok |
| SRC-010-11 | Patcher Lifecycle | manufacturer_manual | 同上 | 2026-11-12 | ok |
| SRC-010-12 | Multi-Channel Audio I/O | manufacturer_manual | 同上 | 2026-11-12 | ok |
| SRC-010-14 | MC(Multi-channel)Overview | manufacturer_manual | 同上 | 2026-11-12 | ok |
| SRC-010-13 | Legal / 利用条件ページ | other | unknown | 2026-11-12 | unreachable |

URLと確認範囲・利用条件は各 `sources/<対象ID>.json` を参照。
