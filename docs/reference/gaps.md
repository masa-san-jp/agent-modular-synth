# 不足・未確認一覧と次段への引継ぎ

自動生成。#2(機能別仕様)が調査のやり直しなしに使える範囲と、保留すべき範囲を判断するための一覧。

## 対象ごとの状態

| 対象 | 状態 | 備考 |
|---|---|---|
| T-001 Doepfer A-100(Eurorack規格と代表モジュール) | 確認済み | doepfer.de のA-100概要・Technical Details・Construction Details と代表8件(A-110-1,A-120,A-140-1,A-145-1,A-138s,A-160-1,A-190-3)の公式説明ページを確認。各モジュールのPDFマニュアルは未取得で、パラメータ範囲の一部は未確認。 [2026-11-13 第3陣] メーカー外資料(en.wikipedia.org Eurorack/CV/gate/Doepfer/Modular synthesizer/Moog synthesizer)で電圧規約の一般論、V/oct対Hz/V、トリガ/ゲート種別、1V/oct歴史、Doepfer沿革を新規エンティティREF-001-011〜014として追記(third_party、low〜medium)。既存事実は変更なし。Doepfer公式値と整合を確認、発売年・沿革年・モジュール数に資料間の食い違いあり。 |
| T-002 Make Noise(Maths等の代表モジュール) | 確認済み | makenoisemusic.com の製品ページと makenoise-manuals.com のPDFマニュアル(Maths、Wogglebug、Mimeophon)を確認。ポート電圧と主要仕様は確認済み。つまみの数値範囲・MIDI系モジュール・メーカー全体の規約は未確認。指定のmakenoise.comは別組織のサイトで不採用。 |
| T-003 Moog Mother-32 | 資料不足 | 公式ユーザーマニュアルPDFを取得できず(ダウンロード一覧はクライアント描画、PDFホストはプロキシで拒否)。moogmusic.com製品ページのSpecs表(パッチベイ32点、正規化、32ステップ/64シーケンス、MIDI/アサイナブル出力)のみ確認。電圧・ゲート規約、パッチ点名、サウンド保存の有無は未確認。(2026-11-13 追記) SOS 2016レビュー(全文)とWikipediaでパッチ点名・+5V/±5V CV・アサイナブル出力16機能・MIDI機能・シーケンス64メモリを補完(basis=third_party)。ゲート閾値・音声電圧・パッチ(音色)保存の有無は依然未確認。公式マニュアルPDFはcdn.shopify.com等が403で未取得、statusはinsufficient_sourcesのまま。フィルタ種別・LFO下限・ベロシティ対応は資料間で食い違い(unconfirmed記録)。 |
| T-004 Korg MS-20 系(MS-20 mini) | 確認済み | korg.comの公式マニュアル(原機オーナーズマニュアル復刻、MS-20 miniオーナーズマニュアル、MIDI Implementation、Patch Book)を確認。原機1978年との関係はminiマニュアルの記述の範囲のみ。miniのパッチパネルのジャック数・電圧表の再掲、音色メモリの明示的有無は未確認。 |
| T-005 VCV Rack | 確認済み | 確認済み。公式マニュアル(電圧規約・ポリフォニー・Core・メニュー)とGitHub v2のソースを読んだ。OSC等の外部制御は本体に確認できず未確認項目に記録。 [2026-11-13 第3陣] メーカー外資料(en.wikipedia.org VCV_Rack/Eurorack/CV_gate)で、公式マニュアルの電圧規約を実機Eurorack慣習と照合する新規エンティティREF-005-011を追記(third_party、low〜medium)。既存事実は変更なし。 |
| T-006 Cardinal | 確認済み | 確認済み(一部)。README/LICENSES/FAQ/DIFFERENCESを読んだ。GitHub APIは接続拒否のためバージョン未確認。パッチ保存形式とOSCは未確認。 |
| T-007 BespokeSynth | 確認済み | 確認済み(ソース中心)。公式ドキュメントサイト(bespokesynth.com/docs)は接続拒否のため未取得。README・GPLソース(raw.githubusercontent.com)で確認。モジュール別の公式パラメータ記述は未確認。 |
| T-008 Pure Data(Pd) | 確認済み | 一次情報はGitHub(pure-data/pure-data)のマニュアル/ヘルプ/ソースで確認。msp.ucsd.eduはアクセス不能(unreachable)でpuredata.infoは根拠未使用。FUDI厳密形式・.pd完全文法・OSC送出側は未確認としてunconfirmedに記録。 |
| T-009 SuperCollider | 確認済み | 一次情報は doc.sccode.org(3.14.0ヘルプ)と公式GitHubで確認。Pdほか他ツールとの比較に必要なクライアント/サーバ分離・OSC・ノード順序・SynthDef形式を取得。電圧規約相当や状態保存機構は未確認としてunconfirmedに記録。 |
| T-010 Max / MSP | 確認済み | 一次情報は docs.cycling74.com のユーザガイド/リファレンスで確認。.maxpat内部スキーマ・既定OSCポート・利用条件(/legalは404)は未確認としてunconfirmedに記録。gen~/RNBOは範囲限定。 |
| T-011 Moog 大型モジュラー系(System 15/35/55、Behringer System 55) | 確認済み | Behringer SYSTEM 55/35/15と代表モジュールは公式製品ページで確認済み。Moog原機・Moog再発売品の公式資料(moogmusic.com)は該当ページ無く未確認(unconfirmed記録)。BehringerのQSG PDFはcdn-media.empowertribe.com 403で未取得。(2026-11-12 調査) (2026-11-13 追記) 原機System 55/35/15を独立systemとして維持し、SOS 2003(Leon)・Wikipedia(Moog synthesizer, CV/gate)から原機の構成(55の全モジュール表)、921/904A/911/902/960/961、1V/octとS-trig、パッチ保存手段なしを補完(basis=third_party)。原機の電圧値、35/15の構成、発売年は資料間で食い違いまたは未確認。 |
| T-012 Buchla 系(Buchla 100/200、TipTop Buchla 200t、Buchla 266 Classic Reissue) | 確認済み | Buchla公式の沿革・200e取扱説明書・Classic Reissue製品ページ、TipTop 200tマニュアルで確認済み。原機100/200の一次仕様は未入手で、ピッチ電圧規約(1.2V/oct対2.4V/oct)に資料間の食い違いあり(unconfirmed記録)。(2026-11-12 調査) (2026-11-13 追記) SOS 200e記事(2005)・Vintage Synth Explorer(100/200)・Wikipediaから原機100/200を拡充(100: 158/146/165/112、200: 258/281/266/245/292/248、Music Easel、信号規約、カード保存、タッチ/計算機IF)。ピッチ規約は1.2V/oct(200eガイド)、1.2V/oct未満(SOS)、2.4V/oct(248t)が併存し未確定、制御電圧範囲も15V/0-10V/+5・+10Vで食い違い(unconfirmed記録、basis=third_party)。 |
| T-013 ARP 系(ARP 2500、ARP 2600、Behringer 2500) | 確認済み | 2026-11-12確認済み。Korg公式(2600 FS/M の製品ページ・仕様・取扱説明書・MIDI表)とBehringer 2500系の製品ページを読了。ARP 2500/2600原機の一次仕様は未取得(原機2600取扱説明書は画像スキャンで未読)、Behringer QSG PDFは接続拒否で未取得。(2026-11-12 オーナー指示により追加) 2026-11-13追記(第3陣): 原機を二次資料で補完。Vintage Synth Explorer、Wikipedia(2600/2500/CV-gate)、Sound On Sound(ARP 2500 1996、2600 FS 2020)、CMUスタジオ解説を読了し、2600原機の改版・1V/oct・ゲート0/10V(低〜中確度)、2500のマトリクス(寸法はVSE 10x10とSOS 10x20で不一致、両論併記)・モジュール構成・約100台を追加。原機の一次資料(サービスノート)はarchive.org未許可で未読(検索要約のみ)。 |
| T-014 Roland System 系(System-100m、System-700、System-500、Behringer System 100) | 確認済み | 2026-11-12確認済み。Roland公式のSYSTEM-500(製品ページ・取扱説明書・各パラメータガイド)とBehringer System 100の4製品ページを読了。SYSTEM-100M/700原機の一次資料は未取得(700の取扱説明書は公式アーカイブ記載のみでPDFがホスト名解決不能)、BehringerのQSG PDFは接続拒否。(2026-11-12 オーナー指示により追加) 2026-11-13追記(第3陣): 原機System 100/100M/700を二次資料で補完。Vintage Synth Explorer、Wikipedia(System 100/100M/700/CV-gate)から構成・ラック・モジュール・ブロック構成を記録。電圧規約(1V/oct、ゲート3V以上等)はmanualmachine/archive.org/modwiggler未許可のためWebSearch要約のみ(低確度)。発売年や型番文字は資料間で不一致のため併記。 |
| T-015 EMS 系(VCS3、Synthi 100) | 確認済み | emssynthesisers.co.uk(EMS公式)のトップ・製品ガイド・沿革(Graham Hinton執筆)を確認し、VCS3/Synthi 100/Synthi Aのモジュール構成、ピンマトリクス(Synthi 100は60x60二枚)、シーケンサ、権利者の変遷を記録。公式の操作・保守マニュアルは見つからず、信号電圧規約・VCS3マトリクス寸法・個別モジュール仕様は未確認。製品ガイドは個人執筆の史料としてthird_party扱い。2026-11-13追記(第3陣): Sound On Sound(Gordon Reid、All About EMS Part 1/2)とWikipedia(VCS3/Synthi 100/AKS)を読了し、VCS3の16x16ピンマトリクス、抵抗入りピン(白2.7kΩ等)、電圧規約(0.32/0.26/0.20 V/oct、外部CVはその約2倍、信号レベル3〜6V)、VCO/VCF/シェイパーの個別仕様、Prestopatch、Synthi 100の60x60二枚、Computer Synthi等を追加。電圧値は単一の第三者資料(SOS)で、EMS一次資料は未確認。フィルタのスロープ(12/18dB対24dB)ほか数点は資料間で不一致のため併記。 |
| T-016 Serge 系(Serge Modular、Random*Source Serge) | 確認済み | serge-modular.com(Random*Source)の公式ページ(FAQ・About・Paperface・パネル・Euro製品ページ)とPaperface 50ユーザーガイドPDFを確認し、ジャック色による信号規約(白=DC CV、赤=トリガ、黒=バイポーラ/音声、最大±12V)、SSG/DSG/NTO等を記録。1970年代原機の一次資料と各パネルPDFマニュアルは未読、serge_4x4ページは接続リセットで未取得。 [2026-11-13 第3陣] 二次資料(en.wikipedia.org Serge synthesizer、vintagesynth.com Serge Modular)で原機の歴史(1972-83の4世代モジュール構成)、設計思想、旧ジャック色(青/黒/赤)、STS継続、Wave Multiplier・TKBを追記(basis third_party、confidence low〜medium)。年代や段数は資料間で食い違い、unconfirmedに記録。1970年代原機の一次資料は依然未入手。 |
| T-017 現行個別モジュール(AJH MiniMod、Intellijel Morgasmatron / Korgasmatron、Behringer SPACE FX) | 確認済み | AJH Synth(ajhsynth.com)のMiniMod系マニュアルPDF/製品ページ、Intellijel Morgasmatronの公式マニュアルと製品ページ、Korgasmatron IIはIntellijel掲載の第三者補足資料と旧製品一覧、Behringer SPACE FXは製品ページを確認。SPACE FXはクイックスタートガイド(V 2.0)を取得し、パラメータ範囲・入出力仕様を記録(電圧範囲・保存・外部制御は記載なしで未確認、消費電流は製品ページと不一致)。Korgasmatron IIの公式マニュアルは未取得。 |

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
| REF-001-011 | Eurorack公称の基準年(1995仕様化か1996発売か)とモジュール数の最新値 | SRC-001-11, SRC-001-13 | 歴史年表に使う場合は両説を併記し、数値は出典日付付きで扱う。 |
| REF-001-012 | 1V/octを最初に導入した歴史的一次資料(Moog 1964年論文等) | SRC-001-15, SRC-001-12 | 歴史的起源の記述は二次資料に依存。仕様化では「普及させた」の程度に留める。 |
| REF-001-013 | Doepfer以外のEurorackモジュールの個別ゲート閾値 | SRC-001-11, SRC-001-12 | 閾値は個体差があるため、仕様化では範囲で記し、モジュール別は各取扱説明書で確認が必要。 |
| REF-001-014 | Doepferフェイザーの開発年(1977年か1979年か)とA-100初出年 | SRC-001-13, SRC-001-11 | 沿革の年表に使う場合は不確実性を明示。公式の「Zeit-Tabelle」(doepfer.de)は未取得。 |

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
| REF-003-001 | Official user manual PDF: Moog download listing is client-rendered; candidate PDF host cdn.shopify.com and api.moogmusic.com refused (403); third-party mirrors (manualslib, manualmachine, scribd) deliberately not used | SRC-003-02, SRC-003-05, SRC-003-06 | Manual-level detail (exact jack list per point, voltage levels, normalling, setup procedures) still rests on reviews; high-confidence values missing |
| REF-003-002 | Gate/trigger thresholds and CV/audio voltage levels of the patchbay (not in product page nor SOS review) | SRC-003-01, SRC-003-03 | Cannot specify jack electrical levels beyond +5 V pulses and +-5 V assignable CVs |
| REF-003-004 | Conflicting filter type (Moog/SOS: ladder; Wikipedia: state-variable), LFO low limit (0.1 Hz vs 1 Hz panel), velocity/aftertouch support (SOS yes via Assignable; Wikipedia no). Not resolved; both kept. | SRC-003-01, SRC-003-03, SRC-003-04 | Use Moog page + SOS (agree) as primary; Wikipedia treated as low-confidence outlier |
| REF-003-009 | Sequence retention at power-off and exact behaviour of Version 2.0 firmware (adds sequencer functions per search summary) | SRC-003-03, SRC-003-06 | Cannot state whether saved sequences survive power-off or what v2.0 changed |

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
| REF-005-011 | VCV Rackのトリガ10Vと実機モジュール(5V系)を直結した際の実機側の挙動 | SRC-005-07, SRC-005-08 | 実機モジュールのゲート閾値は個体差があるため、橋渡し時はレベル確認が必要。 |

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

### T-011 Moog 大型モジュラー系(System 15/35/55、Behringer System 55)

| 対象エンティティ | 不足項目 | 試した資料 | 仕様化への影響 |
|---|---|---|---|
| REF-011-004 | Moog原機System 55の一次仕様(モジュール構成・寸法・電源・信号電圧規約) | SRC-011-11, SRC-011-12 | 原機の仕様をモデル化できず、再現品との差分を比較できない |
| REF-011-005 | Moog原機System 35の一次仕様 | SRC-011-11, SRC-011-12 | 同上 |
| REF-011-006 | Moog原機System 15の一次仕様 | SRC-011-11, SRC-011-12 | 同上 |
| (対象全体) | Moog Musicによる2015年前後の再発売品(System 15/35/55)の現行公式資料(マニュアル・仕様)。moogmusic.comのサイトマップに該当製品ページなし | SRC-011-11, SRC-011-12 | 再発売品を独立したsystemエンティティとして記録できない。系譜の中間(原機→Moog再発売→Behringer)が欠ける |
| REF-011-013 | ピッチCV規約(1V/oct等)・CV範囲・トリガ電圧レベル(V-trig/S-trigの具体値) | SRC-011-01, SRC-011-10 | 信号規約の数値化ができない。Behringer QSG(PDF)が取得不能のため |
| REF-011-001 | Behringer System 55 クイックスタートガイド全文(パッチ手順・コントロール範囲) | SRC-011-10 | 個別パラメータの範囲・既定値が未確認 |
| REF-011-007 | 921B各出力のレベル・周波数範囲 | SRC-011-04, SRC-011-10 | ポートrangeを記録できない |
| REF-011-008 | 904Aのカットオフ周波数範囲・CV感度 | SRC-011-05, SRC-011-10 | パラメータ範囲を記録できない |
| REF-011-010 | 960の各行CVレンジ値・クロック周波数範囲 | SRC-011-07, SRC-011-10 | CV出力範囲を記録できない |
| REF-011-022 | 原機の個別モジュールのピッチ入力スケーリング(1V/octの厳密度)・CV範囲・S-trigの電圧/電流値 | SRC-011-13, SRC-011-14, SRC-011-15, SRC-011-16 | 原機の信号規約を数値化できず、Behringer版との電気的互換の比較ができない |
| REF-011-005 | 原機System 35/15の個別モジュール構成と発売年(55のみSOSに構成表あり) | SRC-011-13, SRC-011-16 | 35/15を構成表レベルで比較できない |
| REF-011-016 | 原機921の周波数範囲(SOS:100kHz超、検索要約:0.01Hz-40kHz)と原機のジャック形状(パッチケーブル規格) | SRC-011-13, SRC-011-16 | オシレータ範囲とコネクタ互換が確定しない |
| REF-011-004 | Moog原機のマニュアル/サービスマニュアル(moogarchives.com等は名前解決・許可外) | SRC-011-16 | 一次資料が無く、第三者資料のみの記録になる |

### T-012 Buchla 系(Buchla 100/200、TipTop Buchla 200t、Buchla 266 Classic Reissue)

| 対象エンティティ | 不足項目 | 試した資料 | 仕様化への影響 |
|---|---|---|---|
| REF-012-001 | 原機200シリーズの電圧規約・モジュール仕様(1次資料。1970年代当時のマニュアル) | SRC-012-01, SRC-012-07, SRC-012-14, SRC-012-15 | 原機のピッチ規約等を確定できない。再発売/200e/200tの記述に依拠 |
| REF-012-002 | 100シリーズの個別モジュール仕様・電圧規約 | SRC-012-01 | 100シリーズは来歴以外の仕様を記録できない |
| REF-012-006 | 266再発売の個別ジャック名・出力電圧範囲・電源(HP/電流) | SRC-012-03 | ポート範囲・電源要件を記録できない(製品ページに記載なし) |
| REF-012-013 | 原機(200系)のピッチ電圧規約。200eガイドは1.2V/octと記し、248tマニュアルは原機が2.4V/octと述べ、記述が食い違う | SRC-012-07, SRC-012-14, SRC-012-15 | ピッチ規約を単一値に確定できない。系列ごと(200e=1.2V/oct、200t=1V/oct)で別記する |
| REF-012-013 | Classic Reissue(258/266等)のピッチ入力規約(1V/octか1.2V/octか) | SRC-012-02, SRC-012-03, SRC-012-04 | 再発売品とEurorack版の相互接続仕様が確定できない |
| (対象全体) | Buchla 100/200原機の公式マニュアル(1963-1970年代)。buchla.comは歴史ページのみ。248の1977年マニュアルはスキャン画像でテキスト抽出不可 | SRC-012-01, SRC-012-15 | 原機の個別モジュール仕様は記録できない |
| REF-012-004 | Classic Reissue各機の電源要件・サイズ・端子電圧(buchla.comの製品ページに記載なし) | SRC-012-02, SRC-012-03, SRC-012-04, SRC-012-05, SRC-012-06 | Eurorack/ケース互換性などの設計制約が不明 |
| REF-012-005 | 200tの266t以外の機種の詳細(207t〜296tの大半) | SRC-012-09 | 200tは一覧のみ記録、個別の機能は代表機のみ |
| REF-012-029 | 原機200(およびlate 200)の制御電圧範囲: 15V(Buchla archives要約・SOS最大約15V) / 0-10V(ブログ要約) / 200e=+5/+10V(SOS) | SRC-012-16, SRC-012-20, SRC-012-21 | 原機のCV/パルス電圧を単一値に確定できない。200系は系列別に併記 |
| REF-012-029 | 原機のピッチ電圧規約: 1.2V/oct(200eガイド)、1.2V/oct未満(SOS 200e)、2.4V/oct(248tマニュアルの原機記述)。100シリーズのピッチ規約は資料なし。 | SRC-012-16, SRC-012-20, SRC-012-21, SRC-012-07, SRC-012-14 | 系列横断のピッチ規約表を作れない。原機の一次マニュアル(Buchla archives等)が必要 |
| REF-012-030 | Music Easelカードの保存対象(SOS: 抵抗値のみ / VSE: スライダー・スイッチ・ノブ・パッチポイント接続) | SRC-012-16, SRC-012-18 | パッチ保存機構を仕様化できない |
| REF-012-027 | Buchla 292の機能(VSE: 4VCF+パンニング / Buchla再発売: 4VCA・ローパスゲート) | SRC-012-18, SRC-012-06 | 292の分類(amplifier_mixer/filter)に影響 |
| (対象全体) | buchlaarchives.com、modularsynthesis.com(Roman Filippov)、web.uvic.ca(200eガイドPDF)、perfectcircuit.com、nmc.emuseum.com等はプロキシ403で未取得 | SRC-012-20, SRC-012-21 | 一次寄りの電圧規約資料に到達できていない |
| REF-012-002 | 100シリーズ130の機能(SOS: Dual envelope detector / Forrest表: Dual Envelop Generator) | SRC-012-16, SRC-012-17 | 130をenvelopeかmodulation_otherのどちらに分類するか決められないため個別エンティティ化しない |

### T-013 ARP 系(ARP 2500、ARP 2600、Behringer 2500)

| 対象エンティティ | 不足項目 | 試した資料 | 仕様化への影響 |
|---|---|---|---|
| REF-013-001 | 原機ARP 2600の電圧規約・各モジュール仕様(原機取扱説明書はPDFを取得したが画像スキャンでテキスト層がなく、内容未読) | SRC-013-14, SRC-013-03 | 原機固有の仕様・電圧は再発売品(FS/M)の資料の範囲に限って記録。原機そのものを仕様の根拠にはできない |
| REF-013-004 | ARP 2500原機のモジュール構成、マトリクススイッチの仕様(行列数・接続方式)、電圧規約 | SRC-013-04, SRC-013-08 | マトリクス式パッチの具体仕様を定義できない。Korgの財団紹介文とBehringer販促ページの断片的記述のみ |
| REF-013-005 | Behringer 2500系のQuick Start Guide(PDF) | SRC-013-13 | ポート単位の電圧範囲・ゲート閾値・信号レベルなどの詳細仕様が取得不能(cdn-media.empowertribe.com が403で接続拒否)。製品ページの記述のみで記録 |
| REF-013-005 | Behringer 2500系にマトリクス式パッチを再現する製品があるか | SRC-013-08, SRC-013-09 | 製品ページに記載なし。確認できたのはケーブル/Eurorack方式のモジュールのみ |
| REF-013-005 | 1033 Dual Envelope Generator Moduleの詳細仕様 | SRC-013-15 | 見出しの説明文のみ確認し機能詳細は未読のため、エンティティ化していない |
| REF-013-002 | 2600 FS/Mのパッチ保存機能の有無 | SRC-013-03, SRC-013-06 | 取扱説明書にデジタルなパッチ保存機能の記載は確認していないが、無いことの明記も確認していない |
| REF-013-003 | 2600 Mの取扱説明書本文による各モジュール詳細(FSと差異のある点) | SRC-013-06, SRC-013-05 | MIDI節とスピーカー節以外はFS資料との差を精査していない。VCO等の仕様はスペック表上FSと同一 |
| REF-013-015 | MIDI CC#01の受信がMIDI実装表に載っていない理由、MIDIチャンネルのデフォルト | SRC-013-06, SRC-013-07 | CC受信の仕様を断定できない |
| REF-013-001 | 原機2600の4012/4072フィルタ・各モジュールの公称仕様、音声信号レベル、CV出力範囲 | SRC-013-16, SRC-013-18, SRC-013-22, SRC-013-24 | 原機の電圧・レンジを仕様化できない。FS(REF-013-006)のKorg仕様と比較するには一次資料が必要。 |
| REF-013-001 | 原機2600の製造終了年(VSE=1980年、Wikipedia=1981年)と総生産数(VSE=最大約3000台の推計) | SRC-013-16, SRC-013-18 | 年表と台数の正確な比較ができない。両説を別事実として併記した。 |
| REF-013-030 | マトリクス寸法(VSE=10x10、SOS=10x20)の食い違いの解消、および2500の電圧規約(ピッチ・ゲート・信号レベル) | SRC-013-17, SRC-013-20, SRC-013-19 | マトリクスの比較仕様(行列数)が確定できない。両説を併記。 |
| REF-013-021 | 原機の一次資料(Service Notes・取扱説明書)の本文。Internet Archiveはホスト未許可で取得不能。検索結果要約のみ | SRC-013-24 | 電圧規約・トリマ手順が二次資料のみ。archive.org を許可すれば確認できる。 |
| REF-013-031 | 原機のパッチシート等の紙媒体によるパッチ記録の慣習 | SRC-013-16, SRC-013-17 | 物理パッチの再現手順(記録方法)の仕様化に影響。 |
| REF-013-024 | 3620のCV/ゲート出力電圧範囲(原機) | SRC-013-21 | FSのKorg仕様は取得済みだが原機の値は確認できない。 |

### T-014 Roland System 系(System-100m、System-700、System-500、Behringer System 100)

| 対象エンティティ | 不足項目 | 試した資料 | 仕様化への影響 |
|---|---|---|---|
| REF-014-001 | SYSTEM-100M原機のモジュール構成・電圧規約・仕様(Roland公式の原機資料) | SRC-014-01, SRC-014-13 | roland.com/global/products/system-100m は404で原機の公式製品ページ未確認。SYSTEM-500/Behringer側の記述から関係を示すのみ |
| REF-014-002 | SYSTEM-700原機の取扱説明書(PDF)の内容 | SRC-014-14, SRC-014-13 | 公式アーカイブ(lib.roland.co.jp)のホスト名が解決できず取得不能。原機のモジュール構成と信号規約は記録不能 |
| REF-014-004 | SYSTEM-500のゲート/トリガ閾値電圧、CV出力電圧範囲、オーディオ出力レベル | SRC-014-07, SRC-014-01, SRC-014-08 | 取扱説明書とパラメータガイドに数値の記載なし。ゲート検出の仕様化に影響 |
| REF-014-005 | 512の『8'で2V印加で中央C』の対象ジャック(KEY INか他か)とピッチ基準の厳密値 | SRC-014-08 | 注記が簡略で対象ジャックが不明。ピッチ基準の定義に影響 |
| REF-014-010 | System 100のうち121/130/150/172/173/297/305の詳細仕様 | SRC-014-15 | 検索結果の存在のみ確認し製品ページ本文は未読のため、エンティティ化していない |
| REF-014-013 | 140 Dual Envelope/LFOの消費電流 | SRC-014-17 | 同一ページの概要欄(各レール40mA)と仕様欄(+12V 50mA/-12V 50mA)で数値が異なるため記録しない |
| REF-014-010 | Behringer System 100各モジュールのQuick Start Guide(PDF)の内容(ポート電圧範囲等) | SRC-014-19 | cdn-media.empowertribe.com が403で接続拒否。ポート単位の電圧・閾値は取得不能 |
| REF-014-015 | SYSTEM-500/System 100にデジタルなパッチ保存・MIDI機能があるか | SRC-014-01, SRC-014-07 | 仕様欄に該当の記載は確認できなかったが、無いことの明記はない |
| REF-014-018 | 100Mの電圧規約(サービスマニュアル本文の電圧・インピーダンス値の確認)。manualmachine.comは未許可で取得不能 | SRC-014-28, SRC-014-25, SRC-014-21 | ゲート/トリガ電圧、入出力レベルを一次資料で確認できない。manualmachine.com 等の許可で解決可能。 |
| REF-014-019 | System 700取扱説明書(archive.org)本文。ゲート電圧・信号レベル | SRC-014-29, SRC-014-24, SRC-014-22 | 700の電圧規約が1V/oct以外確認できない。 |
| REF-014-001 | 発売年(1978年=System 700記事、1979年=100M記事)と製造終了年 | SRC-014-25, SRC-014-24 | 年表の確定ができない。両説を併記。 |
| REF-014-002 | 703/702のモジュール文字(A〜G)の割り当てがVSEとWikipediaで一致しない | SRC-014-22, SRC-014-24 | モジュール型番の正確な一覧が確定できない。 |
| REF-014-029 | パッチ記録用ブック(パッチブック)・メモリの有無 | SRC-014-21, SRC-014-22, SRC-014-24 | パッチ再現手順の仕様化に影響。 |
| REF-014-017 | System 100のゲート/トリガ電圧(検索要約では+14V想定との言及。本文未読) | SRC-014-30, SRC-014-26 | 半モジュラー系譜の電圧比較が未完。 |

### T-015 EMS 系(VCS3、Synthi 100)

| 対象エンティティ | 不足項目 | 試した資料 | 仕様化への影響 |
|---|---|---|---|
| REF-015-001 | VCS3 matrix size, line assignments, voltage levels, oscillator and filter specifications | SRC-015-03, SRC-015-04, SRC-015-05 | Pin-matrix voltage conventions cannot be compared with other signal standards; the product guide gives module lists only. |
| REF-015-005 | Official EMS operating manual or service manual with signal levels | SRC-015-03, SRC-015-04 | Matrix patching is recorded structurally only; electrical conventions are unspecified. |
| REF-015-002 | Current production specification and a dated current price/availability | SRC-015-03 | Home page dated May 2020; reissue vs. original differences cannot be listed. |
| REF-015-011 | Patch recall methods (removable boards, documentation charts) | SRC-015-04 | Patch storage for pin-matrix instruments is recorded as absent-from-documentation, not confirmed absent. |
| REF-015-003 | Computer Synthi / Synthi E / Spectron details (guide sections not read) | SRC-015-04 | Digital-control variants of the Synthi 100 line not recorded. |
| REF-015-001 | Official emssynthesisers.co.uk owner-run pages besides home/products/history/adverts (manuals, modification page at hinton-instruments.co.uk) | SRC-015-01, SRC-015-02 | hinton-instruments.co.uk is not an allowed host; servicing/modification data not read. |
| REF-015-005 | Voltage scalings and signal levels come from a single Sound On Sound author; EMS documentation unread | SRC-015-06, SRC-015-11 | Comparison with 1 V/oct systems relies on one third-party source. |
| REF-015-007 | Filter slope disagreement (12/18 dB vs 24 dB) | SRC-015-06, SRC-015-08 | Filter specification cannot be fixed; both retained. |
| REF-015-006 | Osc 1/2 exact frequency limits; search summaries disagree and bigbluewave.co.uk is not reachable | SRC-015-06, SRC-015-11 | Oscillator range spec incomplete. |
| REF-015-003 | Synthi 100 sequencer exact structure (three layers / six tracks, 256 events) and total units (30 vs fewer than 40) | SRC-015-09, SRC-015-07 | Sequencer and production figures not settled. |
| REF-015-001 | Red-pin tolerance (1% vs 2%) and matrix row/column assignment tables | SRC-015-06, SRC-015-08 | Pin resistance spec incomplete; row/column allocation per signal not read. |
| REF-015-012 | Exact jack lead (MIDI/CV) specification | SRC-015-06 | Interface not specifiable. |

### T-016 Serge 系(Serge Modular、Random*Source Serge)

| 対象エンティティ | 不足項目 | 試した資料 | 仕様化への影響 |
|---|---|---|---|
| REF-016-001 | Original 1970s Serge module specifications and 1979 catalogue data | SRC-016-06 | Original-vs-reissue differences are limited to the manual's remarks (improved tracking, 2022-23 revisions). |
| REF-016-003 | Per-module input/output impedance and precise CV range across modules; 1V/Oct scale only on VCO | SRC-016-06, SRC-016-07 | Typical ranges known (+/-12 V limit); module-specific CV scaling must be read from each manual. |
| REF-016-005 | NTO frequency range, waveform outputs and calibration | SRC-016-11 | Oscillator spec incomplete; page gives no technical table. |
| REF-016-006 | DSG time ranges and CV scaling | SRC-016-10 | Slope times not numerically specified. |
| REF-016-008 | 1973 filter frequency range and CV scaling | SRC-016-06 | Filter range unspecified. |
| REF-016-010 | Whether any Serge sequencer/programmer module stores patterns non-volatilely (Sequencer 8, SEQ4, SEQQ) | SRC-016-06, SRC-016-07 | Pattern storage is unknown; Paperface manual sequencer sections not read in detail. |
| REF-016-002 | Manuals for Mantra II, La Bestia III, Tantra, Yantra (PDF links on the panels page); Serge 4x4 page (connection reset on fetch) | SRC-016-07 | Panel-level module details not read; serge_4x4 page unreachable at attempt. |
| REF-016-003 | Which jack colour scheme (blue/black/red/yellow vs white/red/black) applied to which production era | SRC-016-12, SRC-016-03 | Colour-to-signal mapping in a spec must be tied to era (1970s vs Random*Source); Wikipedia and maker text differ and neither is original documentation. |
| REF-016-012 | Dates of Serge origin (1972/73/74 start, production end 1986 vs 1983) | SRC-016-12, SRC-016-13 | Timeline in the reference should state both and not pick one. |
| REF-016-015 | Wave Multiplier circuit behaviour, ports and ranges | SRC-016-13, SRC-016-12 | Cannot specify the module beyond a description. |
| REF-016-016 | Actual TKB sequencer stage count per era | SRC-016-12, SRC-016-13, SRC-016-11 | Do not state a stage count in a spec without original documentation. |
| REF-016-012 | Original 1970s manuals and catalogue (first-hand data for generations) | SRC-016-12, SRC-016-13 | All generation data here is encyclopedic; Wikipedia page itself carries reliability banners. |
| REF-016-010 | Patch storage in original Serge systems (none mentioned in either secondary source) | SRC-016-12, SRC-016-13 | Treat as no patch memory only as an absence of evidence, not a confirmed negative. |

### T-017 現行個別モジュール(AJH MiniMod、Intellijel Morgasmatron / Korgasmatron、Behringer SPACE FX)

| 対象エンティティ | 不足項目 | 試した資料 | 仕様化への影響 |
|---|---|---|---|
| REF-017-002 | Octave switch positions and absolute frequency range of the oscillator | SRC-017-01 | Frequency range per octave setting is unknown; the pitch scale in Hz cannot be specified. |
| REF-017-003 | Cutoff frequency range in Hz and CV input voltage ranges (Freq, 1/3, 2/3, Emphasis CV, output level) | SRC-017-02 | CV input ranges and output voltage cannot be specified; the output stage level is only stated in the web page as bringing signals to +/-5 V pp. |
| REF-017-005 | Glide time range in seconds | SRC-017-04 | Maximum and minimum glide times are not given numerically in the manual text read. |
| REF-017-006 | Per-jack voltage ranges for X/Y/Z inputs and output; sub-bass tracking limits | SRC-017-05 | Only partial ranges known; full port range table not specified. |
| REF-017-007 | CV input voltage ranges and gain scaling | SRC-017-06 | CV ranges not captured from the web page read; PDF manual not fetched. |
| REF-017-009 | Whether any MiniMod module has electronic preset or CV-controlled memory | SRC-017-07, SRC-017-01, SRC-017-02, SRC-017-03, SRC-017-04 | All modules read are fully analog with knobs and switches; storage is assumed absent but not stated. |
| REF-017-010 | CV input voltage ranges, output levels, cutoff frequency range | SRC-017-08, SRC-017-09 | Port voltage ranges cannot be specified beyond the typical 10 Vp-p reference. |
| REF-017-010 | Signal flow diagram contents (image only in the manual) | SRC-017-08 | Exact internal routing beyond the textual description is not captured. |
| REF-017-011 | Original Korgasmatron II manual, specs (HP width, current draw, voltage ranges), release years, Korgasmatron I details | SRC-017-10, SRC-017-11 | Only functional layout from a supplement; no official spec table. Generation order (I, II, III=Morgasmatron) rests on one Intellijel sentence. |
| REF-017-011 | Hardware relationship to the Korg MS-20 filter (circuit lineage claim) | SRC-017-08, SRC-017-10 | Only the Morgasmatron manual mentions the MS-20 filter's behaviour; no statement that Korgasmatron copies its circuit was read. |
| REF-017-012 | Release date and firmware/version | SRC-017-12 | Version unknown. |
| (対象全体) | Intellijel Morgasmatron/Korgasmatron and AJH MiniMod voltage references for modules not read (Gemini 2412, Sonic XV, V-Shape etc.) | SRC-017-07 | Only a subset of the MiniMod range was read; other modules are not covered. |
| REF-017-012 | Port voltage ranges, parameter defaults, whether settings persist after power-off, and external control beyond the front panel | SRC-017-12, SRC-017-13 | The Quick Start Guide gives parameter ranges and impedances but no voltage levels, defaults or storage statement; persistence is unknown. |

## アクセス不能だった資料

| 出典ID | 資料 | URL |
|---|---|---|
| SRC-003-02 | Mother-32 User Manual / Quickstart (Moog downloads listing) | https://www.moogmusic.com/downloads/?product=Mother 32&type=User Manual |
| SRC-003-05 | Mother 32 Users Manual (PDF found via WebSearch, Shopify CDN) | https://cdn.shopify.com/s/files/1/0527/2557/9960/files/Mother_32_Users_Manual.pdf |
| SRC-003-06 | Moog Mother-32 manual listings (WebSearch result summaries: manualslib, manualmachine, scribd etc.) | https://www.manualslib.com/manual/988819/Moog-Mother-32.html |
| SRC-006-04 | GitHub API releases/latest (DISTRHO/Cardinal) | https://api.github.com/repos/DISTRHO/Cardinal/releases/latest |
| SRC-007-17 | BespokeSynth 公式ドキュメント | https://www.bespokesynth.com/docs/ |
| SRC-008-05 | Pd Documentation(msp.ucsd.edu) | https://msp.ucsd.edu/Pd_documentation/index.htm |
| SRC-010-13 | Legal / 利用条件ページ | https://docs.cycling74.com/legal |
| SRC-011-10 | SYSTEM 55 クイックスタートガイド(WW版PDF) | https://cdn-media.empowertribe.com/634690dab10a4e7389634d344473791d/QSG_BE_0720-ACU_System-55_WW.pdf |
| SRC-011-12 | Moog Music Forum(再発売品マニュアル等のスレッド) | https://forum.moogmusic.com/viewtopic.php?t=24268 |
| SRC-011-16 | Moog System 15/35/55 関連の検索結果要約(WebSearch) | https://notebook.zoeblade.com/900_Series_Moog.html |
| SRC-012-20 | From the Archives (Buchla archives blog) | https://www.buchlaarchives.com/blog/from-the-archives-1 |
| SRC-012-21 | Sequencers using 1.2V/oct Buchla format (blog) | https://djjondent.blogspot.com/2023/11/sequencers-using-12voct-buchla-format.html |
| SRC-013-13 | Quick Start Guide FILTAMP MODULE 1006 (PDF) | https://cdn-media.empowertribe.com/7f580bcc2111431283fe25108aba228f/QSG_BE_0720-ABU_FILTAMP-MODULE-1006_WW.pdf |
| SRC-013-24 | ARP 2600-2606 Service Notes (Internet Archive、全文テキスト) | https://archive.org/stream/synthmanual-arp-2600-2606-service-notes/arp2600-2606servicenotes_djvu.txt |
| SRC-014-14 | SYSTEM700 Owner's Manual (archive PDF) | http://lib.roland.co.jp/support/en/manuals/res/62960132/SYSTEM700_e.pdf |
| SRC-014-19 | Quick Start Guide 182 SEQUENCER (PDF) | https://cdn-media.empowertribe.com/83cf9a369bae492ba6f23668e7ec9f90/QSG_BE_0720-AAE_182-SEQUENCER_WW.pdf |
| SRC-014-28 | Roland SYSTEM 100M Service Manual (ManualMachine) | https://manualmachine.com/roland/system100m/7760628-service-manual/ |
| SRC-014-29 | System 700 owner's manual (Internet Archive 全文テキスト) | https://archive.org/stream/synthmanual_System_700_owners_manual/System_700_owners_manual_djvu.txt |
| SRC-014-30 | Roland system 100 gate voltage (MOD WIGGLER) | https://www.modwiggler.com/forum/viewtopic.php?t=33017 |
| SRC-015-01 | EMS VCS3 / Synthi 100 official site (candidate host) | https://www.ems-synthi.demon.co.uk/ |
| SRC-015-02 | EMS / Synthi / VCS3 candidate hosts (ems-synthi.com, synthi.com, vcs3.com) | https://www.vcs3.com/ |
| SRC-015-11 | EMS VCS3 specification pages (bigbluewave.co.uk, Vintage Synth Explorer forum) | http://www.bigbluewave.co.uk/ems_synthi_vcs3.htm |
