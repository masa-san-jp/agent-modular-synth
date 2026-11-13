> 互換スナップショット（main 6100022）。以後の編集正本は [統合DB](../docs/reference/index.md) です。この旧資料は履歴保持のため凍結し、現在の完了判定には使いません。旧ID対応は [legacy-map](../data/reference/legacy-map.json) を参照。

# DB v1 スキーマと識別規則

このDBは調査事実の正本。文字コードUTF-8、JSON。確認日2026-11-12。製品実測・動作試験は未実施。
- I001〜: 機種、M001〜: 既存モジュール、S001〜: 出典。公開後はIDを再利用しない。
- 必須: id/name/maker/kind/version/parent_id/categories/status/facts/unknowns/rights。
- parent_id は独立機種ではnull、モジュールでは既存機種ID。
- factsはtopic/value/evidence(source_id,section)/certainty。数値・機能・挙動は主張単位で根拠へ戻る。certainty=documented_not_measuredは「メーカー資料で確認、実測なし」。メーカー広告と独立評価を同一視しない。
- categoriesは検索タグで、採用機能ではない。製品固有名はnameやvalueに残す。
- status=documented_partialは確認範囲に限定した登録。unavailableは本文取得不能。レコード全体を完全検証済みと解釈しない。
- 不明はunknownsに具体的に記す。未確認数値を0で埋めない。デフォルト値が未確認なら明記し推測しない。
- 出典必須: id/publisher/title/url/version/sections/checked_on/scope/access_status/evidence_type/reuse。オンライン文書の改訂日がない場合はその旨をversionへ記す。checked_onは取得日であり版の確定ではない。
- 名前・版・メーカーの組で重複確認。別名A-140/A-140-1は1レコード。異なる製品や歴史的原型を同じ仕様として統合しない。版変更時は変更対象を明示し旧記述・根拠を保持する。
- source.sectionは人間可読の原文見出し。URLのフラグメントが保証されないため架空アンカーを生成しない。
- validate.pyは必須項目・ID一意性・親/出典参照・取得状態・JSON形式・文書リンクを検査。数値の正しさや外部サイトの到達性は保証しない。
