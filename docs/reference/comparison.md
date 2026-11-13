# 機能比較表

自動生成。各セルは根拠DBへ辿れるエンティティIDを示す。広告上の主張・第三者評価・実測・未確認は混同していない(事実の `basis` はDBで確認)。セルが「-」の項目は、調査したがモジュール単位で記録していない、またはその機種に該当しない。

## 1. 機能カテゴリ別: 調査済みモジュール

| 機能カテゴリ | T-001 | T-002 | T-003 | T-004 | T-005 | T-006 | T-007 | T-008 | T-009 | T-010 | T-011 | T-012 | T-013 | T-014 | T-015 | T-016 | T-017 | T-018 | T-019 | T-020 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 発振 | A-110-1 Standard VCO (REF-001-005) | - | VCO (REF-003-003) | VCO 1 / VCO 2 (REF-004-004) | VCV VCO (REF-005-004) | - | SingleOscillator (oscillator) (REF-007-003) | osc~ (REF-008-005) | SinOsc (REF-009-008) | cycle~ (REF-010-005) | Behringer 921B OSCILLATOR (REF-011-007) | Buchla 258 Classic Reissue - Dual Oscillator (REF-012-007) | ARP 2600 FS VCO-1/2/3 (REF-013-007)<br>Behringer 1004 OSCILLATOR MODULE (REF-013-016) | Roland SYSTEM-500 512 Dual VCO (REF-014-005)<br>Behringer System 100 110 VCO/VCF/VCA (REF-014-011)<br>Behringer System 100 112 Dual VCO (REF-014-012) | VCS3 voltage controlled oscillator (REF-015-006) | New Timbral Oscillator (NTO) (REF-016-005)<br>Paperface VCO / VCO+ (REF-016-009) | MiniMod VCO (REF-017-002) | - | - | - |
| ノイズ | - | - | - | - | VCV Noise (REF-005-007) | - | - | - | - | noise~ (REF-010-010) | Behringer 903A RANDOM SIGNAL GENERATOR (REF-011-012) | - | - | - | - | - | MiniMod Glide + Noise (REF-017-005) | - | - | - |
| フィルタ | A-120 24dB Low Pass (Transistor Ladder) (REF-001-006) | - | VCF (REF-003-004) | VCHPF + VCLPF (REF-004-005) | VCV VCF (REF-005-005) | - | - | lop~ (REF-008-006) | LPF (REF-009-009) | lores~ (REF-010-006) | Behringer 904A VOLTAGE CONTROLLED LOW PASS FILTER (REF-011-008) | - | ARP 2600 FS VCF (REF-013-008)<br>Behringer 1006 FILTAMP MODULE (REF-013-018)<br>Behringer 1047 MULTIMODE FILTER / RESONATOR MODULE (REF-013-020) | Roland SYSTEM-500 521 Dual VCF (REF-014-006) | VCS3 voltage controlled low-pass filter (REF-015-007) | 1973 Filter (VCF) with Balanced Output (REF-016-008) | MiniMod VCF (Transistor Ladder Filter) (REF-017-003)<br>Morgasmatron (REF-017-010)<br>Korgasmatron II (REF-017-011) | - | - | - |
| 波形整形 | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | Triple Waveshaper (REF-016-007) | - | - | - | - |
| 増幅・ミックス | A-138s Mini Stereo Mixer (REF-001-009)<br>A-130-1 Linear VCA (REF-001-011) | - | Voltage controlled mixer (REF-003-008) | - | - | - | - | - | - | - | - | Buchla 292 Classic Reissue - Quad Lopass Gate (REF-012-009) | ARP 2600 FS VCA / Mixer (REF-013-011)<br>Behringer 1005 MODAMP MODULE (REF-013-019) | Roland SYSTEM-500 530 Dual VCA (REF-014-007) | - | - | MiniMod Discrete Cascaded VCA (REF-017-007) | - | - | - |
| エンベロープ | A-140-1 ADSR Envelope Generator (REF-001-007) | - | Envelope (EG) (REF-003-005) | Envelope Generator 2 (EG-2) (REF-004-006) | VCV ADSR EG (REF-005-006) | - | EnvelopeModulator (envelope) (REF-007-004) | line~ (REF-008-007) | EnvGen (REF-009-010) | line~ (REF-010-007) | Behringer 911 ENVELOPE GENERATOR (REF-011-009) | Buchla 281 Classic Reissue - Quad Function Generator (REF-012-008)<br>TipTop Buchla 281t Quad Function Generator (REF-012-012) | ARP 2600 FS ADSR/AR EG (REF-013-009)<br>Behringer 1003 DUAL ENVELOPE GENERATOR MODULE (REF-013-017) | Roland SYSTEM-500 540 Dual Envelope + LFO (REF-014-008)<br>Behringer System 100 140 Dual Envelope/LFO (REF-014-013) | VCS3 trapezoid envelope generator (REF-015-008) | Dual Universal Slope Generator (DSG mk2) (REF-016-006) | MiniMod Dual Contour (REF-017-004) | - | - | - |
| LFO | A-145-1 Low Frequency Oscillator (REF-001-008) | - | LFO (REF-003-006) | Modulation Generator (MG) (REF-004-007) | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| その他変調 | - | Maths (REF-002-002) | - | - | - | - | - | - | - | - | - | - | - | - | - | Smooth & Stepped Generator (SSG) (REF-016-004) | Ring SM (REF-017-006) | - | - | - |
| クロック・シーケンス | A-160-1 Clock/Trigger Divider (REF-001-010)<br>A-155 Analog/Trigger Sequencer (REF-001-012) | - | 32-step sequencer (REF-003-007) | - | - | Host Time (REF-006-004) | NoteStepSequencer (notesequencer) (REF-007-005) | metro (REF-008-008) | Impulse (REF-009-011) | metro (REF-010-008) | Behringer 960 SEQUENTIAL CONTROLLER (REF-011-010) | TipTop Buchla 245t Sequential Voltage Source (REF-012-010) | - | Behringer System 100 182 Sequencer (REF-014-014) | Synthi Sequencer 256 (REF-015-010) | - | - | - | - | - |
| ランダム・論理 | - | Wogglebug (REF-002-003) | - | Sample and Hold (S/H) (REF-004-009) | - | - | PulseChance (pulsechance) (REF-007-006) | random (REF-008-009) | Dust (REF-009-012) | random (REF-010-009) | - | Buchla 266 Classic Reissue - Source of Uncertainty (REF-012-006)<br>TipTop Buchla 266t Source of Uncertainty (REF-012-011) | ARP 2600 FS Sample & Hold / Clock / Electronic Switch (REF-013-010) | - | - | - | - | - | - | - |
| 時間系 | - | Mimeophon (REF-002-004) | - | - | - | - | - | - | - | - | - | - | ARP 2600 スプリングリバーブ (REF-013-012) | Roland SYSTEM-500 572 Phase Shifter/Delay/LFO (REF-014-009) | VCS3 voltage controlled reverberation (REF-015-009) | - | SPACE FX (REF-017-012) | - | - | - |
| 入出力・ユーティリティ | - | - | - | External Signal Processor (ESP) (REF-004-008) | MIDI-CV (Core) (REF-005-008) | Host Parameters (REF-006-003)<br>Audio to CV Pitch (REF-006-005) | OSCOutput (oscoutput) (REF-007-007) | - | Out (REF-009-013) | - | Behringer 961 INTERFACE (REF-011-011) | - | - | - | - | - | - | - | - | Music Easel Auxiliary Card (REF-020-002) |
| ルーティング | - | - | - | - | - | Carla Plugin Host / Ildaeil Host (REF-006-006) | - | - | - | - | - | - | - | - | - | - | - | - | - | - |

## 2. 横断項目

| 対象 | 種別 | 信号規約 | パッチ保存 | 外部制御・プログラム制御 |
|---|---|---|---|---|
| T-001 Doepfer A-100(Eurorack規格と代表モジュール) | ハード モジュラー | REF-001-002 A-100 信号・電圧規約 | REF-001-003 A-100 パッチ保存(ハードウェア) | REF-001-004 Doepfer A-190-3 USB/MIDI-to-CV/Gate |
| T-002 Make Noise(Maths等の代表モジュール) | ハード モジュラー | REF-002-005 Make Noise モジュールの信号レベル(マニュアル記載) | REF-002-006 Make Noise パッチ保存(3モジュールのマニュアル範囲) | 未記録 |
| T-003 Moog Mother-32 | セミモジュラー | REF-003-002 Mother-32 CV/gate/audio conventions | REF-003-009 Mother-32 sequence memory | REF-003-010 Mother-32 MIDI and assignable output |
| T-004 Korg MS-20 系(MS-20 mini) | セミモジュラー | REF-004-003 MS-20 patch panel voltage conventions | REF-004-010 MS-20 mini sound recall (charts and patch book) | REF-004-011 MS-20 mini MIDI IN / USB MIDI |
| T-005 VCV Rack | ソフト モジュラー | REF-005-002 VCV Rack 電圧規約<br>REF-005-003 VCV Rack ポリフォニックケーブル | REF-005-009 VCV Rack パッチ保存(.vcv) | REF-005-010 VCV Rack 外部制御(MIDI/ヘッドレス/プラグインAPI) |
| T-006 Cardinal | ソフト モジュラー | REF-006-002 Cardinal 信号規約(Rack由来) | REF-006-007 Cardinal パッチ保存 | REF-006-008 Cardinal ホスト統合/MIDI/CVポート |
| T-007 BespokeSynth | ソフト モジュラー | REF-007-002 BespokeSynth 信号の種類(音声・ノート・パルス・モジュレータ) | REF-007-009 BespokeSynth ステート保存(.bsk)とレイアウト | REF-007-010 BespokeSynth 外部制御(MIDI/OSC/Pythonスクリプト) |
| T-008 Pure Data(Pd) | ソフト 環境 | REF-008-002 Pd メッセージ/音声信号規約 | REF-008-003 Pd パッチファイル(.pd) | REF-008-004 Pd 外部制御(FUDI/netsend/pdsend/起動フラグ/OSC解析) |
| T-009 SuperCollider | ソフト 環境 | REF-009-004 SuperCollider 信号・バス・ノード規約 | REF-009-005 SynthDef ファイル(.scsyndef, SCgf形式) | REF-009-006 scsynth OSCコマンド<br>REF-009-007 外部アプリとのOSC通信(sclang側) |
| T-010 Max / MSP | ソフト 環境 | REF-010-002 Max メッセージ/MSP信号規約 | REF-010-003 Max パッチ(.maxpat)と状態保存 | REF-010-004 Max 外部制御(OSC/UDP/パラメータ) |
| T-011 Moog 大型モジュラー系(System 15/35/55、Behringer System 55) | ハード モジュラー | REF-011-013 Behringer SYSTEM 55 トリガ/信号規約 | REF-011-014 Behringer SYSTEM 55 パッチ保存 | REF-011-015 Behringer CM1A MIDI-to-CV インターフェース |
| T-012 Buchla 系(Buchla 100/200、TipTop Buchla 200t、Buchla 266 Classic Reissue) | ハード モジュラー | REF-012-013 Buchla 200e 信号規約<br>REF-012-014 TipTop Buchla 200t 信号規約 | REF-012-015 Buchla 200e Remote Enable/プリセット管理<br>REF-012-016 TipTop Buchla 248t プリセット | REF-012-017 Buchla 225e MIDI Decoder |
| T-013 ARP 系(ARP 2500、ARP 2600、Behringer 2500) | セミモジュラー | REF-013-006 ARP 2600 FS 信号・電圧規約 | REF-013-013 ARP 2600 FS 状態保存(3620アルペジオ/ボイスアサイン) | REF-013-014 ARP 2600 FS MIDI/USB<br>REF-013-015 ARP 2600 M MIDI/USB |
| T-014 Roland System 系(System-100m、System-700、System-500、Behringer System 100) | ハード モジュラー | REF-014-004 Roland SYSTEM-500 信号・電圧規約 | REF-014-015 Roland SYSTEM-500 パッチ記録(Patch Memo) | REF-014-016 Behringer 182 Sequencer 外部同期/制御 |
| T-015 EMS 系(VCS3、Synthi 100) | セミモジュラー | REF-015-005 EMS pin-matrix patching convention | REF-015-011 EMS patch state (pin positions) and sequence memory | REF-015-012 EMS external control add-ons |
| T-016 Serge 系(Serge Modular、Random*Source Serge) | ハード モジュラー | REF-016-003 Serge signal conventions (jack-colour system) | REF-016-010 Serge patching and patch retention | REF-016-011 Serge external control and format interop |
| T-017 現行個別モジュール(AJH MiniMod、Intellijel Morgasmatron / Korgasmatron、Behringer SPACE FX) | ハード モジュラー | REF-017-008 AJH MiniMod signal conventions | REF-017-009 MiniMod patch recording (paper chart) | 未記録 |
| T-018 Make Noise 0-COAST | セミモジュラー | 未記録 | 未記録 | 未記録 |
| T-019 Buchla Music Easel Modern（未確認候補） | セミモジュラー | 未記録 | 未記録 | 未記録 |
| T-020 Buchla Music Easel（2017 Aux Card guide対象） | セミモジュラー | 未記録 | 未記録 | 未記録 |

## 3. 共通点と機種固有の差(DBから抽出した要約)

各エンティティの `purpose` と特徴を以下に示す(自分の言葉の要約。根拠は `fact_ids` からDBへ)。

- **REF-001-002 A-100 信号・電圧規約**: A-100内の音声・制御電圧・トリガ/ゲートの電圧と基準の取り決め。 (根拠: F-001-005, F-001-006, F-001-008, F-001-009, F-001-010)
- **REF-001-003 A-100 パッチ保存(ハードウェア)**: A-100の音色はパッチケーブルとつまみ配置で決まり、公式資料に電子的なパッチ保存の機能は記載されていない。 (根拠: F-001-011)
- **REF-001-004 Doepfer A-190-3 USB/MIDI-to-CV/Gate**: MIDIまたはUSBからCV4本とゲート1本を生成し、A-100を外部制御する。 (根拠: F-001-012, F-001-013, F-001-014)
- **REF-002-005 Make Noise モジュールの信号レベル(マニュアル記載)**: 3モジュールのマニュアルに現れる電圧・ゲート閾値の共通傾向。 (根拠: F-002-029, F-002-030)
- **REF-002-006 Make Noise パッチ保存(3モジュールのマニュアル範囲)**: 確認したマニュアルにパッチ保存/プリセットの記述があるかの記録。 (根拠: F-002-031)
- **REF-003-002 Mother-32 CV/gate/audio conventions**: What the product page states about CV and gate jacks. (根拠: F-003-008, F-003-009, F-003-010, F-003-011)
- **REF-003-009 Mother-32 sequence memory**: What can be stored. (根拠: F-003-022, F-003-023)
- **REF-003-010 Mother-32 MIDI and assignable output**: MIDI-to-CV with 16-function assignable output. (根拠: F-003-024, F-003-025)
- **REF-004-003 MS-20 patch panel voltage conventions**: Records the voltage ranges and trigger types printed for MS-20 patch jacks. (根拠: F-004-017, F-004-018, F-004-019, F-004-020, F-004-021, F-004-023 ほか)
- **REF-004-010 MS-20 mini sound recall (charts and patch book)**: Describes how sounds are recalled: by manual knob/cable setups from charts and a patch book. (根拠: F-004-045, F-004-046, F-004-047)
- **REF-004-011 MS-20 mini MIDI IN / USB MIDI**: Note-only MIDI over DIN and USB. (根拠: F-004-048, F-004-049, F-004-050)
- **REF-005-002 VCV Rack 電圧規約**: ケーブル上の値をボルト単位で扱う信号規約(レベル、トリガー/ゲート、1V/oct、ポリフォニー)。 (根拠: F-005-008, F-005-009, F-005-010, F-005-011, F-005-012, F-005-013 ほか)
- **REF-005-003 VCV Rack ポリフォニックケーブル**: 1本のケーブルに最大16チャンネルの電圧を載せる仕組み。 (根拠: F-005-016, F-005-017, F-005-018, F-005-019, F-005-020, F-005-021)
- **REF-005-009 VCV Rack パッチ保存(.vcv)**: パッチを.vcvファイルとして保存・読込し、自動保存も行う。 (根拠: F-005-035, F-005-036, F-005-037, F-005-046)
- **REF-005-010 VCV Rack 外部制御(MIDI/ヘッドレス/プラグインAPI)**: MIDI入出力モジュール、ヘッドレス起動、C++プラグインAPIによる制御・拡張。 (根拠: F-005-038, F-005-039, F-005-040, F-005-041, F-005-047)
- **REF-006-002 Cardinal 信号規約(Rack由来)**: Rackと同じモジュール/ケーブル体系を継承する。 (根拠: F-006-010)
- **REF-006-007 Cardinal パッチ保存**: ホスト/スタンドアロンでの状態保存。バリアントごとに設定ファイルが異なる。 (根拠: F-006-015, F-006-016)
- **REF-006-008 Cardinal ホスト統合/MIDI/CVポート**: プラグインのMIDI入出力、CVポート、ホストパラメータによる外部制御。 (根拠: F-006-017, F-006-018, F-006-019)
- **REF-007-002 BespokeSynth 信号の種類(音声・ノート・パルス・モジュレータ)**: 音声ストリームとは別に、ノートメッセージ、パルス、モジュレータ値の経路を持つ接続体系。 (根拠: F-007-007, F-007-008, F-007-009)
- **REF-007-009 BespokeSynth ステート保存(.bsk)とレイアウト**: パッチのレイアウト(JSON)とモジュール状態(バイナリ)を.bskに保存する。 (根拠: F-007-021, F-007-023)
- **REF-007-010 BespokeSynth 外部制御(MIDI/OSC/Pythonスクリプト)**: MIDI・OSCコントローラのマッピング、ScriptModuleのPythonフック、OSC出力。 (根拠: F-007-024, F-007-025, F-007-026)
- **REF-008-002 Pd メッセージ/音声信号規約**: 制御(メッセージ)と音声(信号)の区別と接続規則 (根拠: F-008-008, F-008-009, F-008-010, F-008-011, F-008-012, F-008-013 ほか)
- **REF-008-003 Pd パッチファイル(.pd)**: パッチの保存形式と保存される状態の範囲 (根拠: F-008-017, F-008-018)
- **REF-008-004 Pd 外部制御(FUDI/netsend/pdsend/起動フラグ/OSC解析)**: 外部プロセスやネットワークからPdへ制御メッセージを送る手段 (根拠: F-008-007, F-008-020, F-008-021, F-008-022, F-008-023, F-008-024)
- **REF-009-004 SuperCollider 信号・バス・ノード規約**: ノード木・バス・実行順序・計算レートの規約 (根拠: F-009-013, F-009-015, F-009-016, F-009-017, F-009-018, F-009-019 ほか)
- **REF-009-005 SynthDef ファイル(.scsyndef, SCgf形式)**: 合成グラフ定義(UGen接続)のバイナリ保存形式 (根拠: F-009-024, F-009-025, F-009-027)
- **REF-009-006 scsynth OSCコマンド**: サーバを制御するOSCコマンド集合(UDP/TCP) (根拠: F-009-008, F-009-028, F-009-031, F-009-033)
- **REF-009-007 外部アプリとのOSC通信(sclang側)**: NetAddr/OSCFuncによる他アプリとのOSC送受信 (根拠: F-009-034, F-009-035)
- **REF-010-002 Max メッセージ/MSP信号規約**: イベント(メッセージ)と信号(音声)とMCなど複数種のパッチコード規約 (根拠: F-010-008, F-010-011, F-010-012)
- **REF-010-003 Max パッチ(.maxpat)と状態保存**: パッチ構造のJSON保存と、状態を別途保存するpattr系 (根拠: F-010-014, F-010-015, F-010-016, F-010-017)
- **REF-010-004 Max 外部制御(OSC/UDP/パラメータ)**: OSC/UDPでMaxを制御・外部へ送信する手段 (根拠: F-010-018, F-010-019, F-010-020, F-010-021, F-010-022, F-010-023)
- **REF-011-013 Behringer SYSTEM 55 トリガ/信号規約**: V-trig・S-trig系のトリガ形式とEurorack電源。電圧値やピッチ規約は資料未入手。 (根拠: F-011-039, F-011-040)
- **REF-011-014 Behringer SYSTEM 55 パッチ保存**: システムとしてのパッチ保存機能の有無。製品ページでは保存機能の言及なし。 (根拠: F-011-042)
- **REF-011-015 Behringer CM1A MIDI-to-CV インターフェース**: 外部MIDIキーボード/DAWからピッチとトリガを供給するMIDI-CV変換器。 (根拠: F-011-043, F-011-044)
- **REF-012-013 Buchla 200e 信号規約**: 200e/200h系の制御電圧・パルス・オーディオ信号の取り決め。 (根拠: F-012-032, F-012-033, F-012-034, F-012-035, F-012-036)
- **REF-012-014 TipTop Buchla 200t 信号規約**: Eurorack版の電圧規約。ピッチは1V/oct、パルスやCVは0〜10V系。 (根拠: F-012-037, F-012-038, F-012-039)
- **REF-012-015 Buchla 200e Remote Enable/プリセット管理**: 200e/hのプリセット管理(206e/225eのPreset Manager)とモジュール単位のRemote Enable。 (根拠: F-012-040, F-012-041, F-012-042)
- **REF-012-016 TipTop Buchla 248t プリセット**: 248tは12のプリセットを不揮発メモリに保存できる。 (根拠: F-012-043)
- **REF-012-017 Buchla 225e MIDI Decoder**: MIDIをアナログ電圧とパルスに変換し、200e系へ配るMIDIデコーダ。 (根拠: F-012-044, F-012-045)
- **REF-013-006 ARP 2600 FS 信号・電圧規約**: ARP 2600 FS(および一部2600 M)のピッチCV・ゲート/トリガ・LFO出力の電圧規約。 (根拠: F-013-020, F-013-021, F-013-022, F-013-023, F-013-024, F-013-025)
- **REF-013-013 ARP 2600 FS 状態保存(3620アルペジオ/ボイスアサイン)**: 電源断後に保持される設定と保持されないシーケンスの扱い。 (根拠: F-013-041, F-013-042)
- **REF-013-014 ARP 2600 FS MIDI/USB**: 外部MIDI機器やPCからのノート制御。 (根拠: F-013-043, F-013-044)
- **REF-013-015 ARP 2600 M MIDI/USB**: 外部MIDIコントローラーによるノート/ピッチベンド/モジュレーション/ポルタメント制御。 (根拠: F-013-045, F-013-046, F-013-047)
- **REF-014-004 Roland SYSTEM-500 信号・電圧規約**: SYSTEM-500のCV入力レベル、ピッチ規約、ジャック形式、電源。 (根拠: F-014-010, F-014-011, F-014-012, F-014-013, F-014-014)
- **REF-014-015 Roland SYSTEM-500 パッチ記録(Patch Memo)**: 音色(パッチ)の記録・再現手段。 (根拠: F-014-047)
- **REF-014-016 Behringer 182 Sequencer 外部同期/制御**: 182の外部クロック入力、テンポCV、スタート/ストップ。 (根拠: F-014-048)
- **REF-015-005 EMS pin-matrix patching convention**: How EMS instruments interconnect modules with pins in a matrix. (根拠: F-015-007, F-015-014)
- **REF-015-011 EMS patch state (pin positions) and sequence memory**: How patches and sequences are retained. (根拠: F-015-022)
- **REF-015-012 EMS external control add-ons**: Keyboards and sequencers used to control VCS3/Synthi systems. (根拠: F-015-004, F-015-023)
- **REF-016-003 Serge signal conventions (jack-colour system)**: Three signal families by jack colour within +/-12 V. (根拠: F-016-008, F-016-009, F-016-010)
- **REF-016-010 Serge patching and patch retention**: Cord-based patching; no memory documented. (根拠: F-016-022, F-016-023)
- **REF-016-011 Serge external control and format interop**: 1V/Oct input, sync, balanced out, FX interface, Eurorack/4U bridging. (根拠: F-016-024, F-016-025, F-016-026)
- **REF-017-008 AJH MiniMod signal conventions**: Voltage conventions observed across MiniMod modules. (根拠: F-017-023, F-017-038, F-017-039)
- **REF-017-009 MiniMod patch recording (paper chart)**: Settings are recorded by hand; no digital preset memory is described in the pages read. (根拠: F-017-040)
