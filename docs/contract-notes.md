# 実装メモ: 操作契約・データ契約に記述がなく、実装側で補った解釈

共通コマンド処理(`src/control/`、Issue #18)の実装で、契約(`specifications/synthesizer/operation-contract.md`、`data-contract.md`)が曖昧・不足・矛盾していた点と、採った解釈の一覧。契約への追記の候補であり、契約の正本ではない。各項目の末尾に、Issue #24(2026-11-20)での反映先を記す(操作契約・データ契約・製品仕様は 0.4)。契約の受入例・無効例の期待値は、契約の表のまま使っている。

## 契約内の矛盾
| 箇所 | 内容 | 採った解釈 | 反映(Issue #24) |
|---|---|---|---|
| 操作契約 CMD-25 と EVT-03 | 人が現在と同じ音量を設定して上限だけが変わる場合、CMD-25 は「通知は出さない」、EVT-03 の表は「エージェント上限が変わったとき出る」 | CMD-25 に従い、通知は出さない | operation-contract §10 EVT-03(CMD-25 に合わせた) |
| 操作契約 §3.3 と各コマンドのエラーの列挙順 | §3.3 は「対象の存在 → 値と規則」の順。CMD-02 は ERR-103, 106, 121、CMD-06 は ERR-114, 116, 106 の順 | 引数の形(ERR-003)を最初にし、その後は各コマンドの列挙順。module.add: 003 → 101 → 105 → 103 → 106 → 121 → 122/123。cable.connect: 003 → 両端の 102/111 → 112 → 113 → 114 → 116 → 106 | operation-contract §3.3「7〜9 の中の順」、CMD-02、CMD-06、CMD-07、CMD-09、CMD-12(各コマンドの順に合わせた) |

## 操作契約の不足
| 箇所 | 採った解釈 | 反映(Issue #24) |
|---|---|---|
| §3.1 封筒の未知のフィールド | args の未知キーしか規定がない。封筒の未知キー(`actor` を含む)は ERR-001 で拒否(打ち間違いの `expected_revision` を黙って無視しないため) | operation-contract §3.1 |
| §5 ERR-003「IDの書式」 | 書式を検査するのは新しく付けるIDだけ。既存の対象を指すIDは、存在しなければ ERR-102 / ERR-115 | operation-contract §2.2「IDの書式を検査する範囲」 |
| §2.2 次番号と失敗 | 失敗した要求(batch の途中失敗を含む)が使った番号は消費しない | operation-contract §2.2 自動採番の規則9 |
| CMD-09 batch | `ops` が空なら ERR-003、500 超なら ERR-106、未定義のコマンド名は ERR-132、要素の余分なキーは ERR-003。`args` の省略は `{}` | operation-contract CMD-09 |
| CMD-05 module.move | `ui` は x・y が必須で、他のキーは保持する。既存の `ui` に上書きでマージする | operation-contract CMD-05 |
| CMD-11 patch.new | 既に空のパッチでも変更として扱う(リビジョン +1、履歴1件) | operation-contract CMD-11 |
| §9.4 履歴のまとめ | 「同じ操作者」は種別と client_id の両方が一致。undo/redo を挟んだらまとめを切る | operation-contract §9.4 |
| §7 冪等キー | 鍵は操作者をまたいで1つの集まり。再送の応答は `request_id` と `replayed` だけ差し替える | operation-contract §7.1(Issue #24 の修正で、鍵は操作者の種別ごとの集まりに変わった。メモの「操作者をまたいで1つ」は古い)。応答の差し替えは §7.2 に記載済み |
| §14 seed | `duplicate_seed` の `details` は `{module_id, param, value, conflicts}`。ノイズ源と S&H は同じ集まりで数える | operation-contract §14 |
| CMD-21 | `stopped` のとき `fs`・`engine_revision` は null、計数は 0 | 記載済み: operation-contract CMD-21 |
| CMD-01 module.list_types | 契約が求める `category`、ポートの `unit` と `unconnected`、パラメータの enum の区別と `values` は、実装の定義にまだなく `null` で返す。真偽型(`bool`)は区別する | 未反映(理由: 未達) |
| 未対応のコマンド | patch.save / load / list / read / delete は、ファイル保存が未実装のため ERR-207(`details.reason: "not_implemented"`)。手前の検査(権限、引数の形、パッチ名)は実装済み | 反映不要(Issue #20 で保存のコマンドを実装済み) |

## データ契約の不足
| 箇所 | 採った解釈 | 反映(Issue #24) |
|---|---|---|
| §8 DAT-V07 移行の道がない古い仕様版(例 `"0.0"`) | 文面では通るが、拒否する(ERR-205) | data-contract §8 の表 DAT-V07 |
| DAT-V01 解釈済みの値の大きさ | 空白なしの JSON にしたときの UTF-8 バイト数で測る | data-contract §8 の表 DAT-V01 |
| 旧版の既定値 | 現行と同じとする(旧版のパラメータの組は、現行から移行で増えた名前を除いたもの)。既定値や名前を変える改訂を入れるなら、旧版の定義を別に持つ必要がある | data-contract §9.5 |
| 時刻の書式 | `YYYY-MM-DDTHH:MM:SS[.小数]Z` だけを受理(`+00:00` は拒否) | data-contract §3.2 |
| 文字数 | Unicode の符号位置で数える | data-contract §3.2、operation-contract §3.1 |
| `issues[].path` の書式 | `modules[1].params.cutoff`、`cables[0].from.port` の形。最上位は `""` | data-contract §8 の2 |
| JSON の解釈 | 先頭の BOM、入れ子512段超は拒否。`1e999` は置かれた場所の規則で拒否 | data-contract §8 の表 DAT-V02(BOM)、§8 補足(`1e999`)。入れ子512段は operation-contract CMD-15(`patch.read`)。`patch.load` での扱いは未反映(契約に上限の規定がない。下の表) |
| `spec_version` の表記 | `"0.02"` は `0.2` と同じ版として扱い、正規化で `"0.2"` にする | data-contract §9.1 |
| 保存時の書式 | 2文字字下げ、末尾改行、キーは契約の表の順 | data-contract DAT-32(Issue #24 の修正で、`ui` の値は1行で書く形に変わった) |

## Issue #20 で追加した解釈(保存のコマンド、ローカルサーバー)
### 保存のコマンド(`src/control/controller.ts`)
| 箇所 | 採った解釈 | 反映(Issue #24) |
|---|---|---|
| CMD-12 patch.save のエラー順 | 列挙順どおり 003 → 201 → 203 → 005 → 106 → 206 → 207 | operation-contract CMD-12 |
| ERR-106 / ERR-207 の `details` | 値の名前が契約にない。ERR-106 は `limit: "patch_files"`、ERR-207 は保存先の失敗種別と `operation`(read / write / list / remove) | operation-contract §5 ERR-106、ERR-207 |
| DAT-36「書式が不正な saved_by」 | オブジェクトでない、余分なキーがある、`client_id` が文字列でない、のいずれかを人の保存として扱う | data-contract DAT-36、operation-contract §15.3(Issue #24 の修正で、判定は「文書として検証に通り、`kind` が `agent`」に変わった。メモの定義は古い) |
| CMD-14 patch.list の `readable` | 「`patch.load` が成功する(§8 の検証に通る)」を true。未知の版も false。並びは名前順 | operation-contract CMD-14、data-contract DAT-34 |
| CMD-14 / CMD-15 の `modified_at` | ファイルの更新時刻(`meta.modified_at` ではない) | operation-contract CMD-14、CMD-15、data-contract DAT-34 |
| CMD-13 `patch` がオブジェクトでない | ERR-003(ERR-204 ではない) | operation-contract CMD-13 |
| 保存時刻 | 秒まで(契約の例に合わせる) | operation-contract CMD-12、data-contract §3.2 |
| EVT-06 | 再送では出さない。順序は「応答 → Session の通知 → EVT-06」 | operation-contract §10 |
| 読込 → 保存 → 取り消し → やり直し | 保存後の時刻・`saved_by` が戻る | data-contract DAT-35 |

### ローカルサーバー(`src/server/app.ts`)
| 箇所 | 採った解釈 | 反映(Issue #24) |
|---|---|---|
| §3.3 の検査順と認証 | HTTP は契約どおり ERR-011 → ERR-001 → ERR-012 → ERR-004(未認証でも本文を上限まで読む)。WebSocket は接続時に認証する。Host の検査は契約にない輸送層の検査として最初に行う | operation-contract §3.3 の1、§3.4 の1・2 |
| HTTP の状態コード(契約になし) | ERR-001/012 は 400、ERR-004 は 401(Origin・Host が原因なら 403)、ERR-011 は 413、ERR-006 は 503、ERR-007 は 504。それ以外は `ok:false` でも 200 | operation-contract §3.4 の3 |
| サーバーが作る応答の `revision` など | タブがあり認証済みなら、タブの応答・通知から覚えた最後の値。未認証・タブなしでは null | operation-contract §3.4 の4 |
| 応答待ち中にタブが切れた | 待たずに ERR-007(`details.reason: "tab_disconnected"`)。適用されたか不明という意味 | operation-contract §3.4 の6、§5 ERR-007 |
| 要求の大きさと WebSocket | ERR-011 を返せるよう、受信上限は要求上限の2倍。それを超える1通は接続を閉じる | operation-contract §3.4 の7 |
| タブなしのとき | ERR-002 → ERR-005 → ERR-006 の順(引数の検査より先に ERR-006)。直接答える3コマンド(patch.list、patch.read、module.list_types)では `expected_revision` を比べない | operation-contract §3.4 の5 |
| 2つ目のタブ | `hello { accepted: false, reason: "another_tab" }` を送って閉じる。1つ目が閉じれば次の接続を受け付ける | data-contract DAT-25(`hello` の形はタブとサーバーの間の取り決めで、契約の対象外) |
| エージェント用の口の Origin | 自サーバーのオリジンでも拒否。CORS の許可ヘッダは出さない | operation-contract §3.4 の2、product-spec §8.2 |
| 保存フォルダ | シンボリックリンクや同名フォルダは読出しを失敗にする。書き込みは一時ファイルに書いてから名前を付ける | data-contract DAT-31 |

### 認証境界についての注意(判断材料)
- タブ用トークンは配信する index.html に埋めている。同じマシンの**ブラウザ以外のプロセス**は `GET /` でそれを読め、Origin を偽ってタブとして接続できる。そうすると、保存先を直接操作でき、エージェントの要求を受け取る側にもなれる。 **→ product-spec §8.2(DEC-014)**
- 契約は、上書きの制限(§15.3)を「認証境界ではなく誤操作への歯止め」としている。同じ利用者の権限で動くプロセスは、保存フォルダを直接読み書きできるので、これ自体は新しい権限を与えない。ただし、タブになりすませる点は記録しておく(判断記録 OPEN-016)。 **→ 記載済み: operation-contract §15.3、DEC-014**
- 上書きの権限(誰の操作か)はタブ側で検査している。サーバーの保存操作は操作者を知らない。 **→ 反映不要(実装の構成)**

### 仮の値
- 保存フォルダの既定の場所: 環境変数 `SYNTH_PATCH_DIR`、なければ `~/.agent-modular-synth/patches`。 **→ data-contract §14([暫定値])**
- 待受ポート 47800、応答待ち 5 秒、要求の上限 2 MiB、保存パッチ 1000 件。 **→ 待受ポートは data-contract §14([暫定値])。ほかは記載済み: operation-contract §7.8、§16**

### 実装の重複(整理が残る)
- サーバーがタブなしで直接答える `module.list_types`・`patch.list`・`patch.read` と、封筒の検査は、Session / Controller と同じ規則を `src/server/app.ts` に複製している(一致は試験で確認)。共有の関数にまとめるのが望ましい。 **→ 反映不要(実装の整理)**

## Issue #22 で追加した解釈(MCP アダプタ、編集画面)
### MCP アダプタ(`src/mcp/`)
| 箇所 | 採った解釈 | 反映(Issue #24) |
|---|---|---|
| アダプタ自身の失敗の形(サーバーに届かない、トークンがない等。契約 §17 に記述なし) | 契約の失敗応答と同じ形で、`error.id: null`、`error.code` は `adapter_no_token` / `adapter_server_unreachable` / `adapter_bad_response`、`details.applied` は `"no"` / `"unknown"`。新しい `ERR-…` は作っていない | operation-contract §17 |
| 存在しないツール名(人のみのコマンドを含む) | MCP のプロトコルエラー。サーバーへは何も送らない | operation-contract §17 |
| 出力 | テキスト1つ(応答の封筒の JSON)。`ok: false` は isError で返し、`error` を保つ | operation-contract §17 |
| `client_id` | 固定の `mcp`(環境変数 `SYNTH_CLIENT_ID` で変更可) | operation-contract §17 |
| 入力スキーマ | 「どちらか一方」「少なくとも一方」の条件は、スキーマではなく説明文に書く。入力の検査はアダプタでせず、サーバーの契約のエラーをそのまま返す | operation-contract §17 |
| 接続先 | `http://127.0.0.1[:port]` か `http://localhost[:port]` だけ。それ以外は起動しない。リダイレクトにも従わない | operation-contract §17 |
| サーバー停止・トークンなし | 起動は失敗させず、ツールの呼出し時にエラー結果を返す | operation-contract §17 |

### トークンファイル(設計判断)
- サーバーは起動時にエージェント用トークンをファイル(既定 `~/.agent-modular-synth/agent-token`、環境変数 `SYNTH_TOKEN_FILE`)へ書く。権限は本人だけが読める 0600。終了時に、自分が書いた内容のままのときだけ消す。強制終了では残る(次の起動で上書き)。 **→ 記載済み: DEC-113。product-spec §8.2**
- アダプタは、環境変数 `SYNTH_AGENT_TOKEN` があればそれを使い、なければファイルを呼出しのたびに読む。 **→ operation-contract §17**
- 同じ利用者の権限で動くプログラムを信頼する方針(DEC-014)と同じ考え方。サーバーを2つ動かすと、後から起動した方のトークンが入る。 **→ 記載済み: DEC-113、DEC-014**

### 編集画面(`src/web/ui.ts`)
| 箇所 | 採った解釈 | 反映(Issue #24) |
|---|---|---|
| 操作契約 §12.2「UI は範囲外の値を送らない」 | スライダーは定義の範囲に制限する。数値欄に打たれた範囲外・非整数の値はそのまま送り、契約のエラー(ERR-123 / ERR-122)を表示する | 未反映(理由: 設計判断待ち。OPEN-017) |
| 列挙型のパラメータ | 実装の定義に列挙の区別がないため、整数の数値欄になる(選択肢の名前は出ない) | 未反映(理由: 未達) |
| スライダーの刻み | 範囲の約 1/1000 を 10 の累乗に丸めた値(BPM は 0.1) | 未反映(理由: 設計判断待ち。OPEN-018) |
| 保存の上書き | まず上書きなしで送り、ERR-203 のときに確認して上書きで再送する | 未反映(理由: 設計判断待ち。OPEN-019) |

### 実装の重複(整理が残る)
- `src/mcp/tools.ts` のコマンドの表は契約 §6 の写しで、`src/control/session.ts` の `COMMANDS` と重複している(一致は試験で確認)。 **→ 反映不要(実装の整理)**

## この層で扱っていないもの(次の Issue)
Web MIDI の可否、タブ接続の生死監視、同時接続数や待ち要求数の上限。(認証、セッションなし、応答待ち、要求の大きさ、通知の連番、EVT-05 / EVT-06、ファイルへの保存と自動保存は Issue #20 で実装した。)
**→ 未反映(理由: 未達。契約に規定がない実装の範囲)。Web MIDI の可否(`midi.available`)は未実装。タブ接続の生死監視と、同時接続数・待ち要求数の上限は、Issue #24 の修正で実装した(operation-contract §3.4 の8、§16)。**

## 実装上の整理が残る点
- パッチの型と定数(format 名、IDの書式、上限)が `src/control/types.ts`・`session.ts` と `src/control/patch-doc.ts` に重複している。ファイル保存の実装時に一本化する。 **→ 反映不要(実装の整理)**
- 画面(`src/web/`)は、操作をコマンド経由で行う最小のもの(Issue #20)。パッチを組み替える編集画面は未実装。 **→ 反映不要(実装の整理)**

## Issue #24 の修正で増えた、契約にない実装上の値
契約の本文には [暫定値] として書いた(確定値ではない)。値を変えるときは、実装の定数と契約の両方を直す。
| 値 | 内容 | 実装の定数 | 契約での記載 |
|---|---|---|---|
| 10 秒 | 保存先の応答待ち。超えたら ERR-207(`reason: "failed"`) | `src/control/controller.ts` `DEFAULT_STORE_TIMEOUT_MS` | operation-contract CMD-12、§16 |
| 16 MiB 相当の文字数 | 冪等キーで保存する応答の合計の大きさ | `src/control/session.ts` `idempotencyChars` | operation-contract §7.1、§16 |
| 32 MiB 相当の文字数 | 置き換えの履歴が持つパッチの合計の大きさ | `src/control/session.ts` `historyChars` | operation-contract §9.7、§16 |
| 9 桁 | 自動採番の計算に入れる番号の桁数 | `src/control/session.ts` `MAX_NUMBERED_DIGITS` | operation-contract §2.2 の規則8 |
| 64 段 | 要求の入れ子の深さ。超えたら ERR-001(`too_deep`) | `src/control/json.ts` `MAX_REQUEST_DEPTH` | operation-contract §3.3 の1、§16 |
| 8 段 | `ui` の入れ子の深さ | `src/control/json.ts` `MAX_UI_DEPTH` | data-contract DAT-11、§10、operation-contract §16 |
| 512 段 | 保存文書の入れ子の深さ(読取りの上限) | `src/control/patch-doc.ts` `MAX_JSON_DEPTH` | operation-contract CMD-15(`patch.read`)だけ。`patch.load` での扱いは契約に書いていない |
| 16 | エージェントの WebSocket の同時接続数 | `src/server/app.ts` `maxAgentConnections` | operation-contract §3.4 の8、§16 |
| 256 | タブの応答を待つ要求の数 | `src/server/app.ts` `maxPendingRequests` | 同上 |
| 32 MiB | 1つの接続の送信待ちの量 | `src/server/app.ts` `maxBufferedBytes` | 同上 |
| 15 秒 | タブの生死を確かめる間隔 | `src/server/app.ts` `tabPingMs` | 同上 |
| 16 MiB | タブからの1通の大きさ | `src/server/app.ts` `TAB_MAX_MESSAGE_BYTES` | 契約に書いていない(タブとサーバーの間の取り決め) |
| 1 時間 | 起動時に消す一時ファイルの古さ | `src/server/file-store.ts` `sweepTemp` | data-contract DAT-32 |
| 15 秒 | MCP アダプタの応答待ち | `src/mcp/adapter.ts` `DEFAULT_TIMEOUT_MS` | 契約に書いていない |

batch の検査の順(Issue #24): `ops` の形(ERR-003)→ 件数(ERR-106)→ 各要素の形(ERR-003)→ 入れられないコマンド(ERR-132)→ 各操作(ERR-131)。operation-contract CMD-09 に記載済み。
