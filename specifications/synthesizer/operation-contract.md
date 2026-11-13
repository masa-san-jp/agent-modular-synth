# 操作契約(UIとエージェント共通のコマンド・状態・エラー・同期)

版: 0.1 / 2026-11-13。状態: 設計(シンセ本体は未実装)。
要求は [requirements.md](requirements.md)(`REQ-…`。検証IDは同じ枝番の `VER-…`)、構成と安全は [product-spec.md](product-spec.md)、判断と未決は [plans/decisions.md](../../plans/decisions.md)(`DEC-…`/`OPEN-…`)、パッチJSONの形は [data-contract.md](data-contract.md)(`DAT-…`)、モジュールのポート・パラメータは [specifications/modules/](../modules/README.md)(`MOD-…`/`COM-…`)が正本。本書はそれらを複製せずIDで参照する。

本書のID: コマンド `CMD-nn`、エラー `ERR-nnn`、通知 `EVT-nn`、受入例 `AX-nn`。IDは変更しない(廃止時は欠番にする)。
根拠の表記: `F-…` はリファレンスDBの事実。**[設計判断]** は調査事実から一意に決まらず本書で決めたもの(#3内で見直し可)。**[暫定値]** は測定・運用の前に置いた値で、確定値ではない。

---

## 1. 位置づけ
1. 人のUIもエージェントも、**同じコマンド**をコマンド処理(ブラウザのタブ内。product-spec §4)へ送る。UIは状態を直接書き換えない(DEC-002, DEC-105, REQ-A-002)。
2. コマンド処理は要求を**到着順に1件ずつ**処理する(検証 → 適用 → 履歴 → リビジョン → 応答 → 通知)。同時に2件を処理しない(REQ-A-006)。
3. 無効な要求は状態を一切変えない(REQ-A-004)。先行例にも「検証して失敗時は前の状態へ戻す」方式がある(F-018-069)。
4. 輸送(初期案): エージェントはローカルサーバーへWebSocketまたはHTTPで要求を送り、サーバーがタブへ中継する(product-spec §7.1)。認証の詳細は OPEN-007、MCPの輸送は OPEN-008。本書は輸送に依らない封筒とコマンドの意味を定める。

## 2. 状態モデル
### 2.1 セッションの状態
| 項目 | 型 | 内容 | リビジョン対象 | 取り消し対象 |
|---|---|---|---|---|
| `patch` | オブジェクト | パッチグラフ(モジュール、ケーブル、パラメータ、UI位置、メタ情報)。形は data-contract §3 | ○ | ○ |
| `revision` | 整数 ≥ 0 | パッチの版番号(§4) | — | — |
| `session_id` | 文字列 | タブの読込ごとに新しく発行する識別子 | — | — |
| `history` | 列 | 取り消し・やり直しの履歴(§9) | — | — |
| `audio_state` | `stopped` / `running` / `suspended` | 音声状態(product-spec §3.3) | × | × |
| `panic` | 真偽 | 緊急停止中か(product-spec §8.1) | × | × |
| `output.level_db` | 数値(dB) | マスター音量(MOD-IO-001 の `level` とは別。product-spec §8.1) | × | × |
| `output.agent_max_level_db` | 数値(dB) | エージェントが設定できる上限 | × | × |
| `engine_revision` | 整数 または null | 音声エンジンに反映済みの最新リビジョン(§11) | — | — |

音量・緊急停止・音声状態をリビジョンと履歴に**含めない**理由 [設計判断]: 取り消しで音量が上がる、または緊急停止が解除されると安全設計(DEC-004)に反する。パッチ(音作りの内容)と安全・装置の状態を分ける。

### 2.2 識別子と参照
| 対象 | 形式 | 規則 |
|---|---|---|
| モジュール種別 `type` | 仕様ID(例 `MOD-OSC-001`) | product-spec §6 の18種。名前を変えない(保存済みパッチを壊すため。F-018-015) |
| モジュールID | `^[a-z][a-z0-9_]{0,31}$` | パッチ内で一意。`module.add` で指定できる。省略時は `m<N>`(N は1から始まる連番。セッション内で再利用しない。パッチ読込時は既存の `m<N>` の最大値+1 から再開) |
| 常設の出力 | ID `out`、種別 `MOD-IO-001` | 常に1つだけ存在。追加・削除不可(product-spec §6) |
| ケーブルID | `^[a-z][a-z0-9_]{0,31}$` | パッチ内で一意。省略時は `c<N>`(規則はモジュールIDと同じ) |
| ポート参照 | `{"module": "<モジュールID>", "port": "<ポート名>"}` | ポート名は各モジュール仕様 §3 の名前そのまま(大文字・小文字を区別。例 `IN_L`, `saw`) |
| パラメータ名 | 各モジュール仕様 §4 の名前そのまま | 添字付き(MOD-SEQ-001 の `cv[i]`, `gate[i]`)は `cv[1]`〜`cv[16]`、`gate[1]`〜`gate[16]` と書く [設計判断: 仕様の表記をそのまま名前にし、新しい名前を作らない] |
| パラメータ値 | JSONの数値(有限) | 真偽・列挙も各仕様どおり数値(0/1 等)。§12 |
| パッチ名(保存) | `^[a-z0-9][a-z0-9_-]{0,63}$` | data-contract §7.2 |

ケーブルはチャンネル(最大16。COM-08)をまとめて運ぶ。チャンネル単位の参照はない。

### 2.3 音声状態
| 状態 | 意味 | パッチ編集 | エンジンへの反映 | `meter.read` |
|---|---|---|---|---|
| `stopped` | 音声未開始(利用者の操作待ち。F-021-018〜020) | 可 | 開始時に現在のパッチをまとめて構築(全モジュールは初期状態。COM-10) | ERR-301 |
| `running` | 動作中 | 可 | 次の処理ブロックの先頭(product-spec §5.6, §5.7) | 可 |
| `suspended` | ブラウザ・OSによる中断 | 可 | 再開時に、たまった差分を順に適用 | ERR-301 |

`stopped`/`suspended` から `running` への遷移は人のUI操作(CMD-22)だけが行える(REQ-A-008)。

## 3. 要求と応答の封筒
### 3.1 要求
```json
{
  "v": 1,
  "request_id": "r-0001",
  "command": "param.set",
  "args": {"module_id": "vcf1", "param": "cutoff", "value": 2.0},
  "expected_revision": 10,
  "idempotency_key": "6f1c2a9e-3d0b-4c1e-9a55-0e2f7b8d1c44",
  "client_id": "agent-a"
}
```
| フィールド | 型 | 必須 | 既定 | 内容 |
|---|---|---|---|---|
| `v` | 整数 | ○ | — | 封筒の版。本書は `1`。他の値は ERR-012 |
| `request_id` | 文字列(1〜64文字) | ○ | — | 応答と通知に写す相関ID。一意性は検査しない |
| `command` | 文字列 | ○ | — | §6 のコマンド名 |
| `args` | オブジェクト | × | `{}` | コマンドごとの引数。**未知のキーは ERR-003**(打ち間違いを黙って無視しない) |
| `expected_revision` | 整数 ≥ 0 | × | なし | 指定時、現在のリビジョンと一致しなければ ERR-008(§8) |
| `idempotency_key` | 文字列(1〜64文字) | × | なし | 再送の二重適用を防ぐ鍵(§7) |
| `client_id` | 文字列(1〜64文字) | × | なし | 送信者の表示用の名前(自己申告。権限判定には使わない) |

`actor`(操作者)は要求で指定できない。受け口が決める: タブ内のUIからの要求は `human`、ローカルサーバー経由(WebSocket/HTTP/MCP)の要求はすべて `agent`。[設計判断] 自己申告の種別を信用すると、エージェントが人専用の操作(緊急停止の解除など)を行えるため。

### 3.2 応答
成功:
```json
{
  "v": 1,
  "request_id": "r-0001",
  "ok": true,
  "command": "param.set",
  "revision": 11,
  "session_id": "s-7k2m",
  "actor": {"kind": "agent", "client_id": "agent-a"},
  "audio_state": "running",
  "replayed": false,
  "warnings": [],
  "result": {"module_id": "vcf1", "param": "cutoff", "value": 2.0, "previous": 1.0, "changed": true}
}
```
失敗:
```json
{
  "v": 1,
  "request_id": "r-0002",
  "ok": false,
  "command": "param.set",
  "revision": 11,
  "session_id": "s-7k2m",
  "actor": {"kind": "agent", "client_id": "agent-a"},
  "audio_state": "running",
  "replayed": false,
  "error": {"id": "ERR-123", "code": "param_out_of_range", "message": "cutoff は -5〜6 の範囲", "details": {"module_id": "vcf1", "param": "cutoff", "value": 7.5, "min": -5, "max": 6}}
}
```
| フィールド | 内容 |
|---|---|
| `ok` | 成否(REQ-A-004) |
| `revision` | **応答時点の現在のリビジョン**。成功した変更では適用後の値、失敗・読出しでは変わらない現在値。セッションがない場合(ERR-006)は `null` |
| `session_id`, `audio_state` | セッションの識別子と音声状態。すべての応答に付ける(REQ-A-008)。セッションがない場合は `null` |
| `actor` | 受け口が決めた操作者。`kind` は `human` または `agent` |
| `replayed` | 冪等キーにより保存済みの応答を返したとき `true`(§7) |
| `warnings` | 成功時の注意(状態は変わっている)。要素は `{"code", "message", "details"}`。`code` は `type_mismatch`(型違いの接続。§13)、`duplicate_seed`(§14)、`migrated`(読込時に移行した。data-contract §9)、`param_defaulted`(読込時に省略パラメータを既定値で補った) |
| `result` | コマンドごとの返値(§6) |
| `error` | `id`(`ERR-nnn`)、`code`(§5 の名前)、`message`(人向けの説明。文言は契約外)、`details`(機械可読の補足) |

### 3.3 処理順(検証の順)
1件の要求は次の順で検査し、最初に当たった失敗を返す。順序は受入試験で固定する [設計判断]。
1. 封筒の形(ERR-001, ERR-012, ERR-011)
2. 認証(ERR-004)
3. コマンド名(ERR-002)と権限(ERR-005)
4. セッションの有無(ERR-006)
5. 冪等キー(保存済みなら応答を再送。ERR-009)
6. `expected_revision`(ERR-008)
7. 引数の形と型(ERR-003)
8. 対象の存在(ERR-102, ERR-111, ERR-115, ERR-121 など)
9. 値と規則(ERR-122, ERR-123, ERR-114 など)と状態の前提(ERR-301 など)
10. 適用(失敗しない設計。想定外の失敗は ERR-010 とし、状態を適用前へ戻す)

## 4. リビジョン規則
1. `revision` は整数。**パッチを変える成功したコマンド1件につき 1 増える**。`batch` は全体で 1、`history.undo`/`history.redo` も 1、`patch.load`/`patch.new` も 1 増える。減ること・再利用されることはない。
2. 読出し、失敗した要求、音量・緊急停止・音声開始、`patch.save`(ファイルへ書くだけ)では増えない。
3. **値が変わらない変更**(同じ値の `param.set`、同じ位置の `module.move` など)は成功を返すが、リビジョンを進めず、履歴にも積まず、通知も出さない(`result.changed = false`)。[設計判断] 再送や連続操作で意味のない版を作らない。
4. リビジョンは自動保存に含め、再読込後は続きの値から始める(data-contract §7.1)。自動保存がない場合は 0 から始める。`session_id` は再読込のたびに変わる。
5. 利用者は `revision` と `session_id` の組で「自分が見た状態」を識別する。

## 5. エラー一覧
`code` は応答の `error.code` に入る名前。すべてのエラーで状態は変わらない。
| ID | code | 意味 | `details` の主な内容 |
|---|---|---|---|
| ERR-001 | `invalid_request` | 封筒が壊れている(JSONでない、必須フィールドなし、型違い) | `field` |
| ERR-002 | `unknown_command` | コマンド名が未定義 | `command` |
| ERR-003 | `invalid_args` | 引数の不足・未知のキー・型違い・形式違い(IDの書式など) | `arg`, `reason` |
| ERR-004 | `unauthorized` | トークンがない・違う、またはOriginが不正(REQ-S-005) | — |
| ERR-005 | `forbidden` | この操作者には許されない操作(§15) | `command`, `actor_kind` |
| ERR-006 | `no_session` | パッチを持つタブが開かれていない(product-spec §4) | — |
| ERR-007 | `timeout` | タブが時間内に応答しなかった。**適用されたかは不明**(§7.4) | `timeout_ms` |
| ERR-008 | `revision_conflict` | `expected_revision` が現在値と違う(§8) | `expected_revision`, `current_revision` |
| ERR-009 | `idempotency_key_reused` | 同じ冪等キーで内容の違う要求が来た | `idempotency_key` |
| ERR-010 | `internal_error` | 想定外の失敗。状態は適用前へ戻す | — |
| ERR-011 | `payload_too_large` | 要求が大きすぎる(§16) | `limit_bytes` |
| ERR-012 | `unsupported_version` | 封筒の版 `v` が未対応 | `supported` |
| ERR-101 | `unknown_module_type` | 種別が採用モジュール(product-spec §6)にない | `type` |
| ERR-102 | `module_not_found` | モジュールIDが存在しない | `module_id` |
| ERR-103 | `module_id_conflict` | 指定したモジュールIDが既に使われている | `module_id` |
| ERR-104 | `module_protected` | 常設モジュール `out` は削除できない | `module_id` |
| ERR-105 | `singleton_module` | `MOD-IO-001` は追加できない(常に1つ) | `type` |
| ERR-106 | `limit_exceeded` | 個数の上限を超える(§16) | `limit`, `max` |
| ERR-111 | `port_not_found` | そのモジュールにポート名がない | `module_id`, `port` |
| ERR-112 | `port_direction` | `from` が出力でない、または `to` が入力でない | `module_id`, `port`, `direction` |
| ERR-113 | `port_not_connectable` | ケーブルで接続できないポート(§13.6) | `module_id`, `port` |
| ERR-114 | `input_occupied` | その入力には既にケーブルがある(同じ接続の重複を含む) | `existing_cable_id`, `same_source` |
| ERR-115 | `cable_not_found` | ケーブルID、または指定した入力のケーブルが存在しない | `cable_id` または `to` |
| ERR-116 | `cable_id_conflict` | 指定したケーブルIDが既に使われている | `cable_id` |
| ERR-121 | `param_not_found` | そのモジュールにパラメータ名がない | `module_id`, `param` |
| ERR-122 | `param_invalid_value` | 値が有限の数値でない(文字列、`null`、真偽値、配列など)、または整数型・列挙型・真偽型に非整数 | `module_id`, `param`, `expected` |
| ERR-123 | `param_out_of_range` | 有限だが範囲外 | `module_id`, `param`, `value`, `min`, `max` |
| ERR-131 | `batch_failed` | `batch` 内の操作が失敗。全体を適用しない | `failed_index`, `cause`(その操作のエラー) |
| ERR-132 | `batch_op_not_allowed` | `batch` に入れられないコマンド | `index`, `command` |
| ERR-141 | `nothing_to_undo` | 取り消せる履歴がない | — |
| ERR-142 | `nothing_to_redo` | やり直せる履歴がない | — |
| ERR-201 | `invalid_patch_name` | パッチ名が規則に合わない(パス区切り、上位参照、予約名など) | `name` |
| ERR-202 | `patch_not_found` | その名前の保存パッチがない | `name` |
| ERR-203 | `patch_name_exists` | 同名の保存パッチがあり、上書きが指定されていない | `name` |
| ERR-204 | `patch_invalid` | パッチJSONが検証に通らない(data-contract §8) | `issues`(`{"rule", "path", "message"}` の配列) |
| ERR-205 | `patch_version_unsupported` | 未知の `format`、新しすぎる `schema_version` または `spec_version` | `found`, `supported` |
| ERR-206 | `patch_too_large` | パッチの大きさが上限超過(data-contract §10) | `limit_bytes` |
| ERR-207 | `storage_failed` | 保存先の読み書きに失敗 | `reason` |
| ERR-301 | `audio_not_running` | 音声が動作中でないため実行できない | `audio_state` |
| ERR-302 | `level_limit_exceeded` | エージェントの音量上限を超える(REQ-S-004) | `level_db`, `max_db` |
| ERR-303 | `not_a_meter` | 対象が `MOD-IO-003` でない | `module_id`, `type` |
| ERR-304 | `audio_start_failed` | 音声を開始できなかった(ブラウザが拒否、デバイスなし) | `reason` |

## 6. コマンド
凡例 — **変更**: パッチを変える(リビジョンが進む)。**取消**: `history.undo` で戻せるか。**権限**: `両方` = 人のUIとエージェント、`人のみ` = 人のUIだけ(product-spec §8.2 と一致)。**batch**: `batch` に入れられるか。共通エラー(ERR-001〜012)は各行に書かない。

| ID | コマンド | 概要 | 変更 | 取消 | 権限 | batch | 要求 |
|---|---|---|---|---|---|---|---|
| CMD-01 | `module.list_types` | モジュール種別の定義を列挙 | × | — | 両方 | × | REQ-A-001 |
| CMD-02 | `module.add` | モジュールを追加 | ○ | ○ | 両方 | ○ | REQ-F-001 |
| CMD-03 | `module.remove` | モジュールを削除 | ○ | ○ | 両方 | ○ | REQ-F-001 |
| CMD-04 | `module.get` | モジュール1つの状態を読む | × | — | 両方 | × | REQ-A-003 |
| CMD-05 | `module.move` | UI上の位置を変える | ○ | ○ | 両方 | ○ | — |
| CMD-06 | `cable.connect` | 出力と入力を接続 | ○ | ○ | 両方 | ○ | REQ-F-002, REQ-F-011 |
| CMD-07 | `cable.disconnect` | ケーブルを外す | ○ | ○ | 両方 | ○ | REQ-F-002 |
| CMD-08 | `param.set` | パラメータを設定 | ○ | ○ | 両方 | ○ | REQ-F-003 |
| CMD-09 | `batch` | 複数の操作を一括適用 | ○ | ○(1件) | 両方 | × | REQ-F-012 |
| CMD-10 | `patch.get` | パッチ全体とリビジョンを読む | × | — | 両方 | × | REQ-A-003 |
| CMD-11 | `patch.new` | 空のパッチに置き換える | ○ | ○ | 両方 | × | — |
| CMD-12 | `patch.save` | 名前を付けてファイルに保存 | × | × | 両方(上書きに制限) | × | REQ-F-007 |
| CMD-13 | `patch.load` | 保存パッチ(またはJSON)を読み込む | ○ | ○ | 両方 | × | REQ-F-007 |
| CMD-14 | `patch.list` | 保存パッチの一覧 | × | — | 両方 | × | REQ-F-007 |
| CMD-15 | `patch.read` | 保存パッチの中身を読む(読み込まない) | × | — | 両方 | × | REQ-F-007 |
| CMD-16 | `patch.delete` | 保存パッチを削除 | × | × | 人のみ | × | — |
| CMD-17 | `patch.set_meta` | 題名・説明を変える | ○ | ○ | 両方 | ○ | — |
| CMD-18 | `history.undo` | 直前の変更を取り消す | ○ | (redo) | 両方 | × | REQ-F-009 |
| CMD-19 | `history.redo` | 取り消しをやり直す | ○ | (undo) | 両方 | × | REQ-F-009 |
| CMD-20 | `meter.read` | メーター/スコープの値を読む | × | — | 両方 | × | REQ-F-010 |
| CMD-21 | `engine.get_status` | 音声状態・音量・診断値を読む | × | — | 両方 | × | REQ-A-008 |
| CMD-22 | `engine.start` | 音声を開始・再開 | × | × | 人のみ | × | REQ-A-008 |
| CMD-23 | `engine.panic` | 緊急停止(全消音) | × | × | 両方 | × | REQ-S-002 |
| CMD-24 | `engine.release_panic` | 緊急停止の解除 | × | × | 人のみ | × | REQ-S-002 |
| CMD-25 | `output.set_level` | マスター音量を設定 | × | × | 両方(エージェントは上限内) | × | REQ-S-004 |

### CMD-01 `module.list_types`
- 引数: `type`(文字列、任意。指定時はその種別だけ返す。未知なら ERR-101)。
- 返値: `types`(配列)。各要素:
  - `type`(仕様ID)、`title`、`category`、`spec_version`(実装している仕様版)、`singleton`(`MOD-IO-001` のみ `true`)
  - `ports`: `{"name", "direction": "in"|"out", "signal_type", "unit", "connectable", "unconnected"}`。`signal_type` は COM-01 の型名。`connectable` は §13.6。
  - `params`: `{"name", "kind": "float"|"int"|"enum"|"bool", "unit", "min", "max", "default", "values"}`。`values` は列挙型のみ(`{"value", "label"}` の配列)。
  - `readouts`: `meter.read` で読める項目(`MOD-IO-003` のみ)。
- 内容の正本は各モジュール仕様の §3・§4。実装は仕様から作った定義表を返し、仕様と一致することを検証する(VER-A-001)。
- 検証エラー: ERR-101。副作用: なし。セッションがなくても応答できる。

### CMD-02 `module.add`
| 引数 | 型 | 必須 | 既定 | 内容 |
|---|---|---|---|---|
| `type` | 文字列 | ○ | — | 仕様ID |
| `id` | 文字列 | × | 自動(`m<N>`) | §2.2 の書式 |
| `params` | オブジェクト(名前→数値) | × | `{}` | 指定しないパラメータは仕様の既定値。値の検証は §12 |
| `ui` | `{"x": 数値, "y": 数値}` | × | なし | UI上の位置(data-contract §4.2)。省略時はUIが配置を決める |
- 返値: `module`(data-contract §4 の形。採番されたIDと**全パラメータの値**を含む)。
- 検証エラー: ERR-101, ERR-105, ERR-103, ERR-106, ERR-121, ERR-122, ERR-123, ERR-003。
- 副作用: エンジンにモジュールを追加(初期状態から開始。COM-10)。`seed` パラメータを持つ種別で `seed` を指定しなかった場合は §14 の自動割当。
- 取り消し: モジュールを削除する。

### CMD-03 `module.remove`
- 引数: `module_id`(文字列、必須)。
- 返値: `removed_module_id`、`removed_cable_ids`(そのモジュールにつながっていて一緒に外したケーブル)。
- 検証エラー: ERR-102, ERR-104。
- 副作用: つながっているケーブルもすべて外す。エンジンからモジュールを取り除く(内部状態は捨てる)。
- 取り消し: モジュール(同じID・パラメータ・位置)とケーブル(同じID)を戻す。**内部状態は戻らず**初期状態から始まる(§9.5)。

### CMD-04 `module.get`
- 引数: `module_id`(必須)。
- 返値: `module`(data-contract §4 の形)、`cables`(このモジュールにつながるケーブルの配列)。
- 検証エラー: ERR-102。副作用: なし。

### CMD-05 `module.move`
- 引数: `module_id`(必須)、`ui`(`{"x": 数値, "y": 数値}`、必須。有限の数値)。
- 返値: `module_id`, `ui`, `changed`。
- 検証エラー: ERR-102, ERR-003。副作用: 音には影響しない。取り消し: 元の位置へ戻す。

### CMD-06 `cable.connect`
| 引数 | 型 | 必須 | 既定 | 内容 |
|---|---|---|---|---|
| `from` | ポート参照 | ○ | — | 出力ポート |
| `to` | ポート参照 | ○ | — | 入力ポート |
| `id` | 文字列 | × | 自動(`c<N>`) | §2.2 の書式 |
- 返値: `cable`(`{"id", "from", "to"}`)。型違いのときは `warnings` に `type_mismatch`。
- 検証エラー: ERR-102, ERR-111, ERR-112, ERR-113, ERR-114, ERR-116, ERR-106, ERR-003。規則は §13。
- 副作用: 次の処理ブロックから接続先の入力が「接続あり」になる(COM-09 の未接続時の値・正規化が切れる)。ケーブルは1サンプル遅延(COM-06)。
- 取り消し: そのケーブルを外す。

### CMD-07 `cable.disconnect`
- 引数: `cable_id`(文字列)**または** `to`(入力のポート参照)のどちらか一方(両方・どちらもなしは ERR-003)。1つの入力にはケーブルが1本までなので(§13.2)、`to` で一意に決まる。
- 返値: `removed_cable`(`{"id", "from", "to"}`)。
- 検証エラー: ERR-115, ERR-102, ERR-111, ERR-003。
- 副作用: 接続先の入力は未接続時の値へ戻る(COM-09)。取り消し: 同じIDで接続し直す。

### CMD-08 `param.set`
| 引数 | 型 | 必須 | 既定 | 内容 |
|---|---|---|---|---|
| `module_id` | 文字列 | ○ | — | |
| `param` | 文字列 | ○ | — | 各モジュール仕様 §4 の名前 |
| `value` | 数値 | ○ | — | 単位・範囲は各モジュール仕様 §4(`module.list_types` で取得できる)。検証は §12 |
| `coalesce_key` | 文字列(1〜64文字) | × | なし | 連続操作を履歴1件にまとめる鍵(§9.4) |
- 返値: `module_id`, `param`, `value`(設定後の値), `previous`, `changed`。
- 検証エラー: ERR-102, ERR-121, ERR-122, ERR-123, ERR-003。
- 副作用: 次の処理ステップから有効(COM-13。実装上は次のブロック先頭: product-spec §5.6)。補間の有無は各モジュール仕様 §4。`seed` の変更は次のステップで再シード(COM-11)。`MOD-IO-002` の `channel`、`MOD-IO-003` の `capture_len` の変更は各仕様が定める状態の初期化を伴う。
- 取り消し: 前の値へ戻す。

### CMD-09 `batch`
- 引数: `ops`(配列、必須、1〜500件 [暫定値])。各要素は `{"command": 文字列, "args": オブジェクト}`。入れられるのは表の batch 列が ○ のコマンド(`module.add`, `module.remove`, `module.move`, `cable.connect`, `cable.disconnect`, `param.set`, `patch.set_meta`)。
- 動作: 現在のパッチの作業用の写しに対し、`ops` を**先頭から順に**検証・適用する。後の操作は前の操作の結果を参照できる(例: 追加したモジュールのIDを接続で使う。IDは `id` で指定する)。全件が成功したときだけ写しを現在のパッチにする。
- 返値: `results`(各操作の `result` の配列、`ops` と同じ順)。各操作の `warnings` はまとめて封筒の `warnings` に入れ、`details.index` で操作を示す。
- 検証エラー: ERR-132(1件でも入れられないコマンドがあれば、何も検証せず拒否)、ERR-131(`details.failed_index` は 0 始まり、`details.cause` はその操作のエラー `{"id", "code", "message", "details"}`)、ERR-106。
- 副作用: 成功時、リビジョンは **1 だけ**進み、履歴は1件、通知(EVT-01)は1件。エンジンへは1つの差分として同じブロック境界で反映する。
- 部分失敗: 1つでも失敗したら**全体を適用しない**(状態・リビジョン・履歴は不変。通知なし)。REQ-F-012。
- `expected_revision` と `idempotency_key` は `batch` 全体に対して1回だけ評価する(`ops` の要素には書けない)。
- 取り消し: `batch` 全体を1回で戻す。

### CMD-10 `patch.get`
- 引数: なし。
- 返値: `patch`(data-contract §3 の形。`patch.save` が書く内容と同じ)、`history`(`{"can_undo": 真偽, "can_redo": 真偽}`)。リビジョン・`session_id`・音声状態は封筒にある。
- 副作用: なし。

### CMD-11 `patch.new`
- 引数: なし。
- 返値: `patch`(空のパッチ: モジュールは既定パラメータの `out` だけ、ケーブルなし。data-contract §3.3)。
- 副作用: エンジンの全モジュールを作り直す。マスター音量の扱いは `patch.load` と同じ。
- 取り消し: 置き換え前のパッチへ戻す(履歴1件)。

### CMD-12 `patch.save`
| 引数 | 型 | 必須 | 既定 | 内容 |
|---|---|---|---|---|
| `name` | 文字列 | ○ | — | §2.2 のパッチ名。保存先は専用フォルダ内の `<name>.patch.json`(data-contract §7.2) |
| `overwrite` | 真偽 | × | `false` | 同名があるとき上書きするか |
- 返値: `name`, `bytes`, `saved_at`(RFC 3339、UTC), `overwritten`(真偽)。
- 検証エラー: ERR-201, ERR-203, ERR-005(エージェントによる、人が保存したファイルの上書き。§15.3), ERR-206, ERR-207。
- 副作用: ファイルを書く(一時ファイルに書いてから置き換える)。パッチ・リビジョン・履歴は変えない。通知 EVT-06。
- 取り消し: 不可(ファイルは履歴の対象外)。
- 保存するのは構成とパラメータで、内部状態(遅延バッファ等)は含めない(data-contract §2)。

### CMD-13 `patch.load`
- 引数: `name`(保存パッチ名)**または** `patch`(パッチJSONのオブジェクト)のどちらか一方(両方・どちらもなしは ERR-003)。`patch` はUIのファイル取込と、エージェントがJSONを直接渡す場合に使う。
- 返値: `patch`(読込後のパッチ)、`migrated`(移行した場合の内容。data-contract §9.4。移行なしは `null`)。
- 検証エラー: ERR-201, ERR-202, ERR-204, ERR-205, ERR-206, ERR-207。**検証に通らなければ現在のパッチは不変**(product-spec §2 SC-H3)。検証内容は data-contract §8。
- 副作用: パッチ全体を置き換える。エンジンの全モジュールを作り直し、初期状態から始める(COM-10)。マスター音量は低い既定値からフェードインする(REQ-S-003、product-spec §8.1)。音声状態と緊急停止の状態は変えない(緊急停止中は消音のまま)。
- 取り消し: 置き換え前のパッチへ戻す(履歴1件)。[設計判断] 読込を取り消せるようにして、エージェントまたは人が相手の作業中のパッチを誤って失わせないようにする。

### CMD-14 `patch.list`
- 引数: なし。
- 返値: `patches`(配列。`{"name", "title", "bytes", "modified_at", "saved_by_kind", "readable"}`)。読めない・壊れたファイルは `readable: false`(一覧からは隠さない)。
- 副作用: なし。**セッションがなくても応答できる**(product-spec §4)。

### CMD-15 `patch.read`
- 引数: `name`(必須)。
- 返値: `patch`(ファイルの内容をJSONとして解釈したもの。**検証・移行はしない**)、`bytes`、`modified_at`。
- 検証エラー: ERR-201, ERR-202, ERR-207, ERR-204(JSONとして解釈できない)。
- 副作用: なし。現在のパッチは変わらない。セッションがなくても応答できる。

### CMD-16 `patch.delete`
- 引数: `name`(必須)。返値: `name`。検証エラー: ERR-201, ERR-202, ERR-207。
- 副作用: ファイルを削除する。通知 EVT-06。取り消し不可。
- 権限: 人のみ。[設計判断] product-spec §8.2 がエージェントに認めるのは「名前付き保存・読出し」で、削除は含まれない。

### CMD-17 `patch.set_meta`
- 引数: `title`(文字列、0〜120文字)、`description`(文字列、0〜2000文字)。少なくとも一方が必要。
- 返値: `meta`, `changed`。検証エラー: ERR-003。副作用: 音には影響しない。取り消し: 前の値へ戻す。

### CMD-18 `history.undo` / CMD-19 `history.redo`
- 引数: なし。
- 返値: `undone`(または `redone`): `{"command", "actor", "revision"}`(対象になった変更のコマンド名、その変更を行った操作者、その変更が作ったリビジョン)。`history`(`{"can_undo", "can_redo"}`)。
- 検証エラー: ERR-141 / ERR-142。
- 副作用と規則: §9。リビジョンは 1 進む。

### CMD-20 `meter.read`
| 引数 | 型 | 必須 | 既定 | 内容 |
|---|---|---|---|---|
| `module_id` | 文字列 | ○ | — | `MOD-IO-003` のモジュール |
| `fields` | 文字列の配列 | × | `frame` 以外の全項目 | 読む項目。名前は MOD-IO-003 §3 の読出し値(`level`, `peak`, `rms`, `mean`, `vmin`, `vmax`, `windows`, `peak_hold`, `nonfinite_count`, `frame`, `frame_seq`)。未知の名前は ERR-003 |
- 返値: `values`(項目名→値。単位と更新時点は MOD-IO-003 §3)、`sample_time`(エンジンの通算サンプル番号)、`fs`、`engine_revision`(§11.3)。
- `frame`(最大4096個の数値)は大きいので、`fields` で明示したときだけ返す。
- 値は「ある処理ブロックが終わった直後」の同一時点の組で返す [設計判断: MOD-IO-003 §11 が#3に委ねた取得タイミング]。
- 検証エラー: ERR-102, ERR-303, ERR-301, ERR-003。副作用: なし(測定状態を初期化しない)。

### CMD-21 `engine.get_status`
- 引数: なし。
- 返値:
  - `audio_state`、`panic`、`fs`(`stopped` のとき `null`)、`engine_revision`(`stopped` のとき `null`)、`sample_time`
  - `output`: `{"level_db", "agent_max_level_db", "clip_count", "nonfinite_count"}`(`clip_count` は MOD-IO-001 §5 の状態、`nonfinite_count` は product-spec §8.1 の非有限値除去の回数)
  - `midi`: `{"available": 真偽}`(Web MIDI が使えるか。product-spec §7.3)
  - `history`: `{"can_undo", "can_redo"}`
- 副作用: なし。セッションがない場合は ERR-006。

### CMD-22 `engine.start`
- 引数: なし。返値: `audio_state`, `fs`。
- 検証エラー: ERR-005(エージェント)、ERR-304。
- 副作用: `stopped`/`suspended` → `running`。`stopped` からの開始時は現在のパッチからエンジンを構築する。出力は低い既定値からフェードインする(product-spec §8.1)。通知 EVT-02。既に `running` なら何もせず成功。
- 権限: 人のみ(利用者の操作の中でだけ呼べる。F-021-019、REQ-A-008)。

### CMD-23 `engine.panic`
- 引数: なし。返値: `panic: true`。
- 副作用: マスターを即時に消音し、全モジュールの内部状態を初期化する(`reset()`。COM-10)。パッチ・リビジョン・履歴は変えない(product-spec §8.1)。通知 EVT-03。
- 何度呼んでも同じ結果(緊急停止中に呼んでも成功)。どの音声状態でも受け付ける(`stopped` 中は `panic` だけ立ち、開始しても消音のまま)。`expected_revision` は**無視する**(止める操作を競合で失敗させない)[設計判断]。
- 取り消し: 不可。解除は CMD-24。

### CMD-24 `engine.release_panic`
- 引数: なし。返値: `panic: false`。検証エラー: ERR-005(エージェント)。
- 副作用: 消音を解除し、低い既定値からフェードインする(product-spec §8.1)。通知 EVT-03。緊急停止中でなければ何もせず成功。

### CMD-25 `output.set_level`
- 引数: `level_db`(数値、必須。単位 dB。範囲 −60〜0。0 dB = 増幅なし)。
  - 範囲 −60〜0 は [暫定値・設計判断]: マスターは増幅しない(上げる方向は MOD-IO-001 の `level` で行える)。下限と起動時の既定値・フェード時間は product-spec §8.1 のとおり測定タスクで決める(本書は確定しない)。
- 返値: `level_db`, `agent_max_level_db`。
- 検証エラー: ERR-003(数値でない)、ERR-123(範囲外)、ERR-302(エージェントが `agent_max_level_db` を超える値を指定)。
- 規則(product-spec §8.1 の初期案に従う):
  - 人が設定したとき: `level_db` を設定し、`agent_max_level_db` も同じ値にする。
  - エージェントが設定したとき: `level_db ≤ agent_max_level_db` のときだけ設定する。`agent_max_level_db` は変わらない。超える要求は**拒否**する(クランプしない。理由は §12.2 と同じ)。
  - 起動時・パッチ読込時・音声開始時に音量が既定値へ戻ると、`agent_max_level_db` も既定値に戻る。
- 副作用: 音量を平滑に変える。通知 EVT-03。リビジョン・履歴の対象外(§2.1)。

### 6.1 初期版に含めないコマンド
| 候補 | 扱い | 理由 |
|---|---|---|
| エージェントからのノート送信(MIDIイベントの注入) | 後続候補(オーナー確認) | REQ に含まれない。MOD-IO-002 §11 が時刻の与え方を未決としている。発音の確認は当面クロック・シーケンサ(MOD-CLK-001, MOD-SEQ-001)と `meter.read` で行う |
| スナップショット(内部状態を含む完全保存)の取得・復元 | 製品のコマンドにしない | 検証用。エンジンのコードを直接呼ぶ(data-contract §6) |
| 時刻指定つきの変更(何サンプル目に適用) | 後続 | 初期版は到着順に適用(§11) |
| サーバー停止、任意パスの読み書き、任意ホストへの送信 | 設けない | REQ-S-007 |

## 7. 再送と冪等性
1. `idempotency_key` を付けた**変更系コマンドの成功応答**を、コマンド処理(タブ側)が鍵ごとに保存する。保存件数は直近 1000 件 [暫定値]、範囲は同じ `session_id` の間。
2. 同じ鍵・同じ内容(`command`、`args`、`expected_revision` が一致)の要求が再び来たら、**適用せずに**保存済みの応答を `replayed: true` で返す。`request_id` は再送側の値に差し替える。`revision` は最初の応答時の値のまま(現在値は `patch.get` で読む)。
3. 同じ鍵で内容が違う要求は ERR-009。
4. 応答が届かない場合(接続断、ERR-007)は**適用されたか不明**である。利用者は同じ鍵で再送する。適用済みなら保存済みの応答が、未適用なら新しく適用した応答が返る。
5. **失敗した応答は保存しない**(再送時にあらためて評価する)。[設計判断] 失敗は状態を変えないので二重適用の危険がなく、一時的な失敗(ERR-006, ERR-007)の後に同じ鍵で再送できるようにする。
6. 読出しコマンドと、何度実行しても同じ結果になるコマンド(`engine.panic`)では鍵を無視する。
7. 再読込(`session_id` の変化)をまたぐと保存済みの応答は失われる。再読込をまたぐ再送は、`patch.get` で状態を確かめてから行う。`expected_revision` を併用すれば、適用済みの再送は ERR-008 になり二重適用を防げる。
8. タブの応答待ち時間は 5 秒 [暫定値。性能目標ではない]。超えたら ERR-007 を返す。

## 8. 競合
1. `expected_revision` が指定され、現在のリビジョンと違えば ERR-008 を返し、何も変えない。`details.current_revision` に現在値を入れる。
2. 指定がなければ、現在の状態に対してそのまま適用する(後から来た要求が有効)。
3. エージェントは変更系コマンドに `expected_revision` を付けることを推奨する。人のUIは、表示が通知で常に最新になる前提で、既定では付けない。
4. ERR-008 を受けた側は `patch.get`(または通知)で最新を取り込み、必要なら作り直して再送する。自動の統合(マージ)はしない [設計判断: 単一の正本を直列に更新する。DEC-105]。
5. リビジョンはパッチ全体で1つ。別のモジュールへの無関係な変更でも競合になる(細かい単位の競合検出は初期版では行わない)。

## 9. 取り消し・やり直し
1. 履歴は**1本**で、人とエージェントの変更が適用順に並ぶ(DEC-105, REQ-F-009)。`history.undo` は、誰が行ったかに関係なく**直前の変更**を戻す(product-spec §2 SC-X1)。操作者ごとの履歴は持たない。
2. 履歴に積むのは、パッチを変えた成功コマンド(§6 の表で取消 ○)。`batch` は1件。読出し・音量・緊急停止・ファイル保存は積まない。
3. `history.undo`/`history.redo` 自体もパッチを変えるので、リビジョンは 1 進み、通知(EVT-01)が出る。取り消し後に新しい変更を行うと、やり直し側の履歴は消える。
4. **連続操作のまとめ**: 同じ操作者が、同じ `coalesce_key`・同じ `module_id`・同じ `param` の `param.set` を続けて送り、間に他の変更が入らなければ、履歴上は1件にまとめる(戻り先は最初の変更の前の値)。リビジョンと通知は1回ごとに進む・出る。UIのノブのドラッグ用。
5. **戻るのはパッチ(構成とパラメータ)だけ**。エンジンの内部状態は戻らない: 取り消しで復活したモジュールは初期状態から始まり、他のモジュールの状態はそのまま続く。[設計判断] 内部状態はパッチの一部ではない(data-contract §2)。
6. やり直し(`redo`)は記録済みの結果を再適用する(自動採番したIDや自動割当した `seed` を計算し直さない)。
7. 履歴の保持件数は 200 件 [暫定値]。超えた古いものから捨てる。再読込で履歴は消える(自動保存に含めない)。
8. `patch.load`/`patch.new` は履歴を消さず、「パッチ全体の置き換え」として1件積む。

## 10. 通知(EVT)
WebSocketで接続した利用者とUIに、状態の変化を知らせる。HTTPだけの利用者とMCP(§17)は通知を受けないので、`patch.get` と `expected_revision` で同期する。
共通フィールド: `{"v": 1, "event": "<名前>", "seq": 整数, "session_id": 文字列, "data": {…}}`。`seq` は接続ごとの連番で、欠番に気づいたら `patch.get` で取り直す。

| ID | event | 出る時点 | `data` |
|---|---|---|---|
| EVT-01 | `patch.changed` | パッチを変えるコマンドが成功したとき(1コマンドに1件) | `revision`, `previous_revision`, `actor`, `command`, `request_id`, `changes` |
| EVT-02 | `engine.state_changed` | 音声状態、`fs`、MIDIの利用可否が変わったとき | `audio_state`, `fs`, `midi` |
| EVT-03 | `output.changed` | マスター音量または緊急停止の状態が変わったとき | `level_db`, `agent_max_level_db`, `panic`, `actor`, `reason`(`set_level` / `panic` / `release_panic` / `reset_to_default`) |
| EVT-04 | `engine.diagnostic` | 非有限値の除去またはクリップが新たに起きたとき(REQ-S-006)。多発時は間引き、累計を載せる | `nonfinite_count`, `clip_count` |
| EVT-05 | `session.changed` | パッチを持つタブがつながった・切れたとき(サーバーが出す) | `connected`, `session_id`, `revision` |
| EVT-06 | `library.changed` | 保存パッチが保存・削除されたとき | `name`, `action`(`saved` / `deleted`), `actor` |

- EVT-01 は**要求した本人にも**届く(`request_id` で自分の操作と分かる)。`actor` により「誰のどの操作でリビジョンが進んだか」が分かる(REQ-A-006)。
- `changes` は適用された変更の列。各要素の `kind` は `module_added`(`module`)、`module_removed`(`module_id`)、`cable_added`(`cable`)、`cable_removed`(`cable_id`)、`param_changed`(`module_id`, `param`, `value`)、`module_moved`(`module_id`, `ui`)、`meta_changed`(`meta`)、`patch_replaced`(内容は載せない。`patch.get` で取り直す)。`module.remove` では、外れたケーブルの `cable_removed` も並ぶ。`history.undo`/`redo` でも、実際に起きた変更を同じ形で載せる。
- 通知は応答の**後**に、リビジョンの順で送る。

## 11. 時間と同期
1. **適用の時点**: コマンドは到着順に処理され、パッチグラフに適用された時点で確定する(応答の `revision`)。応答はエンジンへの反映を待たない。
2. **エンジンへの反映**: コマンド処理はリビジョン番号つきの差分を音声エンジンへ送る(F-021-015)。エンジンは次の処理ブロックの先頭で適用する(product-spec §5.6, §5.7。COM-13 の「次のステップ」をブロック境界に量子化)。1つのコマンド(`batch` を含む)の差分は同じブロック境界でまとめて適用する。
3. **反映の確認**: エンジンは適用済みの最新リビジョンを `engine_revision` として報告する。`meter.read` と `engine.get_status` の返値に含まれる。エージェントは「自分の変更のリビジョン ≤ `engine_revision`」を確かめてから測定値を使う。測定窓(MOD-IO-003 の `window_ms`)が変更後に閉じるまでは、古い区間を含む値が返りうる(`windows` の増加で判断する)。
4. **音声未開始時**(`stopped`): パッチの編集・保存・読込・取り消しはすべて通常どおり成功する。エンジンはまだないので `engine_revision` は `null`、`meter.read` は ERR-301。開始時に現在のパッチ全体から構築する(REQ-A-008)。
5. **中断時**(`suspended`): 編集は成功し、差分はたまる。再開時に順に適用する。
6. **時刻指定はない**: 初期版のコマンドは「いつ適用するか」を指定できない。操作から音までの遅延は測定対象で、数値目標は未決(OPEN-001、REQ-NF-005)。
7. **人とエージェントの順序**: 両者の要求は同じ1本の待ち行列に入り、コマンド処理が受け取った順で処理する。同時に届いた場合の順は受け取り順で、どちらが先でも結果は契約どおりに定まる。

## 12. パラメータ値の検証
### 12.1 規則
`param.set`、`module.add` の `params`、`patch.load` のパラメータに共通。範囲・既定値・型の正本は各モジュール仕様 §4。
| 入力 | 扱い |
|---|---|
| 有限の数値で、範囲内 | 受理 |
| 有限の数値で、**範囲外** | **拒否**(ERR-123)。クランプしない |
| 数値でない(文字列、`null`、真偽値、配列、オブジェクト) | 拒否(ERR-122) |
| NaN・±∞ | JSONの数値として書けないので、文字列(`"NaN"`)や `null` で来る → 拒否(ERR-122)。封筒が数値の拡張表記(`NaN`, `Infinity`)を含む場合はJSONとして不正 → ERR-001 |
| 整数型・列挙型・真偽型(各仕様で「整数」「列挙」「真偽」「論理」とあるもの、`seed`)に非整数(例 `0.5`) | 拒否(ERR-122)。四捨五入しない |
| 他のパラメータに依存する範囲(MOD-IO-003 の `pre` は 0〜`capture_len−1`) | 仕様の最大範囲(`pre` は 0〜4095)で検証する。依存する上限はエンジンが仕様どおりクランプする |
| 有効値の下限が `fs` に依存するもの(MOD-DLY-001 の `time` は有効値が 1/fs 以上) | 仕様の範囲(0〜2.0)で検証する。有効値のクランプはエンジンが行う |

### 12.2 クランプでなく拒否とする理由 [設計判断]
- COM-12/COM-13 は「エンジン内では範囲外をクランプ、NaN/∞は既定値」と定め、外部操作層の検証エラーは別層としている(COM-13 末尾)。本書はその外部操作層で、矛盾しない。
- 拒否にすると、**パッチグラフが持つ値は常に範囲内の有限値**になる。`patch.get` の値・保存される値・エンジンが使う値が一致し、エージェントが「送った値」と「実際の値」の食い違いに気づけない状況がなくなる(REQ-A-004)。
- エンジン側のクランプ(COM-12/13)は残す。正常な経路では働かない**二重の保護**で、モジュール仕様の検証例(無効入力)はエンジン単体の試験として引き続き有効。
- UIは `module.list_types` の範囲でノブの可動域を制限し、範囲外の値を送らない。
- 退けた案: 外部層でもクランプして適用後の値を返す(product-spec §2 SC-A2 の「拒否またはクランプ」のうちクランプ側)。値の食い違いが成功応答に埋もれるため採らない。

## 13. 接続規則
1. `from` は出力ポート、`to` は入力ポート(ERR-112)。
2. **1つの入力にケーブルは1本まで**(ERR-114)。既にある入力へつなぐ場合は、先に外す(`batch` で「外す → つなぐ」を1回で行える)。自動の置き換えはしない。
   - [設計判断] 理由: 各モジュール仕様は入力を「1つの値」と「接続の有無」(COM-09)で定義しており、1つの入力に複数ケーブルを足し合わせる挙動は#2に定義がない。加算は MOD-MIX-001 で行う。先行例にも入力1本の制約がある(F-018-059, F-018-067)。置き換えを自動にしないのは、暗黙にケーブルが消える副作用を避けるため。
3. **1つの出力からは何本でも**つなげる(F-005-002)。上限は全体のケーブル数(§16)。
4. **同じ接続の重複**(同じ `from` と `to`)は、規則2により ERR-114(`details.same_source = true`)。
5. **自己接続・フィードバック**(同じモジュールの出力→入力、複数モジュールを回るループ)は**許可**する。ケーブルの1サンプル遅延により常に定義される(COM-06, REQ-F-011)。警告も出さない。
6. **接続できないポート**(ERR-113): `MOD-IO-001` の `DEV_L`・`DEV_R`(デバイスへ渡す値で、配線用ではない: MOD-IO-001 §3)、`MOD-IO-002` の `MIDI`(ケーブルでなくエンジンが渡すイベント: MOD-IO-002 §3)。`module.list_types` では `connectable: false`。
   - [設計判断] パッチ内のすべての `MOD-IO-002` は、タブが受けたMIDI入力の同じ列を受け取る(振り分けは各モジュールの `channel` パラメータ)。MOD-IO-002 §11 が#3に委ねた配線の決定。
7. **型違いの接続**(COM-01 の型が違う)は許可し、成功応答の `warnings` に `type_mismatch` を入れる(REQ-F-002)。`details` に両端の型を入れる。[設計判断: COM-01 が#3に委ねた警告の有無。接続は止めず、知らせるだけ]
8. `out`(`MOD-IO-001`)は常設で削除不可(ERR-104)、追加不可(ERR-105)。`out` へのケーブルの接続・切断、`out` のパラメータ変更は通常どおりできる。
9. モジュールを削除すると、つながるケーブルもすべて外れる(CMD-03)。

## 14. 新規モジュールの `seed` 自動割当
- 対象: `seed` パラメータを持つ種別(MOD-NSE-001, MOD-RND-001)。
- 規則 [設計判断]: `module.add` で `seed` を**指定しなかった**とき、「仕様の既定seed以上で、パッチ内の `seed` を持つどのモジュールも使っていない最小の整数」を割り当てる。最初の1個は仕様の既定値(1)になり、2個目は 2、以降同様。割り当てた値は返値の `module.params.seed` に入る。
- `seed` を**指定した**ときはその値を使う。他のモジュールと重なる場合は成功させ、`warnings` に `duplicate_seed` を入れる。`param.set` で重なる値にした場合も同じ。
- 理由: 既定seedが同じモジュールは同じ乱数列を出す(COM-11 の相関注意)。ノイズ源を2つ置いたときに同一波形になるのを避ける。割当は乱数でなく**パッチの状態だけで決まる**ので再現性(REQ-NF-003)を保つ。1個目は仕様の既定値のままなので、モジュール仕様の検証例(既定seed前提)と食い違わない。
- 割当は `module.add` の時点だけ。パッチの読込時は書かれている値をそのまま使う(省略時は仕様の既定値。data-contract §4.1)。
- 退けた案: 何もしない(警告のみ)。知らずに相関したノイズを重ねる誤りが起きやすい。

## 15. 権限
### 15.1 操作者
| 操作者 | 判定 | できること |
|---|---|---|
| `human` | タブ内のUIからの要求 | すべてのコマンド |
| `agent` | ローカルサーバー経由の要求(トークン必須。REQ-S-005) | §6 の表で「両方」のコマンド。制限は 15.2 |

### 15.2 エージェントに許さない操作(product-spec §8.2 と一致)
| 操作 | 応答 |
|---|---|
| 音声の開始(`engine.start`) | ERR-005 |
| 緊急停止の解除(`engine.release_panic`) | ERR-005 |
| 音量上限を超える設定・上限の変更(`output.set_level`) | ERR-302(上限は人の設定でのみ変わる) |
| 保存パッチの削除(`patch.delete`) | ERR-005 |
| 人が保存したファイルの上書き(15.3) | ERR-005 |
| 専用フォルダ外の読み書き(名前にパス区切り・上位参照など) | ERR-201(パスを受け取る引数自体がない) |
| サーバー停止、任意ホストへの送信、コードの実行 | コマンドが存在しない(ERR-002) |

### 15.3 保存ファイルの上書き [設計判断]
- 人: `overwrite: true` で常に上書きできる。
- エージェント: `overwrite: true` でも、上書きできるのは**最後にエージェントが保存したファイル**(ファイル内の `meta.saved_by.kind` が `agent`。data-contract §3.2)だけ。人が保存したファイル、および読めないファイルは ERR-005。
- 理由: product-spec §8.2 はエージェントに名前付き保存を認めるが、人の保存物を失わせる経路は作らない。エージェントが自分の作業を同じ名前で更新することは妨げない。

## 16. 上限
いずれも [暫定値]。暴走・誤用で資源を使い切らないための上限で、性能の保証値ではない(性能目標は OPEN-001。測定後に見直す)。
| 対象 | 上限 | 超過時 |
|---|---|---|
| 要求1件の大きさ | 2 MiB | ERR-011 |
| パッチ内のモジュール数 | 256 | ERR-106 |
| パッチ内のケーブル数 | 1024 | ERR-106 |
| `batch` の操作数 | 500 | ERR-106 |
| パッチJSONの大きさ | 1 MiB(data-contract §10) | ERR-206 |

## 17. MCPアダプタとの対応
MCPアダプタは共通コマンドを1対1でツールにする薄い変換層で、独自の状態・機能を持たない(DEC-002, REQ-A-007, product-spec §7.2)。輸送方式は OPEN-008。
| 項目 | 規則 |
|---|---|
| ツール名 | コマンド名の `.` を `_` に置き換える(`module.add` → `module_add`、`patch.get` → `patch_get`、`batch` → `batch`)。接頭辞は付けない |
| 公開するツール | §6 の表で権限が「両方」のコマンドすべて(22個)。「人のみ」の `patch.delete`、`engine.start`、`engine.release_panic` は**ツールにしない** |
| 入力 | そのコマンドの `args` のフィールドに、任意の `expected_revision` と `idempotency_key` を加えたもの。入力スキーマは `module.list_types` と同じ定義表・本書の引数表から作る |
| 封筒 | アダプタが `v`、`request_id`(自動生成)、`client_id` を補う。操作者は常に `agent` |
| 出力 | 応答の封筒(§3.2)をそのままJSONで返す。`ok: false` はツールのエラー結果として返し、`error` を保つ(エラーを握りつぶさない) |
| 再送 | アダプタは自動再送しない。`idempotency_key` は呼び出し側が指定したときだけ渡す |
| 通知 | 初期版では転送しない。エージェントは `patch_get` と `expected_revision` で同期する |
| ツールの説明 | 読出しのみ・取り消し不可などの性質を、§6 の表から機械的に付ける |

MCP経由の結果は、同じ要求を共通コマンドAPIへ直接送った結果と一致しなければならない(VER-A-007)。

## 18. 受入例
前提(特記がなければ各例の開始時点): 基準パッチ **P0** = data-contract §11 の完全な例(モジュール `out`, `midi1`, `vco1`, `vcf1`, `vca1`, `env1`、ケーブル `c1`〜`c6`)。`revision = 10`、`audio_state = running`、緊急停止なし、操作者は `agent`(トークンあり)。要求は封筒の `v` と `request_id` を省略して示す。応答は主要なフィールドだけを示す。

| ID | 場面 | 要求 | 期待する応答 | 適用後の状態 |
|---|---|---|---|---|
| AX-01 | パッチ保存→復元 | ① `{"command":"patch.save","args":{"name":"bass-01"}}` ② `{"command":"param.set","args":{"module_id":"vcf1","param":"res","value":0.9}}` ③ `{"command":"patch.load","args":{"name":"bass-01"}}` ④ `{"command":"patch.get"}` | ① `ok:true`, `revision:10`, `result.name:"bass-01"` ② `ok:true`, `revision:11` ③ `ok:true`, `revision:12`, `result.migrated:null` ④ `ok:true`, `revision:12` | ④の `result.patch` のモジュール・パラメータ・ケーブルが P0 と一致(`vcf1.res = 0.3`)。ファイル `bass-01.patch.json` がある。履歴は②③の2件 |
| AX-02a | 無効な接続(方向) | `{"command":"cable.connect","args":{"from":{"module":"vco1","port":"pitch"},"to":{"module":"vcf1","port":"cv2"}}}` | `ok:false`, `error.id:"ERR-112"`, `revision:10` | 不変 |
| AX-02b | 無効な接続(入力が使用中) | `{"command":"cable.connect","args":{"from":{"module":"vco1","port":"pulse"},"to":{"module":"vcf1","port":"in"}}}` | `ok:false`, `error.id:"ERR-114"`, `details.existing_cable_id:"c2"`, `details.same_source:false` | 不変 |
| AX-02c | 無効な接続(接続できないポート) | `{"command":"cable.connect","args":{"from":{"module":"out","port":"DEV_L"},"to":{"module":"vcf1","port":"cv2"}}}` | `ok:false`, `error.id:"ERR-113"` | 不変 |
| AX-03a | 存在しないモジュール | `{"command":"param.set","args":{"module_id":"m99","param":"cutoff","value":1.0}}` | `ok:false`, `error.id:"ERR-102"`, `details.module_id:"m99"`, `revision:10` | 不変 |
| AX-03b | 存在しないポート | `{"command":"cable.connect","args":{"from":{"module":"vco1","port":"square"},"to":{"module":"vcf1","port":"cv2"}}}` | `ok:false`, `error.id:"ERR-111"` | 不変 |
| AX-03c | 存在しないケーブル | `{"command":"cable.disconnect","args":{"cable_id":"c99"}}` | `ok:false`, `error.id:"ERR-115"` | 不変 |
| AX-03d | 存在しないパラメータ | `{"command":"param.set","args":{"module_id":"vcf1","param":"resonance","value":0.5}}` | `ok:false`, `error.id:"ERR-121"` | 不変 |
| AX-04a | 不正パラメータ(範囲外) | `{"command":"param.set","args":{"module_id":"vcf1","param":"cutoff","value":7.5}}` | `ok:false`, `error.id:"ERR-123"`, `details.min:-5`, `details.max:6` | 不変(`cutoff = 1.0` のまま。6 にクランプされない) |
| AX-04b | 不正パラメータ(型違い) | `{"command":"param.set","args":{"module_id":"vcf1","param":"cutoff","value":"high"}}` | `ok:false`, `error.id:"ERR-122"` | 不変 |
| AX-04c | 不正パラメータ(NaNの代用) | `{"command":"param.set","args":{"module_id":"vcf1","param":"cutoff","value":null}}` および `"value":"NaN"` | どちらも `ok:false`, `error.id:"ERR-122"` | 不変 |
| AX-04d | 不正パラメータ(整数型に非整数) | `{"command":"param.set","args":{"module_id":"vco1","param":"range","value":0.5}}` | `ok:false`, `error.id:"ERR-122"` | 不変(`range = 0`。1 に丸められない) |
| AX-05a | 中断・再送 | `{"command":"param.set","args":{"module_id":"vcf1","param":"res","value":0.4},"idempotency_key":"k-001"}` を送り、応答を受け取れなかったとして同じ要求をもう一度送る | 1回目 `ok:true`, `revision:11`, `replayed:false`。2回目 `ok:true`, `revision:11`, `replayed:true` | `vcf1.res = 0.4`、`revision = 11`、履歴は1件だけ増える。EVT-01 は1件 |
| AX-05b | 冪等キーの使い回し | AX-05a の後、`{"command":"param.set","args":{"module_id":"vcf1","param":"res","value":0.8},"idempotency_key":"k-001"}` | `ok:false`, `error.id:"ERR-009"`, `revision:11` | 不変(`res = 0.4`) |
| AX-06 | 競合 | 人が `vcf1.cutoff` を変えて `revision = 11` になった後、エージェントが `{"command":"param.set","args":{"module_id":"vcf1","param":"cutoff","value":2.0},"expected_revision":10}` | `ok:false`, `error.id:"ERR-008"`, `details.expected_revision:10`, `details.current_revision:11`, `revision:11` | 不変(人の変更が残る) |
| AX-07 | フィードバック接続(自己接続) | `{"command":"cable.connect","args":{"from":{"module":"vcf1","port":"out"},"to":{"module":"vcf1","port":"cv2"},"id":"fb1"}}` | `ok:true`, `revision:11`, `result.cable.id:"fb1"`, `warnings[0].code:"type_mismatch"`(audio→cv) | ケーブル `fb1` が加わる。ループは1サンプル遅延で動作する(COM-06) |
| AX-08a | `batch` の部分失敗 | `{"command":"batch","args":{"ops":[{"command":"module.add","args":{"type":"MOD-LFO-001","id":"lfo1"}},{"command":"cable.connect","args":{"from":{"module":"lfo1","port":"sine"},"to":{"module":"vcf1","port":"cv3"}}},{"command":"param.set","args":{"module_id":"lfo1","param":"freq","value":9999}}]}}` | `ok:false`, `error.id:"ERR-131"`, `details.failed_index:2`, `details.cause.id:"ERR-123"`, `revision:10` | 不変(`lfo1` もケーブルも存在しない)。通知なし。履歴は増えない |
| AX-08b | `batch` の成功 | AX-08a の3つ目を `"value":0.5` にした要求 | `ok:true`, `revision:11`, `result.results` が3件 | `lfo1`、ケーブル1本、`lfo1.freq = 0.5`。リビジョンは1だけ進む。`history.undo` 1回で3つとも戻り `revision = 12` |
| AX-09a | 音声未開始時の編集 | `audio_state = stopped` で `{"command":"param.set","args":{"module_id":"vcf1","param":"cutoff","value":2.0}}` | `ok:true`, `revision:11`, `audio_state:"stopped"` | `cutoff = 2.0`。音は出ない。開始後のエンジンは `cutoff = 2.0` で始まる |
| AX-09b | 音声未開始時の読出し | P0 に `MOD-IO-003`(ID `scope1`)を加えた状態(`revision = 11`)、`audio_state = stopped` で `{"command":"meter.read","args":{"module_id":"scope1"}}` | `ok:false`, `error.id:"ERR-301"`, `details.audio_state:"stopped"` | 不変 |
| AX-09c | 音声の自動開始の試み | `{"command":"engine.start"}`(エージェント) | `ok:false`, `error.id:"ERR-005"`, `audio_state:"stopped"` | 不変(音声は開始されない) |
| AX-10a | 権限外(緊急停止の解除) | エージェントが `{"command":"engine.panic"}` の後 `{"command":"engine.release_panic"}` | 1つ目 `ok:true`, `result.panic:true`。2つ目 `ok:false`, `error.id:"ERR-005"` | 緊急停止のまま(消音)。パッチと `revision = 10` は不変 |
| AX-10b | 権限外(音量上限) | `agent_max_level_db = -20` のとき `{"command":"output.set_level","args":{"level_db":-6}}` | `ok:false`, `error.id:"ERR-302"`, `details.max_db:-20` | 音量は不変(−20 にクランプされない) |
| AX-10c | 権限外(保存先) | `{"command":"patch.save","args":{"name":"../etc/x"}}` | `ok:false`, `error.id:"ERR-201"` | ファイルは作られない |
| AX-10d | 常設モジュールの削除 | `{"command":"module.remove","args":{"module_id":"out"}}` | `ok:false`, `error.id:"ERR-104"` | 不変 |
| AX-10e | トークンなし | トークンを付けずに `{"command":"patch.get"}` | `ok:false`, `error.id:"ERR-004"`。パッチの内容を返さない | 不変 |
| AX-11 | 人とエージェントの取り消し | エージェントが `{"command":"param.set","args":{"module_id":"env1","param":"attack","value":0.5}}`(`revision = 11`)の後、人が `{"command":"history.undo"}` | `ok:true`, `revision:12`, `result.undone.command:"param.set"`, `result.undone.actor.kind:"agent"` | `env1.attack = 0.01`(P0の値)。エージェントは EVT-01(`actor.kind = human`, `command = history.undo`)を受ける |
| AX-12 | 壊れたパッチの読込 | `{"command":"patch.load","args":{"patch":{"format":"modular-synth-patch","schema_version":1,"modules":[{"id":"out","type":"MOD-IO-001","spec_version":"0.1"},{"id":"x1","type":"MOD-XYZ-999","spec_version":"0.1"}],"cables":[]}}}` | `ok:false`, `error.id:"ERR-204"`, `details.issues[0].rule:"DAT-V06"`, `revision:10` | 不変(P0 のまま) |
| AX-13 | `seed` の自動割当 | `{"command":"module.add","args":{"type":"MOD-NSE-001","id":"n1"}}` の後 `{"command":"module.add","args":{"type":"MOD-NSE-001","id":"n2"}}` | 1つ目 `result.module.params.seed:1`、2つ目 `result.module.params.seed:2`。`revision` は 11、12 | `n1` と `n2` は異なる乱数列を出す |
| AX-14 | セッションなし | タブを閉じた状態で `{"command":"patch.get"}`、続けて `{"command":"patch.list"}` | 1つ目 `ok:false`, `error.id:"ERR-006"`, `revision:null`。2つ目 `ok:true`, `result.patches` | 不変 |
| AX-15 | 同じ値の設定 | `{"command":"param.set","args":{"module_id":"vcf1","param":"cutoff","value":1.0}}`(P0で既に 1.0) | `ok:true`, `revision:10`, `result.changed:false` | 不変。履歴・通知なし |

受入例と検証IDの対応: AX-01 → VER-F-007、AX-02/03/04 → VER-A-004・VER-F-002・VER-F-003、AX-05/06 → VER-A-005、AX-07 → VER-F-011、AX-08 → VER-F-012、AX-09 → VER-A-008、AX-10 → VER-S-002・VER-S-004・VER-S-005・VER-S-007、AX-11 → VER-F-009・VER-A-006、AX-12 → VER-F-007、AX-13 → VER-F-001(関連: VER-NF-003)、AX-14 → VER-A-004、AX-15 → VER-A-003・VER-F-003。

## 19. 未決・確認事項
| 項目 | 状態 |
|---|---|
| 認証の詳細(トークンの渡し方、タブとサーバーの間の認証) | OPEN-007。本書は「トークンがなければ ERR-004」だけを定める |
| MCPの輸送方式、通知の転送 | OPEN-008 |
| マスター音量の既定値・下限・フェード時間 | product-spec §8.1 の測定タスクで決める。本書の −60〜0 dB は暫定 |
| 各上限(§16)、応答待ち時間、履歴件数、冪等キーの保持件数 | 暫定値。性能測定(OPEN-001)の後に見直す |
| エージェントからのノート送信 | 初期版に含めない(§6.1)。オーナー確認 |
| ポリフォニー時のチャンネル数の読出し・設定 | OPEN-004 の#2改訂後に、`module.list_types` と `meter.read` への追加を検討する |
