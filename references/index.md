# モジュラーシンセ・リファレンスDB 初期版

> 拡張DB(22対象・二次資料を含む広範囲): [references/db/docs/index.md](db/docs/index.md)。本ページのDBとの対応は [crosswalk](db/docs/crosswalk.md)。

[範囲・方法](scope.md) / [スキーマ・ID規則](schema.md) / [出典台帳](sources/catalog.json) / [不足・引継ぎ](gaps.md) / [検査結果](validation.md)

## 機種
|レコード|種別|比較の軸|
|---|---|---|
|[I001 A-100](instruments/I001.json)|ハードモジュラー|独立モジュールの組合せ|
|[I002 0-COAST](instruments/I002.json)|セミモジュラー|内部接続＋外部パッチ|
|[I003 VCV Rack](instruments/I003.json)|ソフトモジュラー|仮想グラフ・保存・プラグインAPI|
|[I004 SYSTEM-500](instruments/I004.json)|ハードモジュラー|歴史的原型と後継の区別|
|[I005 Music Easel候補](instruments/I005.json)|分類保留|資料取得不能、仕様根拠に使わない|

## 個別モジュール
- [M001 A-110-1](modules/M001.json): 音高制御、波形、CV normaling。
- [M002 A-140-1](modules/M002.json): 時間変化する制御電圧、gate/retrigger。
- [M003 Core MIDI-CV](modules/M003.json): MIDIイベントから音高・ゲート・時計への変換。

## 機能比較（根拠は各JSONの主張単位）
|問い|ハードで確認できた例|ソフトで確認できた例|仕様化時の注意|
|---|---|---|---|
|つながない時どうなるか|M001はCV1の内部bus接続、I002は内部接続で発音|I003の各入力の未接続値は本調査未確認|未接続を一律0と決めない|
|信号の値をどう解釈するか|M001の典型出力振幅とM002の包絡範囲は異なる|I003はV単位の推奨規約|推奨・典型・許容上限を分ける|
|音の開始をどう扱うか|M002はgate active中のretriggerを区別|M003はlegato gateと新規note triggerを区別|gateとtriggerを同じイベントにしない|
|時間をどう扱うか|M002は連続電圧包絡、時間範囲は概数|I003はサンプル更新・ケーブル1sample遅延|原機の時間と離散処理を混同しない|
|状態を保存できるか|ハードの全状態保存は本調査未確認|I003は.vcv、通常パラメータと独自状態の保存を区別|ノブ保存だけで音声の完全再現とはしない|
|エージェントから操作できるか|I002にはMIDI制御、読戻しは未確認|I003/M003にはプラグインAPI・MIDI|安全な遠隔操作・編集トランザクションの存在を推定しない|
|一般名と独自呼称|I002 OVERTONE/MULTIPLY/DYNAMICS|M003 RTRGなど|見た目や商標の模倣ではなく振る舞いの理解に限る|

これは調査DBであり、機能別仕様(#2)・採用設計(#3)・実装完成ではない。

## 第2回拡充（2026-11-12）

- [M004 A-120 filter](modules/M004.json): cutoff CV加算と共振。数値的な再現式は未確認。
- [M005 A-130-1 VCA](modules/M005.json): 利得CVと信号入力の加算、DC/AC結合の版差。
- [M006 A-155 sequencer](modules/M006.json): step/reset、triggerとgate、Glide/S&H。
- [I006 2017 Easel文脈](instruments/I006.json) / [M007 Aux Card](modules/M007.json): 取得できた旧版公式資料による歴史・拡張・1.2 V/oct。I005 Modernの代用仕様ではない。

比較の追加: filter cutoffへのCV加算（M004）とVCA利得へのCV加算（M005）は制御先が異なる。M006のtrigger幅はclockに依存し、I003の1 ms推奨とは同じ規約ではない。M007の1.2 V/octをVCVの1 V/octへ接続するには変換を検討する必要がある（これは本調査からの設計上の示唆であり製品採用決定ではない）。
