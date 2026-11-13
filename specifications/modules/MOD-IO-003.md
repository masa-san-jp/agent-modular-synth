---
spec_id: MOD-IO-003
title: メーター/スコープ
status: specified
category: io_utility
version: 0.1
refs: [F-005-008, F-005-009, F-005-014, F-005-003, F-001-007, F-002-015, I003]
common: [COM-01, COM-02, COM-05, COM-06, COM-09, COM-10, COM-12, COM-13, COM-14, COM-15]
stateful: true
---
# MOD-IO-003 メーター/スコープ

## 1. 目的と範囲
- 目的: 任意の信号(音声またはCV)を素通しで中継しながら、その値を**読み出せる形**(ピーク、RMS、平均、最小・最大、直近の波形フレーム)で記録する。エージェント(外部制御)や#3のUIが「今この信号は何ボルトか」「波形はどうか」を確認するための計測モジュールで、信号処理には影響しない。1サンプルの処理は「入力を読む → 測定の累積・波形リングバッファ・トリガを更新 → THRUへ素通し」。
- 含む: 窓単位のピーク/RMS/平均/最小/最大、リセットまでの絶対ピーク、非有限値の計数、トリガ付き(または連続)の波形フレーム取得。
- 含まない: 描画(波形やメーターの表示。catalogの方針)、周波数解析(FFT)、ラウドネス(LUFS等)、外部トリガ入力、複数チャンネルの同時表示、読出しの伝送方法(#3のデータ契約)。

## 2. 由来と抽象化
| ID | 種別 | 記述 | 根拠 |
|---|---|---|---|
| S-01 | [R] | ケーブル上の値はボルト単位で扱われる。したがって計測値(ピーク、RMS等)もボルトで表す | F-005-008(high) |
| S-02 | [R] | 音声は約±5 V(10 Vpp)、CVは0〜10 Vまたは±5 Vが典型。計測値の想定レンジとトリガ・レベルの既定値(0 V)の参照 | F-005-009(high), F-001-007(high) |
| S-03 | [R] | 有限入力でNaN/∞を出しうるモジュールは0を返すべき。本仕様は入力のNaN/∞を0として統計に使い、THRUにも0を出す。加えて、その回数を数えて診断に使う([A] S-07) | F-005-014(high) |
| S-04 | [R] | エンジンは各モジュールを1/サンプルレートずつ進める(サンプル単位)。測定の時間軸は「サンプル番号」を基準にし、秒は `fs` で換算する | F-005-003(high) |
| S-05 | [R] | 原機の表示の例(参考): Mathsのunity出力に付くLEDは正を緑、負を赤で約±8 Vを示す。実機の表示の挙動は再現しない(描画は含まない)。二次資料ではなくメーカー記述(確度high) | F-002-015(high) |
| S-06 | [A] | 窓は**固定長のブロック**(連続し重ならない)。1窓が閉じるたびに結果を保持値(ラッチ)に書き込み、次の窓が閉じるまで保持する。理由: スライド窓はリング保持が必要で、結果が窓の端で連続的に変わり読出しの再現性が下がる。ブロックなら同じ入力列から同じ値が必ず得られる | 独自設計(資料にない) |
| S-07 | [A] | NaN/±∞の計数(`nonfinite_count`)を持つ。理由: COM-12で0に置換すると不具合が隠れるため、診断用に数を残す | COM-12 |
| S-08 | [A] | 波形フレームは、トリガ(入力がレベルを上/下に横切る)で開始位置を決める。トリガ前の `pre` サンプルを含める。トリガ・保持・シングルショット等のオシロスコープ機能は最小にとどめる。理由: 原機のスコープ仕様はDBにない | なし(独自設計) |
| S-09 | [X] | ハード機器のメーター(LED、VU)、オシロスコープ(画面)を、計測値とサンプル配列の読出しに抽象化 | F-002-015 |

方式選択: 「ブロック(非重複窓)の統計+リングバッファ+エッジトリガ」。代替(指数移動平均のVUメーター、スライド窓、ピークの減衰保持)は、挙動の式が資料になく、読出しの決定性が低いため採用しない。

## 3. ポート
| 名前 | 方向 | 型 | ch | 単位 | 範囲 | 更新周期 | 未接続時 |
|---|---|---|---|---|---|---|---|
| IN | in | audio | 1 | V | 任意の有限値(NaN/±∞は0 V扱い。回数は`nonfinite_count`) | サンプル毎 | 0 V |
| THRU | out | audio | 1 | V | IN(整形後)と同じ。NaN/±∞は0 | サンプル毎 | 出力は未接続でも通常どおり計算 |

- 型は`audio`だがCV・ゲートも通せる(COM-01、型は意味のタグ)。
- ポートはモノ(1ch)。ポリ入力は1ch目のみ測定する。[A] (COM-08の初期方針)
- 読出し値(ポートではなく、外部インターフェースから取得する。伝送形式は#3):

  - `level`(float, V, 直近のサンプル値、サンプル毎に更新、IN未接続時0)
  - `peak`(float, V, ≥0, 窓が閉じたときに更新、IN未接続時0)
  - `rms`(float, V, ≥0, 窓が閉じたときに更新、IN未接続時0)
  - `mean`(float, V, 任意の有限値, 窓が閉じたときに更新、IN未接続時0)
  - `vmin`, `vmax`(float, V, 窓が閉じたときに更新、IN未接続時0, 0)
  - `windows`(uint32, 閉じた窓の個数, 窓が閉じたときに更新、未接続でも増える)
  - `peak_hold`(float, V, ≥0, サンプル毎に更新、IN未接続時0)
  - `nonfinite_count`(uint32, NaN/∞のサンプル数, サンプル毎に更新、IN未接続時0)
  - `frame`(float配列、長さ `capture_len`, V, フレーム完了時に更新、初期は全て0)
  - `frame_seq`(uint32, 完了したフレーム数, フレーム完了時に更新、トリガなしなら0のまま)

## 4. パラメータ
| 名前 | 単位 | 範囲 | 既定値 | 変調 | 更新タイミング | 補間 |
|---|---|---|---|---|---|---|
| window_ms | ミリ秒 | 1〜1000。有限の範囲外はクランプ。NaN/∞は既定100 | 100 | なし(CV入力を持たない) | 次のステップ。窓長 `W` は閉じ判定のたびに再計算(進行中の累積は保持) | なし |
| capture_len | サンプル(整数) | 4〜4096。最近接整数へ四捨五入(0.5は切り上げ。例 7.5→8)後にクランプ(COM-13)。NaN/∞は既定512 | 512 | なし | 次のステップ。値が変わるとスクラッチ状態(リング、フレーム、トリガ進行)を初期化(§5) | なし |
| trig_mode | 列挙(0=連続、1=立ち上がり、2=立ち下がり。整数型として扱う) | 0〜2。四捨五入後にクランプ(COM-13)。NaN/∞は既定1 | 1 | なし | 次のステップ | なし |
| trig_level | V | −12〜+12。有限の範囲外はクランプ。NaN/∞は既定0 | 0 | なし | 次のステップ | なし |
| pre | サンプル(整数) | 0〜`capture_len−1`。四捨五入後にクランプ(COM-13)。NaN/∞は既定0。トリガ時点の値を使う | 0 | なし | 次のステップ(進行中の取得は開始時の値を使う) | なし |

- パラメータのNaN/∞は**既定値**(window_ms=100, capture_len=512, trig_mode=1, trig_level=0, pre=0)として扱い、有限の範囲外値はクランプする(COM-12/13)。この置換は `nonfinite_count` に数えない(`nonfinite_count` は入力 IN のNaN/∞の回数)。
- CV入力を持たないため、CV感度(COM-18)はない。
- 乱数は使わない(`seed` なし)。

## 5. 内部状態と初期化・リセット
| 名前 | 型 | 初期値 | 意味 |
|---|---|---|---|
| cnt | int | 0 | 現在の窓の累積サンプル数 |
| sum, sumsq | float64 | 0, 0 | 窓内の和と二乗和(倍精度) |
| mn, mx, am | float | +∞, −∞, 0 | 窓内の最小、最大、絶対値最大(窓が閉じると初期値へ戻す) |
| peak, rms, mean, vmin, vmax | float | 0 | 直前に閉じた窓の結果(保持値) |
| windows | uint32 | 0 | 閉じた窓の個数 |
| peak_hold | float | 0 | リセット以降の `abs(x)` の最大 |
| nonfinite_count | uint32(飽和加算) | 0 | NaN/±∞が来たサンプル数 |
| ring[4096] | float | 全て0 | 直近サンプルのリングバッファ(使用長は `capture_len`) |
| wp | int | 0 | リングの書込み位置 |
| prev | float | 0 | 直前のサンプル値(トリガの横切り判定) |
| remain | int | −1 | トリガ後に残るサンプル数(−1=待機中) |
| fc | int | 0 | 連続モードのカウンタ |
| frame[capture_len] | float | 全て0 | 直近の完了フレーム |
| frame_seq | uint32 | 0 | 完了フレーム数 |

- リセットの種類(COM-10): `reset()` の**全体リセット**のみ(位相・音楽的リセットはない)。
- `reset()`(COM-10): 上表を全て初期値へ(`frame_seq` と `windows` も0)。パラメータは変えない。
- `capture_len` が(整形後の値で)変わったとき: `ring`、`wp`、`remain`、`fc`、`frame`(全て0、新しい長さ)を初期化。`frame_seq`、`prev`、窓の統計は保持する。
- RESET入力ポートはない(該当なし。理由: 測定の初期化は`reset()`で行い、音楽的リセットの概念がない)。

## 6. 振る舞い
サンプルレート依存: 窓長 `W = max(1, floor(window_ms · fs / 1000 + 0.5))` サンプル(fs=48000, window_ms=100 → 4800。fs=44100, window_ms=1 → 44)。
1サンプルの処理(入力を読む → 状態更新 → 出力):
```
// 0. 入力の整形 (COM-12)
if IN is NaN or ±inf:  nonfinite_count += 1;  x = 0
else x = IN                                // 未接続は 0 V (COM-09)
level = x
// 1. 窓の累積
cnt += 1;  sum += x;  sumsq += x*x
mn = min(mn, x);  mx = max(mx, x);  am = max(am, abs(x));  peak_hold = max(peak_hold, abs(x))
W = max(1, floor(clamp(finite(window_ms) ? window_ms : 100, 1, 1000)*fs/1000 + 0.5))
if cnt >= W:                                // 窓が閉じる (このサンプルを含む)
    peak = am;  rms = sqrt(sumsq / cnt);  mean = sum / cnt
    vmin = mn;  vmax = mx;  windows += 1
    cnt = 0;  sum = 0;  sumsq = 0;  mn = +inf;  mx = -inf;  am = 0
// 2. 波形フレーム
// パラメータの整形(§4): NaN/∞は既定値、四捨五入(0.5切り上げ)→クランプ(COM-13)。window_ms/trig_level は有限の範囲外をクランプ
L = clamp(round(finite(capture_len) ? capture_len : 512), 4, 4096)
pre_e = clamp(round(finite(pre) ? pre : 0), 0, L - 1)
mode = clamp(round(finite(trig_mode) ? trig_mode : 1), 0, 2);   tl = clamp(finite(trig_level) ? trig_level : 0, -12, 12)
ring[wp] = x;  wp = (wp + 1) mod L;  done = false
if mode == 0:                          // 連続: Lサンプルごとに完了
    remain = -1;  fc += 1;  if fc >= L: fc = 0; done = true
else:
    if remain >= 0:                         // 取得中。この間はトリガを評価しない
        remain -= 1;  if remain == 0: done = true; remain = -1
    else:
        fired = (mode == 1) ? (prev < tl && tl <= x)
                             : (prev >= tl && tl > x)
        if fired:
            remain = L - pre_e - 1                  // トリガ点の後に取るサンプル数
            if remain == 0: done = true; remain = -1
prev = x
if done:
    frame[i] = ring[(wp + i) mod L]   for i = 0..L-1       // 最古→最新
    frame_seq += 1
// 3. 出力
THRU = x
```
- フレーム内の位置: トリガ点のサンプルは `frame[pre_e]`(連続モードでは先頭から古い順に並ぶだけで、トリガ点の概念はない)。`frame[i]` の時刻は `(n_trig − pre_e + i)/fs` 秒。
- 完了時、フレームは「その時点までの直近 `L` サンプル」。トリガ前の履歴が足りない場合は、リングの初期値0が入る。
- トリガは、取得が完了するサンプルでは評価しない(次のサンプルから評価)。
- 同じ入力列・同じパラメータから、読出し値は全サンプルで決定的に定まる。

## 7. 共通規約との関係
- COM-02: 入力は任意の有限値を許容し、統計は値を切り捨てずに累積する(ピークも範囲外を保持)。
- COM-05/06: 1サンプル=1ステップ、単体の検証は `x[n]→y[n]`(THRU=x[n])。
- COM-09: IN未接続は0 V(正規化なし)。
- COM-10: `reset()`(§5)。
- COM-12: NaN/∞は0に置換(THRUと統計)、回数は`nonfinite_count`。累積用の `sum`/`sumsq` は倍精度で、float32の丸め誤差とオーバーフローを避ける。
- COM-12: 入力のNaN/∞は0に置換して `nonfinite_count` に数える。パラメータのNaN/∞は既定値(数えない)。
- COM-13: パラメータ範囲外はクランプ、整数型(`capture_len`, `trig_mode`, `pre`)は四捨五入→クランプ。COM-14: §9。
- 固有: 読出し値(ポートではない)の伝送形式・取得タイミングは#3(データ契約)。読出しは「あるサンプルの処理が終わった直後の値」を返すものとする。

## 8. 異常入力・境界・数値安定性
- NaN/±∞: 0 V扱い。`nonfinite_count` を加算(uint32で飽和)。
- 非常に大きな有限値(例 ±1e30): そのまま累積される。`sumsq` が倍精度で 1e60 程度となりoverflowはしない。`x*x` が倍精度で±∞になる規模(約1e154)を超える入力は、`rms` が +∞ になりうる。その場合は `rms` に 0 を書く(COM-12。実機入力は float32 で最大約3.4e38 のため倍精度の `x*x`≈1.2e77 に収まり、通常は起きない)。
- 窓が閉じる前: `peak`、`rms`、`mean`、`vmin`、`vmax` は直前の値(初期は0)を保持。`peak_hold` と `level` は逐次更新される。
- `window_ms` を縮めて `cnt ≥ W` になった場合、次の判定のサンプルで即座に窓が閉じる(累積途中の値で `rms` 等を計算)。
- パラメータのNaN/∞は既定値(window_ms=100, capture_len=512, trig_mode=1, trig_level=0, pre=0。TV-13)。`nonfinite_count` には数えない。
- `capture_len` は四捨五入(0.5は切り上げ。7.5→8、3.4→4)後に4〜4096にクランプ。`pre ≥ capture_len` は `capture_len−1` にクランプ(その場合トリガ点が最後のサンプル、完了は即時)。
- 立ち上がりトリガ: 条件は `prev < trig_level ≤ x`(下から上へ、または等しくなる点)。同じ値に留まるときは発火しない。ノイズ混じりの信号では複数回発火しうる(取得中は無視される)。ヒステリシスはない。[A]
- `trig_level > 0` のとき、最初のサンプル(`prev=0`)が `trig_level` 以上ならそのサンプルで発火する。
- DC・ゼロ入力: `rms`=|DC|、`mean`=DC。0入力では全て0、フレームは(トリガなしなら)更新されない。
- 数値: `sqrt` の引数は非負(二乗和)。`mean`の計算で `cnt ≥ 1`(0除算なし)。

## 9. 保存・復元・版互換
- 保存対象: ①パラメータ(`window_ms`、`capture_len`、`trig_mode`、`trig_level`、`pre`)、②内部状態(§5の全変数: 窓の累積、保持値、`windows`、`peak_hold`、`nonfinite_count`、リング(`capture_len`サンプル)、`wp`、`prev`、`remain`、`fc`、`frame`、`frame_seq`)、③PRNG状態: なし、④`spec_id=MOD-IO-003`、仕様版 `0.1`。
- 復元後は同じ入力列に対し、THRUと全読出し値がビット同一(TV-MOD-IO-003-12)。
- 版移行: 初版のため該当なし。読出し項目を増やす場合は、旧データでは新しい読出しを初期値で復元する。

## 10. 検証例
共通前提: `fs=48000`(特記を除く)、パラメータは特記以外 §4 の既定値(`window_ms=1` 等の指定は各行)。期待値はスクラッチの検証用Python(§6の参照実装。倍精度で累積)で計算。許容誤差は絶対1e-6(読出しの値は倍精度累積だがTHRU等はfloat32で出る場合を想定)。カウンタ(`windows`、`frame_seq`、`nonfinite_count`)とフレームの配置は完全一致。

| TV-ID | 種別 | 前提 | 入力 | 期待値 | 許容誤差と根拠 |
|---|---|---|---|---|---|
| TV-MOD-IO-003-01 | 正常 | window_ms=1(W=48), capture_len=16, trig_mode=1 | x[n]=3·sin(2π·1000·n/48000), n=0..95 | n=46: peak=rms=mean=vmin=vmax=0, windows=0(窓がまだ閉じない)、peak_hold=3.0。n=47(窓1が閉じる): peak=3.0, rms=2.1213203436(=3/√2), mean≈0(絶対値<1e-6), vmin=−3.0, vmax=3.0, windows=1。n=95: 同値, windows=2。THRU[n]=x[n] | 絶対1e-6。1 kHzは48サンプル周期のため、窓が整数周期。n=12でsin=1なのでpeak=3 |
| TV-MOD-IO-003-02 | 正常 | window_ms=1, capture_len=16 | (a) x=2.0 一定、n=0..47。(b) x=2.0(n=0..47)の後 x=−3.0(n=48..95) | (a) n=47: peak=2.0, rms=2.0, mean=2.0, vmin=2.0, vmax=2.0, windows=1。(b) n=95: peak=3.0, rms=3.0, mean=−3.0, vmin=−3.0, vmax=−3.0, windows=2, peak_hold=3.0 | 絶対1e-6。DCは `rms`=DCの絶対値、`mean=DC` |
| TV-MOD-IO-003-03 | 正常 | window_ms=100, capture_len=8, trig_mode=1, trig_level=0.5, pre=2 | x[0..15]=0, 0.2, 0.4, 0.6, 0.8, 1.0, 0.9, 0.7, 0.5, 0.3, 0.1, 0.2, 0.4, 0.6, 0.8, 0.9 | トリガは n=3(prev=0.4<0.5≤0.6)。n=0..7: frame_seq=0。n=8(完了, remain=L−pre−1=5): frame=[0.2, 0.4, 0.6, 0.8, 1.0, 0.9, 0.7, 0.5]、frame[2]=0.6(トリガ点)、frame_seq=1。n=9..15: frameとframe_seqは不変(n=13で0.4→0.6により再び発火するが、完了は n=18 のため n=15 までは frame_seq=1 のまま) | 絶対1e-6、frame_seqは完全一致。S-08の配置 `frame[pre]=トリガ点` |
| TV-MOD-IO-003-04 | 正常 | 上と同じで trig_mode=2(立ち下がり)、x も同じ | n=0..15 | トリガは n=9(prev=0.5≥0.5>0.3)。n=14 で完了(remain=5): frame=[0.7, 0.5, 0.3, 0.1, 0.2, 0.4, 0.6, 0.8]、frame[2]=0.3(トリガ点)、frame_seq=1 | 絶対1e-6。`prev ≥ trig_level > x` |
| TV-MOD-IO-003-05 | 正常 | capture_len=4, trig_mode=0(連続) | x[n]=n+1(n=0..9) | n=3: frame=[1,2,3,4], frame_seq=1。n=7: frame=[5,6,7,8], frame_seq=2。n=9 時点: frame=[5,6,7,8]、frame_seq=2(10サンプルでは2フレーム完了) | 絶対1e-6、frame_seqは完全一致。Lサンプルごとに完了 |
| TV-MOD-IO-003-06 | 境界 | capture_len=4, trig_mode=1, trig_level=0.5。(a) pre=0。(b) pre=10(→3にクランプ)。(c) pre=1 でx[0]=1(トリガがn=0)。(d) capture_len=6, pre=1 | (a) x=0,0,0,1,2,3,4,5,6。(b) x=0,0,0,1,2,3,4,5。(c) x=1,2,3,4,5。(d) x=0,1,0,1,0,1,0,0,0,0 | (a) トリガ n=3。完了は n=6: frame=[1,2,3,4], frame_seq=1。(b) pre=3 にクランプ。トリガ n=3 で remain=0 のため即完了: frame=[0,0,0,1], frame_seq=1。(c) 最初のサンプルでprev=0<0.5≤1 のため n=0 で発火。完了 n=2: frame=[0,1,2,3] (先頭は履歴の初期値0), frame_seq=1。(d) トリガ n=1。n=3(0→1)は取得中なので無視。完了 n=5: frame=[0,1,0,1,0,1], frame_seq=1(n=5ではトリガを評価しない)。n=6..9 は発火なし | 絶対1e-6、完全一致(配置)。§8(クランプ、取得中の無視、完了サンプルでは評価しない) |
| TV-MOD-IO-003-07 | 境界 | fs=44100, window_ms=1, capture_len=4 | x=1.0 一定、n=0..49 | W=floor(1·44100/1000+0.5)=44。n=42: windows=0。n=43: windows=1, peak=1.0, rms=1.0 | 完全一致(窓の閉じるサンプル)、値は絶対1e-6。`fs` 依存の窓長 |
| TV-MOD-IO-003-08 | 無効入力 | window_ms=1, capture_len=4, trig_mode=1, trig_level=0 | x[0..39]=1.0、x[40]=NaN、x[41]=+∞、x[42]=−∞、x[43..47]=1.0 | THRU[40..42]=0(NaN/∞は0)。n=47(窓が閉じる): nonfinite_count=3, peak=1.0, rms=0.9682458366(=√(45/48))、mean=0.9375(=45/48)、vmin=0, vmax=1.0, windows=1。frame=[0,0,0,0], frame_seq=0(trig_level=0で `prev<0` が成立しない) | 絶対1e-6、nonfinite_count完全一致。COM-12 |
| TV-MOD-IO-003-09 | 未接続 | window_ms=1, capture_len=4, trig_mode=1, trig_level=0.5 | INが未接続(0 V)、n=0..95 | THRU=0。n=95: windows=2, peak=rms=mean=vmin=vmax=0, peak_hold=0, nonfinite_count=0, frame=[0,0,0,0], frame_seq=0。trig_level=−0.5 の立ち上がりでも frame_seq=0(`prev=0` が −0.5 未満でない) | 絶対1e-6、カウンタ完全一致。COM-09(未接続は0 V) |
| TV-MOD-IO-003-10 | リセット | window_ms=1, capture_len=4, trig_mode=0。x=2.0 を n=0..59 | n=59 の直後に `reset()`、その後の1サンプル(x=2.0) | reset前(n=59): windows=1, peak=rms=mean=2.0, frame_seq=15, peak_hold=2.0。reset直後(1サンプル処理後): windows=0, peak=rms=mean=vmin=vmax=0(窓の途中のため未ラッチ), peak_hold=2.0(その1サンプル分のみ), nonfinite_count=0, frame=[0,0,0,0], frame_seq=0。パラメータは不変 | カウンタ完全一致、値は絶対1e-6。COM-10(reset()は全状態を初期値へ。frame_seq=15は 60/4) |
| TV-MOD-IO-003-11 | 境界 | window_ms=1000(最大), capture_len=4, trig_mode=1 | x=0.5 一定、n=0..47999 | W=48000。n=47999 で windows=1, peak=rms=mean=0.5。n=47998 では windows=0 | 完全一致(窓の位置)、値は絶対1e-6。`window_ms` 上限 |
| TV-MOD-IO-003-12 | 保存復元 | window_ms=2, capture_len=32, trig_mode=1, trig_level=0.5, pre=5。x[n]=3·sin(2π·997·n/48000)+0.1·cos(n)(n=0..1999)。n=776 の直後に全状態を保存し新インスタンスへ復元 | n=777..1999 を継続 | 復元側のTHRUと全読出し値(各サンプルの peak, rms, mean, vmin, vmax, windows, peak_hold, nonfinite_count, frame, frame_seq)が、保存せずに継続した場合とビット同一。参考値(n=1999 時点): windows=20, frame_seq=41, peak=3.0929368214, rms=2.1233103635, mean=0.0054306410, vmin=−3.0833428140, vmax=3.0929368214, peak_hold=3.0935907455。frame[0..2]=−0.9696320, −0.6672800, −0.3737560 | 完全一致(ビット同一, COM-14)。参考値は絶対1e-6(倍精度累積の値) |
| TV-MOD-IO-003-13 | 無効入力 | パラメータだけを変えた別実行 (a)〜(e)(特記以外は §4 の既定値) | (a) capture_len=7.5, trig_mode=0: x[n]=n+1(n=0..7)。(b) capture_len=3.4, trig_mode=0: x[n]=n+1(n=0..3)。(c) window_ms=NaN, capture_len=NaN: x=1.0 一定、n=0..4799。(d) trig_mode=NaN, trig_level=0.5, pre=NaN, capture_len=4: x=0,0,0,1,2,3,4,5,6(n=0..8)。(e) pre=1.5, trig_mode=1, trig_level=0.5, capture_len=4: x=0,0,0,1,2,3(n=0..5) | (a) 7.5→8: n=7 で frame=[1,2,3,4,5,6,7,8], frame_seq=1(切り捨てなら7要素)。(b) 3.4→4: n=3 で frame=[1,2,3,4], frame_seq=1。(c) window_ms→既定100(W=4800)、capture_len→既定512: n=4798 で windows=0、n=4799 で windows=1, peak=rms=mean=1.0。frameは長さ512。(d) trig_mode→1(立ち上がり)、pre→0: トリガ n=3、n=6 で完了 frame=[1,2,3,4], frame_seq=1(TV-06 (a) と同じ)。(e) pre→2(1.5→2。0.5は切り上げ): トリガ n=3、remain=1、n=4 で完了 frame=[0,0,1,2]、frame[2]=1(トリガ点)、frame_seq=1。いずれも nonfinite_count=0 | 絶対1e-6、カウンタ・配置は完全一致。COM-12(パラメータNaN/∞→既定値)、COM-13(整数型は四捨五入→クランプ)。スクラッチの参照実装で算出 |

### 音質・測定精度に関する要件(機能再現とは別項)
- 本モジュールは信号を変えない(THRU=x)。音質への影響はない(加算・乗算・フィルタなし)。確認方法: THRUが入力と完全に一致することを、任意の入力列で比較する(NaN/∞を除く)。
- 測定精度: `rms` と `mean` は倍精度累積で、窓長4800(既定)程度でfloat32の入力に対する相対誤差は1e-12以下の見込み。測定方法: 1 kHz・3 Vの正弦波(整数周期の窓)で `rms=3/√2` との差を見る(TV-01)。
- 周波数・位相: フレームはサンプル単位の位置を持つ。トリガ点の時刻精度はサンプル(サブサンプル補間なし。COM-07)。表示上の滑らかさ(補間)は#3のUIの責務。

## 11. 未確認・保留事項
- [A→#3] ブロック窓(非重複)方式(S-06)とピークの保持規則(`peak_hold` はリセットまで)。UIが「ピークの減衰」「ホールド時間」を必要とするなら別途定める。VUメーターの積分時間・ballisticsはDBに根拠がない。
- [A→#3] トリガの方式(エッジ、ヒステリシスなし)、取得中の再トリガ禁止、トリガ・レベルの既定値(0 V)。ノイズ入力に対する扱い(ホールドオフ等)。
- [#3] 読出し値の伝送形式・取得タイミング・フレームの更新通知(`frame_seq` の使い方)、エージェントが複数サンプル分を取りこぼさずに取得する方法(リングの長さ、ポーリング頻度)。
- [#3] MOD-IO-001の `CLIP` 出力・`clip_count` の可視化との連携(クリップ時の表示、保持時間)。
- 保留: FFT/スペクトル表示、複数チャンネル同時、外部トリガ入力(ゲートに同期した波形取得)、周波数・ピッチ検出、ラウドネス。DBに挙動の根拠が不足。
- DBに根拠が見つからず[A]にした主要項目: 窓方式、トリガ規則、フレームの配置、`nonfinite_count`、各パラメータの既定値と範囲。
