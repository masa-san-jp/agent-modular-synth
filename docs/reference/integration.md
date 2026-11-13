# リファレンスDB統合記録

状態: レビュー用。Issue #1 は未完了。Issue #2/#3・実装には着手しない。

## 基準
- 最新main: `61000220d6ec7f71ef7c0054a2befcf698045faa`（PR #5/#6）。
- 取り込んだPR #4 head: `96d0cd7f8c6a0dfeaaca6054437107b6c0e0e24f`。
- PR #4のブランチと内容は変更しない。統合ブランチは最新mainを親にする。
- PR #4のREADMEを上書き採用せず、mainの入口・構成案を保持して統合入口を追加した。
- PR #4に存在しないmainファイルを削除しない。

## 正本と互換
正本は data/reference、表示索引・比較・不足は tools/build_reference_docs.py で生成する。
旧 references のJSONは元のバイトを保持した凍結履歴。Markdown冒頭で移行先を示す。
旧I/M/S番号は削除・再利用しない。legacy-mapから新IDへ追跡する。
PR #4既存のT/REF/F/SRC番号・全既存フィールドを保持し、新規番号だけ末尾追加した。

20対象・207 entities・687 facts・189 sources・147未確認項目。
mainの13記録・28事実・18出典を移行。既存の同一機種は同じentityへ補足し、
0-COAST、2017 Easel、Modern候補、A-130-1、A-155、Aux Cardの版境界を保持。
既存201 entityに6件追加。補足factsには既存記述と重なる観察も含まれ、687件が独立の主張・証拠という意味ではない。
同じページURLのDoepfer出典3件を再利用した。VCV包括manualと各ページは確認範囲の違いを明示し、拙速に削除しない。

## 根拠の扱い
これは既存調査の整合化であり、全原文の再調査ではない。PR #4の著者による確認記録を保持し、
今回それらすべてを一次資料で再確認したとは主張しない。
main由来の確認日は2026-11-12を維持。移行日は2026-11-13。
未取得PDFやplaceholder資料を新たな確認済み根拠に昇格させていない。
VCV Ethics Guidelinesは一般的な法律そのものではなく、Library配布・商用条件との区別を旧記録から保持する。

## 意味上の保留
- A-110-1のPR #4記録「約8 oct」と15 Hz–8 kHzの表現、および別言語・版の差は原文再照合が必要。統合時に数値を変更しない。
- Buchlaのモデル別1.2/2.4 V/octの扱いは従来の未確認項目を維持。2017 Aux Cardの仕様で他モデルを上書きしない。
- Modern候補の分類・旧版関係は未確認。T-019のcategoryは候補の整理用で、確認済み分類ではない。
- 範囲を絞った仕様化の前に、高影響の電圧・時間・保存・外部制御の主張を原文と再照合する。
- Issue #1の受入は統合レビューと上記保留の設計影響判定後。PR #4は自動close/mergeしない。

## 検証
`python tools/validate_reference.py` と `python tools/validate_integration.py`、
`python references/validate.py` を使用する。
schema validatorは参照・必須項目などの機械検査で、主張の正しさや許諾、全意味重複を保証しない。
integration validatorは元PR #4フィールド保持・旧JSON保持・全旧factの対応と本文/出典/locator保持・ローカルMarkdownリンクを検査する。
2026-11-13に上記3検査を実行し、すべて終了コード0で完了した。生成文書も再生成済み。
外部URLの到達性・全本文の真偽・JSON深層の全型制約・Markdownアンカーの妥当性は未検査。
