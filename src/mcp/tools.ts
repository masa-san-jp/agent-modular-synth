// MCP のツール定義(operation-contract §17)。共通コマンドを1対1でツールにする。
// - ツール名: コマンド名の `.` を `_` に置き換える。接頭辞は付けない。
// - 公開するのは §6 の表で権限が「両方」のコマンドすべて。「人のみ」はツールにしない。
// - 入力: そのコマンドの args のフィールド + 任意の expected_revision と idempotency_key。
// - 説明: 読出しのみ・取り消し不可などの性質を、§6 の表(下の TABLE)から機械的に付ける。
// 下の TABLE と ARGS は契約 §6 の写し。コマンドの集合・権限・batch の可否は src/control/session.ts の COMMANDS と
// 一致し、表の各列は契約の文書と一致することを試験(test/mcp.test.ts)で確かめる。
import { ALL_READOUT_NAMES, COMMANDS } from "../control/session.js";
import { REGISTRY } from "../modules/registry.js";

type Schema = Record<string, unknown>;

/** §6 の表の1行(権限が「両方」のものと「人のみ」のもの)。 */
export interface CommandRow {
  id: string;
  command: string;
  /** 概要。 */
  summary: string;
  /** 変更: パッチを変える(リビジョンが進む)。 */
  changes: boolean;
  /** 取消: `yes` = history.undo で戻せる、`no` = 戻せない、`na` = 読出し(対象外)、`redo` / `undo` = 逆の操作で戻す。 */
  undo: "yes" | "no" | "na" | "redo" | "undo";
  /** 権限の注記(「両方(…)」の括弧の中)。 */
  permissionNote?: string;
  /** 取消の注記(「○(…)」の括弧の中)。 */
  undoNote?: string;
}

/** 契約 §6 の表(CMD-01〜33)。「人のみ」の4件は載せるが、ツールにはしない(COMMANDS の humanOnly で除く)。 */
export const TABLE: readonly CommandRow[] = [
  { id: "CMD-01", command: "module.list_types", summary: "モジュール種別の定義を列挙", changes: false, undo: "na" },
  { id: "CMD-02", command: "module.add", summary: "モジュールを追加", changes: true, undo: "yes" },
  { id: "CMD-03", command: "module.remove", summary: "モジュールを削除", changes: true, undo: "yes" },
  { id: "CMD-04", command: "module.get", summary: "モジュール1つの状態を読む", changes: false, undo: "na" },
  { id: "CMD-05", command: "module.move", summary: "UI上の位置を変える", changes: true, undo: "yes" },
  { id: "CMD-06", command: "cable.connect", summary: "出力と入力を接続", changes: true, undo: "yes" },
  { id: "CMD-07", command: "cable.disconnect", summary: "ケーブルを外す", changes: true, undo: "yes" },
  { id: "CMD-08", command: "param.set", summary: "パラメータを設定", changes: true, undo: "yes" },
  { id: "CMD-09", command: "batch", summary: "複数の操作を一括適用", changes: true, undo: "yes", undoNote: "1件" },
  { id: "CMD-10", command: "patch.get", summary: "パッチ全体とリビジョンを読む", changes: false, undo: "na" },
  { id: "CMD-11", command: "patch.new", summary: "空のパッチに置き換える", changes: true, undo: "yes" },
  { id: "CMD-12", command: "patch.save", summary: "名前を付けてファイルに保存", changes: false, undo: "no", permissionNote: "上書きに制限" },
  { id: "CMD-13", command: "patch.load", summary: "保存パッチ(またはJSON)を読み込む", changes: true, undo: "yes" },
  { id: "CMD-14", command: "patch.list", summary: "保存パッチの一覧", changes: false, undo: "na" },
  { id: "CMD-15", command: "patch.read", summary: "保存パッチの中身を読む(読み込まない)", changes: false, undo: "na" },
  { id: "CMD-16", command: "patch.delete", summary: "保存パッチを削除", changes: false, undo: "no" },
  { id: "CMD-17", command: "patch.set_meta", summary: "題名・説明を変える", changes: true, undo: "yes" },
  { id: "CMD-18", command: "history.undo", summary: "直前の変更を取り消す", changes: true, undo: "redo" },
  { id: "CMD-19", command: "history.redo", summary: "取り消しをやり直す", changes: true, undo: "undo" },
  { id: "CMD-20", command: "meter.read", summary: "メーター/スコープの値を読む", changes: false, undo: "na" },
  { id: "CMD-21", command: "engine.get_status", summary: "音声状態・音量・診断値を読む", changes: false, undo: "na" },
  { id: "CMD-22", command: "engine.start", summary: "音声を開始・再開", changes: false, undo: "no" },
  { id: "CMD-23", command: "engine.panic", summary: "緊急停止(全消音)", changes: false, undo: "no" },
  { id: "CMD-24", command: "engine.release_panic", summary: "緊急停止の解除", changes: false, undo: "no" },
  { id: "CMD-25", command: "output.set_level", summary: "マスター音量を設定", changes: false, undo: "no", permissionNote: "エージェントは上限内" },
  { id: "CMD-26", command: "score.play", summary: "楽譜(どの音を、何拍目から、何拍のばすかの並び)を予約して演奏する", changes: false, undo: "no" },
  { id: "CMD-27", command: "score.stop", summary: "予約済みの楽譜をすべて捨て、鳴っている音を止める", changes: false, undo: "no" },
  { id: "CMD-28", command: "score.get_status", summary: "演奏の状態と、人からの指示を読む", changes: false, undo: "na" },
  { id: "CMD-29", command: "prompt.send", summary: "演奏への指示(プロンプト)をエージェントへ送る", changes: false, undo: "no" },
  { id: "CMD-30", command: "performance.list", summary: "保存された演奏データ(演奏した楽譜の記録)の一覧", changes: false, undo: "na" },
  { id: "CMD-31", command: "performance.read", summary: "保存された演奏データの中身を読む", changes: false, undo: "na" },
  { id: "CMD-32", command: "performance.replay", summary: "保存された演奏データを再演奏する(パッチを置き換える)", changes: true, undo: "yes" },
  { id: "CMD-33", command: "performance.set_plan", summary: "演奏の長さの予定を決める(決めなければ、止めるまで続く)", changes: false, undo: "no" },
];

// ---- 引数(契約 §6 の各コマンドの引数表。値の検査はコマンド処理が行う。ここは形を伝えるだけ) ----

const str = (description: string, extra: Schema = {}): Schema => ({ type: "string", description, ...extra });
const MODULE_ID = "^[a-z][a-z0-9_]{0,31}$";
const PATCH_NAME = "^[a-z0-9][a-z0-9_-]{0,63}$";
const TYPE_IDS = [...REGISTRY.keys()];

const portRef = (description: string): Schema => ({
  type: "object",
  description,
  properties: {
    module: str("モジュールID"),
    port: str("ポート名(各モジュール仕様の名前そのまま。大文字・小文字を区別。例 IN_L, saw)"),
  },
  required: ["module", "port"],
  additionalProperties: false,
});
const uiPos = (description: string): Schema => ({
  type: "object",
  description,
  properties: { x: { type: "number" }, y: { type: "number" } },
  required: ["x", "y"],
});
const moduleId = str("モジュールID");

interface ArgSpec {
  properties: Record<string, Schema>;
  required?: string[];
  /** 引数どうしの規則など、スキーマで表さない注意。説明に付ける。 */
  note?: string;
}

/** batch に入れられるコマンド(§6 の表の batch 列が ○)。 */
export const BATCHABLE: readonly string[] = Object.keys(COMMANDS).filter((c) => COMMANDS[c].batch === true);

export const ARGS: Readonly<Record<string, ArgSpec>> = {
  "score.play": {
    properties: {
      notes: {
        type: "array",
        description: "音符の並び(順は問わない)。和音は同じ t の音符を並べる。休みは音符を置かない",
        maxItems: 2000,
        items: {
          type: "object",
          properties: {
            t: { type: "number", minimum: 0, description: "楽譜の先頭から数えた、音の始まる位置(tempo_bpm があれば拍、なければ秒)" },
            dur: { type: "number", exclusiveMinimum: 0, description: "長さ(単位は t と同じ)" },
            note: { type: "integer", minimum: 0, maximum: 127, description: "MIDI ノート番号。60 = C4(中央のド)。1 上がるごとに半音" },
            vel: { type: "integer", minimum: 1, maximum: 127, description: "強さ。既定 100" },
            ch: { type: "integer", minimum: 1, maximum: 16, description: "MIDI チャンネル。既定 1" },
          },
          required: ["t", "dur", "note"],
          additionalProperties: false,
        },
      },
      params: {
        type: "array",
        description:
          "パラメータの変化の並び(任意)。楽譜の中の位置で、モジュールのパラメータを動かす(フィルタを開く、ディレイを深くする、など)。音声側の値だけが変わり、パッチ・リビジョン・履歴は変わらない。演奏が終わる・止まると、パッチの値に戻る",
        maxItems: 2000,
        items: {
          type: "object",
          properties: {
            t: { type: "number", minimum: 0, description: "楽譜の先頭から数えた位置(単位は音符と同じ)" },
            dur: { type: "number", minimum: 0, description: "省略または 0 なら、その位置で値を切り替える。正の値なら、その長さをかけて、直前の値から直線で動かす(整数・真偽・列挙のパラメータは切り替えだけ)" },
            module_id: str("モジュールID"),
            param: str("パラメータ名"),
            value: { type: "number", description: "動かす先の値。範囲は param_set と同じ(範囲外は拒否)" },
          },
          required: ["t", "module_id", "param", "value"],
          additionalProperties: false,
        },
      },
      length: { type: "number", exclusiveMinimum: 0, description: "楽譜の長さ(単位は t と同じ)。次の楽譜はこの後に続く。省略時は最後の音符の終わり。小節の区切りに合わせると、続きがずれない" },
      tempo_bpm: { type: "number", minimum: 20, maximum: 1000, description: "指定すると t・dur・length の単位が拍になる。省略時は秒" },
      mode: str("append(既定): 予約があればその末尾に切れ目なく続け、なければ今から。replace: 予約を捨てて今から", { enum: ["append", "replace"] }),
      ack_prompt: { type: "integer", minimum: 0, description: "このID以下の、人からの指示を「反映済み」にする(この楽譜がその指示を踏まえたものだと人に示す)" },
    },
    required: ["notes"],
    note:
      "演奏を続けるには: 応答の remaining(予約の末尾までの秒)が尽きる前に、次の楽譜を送る。送る前に score_get_status(またはこの応答)の prompts で acked:false の指示を読み、踏まえた楽譜に ack_prompt を付ける。音が出るには、パッチに MIDI-CV(MOD-IO-002)があり、人が音声を開始している必要がある。",
  },
  "performance.list": { properties: {} },
  "performance.read": {
    properties: { name: str("演奏データの名前(performance_list で分かる。頭が日時: yyyymmdd-hhmmss)", { pattern: PATCH_NAME }) },
    required: ["name"],
    note: "自分や他のエージェントが過去に何を演奏したかを読み返すのに使う。演奏中の演奏データも読める(そこまでの楽譜が入っている)。",
  },
  "performance.replay": {
    properties: { name: str("演奏データの名前", { pattern: PATCH_NAME }) },
    required: ["name"],
    note: "今のパッチは、演奏データが持つパッチ(演奏を始めた時点のもの)に置き換わる。予約済みの楽譜は捨てる。音声が動作中のときだけ。",
  },
  "performance.set_plan": {
    properties: { duration_seconds: { type: ["number", "null"], minimum: 1, maximum: 86400, description: "演奏の長さの予定(秒)。null は「止めるまで続ける」" } },
    required: ["duration_seconds"],
    note: "予定は情報で、この長さで自動的に止まりはしない。score_get_status の plan(予定と経過)を見て、終わりに向けた楽譜を書く。",
  },
  "score.stop": { properties: {} },
  "score.get_status": { properties: {} },
  "prompt.send": { properties: { text: str("指示の文章", { minLength: 1, maxLength: 500 }) }, required: ["text"] },
  "module.list_types": { properties: { type: str("種別の仕様ID。指定時はその種別だけ返す", { enum: TYPE_IDS }) } },
  "module.add": {
    properties: {
      type: str("種別の仕様ID(例 MOD-OSC-001)。MOD-IO-001(常設の出力 out)は追加できない", { enum: TYPE_IDS }),
      id: str("モジュールID。省略時は自動採番(m<N>)", { pattern: MODULE_ID }),
      params: {
        type: "object",
        description: "パラメータ名→数値。指定しないパラメータは仕様の既定値。名前と範囲は module_list_types で取得できる。範囲外は拒否(クランプしない)",
        additionalProperties: { type: "number" },
      },
      ui: uiPos("UI上の位置。省略時はUIが配置を決める"),
    },
    required: ["type"],
  },
  "module.remove": { properties: { module_id: moduleId }, required: ["module_id"] },
  "module.get": { properties: { module_id: moduleId }, required: ["module_id"] },
  "module.move": { properties: { module_id: moduleId, ui: uiPos("UI上の位置(有限の数値)") }, required: ["module_id", "ui"] },
  "cable.connect": {
    properties: {
      from: portRef("出力ポート"),
      to: portRef("入力ポート(1つの入力にケーブルは1本まで)"),
      id: str("ケーブルID。省略時は自動採番(c<N>)", { pattern: MODULE_ID }),
    },
    required: ["from", "to"],
  },
  "cable.disconnect": {
    properties: { cable_id: str("ケーブルID"), to: portRef("入力ポート(そこにつながるケーブルを外す)") },
    note: "cable_id または to のどちらか一方を指定する(両方・どちらもなしはエラー)。",
  },
  "param.set": {
    properties: {
      module_id: moduleId,
      param: str("パラメータ名(各モジュール仕様の名前。module_list_types で取得できる)"),
      value: { type: "number", description: "値。単位・範囲は各モジュール仕様(module_list_types で取得できる)。範囲外は拒否(クランプしない)" },
      coalesce_key: str("連続操作を履歴1件にまとめる鍵", { minLength: 1, maxLength: 64 }),
    },
    required: ["module_id", "param", "value"],
  },
  batch: {
    properties: {
      ops: {
        type: "array",
        description: "操作の列。先頭から順に検証・適用し、1つでも失敗したら全体を適用しない。後の操作は前の操作の結果を参照できる(追加するモジュールのIDは id で指定する)",
        minItems: 1,
        maxItems: 500,
        items: {
          type: "object",
          properties: {
            command: str("コマンド名(ツール名ではなく、`.` 区切りの名前)", { enum: [...BATCHABLE] }),
            args: { type: "object", description: "そのコマンドの引数(expected_revision と idempotency_key はここには書けない)" },
          },
          required: ["command"],
          additionalProperties: false,
        },
      },
    },
    required: ["ops"],
  },
  "patch.get": { properties: {} },
  "patch.new": { properties: {} },
  "patch.save": {
    properties: {
      name: str("パッチ名(専用フォルダ内の <name>.patch.json に保存する)", { pattern: PATCH_NAME }),
      overwrite: { type: "boolean", description: "同名があるとき上書きするか(既定 false)。エージェントが上書きできるのは、最後にエージェントが保存したファイルだけ" },
    },
    required: ["name"],
  },
  "patch.load": {
    properties: {
      name: str("保存パッチ名", { pattern: PATCH_NAME }),
      patch: { type: "object", description: "パッチJSONのオブジェクト(直接渡す場合)" },
    },
    note: "name または patch のどちらか一方を指定する(両方・どちらもなしはエラー)。",
  },
  "patch.list": { properties: {} },
  "patch.read": { properties: { name: str("保存パッチ名", { pattern: PATCH_NAME }) }, required: ["name"] },
  "patch.set_meta": {
    properties: { title: str("題名", { maxLength: 120 }), description: str("説明", { maxLength: 2000 }) },
    note: "title と description の少なくとも一方が必要。",
  },
  "history.undo": { properties: {} },
  "history.redo": { properties: {} },
  "meter.read": {
    properties: {
      module_id: str("MOD-IO-003(メーター/スコープ)のモジュールID"),
      fields: {
        type: "array",
        description: "読む項目。省略時は frame 以外の全項目(frame は明示したときだけ返す)",
        items: { type: "string", enum: [...ALL_READOUT_NAMES] },
      },
    },
    required: ["module_id"],
  },
  "engine.get_status": { properties: {} },
  "engine.panic": { properties: {} },
  "output.set_level": {
    properties: { level_db: { type: "number", description: "マスター音量 [dB]。0 dB = 増幅なし。エージェントは上限(engine_get_status の output.agent_max_level_db)以下に限る", minimum: -60, maximum: 0 } },
    required: ["level_db"],
  },
};

/** タブ(セッション)がなくても応答できるコマンド(product-spec §4、CMD-01・14・15)。 */
const NO_SESSION_OK: ReadonlySet<string> = new Set(["module.list_types", "patch.list", "patch.read"]);

/** すべてのツールに加える封筒の項目(§17 の「入力」)。 */
const ENVELOPE_PROPS: Record<string, Schema> = {
  expected_revision: {
    type: "integer",
    minimum: 0,
    description: "任意。指定時、現在のリビジョンと一致しなければ何も変えずに失敗する(ERR-008)。現在値は応答の revision や patch_get で分かる",
  },
  idempotency_key: {
    type: "string",
    minLength: 1,
    maxLength: 64,
    description: "任意。同じ鍵・同じ内容の再送を二重に適用しないための鍵。アダプタは自動で付けず、自動再送もしない",
  },
};

export interface ToolDef {
  /** ツール名(コマンド名の `.` を `_` に置き換えたもの)。 */
  name: string;
  /** 対応する共通コマンド。 */
  command: string;
  description: string;
  inputSchema: Schema;
  annotations: { title: string; readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
}

/** コマンド名 → ツール名(§17)。 */
export function toolName(command: string): string {
  return command.replaceAll(".", "_");
}

/** §6 の表の1行から、性質の説明を機械的に作る。 */
export function describe(row: CommandRow): string {
  const spec = COMMANDS[row.command];
  const readOnly = !row.changes && row.undo === "na";
  const parts: string[] = [`${row.summary}(共通コマンド ${row.command}、${row.id})。`];
  if (readOnly) {
    parts.push("読出しのみ(状態を変えない。リビジョンは進まない)。");
  } else {
    parts.push(row.changes ? "パッチを変える(成功するとリビジョンが 1 進む)。" : "パッチは変えない(リビジョンは進まない)が、パッチ以外の状態を変える。");
    if (row.undo === "yes") parts.push(`history_undo で取り消せる${row.undoNote ? `(${row.undoNote}として)` : ""}。`);
    else if (row.undo === "redo") parts.push("history_redo でやり直せる。");
    else if (row.undo === "undo") parts.push("history_undo で取り消せる。");
    else parts.push("取り消し不可(history_undo では戻らない)。");
  }
  if (row.permissionNote) parts.push(`エージェントの制限: ${row.permissionNote}。`);
  if (spec.batch) parts.push("batch に入れられる。");
  parts.push(spec.keyed ? "idempotency_key を付けると再送しても1回分しか適用されない。" : "idempotency_key は無視される(毎回実行する)。");
  if (NO_SESSION_OK.has(row.command)) parts.push("ブラウザのタブが開かれていなくても応答できる。");
  const note = ARGS[row.command]?.note;
  if (note) parts.push(note);
  parts.push("結果は応答の封筒(JSON)。ok:false のときはツールのエラー結果になり、error に理由が入る。");
  return parts.join(" ");
}

function build(): ToolDef[] {
  return TABLE.filter((row) => COMMANDS[row.command]?.humanOnly !== true).map((row) => {
    const args = ARGS[row.command];
    const readOnly = !row.changes && row.undo === "na";
    return {
      name: toolName(row.command),
      command: row.command,
      description: describe(row),
      inputSchema: {
        type: "object",
        properties: { ...args.properties, ...ENVELOPE_PROPS },
        ...(args.required ? { required: args.required } : {}),
        additionalProperties: false,
      },
      annotations: {
        title: row.summary,
        readOnlyHint: readOnly,
        // 取り消せない変更(保存、緊急停止、音量)。読出しと、取り消せる変更は false。
        destructiveHint: !readOnly && row.undo === "no",
        // 同じ引数で繰り返しても結果が変わらないもの(読出しと緊急停止)。
        idempotentHint: readOnly || row.command === "engine.panic",
        // ローカルサーバーだけと通信する(外部には出ない)。
        openWorldHint: false,
      },
    };
  });
}

/** 公開するツール(権限が「両方」のコマンドすべて)。 */
export const TOOLS: readonly ToolDef[] = build();
