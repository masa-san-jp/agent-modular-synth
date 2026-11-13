# 手作業DB(`references/` の I/M レコード)と拡張DB(`references/db/`)の対応表

#1 の成果物は2系統ある。どちらも `references/` 配下に置き、重複対象はこの表で結ぶ。

| 系統 | 場所 | 位置付け |
|---|---|---|
| 精査済みDB(I/Mレコード、S出典) | [`references/`](../../index.md) | 主張単位で確度(`certainty`)を付けた少数・高精度のレコード。確認範囲を厳格に限定 |
| 拡張DB(T/REF/F/SRC、22対象) | [`references/db/`](index.md) | 広範囲(二次資料含む)。事実単位で `basis`・`confidence`・節・確認日を持つ。自動検査あり |

**使い分け:** 両者が食い違う場合は、確度の記録が厳格な精査済みDBを優先し、食い違いを `gaps.md` に記録して調べ直す。拡張DBの二次資料(`third_party`)だけを根拠に仕様を断定しない。

## 重複対象の対応
| 精査済みDB | 拡張DB | 備考 |
|---|---|---|
| I001 A-100 | T-001(REF-001-001〜) | Doepfer。同一対象 |
| M001 A-110-1 | REF-001-005 | VCO |
| M004 A-120 | REF-001-006 | VCF |
| M002 A-140-1 | REF-001-007 | ADSR |
| M005 A-130-1 | 該当なし | 拡張DBはA-138s(ミキサー)REF-001-009を収録。VCAは精査済みDBのみ |
| M006 A-155 | 該当なし | 拡張DBはA-160-1(クロック分周)REF-001-010。A-155は精査済みDBのみ |
| I003 VCV Rack | T-005(REF-005-001〜) | 同一対象 |
| M003 Core MIDI-CV | REF-005-008 | 同一モジュール |
| I004 SYSTEM-500 / SYSTEM-100m系譜 | T-014(REF-014-003〜) | 拡張DBは System-100M/700 原機と Behringer System 100 も含む(二次資料) |
| I005 Music Easel Modern(候補) / I006 Music Easel / M007 Aux Card | T-012(REF-012-022 Music Easel、REF-012-030 パッチ保存) | 拡張DBは原機の二次資料を含む。精査済みDBは取得できた旧版公式資料の範囲 |
| I002 0-COAST | 該当なし | 拡張DBのMake Noise(T-002)は Maths/Wogglebug/Mimeophon |

## 拡張DBのみの対象
T-003〜T-004、T-006〜T-011、T-013、T-015〜T-022(Mother-32、MS-20、Cardinal、BespokeSynth、Pd、SuperCollider、Max、Moog系、Buchla系、ARP系、EMS、Serge、現行個別モジュール、ブラウザ型、エージェント連携、Mutable Instruments、Web Audio、MIDI/OSC)。

## 検査
- 精査済みDB: `python3 references/validate.py`
- 拡張DB: `python3 tools/validate_reference.py`
