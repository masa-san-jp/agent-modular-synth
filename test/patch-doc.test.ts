// パッチ文書の検証・正規化・移行・生成(data-contract §3〜§5、§8〜§12)。
// 契約の例(§11 の完全なパッチ、§12 の無効な例 DX-01〜DX-12)は契約文書から機械的に抜き出して使う。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildCatalog } from "../src/control/catalog.js";
import {
  MAX_CABLES, MAX_MODULES, MAX_PATCH_BYTES, MAX_UI_BYTES, PATCH_FORMAT, PATCH_SCHEMA_VERSION,
  PatchDocument, PatchLoadResult, isValidPatchName, parsePatchText, serializePatchDocument, utf8ByteLength,
  validatePatchDocument,
} from "../src/control/patch-doc.js";
import { REGISTRY } from "../src/modules/registry.js";

const catalog = buildCatalog(REGISTRY);

// ---- 契約文書からの抜き出し ----
const contract = readFileSync(new URL("../../specifications/synthesizer/data-contract.md", import.meta.url), "utf8");

/** 見出し行 `after` より後で最初に現れるコードブロックの中身。 */
function blockAfter(after: string): string {
  const at = contract.indexOf(after);
  assert.ok(at >= 0, `契約に ${after} がない`);
  const m = /```(?:json|text)\n([\s\S]*?)\n```/.exec(contract.slice(at));
  assert.ok(m, `${after} の後にコードブロックがない`);
  return m[1]!;
}
const P0_TEXT = blockAfter("\n## 11. 完全なパッチの例");
const EMPTY_TEXT = blockAfter("\n### 3.3 空のパッチ");
const dx = (id: string): string => blockAfter(`\n${id}:\n`);
/** 基準(§11)の文字列の一部を置き換えたもの(置き換えが1回だけ起きたことを確かめる)。 */
function baseWith(from: string, to: string): string {
  assert.equal(P0_TEXT.split(from).length, 2, `基準に ${from} がちょうど1つあること`);
  return P0_TEXT.replace(from, to);
}
const p0 = (): any => JSON.parse(P0_TEXT);

function expectOk(r: PatchLoadResult): Extract<PatchLoadResult, { ok: true }> {
  if (!r.ok) assert.fail(`検証に通るはず: ${JSON.stringify(r.error)}`);
  return r;
}
function expectError(r: PatchLoadResult, id: string, rule: string): Extract<PatchLoadResult, { ok: false }>["error"] {
  if (r.ok) assert.fail(`拒否されるはず(${id} ${rule})`);
  assert.equal(r.error.id, id);
  assert.equal(r.error.rule, rule);
  assert.equal(r.error.issues[0]!.rule, rule);
  assert.ok(r.error.issues.length >= 1 && r.error.issues.length <= 50);
  return r.error;
}
/** 文字列と、解釈済みの値の両方で同じ拒否になること。値は書き換わらないこと。 */
function rejectBoth(text: string, id: string, rule: string): Extract<PatchLoadResult, { ok: false }>["error"] {
  const err = expectError(parsePatchText(text, catalog), id, rule);
  const doc = JSON.parse(text);
  const before = JSON.stringify(doc);
  const err2 = expectError(validatePatchDocument(doc, catalog), id, rule);
  assert.equal(JSON.stringify(doc), before, "入力が書き換わらない");
  assert.deepEqual(err2, err);
  return err;
}
const rulesOf = (err: { issues: { rule: string }[] }): string[] => err.issues.map((i) => i.rule);

// ---- 定数 ----
test("契約の定数(§3.1、§10)", () => {
  assert.equal(PATCH_FORMAT, "modular-synth-patch");
  assert.equal(PATCH_SCHEMA_VERSION, 1);
  assert.equal(MAX_PATCH_BYTES, 1048576);
  assert.equal(MAX_MODULES, 256);
  assert.equal(MAX_CABLES, 1024);
  assert.equal(MAX_UI_BYTES, 1024);
});

// ---- §11 完全なパッチの例、§3.3 空のパッチ ----
test("§11: 完全なパッチの例(P0)が検証に通り、正規化しても内容が同じ", () => {
  const r = expectOk(parsePatchText(P0_TEXT, catalog));
  assert.deepEqual(r.patch, p0());
  assert.deepEqual(r.warnings, []);
  assert.equal(r.migrated, null);
  const doc = p0();
  const r2 = expectOk(validatePatchDocument(doc, catalog));
  assert.deepEqual(r2.patch, p0());
  assert.deepEqual(doc, p0(), "入力が書き換わらない");
  assert.notEqual(r2.patch.modules, doc.modules, "返す文書は入力と別の値");
  assert.notEqual(r2.patch.modules[0]!.ui, doc.modules[0].ui);
});

test("§11: serialize → parse の往復で同じ内容になる", () => {
  const first = expectOk(parsePatchText(P0_TEXT, catalog)).patch;
  const text = serializePatchDocument(first);
  const second = expectOk(parsePatchText(text, catalog));
  assert.deepEqual(second.patch, first);
  assert.deepEqual(second.warnings, []);
  assert.equal(serializePatchDocument(second.patch), text);
  assert.ok(utf8ByteLength(text) <= MAX_PATCH_BYTES);
  assert.ok(!text.startsWith("﻿"));
});

test("§3.3: 空のパッチが検証に通る。serialize はキーを契約の表の順で書く", () => {
  const r = expectOk(parsePatchText(EMPTY_TEXT, catalog));
  assert.deepEqual(r.patch, JSON.parse(EMPTY_TEXT));
  assert.deepEqual(r.warnings, []);
  const text = serializePatchDocument(expectOk(parsePatchText(P0_TEXT, catalog)).patch);
  const parsed = JSON.parse(text);
  assert.deepEqual(Object.keys(parsed), ["format", "schema_version", "meta", "modules", "cables"]);
  assert.deepEqual(Object.keys(parsed.meta), ["title", "description", "created_at", "modified_at", "saved_by", "app_version"]);
  assert.deepEqual(Object.keys(parsed.modules[0]), ["id", "type", "spec_version", "params", "ui"]);
  assert.deepEqual(Object.keys(parsed.cables[0]), ["id", "from", "to"]);
  assert.deepEqual(parsed.modules.map((m: any) => m.id), ["out", "midi1", "vco1", "vcf1", "vca1", "env1"], "配列は現在の並びのまま(DAT-03)");
});

// ---- §12 無効な例 ----
test("DX-01: 壊れたJSON → DAT-V02 / ERR-204", () => {
  const err = expectError(parsePatchText(dx("DX-01"), catalog), "ERR-204", "DAT-V02");
  assert.equal(err.code, "patch_invalid");
  assert.deepEqual(err.details.issues, err.issues);
});

test("DX-02: 未知の版(schema_version = 99)→ DAT-V04 / ERR-205(details.found = 99)", () => {
  const err = rejectBoth(baseWith('"schema_version": 1', '"schema_version": 99'), "ERR-205", "DAT-V04");
  assert.equal(err.code, "patch_version_unsupported");
  assert.equal(err.details.found, 99);
  assert.deepEqual(err.details.supported, [1]);
});

test("DX-03: 別の形式(format = vcv-rack-patch)→ DAT-V03 / ERR-205", () => {
  const err = rejectBoth(baseWith('"format": "modular-synth-patch"', '"format": "vcv-rack-patch"'), "ERR-205", "DAT-V03");
  assert.equal(err.details.found, "vcv-rack-patch");
  assert.deepEqual(err.details.supported, ["modular-synth-patch"]);
});

test("DX-04: 未知のモジュール種別 → DAT-V06 / ERR-204", () => {
  const err = rejectBoth(dx("DX-04"), "ERR-204", "DAT-V06");
  assert.deepEqual(rulesOf(err), ["DAT-V06"]);
  assert.equal(err.issues[0]!.path, "modules[1].type");
});

test("DX-05: 未知のパラメータ → DAT-V10 / ERR-204", () => {
  const err = rejectBoth(dx("DX-05"), "ERR-204", "DAT-V10");
  assert.deepEqual(rulesOf(err), ["DAT-V10"]);
  assert.equal(err.issues[0]!.path, "modules[1].params.resonance");
});

test("DX-06: 範囲外のパラメータ → DAT-V12 / ERR-204", () => {
  const err = rejectBoth(dx("DX-06"), "ERR-204", "DAT-V12");
  assert.deepEqual(rulesOf(err), ["DAT-V12"]);
  assert.equal(err.issues[0]!.path, "modules[1].params.cutoff");
});

test("DX-07: 数値でないパラメータ → DAT-V11 / ERR-204", () => {
  const err = rejectBoth(dx("DX-07"), "ERR-204", "DAT-V11");
  assert.deepEqual(rulesOf(err), ["DAT-V11", "DAT-V11"]);
  assert.deepEqual(err.issues.map((i) => i.path), ["modules[1].params.attack", "modules[1].params.sustain"]);
});

test("DX-08: out がない → DAT-V09 / ERR-204", () => {
  const err = rejectBoth(dx("DX-08"), "ERR-204", "DAT-V09");
  assert.deepEqual(rulesOf(err), ["DAT-V09"]);
});

test("DX-09: 1つの入力に2本 → DAT-V16 / ERR-204", () => {
  const err = rejectBoth(dx("DX-09"), "ERR-204", "DAT-V16");
  assert.deepEqual(rulesOf(err), ["DAT-V16"]);
  assert.equal(err.issues[0]!.path, "cables[1].to");
});

test("DX-10: 存在しないポート・逆向きの接続 → DAT-V14, DAT-V15 / ERR-204", () => {
  const err = rejectBoth(dx("DX-10"), "ERR-204", "DAT-V14");
  assert.deepEqual(rulesOf(err), ["DAT-V14", "DAT-V15"]);
  assert.equal(err.issues[0]!.path, "cables[0].from.port");
  assert.equal(err.issues[1]!.path, "cables[1].from");
});

test("DX-11: 新しすぎる仕様版(vco1 の spec_version = 9.0)→ DAT-V07 / ERR-205", () => {
  const text = P0_TEXT.replace(
    '{"id": "vco1", "type": "MOD-OSC-001", "spec_version": "0.3"',
    '{"id": "vco1", "type": "MOD-OSC-001", "spec_version": "9.0"',
  );
  assert.notEqual(text, P0_TEXT);
  const err = rejectBoth(text, "ERR-205", "DAT-V07");
  assert.equal(err.details.found, "9.0");
  assert.deepEqual(err.details.supported, ["0.1", "0.2", "0.3"]);
  assert.equal(err.issues[0]!.path, "modules[2].spec_version");
});

test("DX-12: 未知のキー(最上位に script)→ DAT-V05 / ERR-204", () => {
  const text = baseWith('"format": "modular-synth-patch",', '"format": "modular-synth-patch", "script": "...",');
  const err = rejectBoth(text, "ERR-204", "DAT-V05");
  assert.deepEqual(rulesOf(err), ["DAT-V05"]);
  assert.equal(err.issues[0]!.path, "script");
});

test("§12 の無効な例を validatePatchDocument に渡しても、入力は書き換わらない(DAT-40、DAT-57)", () => {
  for (const id of ["DX-04", "DX-05", "DX-06", "DX-07", "DX-08", "DX-09", "DX-10"]) {
    const doc = JSON.parse(dx(id));
    const frozen = structuredClone(doc);
    const r = validatePatchDocument(deepFreeze(doc), catalog);
    assert.equal(r.ok, false, id);
    assert.deepEqual(doc, frozen, id);
  }
  // 成功する場合も、凍結した入力のまま通る(省略パラメータの補完・移行があっても)
  const ok = deepFreeze({ ...JSON.parse(dx("DX-08")), modules: [{ id: "out", type: "MOD-IO-001", spec_version: "0.1" }] });
  expectOk(validatePatchDocument(ok, catalog));
});

function deepFreeze<T>(v: T): T {
  if (typeof v === "object" && v !== null) {
    for (const k of Object.keys(v)) deepFreeze((v as any)[k]);
    Object.freeze(v);
  }
  return v;
}

// ---- §8 段階と順序 ----
test("DAT-V02: 拡張表記(NaN・Infinity)、重複キー、コメント、最上位がオブジェクトでないものは ERR-204", () => {
  const bad = [
    P0_TEXT.replace('"level": 1.0, "mute": 0', '"level": NaN, "mute": 0'),
    P0_TEXT.replace('"level": 1.0, "mute": 0', '"level": Infinity, "mute": 0'),
    P0_TEXT.replace('"level": 1.0, "mute": 0', '"level": -Infinity, "mute": 0'),
    P0_TEXT.replace('"level": 1.0, "mute": 0', '"level": 1.0, "level": 1.0, "mute": 0'),
    P0_TEXT.replace('"schema_version": 1,', '"schema_version": 1, "schema_version": 1,'),
    P0_TEXT.replace('"schema_version": 1,', '"schema_version": 1, // 版\n'),
    P0_TEXT.replace('"schema_version": 1,', '"schema_version": 1, /* 版 */'),
    P0_TEXT.replace('"cables": [', '"cables": [,'),
    P0_TEXT + "x",
    "﻿" + P0_TEXT,
    P0_TEXT.replace('"mute": 0}', '"mute": 0,}'),
    P0_TEXT.replace('"mute": 0}', '"mute": 01}'),
    P0_TEXT.replace('"mute": 0}', '"mute": .5}'),
    P0_TEXT.replace('"mute": 0}', "'mute': 0}"),
    "", "   ", "[]", "null", "1", '"modular-synth-patch"', "{", "[".repeat(100000),
  ];
  for (const text of bad) {
    assert.ok(text !== P0_TEXT);
    const err = expectError(parsePatchText(text, catalog), "ERR-204", "DAT-V02");
    assert.equal(err.issues.length, 1);
  }
  for (const doc of [null, [], 1, "x", undefined, true]) expectError(validatePatchDocument(doc, catalog), "ERR-204", "DAT-V02");
});

test("DAT-V01: 大きさは上限ちょうどまで通り、1バイト超過で ERR-206(他の不合格より先)", () => {
  const pad = (bytes: number): string => {
    const doc = p0();
    doc.meta.description = "";
    const base = utf8ByteLength(JSON.stringify(doc));
    return JSON.stringify(doc) + " ".repeat(bytes - base);
  };
  const exact = pad(MAX_PATCH_BYTES);
  assert.equal(utf8ByteLength(exact), MAX_PATCH_BYTES);
  expectOk(parsePatchText(exact, catalog));
  const over = pad(MAX_PATCH_BYTES + 1);
  const err = expectError(parsePatchText(over, catalog), "ERR-206", "DAT-V01");
  assert.equal(err.code, "patch_too_large");
  assert.deepEqual(err.details, { limit_bytes: 1048576 });
  // 壊れたJSONでも、大きさの検査が先
  expectError(parsePatchText("{" + " ".repeat(MAX_PATCH_BYTES), catalog), "ERR-206", "DAT-V01");
  // バイト数で数える(日本語は1文字3バイト)
  expectError(parsePatchText('{"x":"' + "あ".repeat(MAX_PATCH_BYTES / 3) + '"}', catalog), "ERR-206", "DAT-V01");
  // 解釈済みの値は、空白なしのJSONにした大きさで測る
  const big = p0();
  big.modules[0].ui.note = "a".repeat(MAX_PATCH_BYTES);
  expectError(validatePatchDocument(big, catalog), "ERR-206", "DAT-V01");
});

test("DAT-V03 → V04 → V05 の順に、最初の不合格で止まる", () => {
  // format も schema_version も構造も不正 → DAT-V03 だけ
  let err = expectError(validatePatchDocument({ format: "x", schema_version: 99, extra: 1 }, catalog), "ERR-205", "DAT-V03");
  assert.equal(err.issues.length, 1);
  err = expectError(validatePatchDocument({ schema_version: 1, modules: [], cables: [] }, catalog), "ERR-205", "DAT-V03");
  assert.equal(err.details.found, null);
  // format は正しく、schema_version と構造が不正 → DAT-V04 だけ
  err = expectError(validatePatchDocument({ format: PATCH_FORMAT, schema_version: 99, extra: 1 }, catalog), "ERR-205", "DAT-V04");
  assert.equal(err.issues.length, 1);
});

test("DAT-V04: 整数でない・1 未満の schema_version は ERR-204", () => {
  for (const v of [1.5, 0, -1, "1", null, true, [1]]) {
    const doc = p0();
    doc.schema_version = v;
    expectError(validatePatchDocument(doc, catalog), "ERR-204", "DAT-V04");
  }
  const doc = p0();
  delete doc.schema_version;
  expectError(validatePatchDocument(doc, catalog), "ERR-204", "DAT-V04");
  expectError(parsePatchText(baseWith('"schema_version": 1', '"schema_version": 1e999'), catalog), "ERR-204", "DAT-V04");
});

test("DAT-V05: 必須フィールド・型・未知のキーをまとめて報告する(配列の先頭に近い順)", () => {
  const doc = p0();
  delete doc.cables;
  doc.meta.title = 5;
  doc.meta.author = "x";
  doc.meta.saved_by.role = "x";
  doc.modules[1].params = [];
  doc.modules[2].color = "red";
  delete doc.modules[3].type;
  doc.modules[4].ui = "x";
  doc.modules[5] = "env1";
  const err = expectError(validatePatchDocument(doc, catalog), "ERR-204", "DAT-V05");
  assert.deepEqual(err.issues.map((i) => i.path), [
    "cables", "meta.title", "meta.author", "meta.saved_by.role",
    "modules[1].params", "modules[2].color", "modules[3].type", "modules[4].ui", "modules[5]",
  ]);
  assert.ok(err.issues.every((i) => i.rule === "DAT-V05"));

  const doc2 = p0();
  doc2.cables[0].color = "red";
  doc2.cables[1].from.channel = 1;
  delete doc2.cables[2].to.port;
  doc2.cables[3].to = "env1.gate";
  doc2.cables[4].id = 5;
  delete doc2.cables[5].from;
  const err2 = expectError(validatePatchDocument(doc2, catalog), "ERR-204", "DAT-V05");
  assert.deepEqual(err2.issues.map((i) => i.path), [
    "cables[0].color", "cables[1].from.channel", "cables[2].to.port", "cables[3].to", "cables[4].id", "cables[5].from",
  ]);
});

test("DAT-V05: 後の段階(種別・パラメータ・ケーブル)の問題は報告しない", () => {
  const doc = p0();
  doc.extra = 1;
  doc.modules[1].type = "MOD-XYZ-999";
  doc.modules[2].params.tune = 99;
  const err = expectError(validatePatchDocument(doc, catalog), "ERR-204", "DAT-V05");
  assert.deepEqual(rulesOf(err), ["DAT-V05"]);
});

test("§8 規則3: 段階6で DAT-V06 と DAT-V07 の両方に不合格なら DAT-V06 の ERR-204", () => {
  const doc = p0();
  doc.modules[1].spec_version = "9.0"; // DAT-V07(新しすぎる)
  doc.modules[4].type = "MOD-XYZ-999"; // DAT-V06
  const err = expectError(validatePatchDocument(doc, catalog), "ERR-204", "DAT-V06");
  assert.deepEqual(rulesOf(err), ["DAT-V06", "DAT-V07"]);
  assert.deepEqual(err.issues.map((i) => i.path), ["modules[4].type", "modules[1].spec_version"]);
});

test("DAT-V07: 書式が不正なら ERR-204、新しすぎれば ERR-205。先頭の issue が決める", () => {
  for (const sv of ["1", "0.2.0", "v0.2", "0.2 ", "", "0.x", "-0.2"]) {
    const doc = p0();
    doc.modules[2].spec_version = sv;
    expectError(validatePatchDocument(doc, catalog), "ERR-204", "DAT-V07");
  }
  // 0.10 > 0.9 > 0.3(vco1 の現行版。主・副を整数として比べる。§9.1)
  for (const sv of ["0.4", "0.10", "1.0", "0.9"]) {
    const doc = p0();
    doc.modules[2].spec_version = sv;
    const err = expectError(validatePatchDocument(doc, catalog), "ERR-205", "DAT-V07");
    assert.equal(err.details.found, sv);
  }
  const doc = p0();
  doc.modules[1].spec_version = "bad";
  doc.modules[2].spec_version = "9.0";
  let err = expectError(validatePatchDocument(doc, catalog), "ERR-204", "DAT-V07");
  assert.equal(err.issues.length, 2);
  doc.modules[1].spec_version = "9.0";
  doc.modules[2].spec_version = "bad";
  err = expectError(validatePatchDocument(doc, catalog), "ERR-205", "DAT-V07");
  assert.equal(err.issues.length, 2);
});

test("段階6で不合格なら、段階7以降(パラメータ・ケーブル)は報告しない", () => {
  const doc = p0();
  doc.modules[1].type = "MOD-XYZ-999";
  doc.modules[2].params.tune = 99;
  doc.cables[0].to.port = "nope";
  const err = expectError(validatePatchDocument(doc, catalog), "ERR-204", "DAT-V06");
  assert.deepEqual(rulesOf(err), ["DAT-V06"]);
});

test("DAT-V08: モジュールIDの書式と重複", () => {
  for (const id of ["", "1abc", "Abc", "a-b", "a b", "あ", "a" + "b".repeat(32)]) {
    const doc = p0();
    doc.modules[2].id = id;
    doc.cables = [];
    const err = expectError(validatePatchDocument(doc, catalog), "ERR-204", "DAT-V08");
    assert.equal(err.issues[0]!.path, "modules[2].id");
  }
  const ok = p0();
  ok.modules[2].id = "a" + "b".repeat(31); // 32文字ちょうど
  ok.cables = [];
  expectOk(validatePatchDocument(ok, catalog));
  const dup = p0();
  dup.modules[3].id = "vco1";
  const err = expectError(validatePatchDocument(dup, catalog), "ERR-204", "DAT-V08");
  assert.equal(err.issues[0]!.path, "modules[3].id");
});

test("DAT-V09: out がちょうど1つ。他の MOD-IO-001 は不可。out の種別が違っても不可", () => {
  const two = p0();
  two.modules.push({ id: "out2", type: "MOD-IO-001", spec_version: "0.2" });
  let err = expectError(validatePatchDocument(two, catalog), "ERR-204", "DAT-V09");
  assert.equal(err.issues[0]!.path, "modules[6]");
  const wrong = p0();
  wrong.modules[0].type = "MOD-UTL-001";
  wrong.modules[0].params = {};
  wrong.cables = [];
  expectError(validatePatchDocument(wrong, catalog), "ERR-204", "DAT-V09");
  // 段階7の中は規則番号順: V08(重複)→ V09 → V10 → V11 → V12
  const many = p0();
  many.modules[1].id = "vco1";
  many.modules[0].id = "main";
  many.modules[3].params.resonance = 1;
  many.modules[5].params.attack = "fast";
  many.modules[4].params.gain = 2;
  err = expectError(validatePatchDocument(many, catalog), "ERR-204", "DAT-V08");
  assert.deepEqual(rulesOf(err), ["DAT-V08", "DAT-V09", "DAT-V09", "DAT-V10", "DAT-V11", "DAT-V12"]);
});

test("DAT-V11・V12: 整数型への非整数は拒否、範囲はちょうどまで通る(クランプも四捨五入もしない: DAT-09)", () => {
  const set = (module: number, name: string, value: unknown): any => {
    const doc = p0();
    doc.modules[module].params[name] = value;
    return doc;
  };
  expectError(validatePatchDocument(set(2, "range", 0.5), catalog), "ERR-204", "DAT-V11"); // int
  expectError(validatePatchDocument(set(1, "voices", 1.5), catalog), "ERR-204", "DAT-V11");
  for (const v of [true, "1", null, [1], {}, NaN, Infinity]) {
    expectError(validatePatchDocument(set(3, "res", v), catalog), "ERR-204", "DAT-V11");
  }
  assert.equal(expectOk(validatePatchDocument(set(3, "cutoff", 6), catalog)).patch.modules[3]!.params.cutoff, 6);
  assert.equal(expectOk(validatePatchDocument(set(3, "cutoff", -5), catalog)).patch.modules[3]!.params.cutoff, -5);
  expectError(validatePatchDocument(set(3, "cutoff", 6.000001), catalog), "ERR-204", "DAT-V12");
  expectError(validatePatchDocument(set(3, "cutoff", -5.000001), catalog), "ERR-204", "DAT-V12");
  expectError(validatePatchDocument(set(1, "voices", 17), catalog), "ERR-204", "DAT-V12");
  expectError(validatePatchDocument(set(1, "voices", 0), catalog), "ERR-204", "DAT-V12");
  // 1e999 はJSONとしては書けるが、有限の数値でない
  expectError(parsePatchText(baseWith('"res": 0.3', '"res": 1e999'), catalog), "ERR-204", "DAT-V11");
});

test("seed: 整数だけを受け付け、重複は受理する(§8 扱いのまとめ)", () => {
  const doc = p0();
  doc.modules.push({ id: "n1", type: "MOD-NSE-001", spec_version: "0.2", params: { seed: 7 } });
  doc.modules.push({ id: "n2", type: "MOD-NSE-001", spec_version: "0.2", params: { seed: 7 } });
  const r = expectOk(validatePatchDocument(doc, catalog));
  assert.equal(r.patch.modules[6]!.params.seed, 7);
  assert.equal(r.patch.modules[7]!.params.seed, 7);
  doc.modules[6].params.seed = 4294967295;
  expectOk(validatePatchDocument(doc, catalog));
  doc.modules[6].params.seed = 4294967296;
  expectError(validatePatchDocument(doc, catalog), "ERR-204", "DAT-V12");
  doc.modules[6].params.seed = 1.5;
  expectError(validatePatchDocument(doc, catalog), "ERR-204", "DAT-V11");
});

test("DAT-V13〜V16: ケーブルIDの書式・重複、存在しないモジュール、接続できないポート", () => {
  let doc = p0();
  doc.cables[1].id = "C2";
  doc.cables[2].id = "c1";
  let err = expectError(validatePatchDocument(doc, catalog), "ERR-204", "DAT-V13");
  assert.deepEqual(err.issues.map((i) => i.path), ["cables[1].id", "cables[2].id"]);

  doc = p0();
  doc.cables[0].from.module = "nope";
  doc.cables[1].to.port = "IN"; // 大文字・小文字を区別する
  err = expectError(validatePatchDocument(doc, catalog), "ERR-204", "DAT-V14");
  assert.deepEqual(err.issues.map((i) => i.path), ["cables[0].from.module", "cables[1].to.port"]);

  // 接続できないポート(DAT-12): MOD-IO-001 の PRE_L/PRE_R/DEV_L/DEV_R、MOD-IO-002 の MIDI
  for (const port of ["PRE_L", "PRE_R", "DEV_L", "DEV_R"]) {
    doc = p0();
    doc.cables.push({ id: "c7", from: { module: "out", port }, to: { module: "vco1", port: "fm" } });
    err = expectError(validatePatchDocument(doc, catalog), "ERR-204", "DAT-V15");
    assert.equal(err.issues[0]!.path, "cables[6].from");
  }
  doc = p0();
  doc.cables.push({ id: "c7", from: { module: "vco1", port: "sine" }, to: { module: "midi1", port: "MIDI" } });
  err = expectError(validatePatchDocument(doc, catalog), "ERR-204", "DAT-V15");
  assert.equal(err.issues[0]!.path, "cables[6].to");
  // 出力→出力、入力→入力
  doc = p0();
  doc.cables.push({ id: "c7", from: { module: "vco1", port: "sine" }, to: { module: "vcf1", port: "out" } });
  expectError(validatePatchDocument(doc, catalog), "ERR-204", "DAT-V15");
});

test("DAT-12: 自己接続・フィードバック・型違い・1つの出力から複数は通る(型違いの警告は出さない)", () => {
  const doc = p0();
  doc.cables.push({ id: "self", from: { module: "vco1", port: "sine" }, to: { module: "vco1", port: "fm" } });
  doc.cables.push({ id: "fb", from: { module: "vca1", port: "out" }, to: { module: "vcf1", port: "cv1" } });
  doc.cables.push({ id: "gate_to_r", from: { module: "midi1", port: "GATE" }, to: { module: "out", port: "IN_R" } });
  doc.cables.push({ id: "clip", from: { module: "out", port: "CLIP" }, to: { module: "vco1", port: "sync" } });
  const r = expectOk(validatePatchDocument(doc, catalog));
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.patch.cables, doc.cables);
});

test("DAT-V17: モジュール数・ケーブル数は上限ちょうどまで通り、超過で ERR-204", () => {
  const build = (modules: number, cables: number): any => {
    const doc: any = { format: PATCH_FORMAT, schema_version: 1, modules: [{ id: "out", type: "MOD-IO-001", spec_version: "0.2" }], cables: [] };
    for (let i = 1; i < modules; i++) doc.modules.push({ id: `m${i}`, type: "MOD-FNC-001", spec_version: "0.2" });
    // 入力は1本までなので、m1 の out を各モジュールの5つの入力と out の IN_L/IN_R へ順につなぐ
    const inputs: { module: string; port: string }[] = [{ module: "out", port: "IN_L" }, { module: "out", port: "IN_R" }];
    for (let i = 1; i < modules; i++) for (const port of ["in", "trig", "cycle", "rise_cv", "fall_cv"]) inputs.push({ module: `m${i}`, port });
    assert.ok(inputs.length >= cables);
    for (let i = 0; i < cables; i++) doc.cables.push({ id: `c${i + 1}`, from: { module: "m1", port: "out" }, to: inputs[i] });
    return doc;
  };
  const exact = expectOk(validatePatchDocument(build(256, 1024), catalog));
  assert.equal(exact.patch.modules.length, 256);
  assert.equal(exact.patch.cables.length, 1024);
  assert.ok(utf8ByteLength(serializePatchDocument(exact.patch)) <= MAX_PATCH_BYTES, "§10 の目安: 256モジュール・1024ケーブルは 1 MiB に収まる");
  let err = expectError(validatePatchDocument(build(257, 1024), catalog), "ERR-204", "DAT-V17");
  assert.deepEqual(err.issues.map((i) => i.path), ["modules"]);
  err = expectError(validatePatchDocument(build(256, 1025), catalog), "ERR-204", "DAT-V17");
  assert.deepEqual(err.issues.map((i) => i.path), ["cables"]);
  err = expectError(validatePatchDocument(build(300, 1100), catalog), "ERR-204", "DAT-V17");
  assert.deepEqual(err.issues.map((i) => i.path), ["modules", "cables"]);
});

test("§8 規則2: issues は最大50件", () => {
  const doc: any = { format: PATCH_FORMAT, schema_version: 1, modules: [{ id: "out", type: "MOD-IO-001", spec_version: "0.2" }], cables: [] };
  for (let i = 1; i <= 80; i++) doc.modules.push({ id: `m${i}`, type: "MOD-XYZ-999", spec_version: "0.2" });
  const err = expectError(validatePatchDocument(doc, catalog), "ERR-204", "DAT-V06");
  assert.equal(err.issues.length, 50);
  assert.equal(err.issues[0]!.path, "modules[1].type");
  assert.equal(err.issues[49]!.path, "modules[50].type");
  assert.deepEqual(err.details.issues, err.issues);
});

test("DAT-V18: meta の文字数(上限ちょうど/超過)と書式", () => {
  const withMeta = (meta: any): any => ({ ...p0(), meta });
  expectOk(validatePatchDocument(withMeta({ title: "あ".repeat(120), description: "a".repeat(2000), app_version: "v".repeat(32) }), catalog));
  expectOk(validatePatchDocument(withMeta({ title: "😀".repeat(120) }), catalog)); // 文字数で数える
  let err = expectError(validatePatchDocument(withMeta({ title: "あ".repeat(121) }), catalog), "ERR-204", "DAT-V18");
  assert.equal(err.issues[0]!.path, "meta.title");
  err = expectError(validatePatchDocument(withMeta({ description: "a".repeat(2001) }), catalog), "ERR-204", "DAT-V18");
  assert.equal(err.issues[0]!.path, "meta.description");
  err = expectError(validatePatchDocument(withMeta({ app_version: "v".repeat(33) }), catalog), "ERR-204", "DAT-V18");
  assert.equal(err.issues[0]!.path, "meta.app_version");
  for (const t of ["2026-11-13", "2026-11-13 09:00:00Z", "2026-11-13T09:00:00+09:00", "2026-11-13T09:00:00", "2026-13-01T00:00:00Z", "2026-02-30T00:00:00Z", "2026-11-13T24:00:00Z", "yesterday", ""]) {
    err = expectError(validatePatchDocument(withMeta({ created_at: t }), catalog), "ERR-204", "DAT-V18");
    assert.equal(err.issues[0]!.path, "meta.created_at");
    expectError(validatePatchDocument(withMeta({ modified_at: t }), catalog), "ERR-204", "DAT-V18");
  }
  expectOk(validatePatchDocument(withMeta({ created_at: "2024-02-29T23:59:59.123Z" }), catalog));
  err = expectError(validatePatchDocument(withMeta({ saved_by: { kind: "robot" } }), catalog), "ERR-204", "DAT-V18");
  assert.equal(err.issues[0]!.path, "meta.saved_by.kind");
  const r = expectOk(validatePatchDocument(withMeta({ saved_by: { kind: "agent", client_id: "claude" } }), catalog));
  assert.deepEqual(r.patch.meta, { title: "", description: "", saved_by: { kind: "agent", client_id: "claude" } });
});

test("meta: 省略時は title・description が既定値(空文字列)になり、他の項目は「なし」のまま", () => {
  const doc = p0();
  delete doc.meta;
  assert.deepEqual(expectOk(validatePatchDocument(doc, catalog)).patch.meta, { title: "", description: "" });
  doc.meta = {};
  assert.deepEqual(expectOk(validatePatchDocument(doc, catalog)).patch.meta, { title: "", description: "" });
  doc.meta = { title: "題" };
  assert.deepEqual(expectOk(validatePatchDocument(doc, catalog)).patch.meta, { title: "題", description: "" });
});

// ---- ui(DAT-10、DAT-11) ----
test("DAT-11: ui 内の未知のキーは拒否せず、そのまま保持して書き戻す。ui がないモジュールは ui なしのまま", () => {
  const doc = p0();
  doc.modules[2].ui = { x: 1.5, y: -2, color: "red", collapsed: true, tags: ["a", { b: null }], nested: { deep: [1, 2, 3] } };
  delete doc.modules[3].ui;
  doc.modules[4].ui = {};
  const r = expectOk(validatePatchDocument(doc, catalog));
  assert.deepEqual(r.patch.modules[2]!.ui, doc.modules[2].ui);
  assert.notEqual(r.patch.modules[2]!.ui, doc.modules[2].ui);
  assert.equal("ui" in r.patch.modules[3]!, false);
  assert.deepEqual(r.patch.modules[4]!.ui, {});
  const again = expectOk(parsePatchText(serializePatchDocument(r.patch), catalog));
  assert.deepEqual(again.patch, r.patch);
});

test("DAT-V18: ui の x・y の型と、ui のバイト数(上限ちょうど/超過)", () => {
  for (const v of ["10", null, true, [1], NaN]) {
    const doc = p0();
    doc.modules[2].ui.x = v;
    const err = expectError(validatePatchDocument(doc, catalog), "ERR-204", "DAT-V18");
    assert.equal(err.issues[0]!.path, "modules[2].ui.x");
    const doc2 = p0();
    doc2.modules[2].ui = { y: v };
    assert.equal(expectError(validatePatchDocument(doc2, catalog), "ERR-204", "DAT-V18").issues[0]!.path, "modules[2].ui.y");
  }
  const uiOf = (bytes: number): any => {
    const ui = { x: 1, y: 2, note: "" };
    ui.note = "a".repeat(bytes - utf8ByteLength(JSON.stringify(ui)));
    assert.equal(utf8ByteLength(JSON.stringify(ui)), bytes);
    return ui;
  };
  const doc = p0();
  doc.modules[2].ui = uiOf(1024);
  expectOk(validatePatchDocument(doc, catalog));
  doc.modules[2].ui = uiOf(1025);
  const err = expectError(validatePatchDocument(doc, catalog), "ERR-204", "DAT-V18");
  assert.equal(err.issues[0]!.path, "modules[2].ui");
});

// ---- 省略パラメータの補完(DAT-08、DAT-59) ----
test("DAT-08: 書かれていないパラメータは既定値で補い、warnings に param_defaulted を入れる", () => {
  const doc = {
    format: PATCH_FORMAT, schema_version: 1,
    modules: [
      { id: "out", type: "MOD-IO-001", spec_version: "0.2" },
      { id: "vcf1", type: "MOD-FLT-001", spec_version: "0.2", params: { res: 0.7 } },
      { id: "vco1", type: "MOD-OSC-001", spec_version: "0.3", params: { range: 0, tune: 0, fm_amt: 0, pw: 0.5, pwm_amt: 0 } },
    ],
    cables: [],
  };
  const before = structuredClone(doc);
  const r = expectOk(validatePatchDocument(doc, catalog));
  assert.deepEqual(doc, before, "入力が書き換わらない");
  assert.deepEqual(r.patch.modules[0]!.params, { level: 1, mute: 0 });
  assert.deepEqual(r.patch.modules[1]!.params, { cutoff: 3, res: 0.7, cv2_level: 1, cv3_level: 1 });
  assert.equal(r.migrated, null);
  assert.deepEqual(r.warnings.map((w) => w.code), ["param_defaulted", "param_defaulted"]);
  assert.deepEqual(r.warnings.map((w) => [w.details.module_id, w.details.params]), [
    ["out", ["level", "mute"]],
    ["vcf1", ["cutoff", "cv2_level", "cv3_level"]],
  ]);
  // 全20種: params なしで読むと、種別の全パラメータが既定値で入る(DAT-07 の形になる)
  const all: any = { format: PATCH_FORMAT, schema_version: 1, modules: [], cables: [] };
  let n = 0;
  for (const t of catalog.values()) all.modules.push({ id: t.type === "MOD-IO-001" ? "out" : `m${++n}`, type: t.type, spec_version: t.specVersion });
  assert.equal(all.modules.length, 20);
  const ra = expectOk(validatePatchDocument(all, catalog));
  for (const m of ra.patch.modules) {
    const info = catalog.get(m.type)!;
    assert.deepEqual(m.params, Object.fromEntries(info.params.map((p) => [p.name, p.default])), m.type);
    assert.deepEqual(Object.keys(m.params), info.params.map((p) => p.name), m.type);
  }
  // 補った結果を書いて読み直すと、警告なしで同じ内容
  const again = expectOk(parsePatchText(serializePatchDocument(ra.patch), catalog));
  assert.deepEqual(again.patch, ra.patch);
  assert.deepEqual(again.warnings, []);
});

// ---- 移行(§9) ----
/** §11 の例を仕様版 0.1 の形にしたもの(DAT-61 の見本): 全モジュールを 0.1 にし、0.2 で増えた voices を除く。 */
function p0AtSpec01(): any {
  const doc = p0();
  for (const m of doc.modules) m.spec_version = "0.1";
  delete doc.modules[1].params.voices;
  return doc;
}

test("§9.5: 仕様版 0.1 の文書 → 現行(0.2。MOD-OSC-001 は 0.2 を経て 0.3)。MOD-IO-002 に voices = 1 を補い、他は何もしない移行", () => {
  const doc = p0AtSpec01();
  const before = structuredClone(doc);
  const r = expectOk(validatePatchDocument(doc, catalog));
  assert.deepEqual(doc, before, "元の入力は書き換えない(DAT-60)");
  assert.deepEqual(r.patch, p0(), "移行後の期待パッチは §11 の例");
  assert.deepEqual(r.migrated, {
    schema_from: 1, schema_to: 1,
    modules: [
      { id: "out", type: "MOD-IO-001", spec_from: "0.1", spec_to: "0.2" },
      { id: "midi1", type: "MOD-IO-002", spec_from: "0.1", spec_to: "0.2" },
      { id: "vco1", type: "MOD-OSC-001", spec_from: "0.1", spec_to: "0.3" },
      { id: "vcf1", type: "MOD-FLT-001", spec_from: "0.1", spec_to: "0.2" },
      { id: "vca1", type: "MOD-AMP-001", spec_from: "0.1", spec_to: "0.2" },
      { id: "env1", type: "MOD-ENV-001", spec_from: "0.1", spec_to: "0.2" },
    ],
  });
  // voices は移行が補ったもので、省略パラメータの補完(param_defaulted)ではない
  assert.deepEqual(r.warnings.map((w) => w.code), ["migrated"]);
  assert.deepEqual(r.warnings[0]!.details, r.migrated);
  // 文字列からでも同じ
  assert.deepEqual(parsePatchText(JSON.stringify(doc), catalog), r);
  // 移行後を保存して読み直すと、移行なし
  const again = expectOk(parsePatchText(serializePatchDocument(r.patch), catalog));
  assert.equal(again.migrated, null);
  assert.deepEqual(again.patch, r.patch);
});

test("§9.5: MOD-IO-003 の 0.1 → 0.2 は channel = 1 を補う。一部のモジュールだけ古い文書も読める", () => {
  const doc = p0();
  doc.modules.push({
    id: "meter1", type: "MOD-IO-003", spec_version: "0.1",
    params: { window_ms: 50, capture_len: 256, trig_mode: 0, trig_level: 0.5, pre: 10 },
  });
  const r = expectOk(validatePatchDocument(doc, catalog));
  assert.deepEqual(r.patch.modules[6], {
    id: "meter1", type: "MOD-IO-003", spec_version: "0.2",
    params: { window_ms: 50, capture_len: 256, trig_mode: 0, trig_level: 0.5, pre: 10, channel: 1 },
  });
  assert.deepEqual(r.migrated, { schema_from: 1, schema_to: 1, modules: [{ id: "meter1", type: "MOD-IO-003", spec_from: "0.1", spec_to: "0.2" }] });
  assert.deepEqual(r.warnings.map((w) => w.code), ["migrated"]);
});

test("DAT-59: 省略パラメータは移行の直前に元の spec_version の既定値で補う(0.1 にない voices・channel は補完の対象外)", () => {
  const doc = {
    format: PATCH_FORMAT, schema_version: 1,
    modules: [
      { id: "out", type: "MOD-IO-001", spec_version: "0.1" },
      { id: "midi1", type: "MOD-IO-002", spec_version: "0.1", params: { transpose: 12 } },
      { id: "meter1", type: "MOD-IO-003", spec_version: "0.1" },
    ],
    cables: [],
  };
  const r = expectOk(validatePatchDocument(doc, catalog));
  assert.deepEqual(r.patch.modules[1]!.params, { channel: 0, transpose: 12, voices: 1, cc_number: 1 });
  assert.deepEqual(r.patch.modules[2]!.params, { window_ms: 100, capture_len: 512, trig_mode: 1, trig_level: 0, pre: 0, channel: 1 });
  assert.deepEqual(r.warnings.map((w) => [w.code, w.details.module_id ?? null, w.details.params ?? null]), [
    ["param_defaulted", "out", ["level", "mute"]],
    ["param_defaulted", "midi1", ["channel", "cc_number"]],
    ["param_defaulted", "meter1", ["window_ms", "capture_len", "trig_mode", "trig_level", "pre"]],
    ["migrated", null, null],
  ]);
  assert.ok(r.warnings.slice(0, 3).every((w) => w.details.spec_version === "0.1"));
});

test("DAT-56: 移行は知らない名前・数値でない値を変えずに通し、移行後の DAT-V10〜V12 が拒否する", () => {
  const unknown = p0AtSpec01();
  unknown.modules[3].params.resonance = 0.5;
  let err = expectError(validatePatchDocument(unknown, catalog), "ERR-204", "DAT-V10");
  assert.equal(err.issues[0]!.path, "modules[3].params.resonance");
  const notNumber = p0AtSpec01();
  notNumber.modules[5].params.attack = "fast";
  err = expectError(validatePatchDocument(notNumber, catalog), "ERR-204", "DAT-V11");
  assert.equal(err.issues[0]!.path, "modules[5].params.attack");
  const range = p0AtSpec01();
  range.modules[3].params.cutoff = 7.5;
  expectError(validatePatchDocument(range, catalog), "ERR-204", "DAT-V12");
});

test("DAT-V07: 移行が登録されていない古い版(0.0)は拒否する", () => {
  const doc = p0();
  doc.modules[2].spec_version = "0.0";
  const err = expectError(validatePatchDocument(doc, catalog), "ERR-205", "DAT-V07");
  assert.deepEqual(err.details, { found: "0.0", supported: ["0.1", "0.2", "0.3"] });
});

test("DAT-55・DAT-61: パッチ形式の移行は、試験専用の仮の旧版で古い版から順に適用する", () => {
  // 仮の版: 1 = ケーブルを `wires`(from/to が "モジュール.ポート" の文字列)で書く。2 = `wires` を `cables` に改名。3 = 現行の形。
  const calls: number[] = [];
  const options = {
    schemaVersion: 3,
    schemaMigrations: new Map([
      [1, (doc: Readonly<Record<string, unknown>>) => {
        calls.push(1);
        const { wires, ...rest } = doc;
        return { ...rest, schema_version: 2, cables: wires };
      }],
      [2, (doc: Readonly<Record<string, unknown>>) => {
        calls.push(2);
        const ref = (s: string) => ({ module: s.split(".")[0], port: s.split(".")[1] });
        return {
          ...doc, schema_version: 3,
          cables: (doc.cables as { id: string; from: string; to: string }[]).map((c) => ({ id: c.id, from: ref(c.from), to: ref(c.to) })),
        };
      }],
    ]),
  };
  const v1 = deepFreeze({
    format: PATCH_FORMAT, schema_version: 1,
    modules: [
      { id: "out", type: "MOD-IO-001", spec_version: "0.2", params: { level: 1, mute: 0 } },
      { id: "midi1", type: "MOD-IO-002", spec_version: "0.1", params: { channel: 0, transpose: 0, cc_number: 1 } },
      { id: "vco1", type: "MOD-OSC-001", spec_version: "0.3", params: { range: 0, tune: 0, fm_amt: 0, pw: 0.5, pwm_amt: 0 } },
    ],
    wires: [{ id: "c1", from: "midi1.PITCH", to: "vco1.pitch" }, { id: "c2", from: "vco1.saw", to: "out.IN_L" }],
  });
  const r = expectOk(validatePatchDocument(v1, catalog, options));
  assert.deepEqual(calls, [1, 2]);
  assert.equal(r.patch.schema_version, 3);
  assert.deepEqual(r.patch.cables, [
    { id: "c1", from: { module: "midi1", port: "PITCH" }, to: { module: "vco1", port: "pitch" } },
    { id: "c2", from: { module: "vco1", port: "saw" }, to: { module: "out", port: "IN_L" } },
  ]);
  assert.deepEqual(r.migrated, { schema_from: 1, schema_to: 3, modules: [{ id: "midi1", type: "MOD-IO-002", spec_from: "0.1", spec_to: "0.2" }] });
  assert.deepEqual(r.warnings.map((w) => w.code), ["migrated"]);
  // 途中の版からは、残りの移行だけ
  calls.length = 0;
  const v2 = { ...v1, schema_version: 2, cables: v1.wires, wires: undefined };
  delete (v2 as any).wires;
  assert.deepEqual(expectOk(validatePatchDocument(v2, catalog, options)).patch, r.patch);
  assert.deepEqual(calls, [2]);
  // DAT-V05 は移行①の後の形に対して行う: 現行の形に旧版のキーがあれば拒否
  const mixed = { ...r.patch, wires: [] };
  expectError(validatePatchDocument(mixed, catalog, options), "ERR-204", "DAT-V05");
  // 最新版より新しい版は拒否
  const err = expectError(validatePatchDocument({ ...r.patch, schema_version: 4 }, catalog, options), "ERR-205", "DAT-V04");
  assert.deepEqual(err.details, { found: 4, supported: [1, 2, 3] });
});

test("DAT-56: モジュールの移行は順に適用し、ポート名の対応をケーブルへ反映する(試験専用の仮の旧版)", () => {
  // 仮の鎖: MOD-UTL-001 の 0.0 →(gain を2倍の単位から直す)→ 0.1 →(ポート名 input → in)→ 0.2
  const options = {
    specMigrations: new Map([["MOD-UTL-001", [
      { from: "0.0", to: "0.1", migrate: (p: Readonly<Record<string, unknown>>) => ({ ...p, gain: typeof p.gain === "number" ? p.gain / 2 : p.gain }) },
      { from: "0.1", to: "0.2", migrate: (p: Readonly<Record<string, unknown>>) => ({ ...p }), renamePorts: { input: "in" } },
    ]]]),
  };
  const doc = deepFreeze({
    format: PATCH_FORMAT, schema_version: 1,
    modules: [
      { id: "out", type: "MOD-IO-001", spec_version: "0.2", params: { level: 1, mute: 0 } },
      { id: "u1", type: "MOD-UTL-001", spec_version: "0.0", params: { gain: 1, offset: 0 } },
      { id: "u2", type: "MOD-UTL-001", spec_version: "0.2", params: { gain: 1, offset: 0 } },
    ],
    cables: [
      { id: "c1", from: { module: "u2", port: "out" }, to: { module: "u1", port: "input" } },
      { id: "c2", from: { module: "u1", port: "out" }, to: { module: "out", port: "IN_L" } },
    ],
  });
  const r = expectOk(validatePatchDocument(doc, catalog, options));
  assert.deepEqual(r.patch.modules[1], { id: "u1", type: "MOD-UTL-001", spec_version: "0.2", params: { gain: 0.5, offset: 0 } });
  assert.deepEqual(r.patch.cables[0]!.to, { module: "u1", port: "in" });
  assert.deepEqual(r.migrated!.modules, [{ id: "u1", type: "MOD-UTL-001", spec_from: "0.0", spec_to: "0.2" }]);
  // 最新版(0.2)のモジュール u2 には旧ポート名は通らない
  const bad = structuredClone(doc) as any;
  bad.cables.push({ id: "c3", from: { module: "u1", port: "out" }, to: { module: "u2", port: "input" } });
  expectError(validatePatchDocument(bad, catalog, options), "ERR-204", "DAT-V14");
});

// ---- 文字列の解釈 ----
test("parsePatchText: 空白・改行・エスケープ・指数表記を含む正しいJSONを読む", () => {
  const doc = p0();
  doc.meta.title = '引用符 " と \\ と改行\nとタブ\tと絵文字😀';
  doc.modules[3].params.cutoff = 1.5e0;
  doc.modules[2].ui = { x: -12.5, constructor: "c" };
  const text = "\n\t " + JSON.stringify(doc, null, "\t").replace('"x": -12.5,', '"x": -1.25e1, "__proto__": {"a": 1},').replace('"cutoff": 1.5', '"cutoff": 15E-1').replace('"title": "引', '"title": "\\u5f15') + "\r\n";
  const r = expectOk(parsePatchText(text, catalog));
  assert.equal(r.patch.meta.title, doc.meta.title);
  assert.equal(r.patch.modules[3]!.params.cutoff, 1.5);
  assert.equal(JSON.stringify(r.patch.modules[2]!.ui), '{"x":-12.5,"__proto__":{"a":1},"constructor":"c"}');
  assert.equal(Object.getPrototypeOf(r.patch.modules[2]!.ui), Object.prototype);
  // `__proto__` や `constructor` を名前にしても、未知のキー・未知のパラメータとして拒否する
  expectError(parsePatchText(baseWith('"cables": [', '"__proto__": {}, "cables": ['), catalog), "ERR-204", "DAT-V05");
  expectError(parsePatchText(baseWith('"res": 0.3', '"res": 0.3, "constructor": 1'), catalog), "ERR-204", "DAT-V10");
  expectError(parsePatchText(baseWith('"res": 0.3', '"res": 0.3, "__proto__": 1'), catalog), "ERR-204", "DAT-V10");
});

// ---- パッチ名(DAT-31) ----
test("DAT-31: isValidPatchName", () => {
  for (const name of ["bass-01", "a", "0", "a_b-c", "a".repeat(64), "console", "com10", "lpt0"]) assert.equal(isValidPatchName(name), true, name);
  for (const name of [
    "", "a".repeat(65), "-a", "_a", "Bass", "a b", "a.b", "a/b", "a\\b", "..", ".", "ベース", "a.patch.json",
    "con", "prn", "aux", "nul", "com1", "com9", "lpt1", "lpt9",
  ]) assert.equal(isValidPatchName(name), false, name);
  for (const v of [null, undefined, 1, ["a"], {}]) assert.equal(isValidPatchName(v), false);
});

// 型の確認(コンパイルできること): 正規化済みの文書は PatchDocument
const _typeCheck = (r: PatchLoadResult): PatchDocument | null => (r.ok ? r.patch : null);
void _typeCheck;
