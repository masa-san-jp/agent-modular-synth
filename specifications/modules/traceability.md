# 追跡表: 仕様ID → リファレンスID → 出典

自動生成(`tools/build_spec_docs.py`)。仕様本文の §2 の根拠IDと、DBの事実が持つ出典ID・節を結ぶ。DBの事実本文は複製しない。

| 仕様ID | 名称 | 参照リファレンス(フロントマター) | [R] 件数 | [A] 件数 | [X] 件数 |
|---|---|---|---|---|---|
| [MOD-AMP-001](MOD-AMP-001.md) | VCA(電圧制御アンプ) | M005, F-004-020, F-013-037, F-013-023, F-014-022, F-014-023, F-017-036, F-005-010, F-001-009 | 5 | 4 | 1 |
| [MOD-CLK-001](MOD-CLK-001.md) | クロック | M006, REF-007-005, F-007-014, F-018-025, F-022-009, F-005-011, F-005-012, F-005-013, F-003-018, F-003-025, REF-005-002 | 7 | 3 | 1 |
| [MOD-CLK-002](MOD-CLK-002.md) | クロック分周 | REF-001-010, F-001-034, F-001-035, F-001-036, F-005-011, F-005-012, F-003-025, F-002-019 | 5 | 4 | 1 |
| [MOD-DLY-001](MOD-DLY-001.md) | ディレイ | REF-002-004, F-002-009, F-002-024, F-002-028, F-014-029, F-017-059, F-019-018, F-005-010, F-005-012 | 5 | 5 | 1 |
| [MOD-ENV-001](MOD-ENV-001.md) | ADSRエンベロープ | REF-001-007, REF-004-006, F-001-023, F-001-024, F-001-025, M002, REF-005-006, F-005-029, F-005-011, F-005-012, REF-007-004, F-007-013 | 5 | 4 | 1 |
| [MOD-FLT-001](MOD-FLT-001.md) | ローパスフィルタ(ラダー系) | REF-001-006, F-001-021, M004, M005, F-005-027, F-005-028, F-017-012, F-017-013, F-017-015, F-014-037, F-003-014, F-005-010, F-001-007 | 3 | 6 | 1 |
| [MOD-FNC-001](MOD-FNC-001.md) | スルー/関数発生器 | REF-002-002, F-002-003, F-002-004, F-002-011, F-002-012, F-002-013, F-002-014, F-002-015, F-002-018, F-002-019, REF-018-029, F-018-074, F-005-011, F-005-012 | 8 | 5 | 1 |
| [MOD-IO-001](MOD-IO-001.md) | オーディオ出力 | F-005-004, F-005-009, F-005-010, F-005-014, F-005-045, F-001-007, F-004-003, F-003-006, F-003-044, F-003-030, I003 | 5 | 4 | 1 |
| [MOD-IO-002](MOD-IO-002.md) | MIDI-CV | M003, REF-005-008, F-005-032, F-005-033, F-005-034, F-005-013, F-005-011, REF-001-004, F-001-012, F-001-013, F-003-024, F-003-027, REF-004-011, F-004-048, F-007-007 | 6 | 4 | 1 |
| [MOD-IO-003](MOD-IO-003.md) | メーター/スコープ | F-005-008, F-005-009, F-005-014, F-005-003, F-001-007, F-002-015, I003 | 5 | 3 | 1 |
| [MOD-LFO-001](MOD-LFO-001.md) | LFO(低周波オシレータ) | REF-001-008, F-001-027, F-001-028, F-001-029, F-001-007, REF-005-002, F-005-013, F-005-009, F-005-010, F-005-011, F-005-014 | 7 | 4 | 1 |
| [MOD-LGC-001](MOD-LGC-001.md) | 論理・比較 | F-005-011, F-001-006, F-001-009, F-002-003, F-002-016, F-016-029, REF-016-012, F-005-012 | 5 | 3 | 1 |
| [MOD-MIX-001](MOD-MIX-001.md) | ミキサー | REF-001-009, F-001-031, F-001-032, F-017-033, F-014-022, F-001-009, F-005-010 | 4 | 3 | 2 |
| [MOD-NSE-001](MOD-NSE-001.md) | ノイズ源(白色ノイズ) | REF-005-007, F-005-030, F-005-031, REF-010-010, F-010-034, REF-005-002, F-005-009, F-005-010, F-005-014 | 5 | 2 | 1 |
| [MOD-OSC-001](MOD-OSC-001.md) | VCO(電圧制御オシレータ) | REF-001-005, F-001-005, F-001-015, F-001-016, F-001-017, F-001-018, F-001-019, M001, REF-005-002, F-005-009, F-005-010, F-005-013, F-005-014, F-005-011 | 8 | 5 | 1 |
| [MOD-RND-001](MOD-RND-001.md) | サンプル&ホールド/ランダム | REF-004-009, F-003-007, F-004-043, F-004-044, F-004-022, REF-002-003, F-002-006, F-002-020, F-002-023, REF-005-007, F-005-031, F-005-009, F-005-011 | 5 | 3 | 1 |
| [MOD-SEQ-001](MOD-SEQ-001.md) | ステップシーケンサ | M006, REF-003-007, F-003-020, F-003-022, F-003-037, F-003-038, F-005-011, F-005-012, F-001-034, REF-007-005 | 6 | 5 | 1 |
| [MOD-UTL-001](MOD-UTL-001.md) | アッテヌバータ/オフセット | REF-002-002, F-002-016, F-002-017, F-002-011, REF-005-002, F-005-009, F-005-010, F-005-014 | 5 | 1 | 2 |

## [R](原著の事実)ごとの出典

### MOD-AMP-001 VCA(電圧制御アンプ)

| 記述ID | 根拠ID | 出典ID | 節・箇所 | 根拠の種別/確度 |
|---|---|---|---|---|
| S-01 | M005 | (精査済みDB) | A-130-1 Linear VCA | 精査済みレコード |
| S-02 | F-004-020 | SRC-004-01 | p.8 Specifications, sections 4, 5, 10 | manufacturer_doc/high |
| S-03 | F-013-037 | SRC-013-03 | p.12 VCA section a-j | manufacturer_doc/high |
| S-03 | F-013-023 | SRC-013-03 | p.12 VCA section d/e | manufacturer_doc/high |
| S-03 | F-014-022 | SRC-014-04 | Product page '530 Dual VCA' | manufacturer_doc/high |
| S-03 | F-014-023 | SRC-014-10 | Parameter Guide: INITIAL / Indicators | manufacturer_doc/high |
| S-04 | F-001-009 | SRC-001-02 | Technical Details Signals in the A-100 末尾 | manufacturer_doc/high |
| S-04 | F-005-010 | SRC-005-01 | VoltageStandards 'Output Saturation' | manufacturer_doc/high |
| S-05 | M005 | (精査済みDB) | A-130-1 Linear VCA | 精査済みレコード |
| S-05 | F-017-036 | SRC-017-06 | VCA.html Response, CV Inputs and High distortion sections | manufacturer_doc/high |

### MOD-CLK-001 クロック

| 記述ID | 根拠ID | 出典ID | 節・箇所 | 根拠の種別/確度 |
|---|---|---|---|---|
| S-01 | F-005-013 | SRC-005-01 | VoltageStandards 'Pitch and Frequencies' | manufacturer_doc/high |
| S-01 | REF-005-002 | (エンティティ) | VCV Rack 電圧規約 | - |
| S-02 | F-005-011 | SRC-005-01 | VoltageStandards 'Triggers and Gates' | manufacturer_doc/high |
| S-03 | F-005-012 | SRC-005-01 | VoltageStandards 'Timing' | manufacturer_doc/high |
| S-04 | F-018-025 | SRC-018-03 | README Modules > Control | licensed_source/medium |
| S-05 | F-022-009 | SRC-022-06 | 冒頭; Pulses per quarter note | third_party/medium |
| S-06 | F-003-018 | SRC-003-01 | Mother-32 product page, Specs table | manufacturer_doc/medium |
| S-06 | F-003-025 | SRC-003-01 | Mother-32 product page, Specs table | manufacturer_doc/medium |
| S-07 | M006 | (精査済みDB) | A-155 Analog/Trigger Sequencer | 精査済みレコード |

### MOD-CLK-002 クロック分周

| 記述ID | 根拠ID | 出典ID | 節・箇所 | 根拠の種別/確度 |
|---|---|---|---|---|
| S-01 | F-001-034 | SRC-001-09 | A-160 英語説明部 | manufacturer_doc/high |
| S-02 | F-001-035 | SRC-001-09 | A-160 英語説明部 | manufacturer_doc/high |
| S-03 | F-005-012 | SRC-005-01 | VoltageStandards 'Timing' | manufacturer_doc/high |
| S-03 | F-005-011 | SRC-005-01 | VoltageStandards 'Triggers and Gates' | manufacturer_doc/high |
| S-04 | F-003-025 | SRC-003-01 | Mother-32 product page, Specs table | manufacturer_doc/medium |
| S-05 | F-002-019 | SRC-002-06 | Getting Started: Trigger Input | manufacturer_doc/high |

### MOD-DLY-001 ディレイ

| 記述ID | 根拠ID | 出典ID | 節・箇所 | 根拠の種別/確度 |
|---|---|---|---|---|
| S-01 | F-002-028 | SRC-002-08 | Overview; Rate節 | manufacturer_doc/high |
| S-01 | F-002-024 | SRC-002-08 | Panel Controls 項目1〜16 | manufacturer_doc/high |
| S-01 | F-002-009 | SRC-002-04 | Mimeophon product page FEATURES | advertising/medium |
| S-02 | F-014-029 | SRC-014-06 | Product page + Parameter Guide DELAY section | manufacturer_doc/high |
| S-03 | F-017-059 | SRC-017-13 | Quick Start Guide, 'SPACE FX Effects and Parameters' table (EN) | manufacturer_doc/medium |
| S-04 | F-019-018 | SRC-019-04 | Tools節下の説明 | licensed_source/high |
| S-05 | F-005-010 | SRC-005-01 | VoltageStandards 'Output Saturation' | manufacturer_doc/high |
| S-05 | F-005-012 | SRC-005-01 | VoltageStandards 'Timing' | manufacturer_doc/high |

### MOD-ENV-001 ADSRエンベロープ

| 記述ID | 根拠ID | 出典ID | 節・箇所 | 根拠の種別/確度 |
|---|---|---|---|---|
| S-01 | F-001-023 | SRC-001-06 | A-140 英語説明部 | manufacturer_doc/high |
| S-01 | M002 | (精査済みDB) | A-140-1 ADSR | 精査済みレコード |
| S-02 | F-005-029 | SRC-005-02 | fund 'VCV ADSR EG' | manufacturer_doc/high |
| S-03 | F-001-024 | SRC-001-06 | A-140 英語説明部 | manufacturer_doc/high |
| S-03 | M002 | (精査済みDB) | A-140-1 ADSR | 精査済みレコード |
| S-04 | F-001-025 | SRC-001-06 | A-140 英語説明部 | manufacturer_doc/high |
| S-05 | F-005-011 | SRC-005-01 | VoltageStandards 'Triggers and Gates' | manufacturer_doc/high |
| S-05 | F-005-012 | SRC-005-01 | VoltageStandards 'Timing' | manufacturer_doc/high |

### MOD-FLT-001 ローパスフィルタ(ラダー系)

| 記述ID | 根拠ID | 出典ID | 節・箇所 | 根拠の種別/確度 |
|---|---|---|---|---|
| S-01 | F-001-021 | SRC-001-05 | A-120 英語説明部 | manufacturer_doc/high |
| S-01 | M004 | (精査済みDB) | A-120 24dB Low Pass | 精査済みレコード |
| S-02 | F-005-027 | SRC-005-02 | fund 'VCV VCF' | manufacturer_doc/high |
| S-02 | F-005-028 | SRC-005-02 | fund 'VCV VCF' | manufacturer_doc/high |
| S-02 | F-017-012 | SRC-017-02 | User Guide intro | manufacturer_doc/high |
| S-02 | F-017-013 | SRC-017-02 | Controls list items 10-12 | manufacturer_doc/high |
| S-02 | F-017-015 | SRC-017-02 | Intro; items 13, 14 | manufacturer_doc/high |
| S-03 | F-005-010 | SRC-005-01 | VoltageStandards 'Output Saturation' | manufacturer_doc/high |
| S-03 | F-001-007 | SRC-001-02 | Technical Details Signals in the A-100 | manufacturer_doc/high |

### MOD-FNC-001 スルー/関数発生器

| 記述ID | 根拠ID | 出典ID | 節・箇所 | 根拠の種別/確度 |
|---|---|---|---|---|
| S-01 | F-002-003 | SRC-002-02 | MATHS product page FEATURES | advertising/medium |
| S-01 | F-002-004 | SRC-002-02 | MATHS product page FEATURES | advertising/medium |
| S-02 | F-002-011 | SRC-002-06 | Panel Controls: MATHS Channel 1/4 | manufacturer_doc/high |
| S-03 | F-002-012 | SRC-002-06 | Panel Controls: Channel 1 項目6,8,9; Rise Fall and Vari-Response | manufacturer_doc/high |
| S-04 | F-002-013 | SRC-002-06 | Panel Controls; Rise Fall and Vari-Response 内 EOR/EOC節 | manufacturer_doc/high |
| S-05 | F-002-014 | SRC-002-06 | Panel Controls: Channel 1 項目2 | manufacturer_doc/high |
| S-06 | F-002-019 | SRC-002-06 | Getting Started: Trigger Input | manufacturer_doc/high |
| S-07 | F-002-018 | SRC-002-06 | Panel Controls: Channel 1 項目1 | manufacturer_doc/high |
| S-08 | F-018-074 | SRC-018-10 | README Modulation | licensed_source/medium |
| S-08 | REF-018-029 | (エンティティ) | FUNC (eurorack-js) | - |

### MOD-IO-001 オーディオ出力

| 記述ID | 根拠ID | 出典ID | 節・箇所 | 根拠の種別/確度 |
|---|---|---|---|---|
| S-01 | F-005-004 | SRC-005-01 | Core 'Audio' | manufacturer_doc/high |
| S-02 | F-005-009 | SRC-005-01 | VoltageStandards 'Levels' | manufacturer_doc/high |
| S-02 | F-005-045 | SRC-005-07 | 節Electrical | third_party/medium |
| S-02 | F-001-007 | SRC-001-02 | Technical Details Signals in the A-100 | manufacturer_doc/high |
| S-03 | F-005-010 | SRC-005-01 | VoltageStandards 'Output Saturation' | manufacturer_doc/high |
| S-04 | F-005-014 | SRC-005-01 | VoltageStandards 'NaNs and Infinity' | manufacturer_doc/high |
| S-05 | F-004-003 | SRC-004-02 | Owner's Manual, 'Specifications' | manufacturer_doc/high |
| S-05 | F-003-006 | SRC-003-01 | Mother-32 product page, Specs table | manufacturer_doc/medium |
| S-05 | F-003-044 | SRC-003-03 | Review Specifications box; Wikipedia Eurorack compatibility | third_party/medium |
| S-05 | F-003-030 | SRC-003-03 | Review (whole text checked) | third_party/medium |

### MOD-IO-002 MIDI-CV

| 記述ID | 根拠ID | 出典ID | 節・箇所 | 根拠の種別/確度 |
|---|---|---|---|---|
| S-01 | F-005-032 | SRC-005-01 | Core 'MIDI-CV' | manufacturer_doc/high |
| S-01 | M003 | (精査済みDB) | Core MIDI-CV | 精査済みレコード |
| S-02 | F-005-033 | SRC-005-01 | Core 'MIDI-CV' | manufacturer_doc/high |
| S-03 | F-005-013 | SRC-005-01 | VoltageStandards 'Pitch and Frequencies' | manufacturer_doc/high |
| S-04 | F-001-012 | SRC-001-10 | A-190-3 入出力と操作部の節 | manufacturer_doc/high |
| S-04 | F-001-013 | SRC-001-10 | A-190-3 入出力と操作部/ジャンパの節 | manufacturer_doc/high |
| S-04 | REF-001-004 | (エンティティ) | Doepfer A-190-3 USB/MIDI-to-CV/Gate | - |
| S-05 | F-003-027 | SRC-003-03 | Review, Keyboard, Sequencer & MIDI section | third_party/medium |
| S-05 | F-004-048 | SRC-004-02 | Owner's Manual, 4. About MIDI, MIDI IN connector | manufacturer_doc/high |
| S-06 | F-007-007 | SRC-007-06 | Source/INoteReceiver.h | licensed_source/high |

### MOD-IO-003 メーター/スコープ

| 記述ID | 根拠ID | 出典ID | 節・箇所 | 根拠の種別/確度 |
|---|---|---|---|---|
| S-01 | F-005-008 | SRC-005-01 | VoltageStandards 冒頭 | manufacturer_doc/high |
| S-02 | F-005-009 | SRC-005-01 | VoltageStandards 'Levels' | manufacturer_doc/high |
| S-02 | F-001-007 | SRC-001-02 | Technical Details Signals in the A-100 | manufacturer_doc/high |
| S-03 | F-005-014 | SRC-005-01 | VoltageStandards 'NaNs and Infinity' | manufacturer_doc/high |
| S-04 | F-005-003 | SRC-005-01 | MenuBar 'Sample rate' | manufacturer_doc/high |
| S-05 | F-002-015 | SRC-002-06 | Panel Controls: Channel 1 項目5,6 | manufacturer_doc/high |

### MOD-LFO-001 LFO(低周波オシレータ)

| 記述ID | 根拠ID | 出典ID | 節・箇所 | 根拠の種別/確度 |
|---|---|---|---|---|
| S-01 | F-001-027 | SRC-001-07 | A-145 英語説明部 | manufacturer_doc/high |
| S-02 | F-001-028 | SRC-001-07 | A-145 英語説明部 | manufacturer_doc/high |
| S-03 | F-001-029 | SRC-001-07 | A-145 英語説明部 | manufacturer_doc/high |
| S-03 | REF-001-008 | (エンティティ) | A-145-1 Low Frequency Oscillator | - |
| S-04 | F-001-007 | SRC-001-02 | Technical Details Signals in the A-100 | manufacturer_doc/high |
| S-05 | F-005-013 | SRC-005-01 | VoltageStandards 'Pitch and Frequencies' | manufacturer_doc/high |
| S-06 | F-005-011 | SRC-005-01 | VoltageStandards 'Triggers and Gates' | manufacturer_doc/high |
| S-07 | F-005-014 | SRC-005-01 | VoltageStandards 'NaNs and Infinity' | manufacturer_doc/high |
| S-07 | F-005-010 | SRC-005-01 | VoltageStandards 'Output Saturation' | manufacturer_doc/high |

### MOD-LGC-001 論理・比較

| 記述ID | 根拠ID | 出典ID | 節・箇所 | 根拠の種別/確度 |
|---|---|---|---|---|
| S-01 | F-005-011 | SRC-005-01 | VoltageStandards 'Triggers and Gates' | manufacturer_doc/high |
| S-02 | F-001-006 | SRC-001-02 | Technical Details Principles / Signals in the A-100 | manufacturer_doc/high |
| S-03 | F-001-009 | SRC-001-02 | Technical Details Signals in the A-100 末尾 | manufacturer_doc/high |
| S-04 | F-002-003 | SRC-002-02 | MATHS product page FEATURES | advertising/medium |
| S-04 | F-002-016 | SRC-002-06 | Panel Controls: SUM and OR Bus 項目1〜5 | manufacturer_doc/high |
| S-05 | F-016-029 | SRC-016-12 | Section 1st generation modules (1973) | third_party/medium |
| S-05 | REF-016-012 | (エンティティ) | Serge Modular module generations 1973-1983 (original catalogue) | - |

### MOD-MIX-001 ミキサー

| 記述ID | 根拠ID | 出典ID | 節・箇所 | 根拠の種別/確度 |
|---|---|---|---|---|
| S-01 | F-001-031 | SRC-001-08 | A-138s 英語説明部 | manufacturer_doc/high |
| S-01 | REF-001-009 | (エンティティ) | A-138s Mini Stereo Mixer | - |
| S-02 | F-001-032 | SRC-001-08 | A-138s Technical notes | manufacturer_doc/high |
| S-04 | F-001-009 | SRC-001-02 | Technical Details Signals in the A-100 末尾 | manufacturer_doc/high |
| S-04 | F-005-010 | SRC-005-01 | VoltageStandards 'Output Saturation' | manufacturer_doc/high |
| S-05 | F-014-022 | SRC-014-04 | Product page '530 Dual VCA' | manufacturer_doc/high |

### MOD-NSE-001 ノイズ源(白色ノイズ)

| 記述ID | 根拠ID | 出典ID | 節・箇所 | 根拠の種別/確度 |
|---|---|---|---|---|
| S-01 | F-005-030 | SRC-005-02 | fund 'VCV Noise' | manufacturer_doc/high |
| S-02 | F-005-031 | SRC-005-02 | fund 'VCV Noise' | manufacturer_doc/high |
| S-03 | F-010-034 | SRC-010-10 | noise~ Description | api_doc/high |
| S-04 | F-005-009 | SRC-005-01 | VoltageStandards 'Levels' | manufacturer_doc/high |
| S-04 | F-005-010 | SRC-005-01 | VoltageStandards 'Output Saturation' | manufacturer_doc/high |
| S-05 | F-005-014 | SRC-005-01 | VoltageStandards 'NaNs and Infinity' | manufacturer_doc/high |

### MOD-OSC-001 VCO(電圧制御オシレータ)

| 記述ID | 根拠ID | 出典ID | 節・箇所 | 根拠の種別/確度 |
|---|---|---|---|---|
| S-01 | F-001-015 | SRC-001-04 | A-110 英語説明部 | manufacturer_doc/high |
| S-01 | M001 | (精査済みDB) | A-110-1 Standard VCO | 精査済みレコード |
| S-02 | F-001-016 | SRC-001-04 | A-110 英語説明部 | manufacturer_doc/high |
| S-02 | M001 | (精査済みDB) | A-110-1 Standard VCO | 精査済みレコード |
| S-03 | F-001-017 | SRC-001-04 | A-110 英語説明部 | manufacturer_doc/high |
| S-03 | F-001-005 | SRC-001-02 | Technical Details Principles of Voltage Control | manufacturer_doc/high |
| S-04 | F-005-013 | SRC-005-01 | VoltageStandards 'Pitch and Frequencies' | manufacturer_doc/high |
| S-04 | F-001-005 | SRC-001-02 | Technical Details Principles of Voltage Control | manufacturer_doc/high |
| S-05 | F-001-018 | SRC-001-04 | A-110 Technical remarks | manufacturer_doc/high |
| S-06 | F-001-019 | SRC-001-04 | A-110 Technical remarks | manufacturer_doc/high |
| S-07 | F-005-014 | SRC-005-01 | VoltageStandards 'NaNs and Infinity' | manufacturer_doc/high |
| S-08 | F-005-010 | SRC-005-01 | VoltageStandards 'Output Saturation' | manufacturer_doc/high |

### MOD-RND-001 サンプル&ホールド/ランダム

| 記述ID | 根拠ID | 出典ID | 節・箇所 | 根拠の種別/確度 |
|---|---|---|---|---|
| S-01 | F-004-043 | SRC-004-01 | Original Owner's Manual p.7 (40) | manufacturer_doc/high |
| S-02 | F-004-044 | SRC-004-01 | Original Owner's Manual p.8 Specifications section 9 | manufacturer_doc/high |
| S-02 | F-004-022 | SRC-004-01 | p.8 Specifications, sections 7-9 | manufacturer_doc/high |
| S-03 | F-002-006 | SRC-002-03 | Wogglebug product page FEATURES | advertising/medium |
| S-03 | F-002-020 | SRC-002-07 | Panel Controls: Wogglebug 出力説明 | manufacturer_doc/high |
| S-03 | F-002-023 | SRC-002-07 | Panel Controls 項目3; Overview 新機能の節 | manufacturer_doc/high |
| S-04 | F-005-031 | SRC-005-02 | fund 'VCV Noise' | manufacturer_doc/high |
| S-05 | F-005-011 | SRC-005-01 | VoltageStandards 'Triggers and Gates' | manufacturer_doc/high |

### MOD-SEQ-001 ステップシーケンサ

| 記述ID | 根拠ID | 出典ID | 節・箇所 | 根拠の種別/確度 |
|---|---|---|---|---|
| S-01 | M006 | (精査済みDB) | A-155 Analog/Trigger Sequencer | 精査済みレコード |
| S-02 | M006 | (精査済みDB) | A-155 Analog/Trigger Sequencer | 精査済みレコード |
| S-02 | F-005-011 | SRC-005-01 | VoltageStandards 'Triggers and Gates' | manufacturer_doc/high |
| S-03 | F-003-037 | SRC-003-03 | Review, Keyboard, Sequencer & MIDI; In Use | third_party/medium |
| S-03 | REF-003-007 | (エンティティ) | 32-step sequencer | - |
| S-04 | F-003-038 | SRC-003-03 | Review, Keyboard, Sequencer & MIDI; Assignable Output box | third_party/medium |
| S-05 | F-005-012 | SRC-005-01 | VoltageStandards 'Timing' | manufacturer_doc/high |
| S-06 | F-005-011 | SRC-005-01 | VoltageStandards 'Triggers and Gates' | manufacturer_doc/high |

### MOD-UTL-001 アッテヌバータ/オフセット

| 記述ID | 根拠ID | 出典ID | 節・箇所 | 根拠の種別/確度 |
|---|---|---|---|---|
| S-01 | F-002-017 | SRC-002-06 | Panel Controls: SUM and OR Bus 項目1,2 | manufacturer_doc/high |
| S-02 | F-002-016 | SRC-002-06 | Panel Controls: SUM and OR Bus 項目1〜5 | manufacturer_doc/high |
| S-03 | F-002-011 | SRC-002-06 | Panel Controls: MATHS Channel 1/4 | manufacturer_doc/high |
| S-04 | F-005-009 | SRC-005-01 | VoltageStandards 'Levels' | manufacturer_doc/high |
| S-04 | F-005-010 | SRC-005-01 | VoltageStandards 'Output Saturation' | manufacturer_doc/high |
| S-05 | F-005-014 | SRC-005-01 | VoltageStandards 'NaNs and Infinity' | manufacturer_doc/high |

