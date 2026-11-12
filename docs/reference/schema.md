# リファレンスDB スキーマ・ID規則(v0.1)

調査事実の正本は `data/reference/` 配下のJSON。本書は構造と規則の定義であり、事実本文は含まない。検査は `tools/validate_reference.py` が行う。

## ファイル構成
| パス | 内容 |
|---|---|
| `data/reference/targets.json` | 初期版の調査対象一覧(固定)。選定理由・調査状態 |
| `data/reference/records/<TARGET_ID>.json` | 対象ごとのレコード(エンティティと事実) |
| `data/reference/sources/<TARGET_ID>.json` | 対象ごとの出典台帳 |

## ID規則
| 種別 | 形式 | 例 |
|---|---|---|
| 対象 | `T-<3桁>` | `T-001` |
| エンティティ | `REF-<対象番号3桁>-<3桁連番>` | `REF-001-004` |
| 事実 | `F-<対象番号3桁>-<3桁連番>` | `F-001-012` |
| 出典 | `SRC-<対象番号3桁>-<2桁連番>` | `SRC-001-01` |

IDは一度付与したら再利用・変更しない。削除する場合も `status: "retired"` で残す。版違いは別エンティティとし `supersedes` / `variant_of` で関係を示す。

## targets.json
配列 `targets[]`。各要素:
- `id`, `name`, `maker`
- `category`: `hardware_modular` / `semi_modular` / `software_modular` / `software_environment`
- `era`: `historical` / `current`
- `selection_reason`: 選定理由
- `status`: `confirmed`(確認済み) / `insufficient_sources`(資料不足・アクセス不能) / `out_of_scope`(対象外)
- `status_note`: 状態の根拠(未確認なら何が足りないか)

## records/<TARGET_ID>.json
`target_id`, `entities[]`, `facts[]`, `unconfirmed[]`

### entity
- `id`, `kind`: `system` / `module` / `signal_standard` / `patch_storage` / `control_interface`
- `name`, `maker`, `version`(不明なら `null` と `version_status: "unconfirmed"`)
- `function_category`: `oscillator` / `noise` / `filter` / `waveshaper` / `amplifier_mixer` / `envelope` / `lfo` / `modulation_other` / `clock_sequencer` / `random_logic` / `time_effect` / `io_utility` / `routing` / `system` / `other`
- `purpose`, `synthesis_method`, `features[]`, `constraints[]`(自分の言葉。各文は根拠となる `fact_ids` を持つ)
- `ports[]`: `name`, `direction`(`in`/`out`), `signal_type`(`audio`/`cv`/`gate`/`trigger`/`clock`/`event`/`other`/`unknown`), `range`(`{min,max,unit}` または `null`), `range_status`(`confirmed`/`unconfirmed`), `fact_ids[]`
- `params[]`: `name`, `unit`, `range`, `default`, `range_status`, `default_status`, `fact_ids[]`
- `mechanisms`: `patching`, `timing`, `state_save`, `external_control` — 各々 `{summary, fact_ids[]}` または `null`
- `relations`: `variant_of`, `supersedes`, `part_of`(エンティティIDまたは `null`)
- `status`: `active` / `retired`

### fact
- `id`, `entity_id`, `topic`, `statement`(自分の言葉の要約。原文の長文引用禁止)
- `basis`: `manufacturer_doc` / `api_doc` / `licensed_source` / `third_party` / `measurement` / `advertising`
- `confidence`: `high` / `medium` / `low`
- `source_id`, `locator`(節名・ページ・ファイルパス等。必須)
- `verified_on`: `YYYY-MM-DD`
- 広告文(`advertising`)・第三者評価(`third_party`)・実測(`measurement`)を `manufacturer_doc` 等と混同しない。

### unconfirmed
`entity_id`(または対象)、`item`(未確認項目)、`tried_sources[]`(試した出典ID)、`impact_on_spec`(仕様化への影響)。未確認値は0や推測で埋めず、ここに記録する。

## sources/<TARGET_ID>.json(出典台帳)
各要素: `id`, `title`, `publisher`, `url`, `doc_version`(不明なら `"unknown"`), `doc_type`(`manufacturer_manual` / `spec` / `api_doc` / `source_code` / `third_party` / `other`), `accessed_on`, `checked_scope`(実際に読んだ範囲), `link_status`(`ok` / `unreachable`), `license_note`(再利用条件。転載しない旨を含む)。

## 未知値・重複・版違いの扱い
- 未知値: フィールドは `null`、対応する `*_status` を `unconfirmed` とし、`unconfirmed[]` に記録。
- 重複: 同一製品・モジュール・版は1エンティティ。検査スクリプトが (`maker`,`name`,`version`) の重複を検出する。
- 版違い: 別エンティティ+`variant_of`。
- 外部リンク: `accessed_on` にアクセス確認日、取得不能なら `link_status: "unreachable"`。
