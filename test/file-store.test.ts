// 専用フォルダの保存先(src/server/file-store.ts)の試験。data-contract §7.2(DAT-30〜34)、§10。
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FilePatchStore, MAX_PATCH_FILES } from "../src/server/file-store.js";

/** 試験ごとの作業場所: base/patches が専用フォルダ、base の直下が「フォルダの外」。 */
async function rig(options: { maxFiles?: number; maxBytes?: number } = {}) {
  const base = await mkdtemp(join(tmpdir(), "synth-store-"));
  const dir = join(base, "patches");
  const store = new FilePatchStore(dir, options);
  return { base, dir, store, cleanup: () => rm(base, { recursive: true, force: true }) };
}

const DOC = '{"format":"modular-synth-patch","schema_version":1}\n';

test("上限の既定値は契約の値(ファイル数 1000、大きさ 1 MiB)", async () => {
  const r = await rig();
  try {
    assert.equal(MAX_PATCH_FILES, 1000);
    assert.equal(r.store.maxFiles, 1000);
    assert.equal(r.store.maxBytes, 1024 * 1024);
  } finally {
    await r.cleanup();
  }
});

test("フォルダがまだないとき: 一覧は空、読出しは not_found。書き込みでフォルダを作る", async () => {
  const r = await rig();
  try {
    assert.deepEqual(await r.store.list(), { ok: true, value: [] });
    assert.deepEqual(await r.store.read("bass-01"), { ok: false, error: "not_found" });
    assert.deepEqual(await r.store.remove("bass-01"), { ok: false, error: "not_found" });
    const w = await r.store.write("bass-01", DOC, false);
    assert.equal(w.ok, true);
    assert.deepEqual(await readdir(r.dir), ["bass-01.patch.json"]);
  } finally {
    await r.cleanup();
  }
});

test("書いて読む: <name>.patch.json に UTF-8 でそのまま入り、大きさと更新時刻(RFC 3339、UTC)を返す", async () => {
  const r = await rig();
  try {
    const text = '{"meta":{"title":"低音 ♪"}}\n';
    const w = await r.store.write("bass-01", text, false);
    assert.equal(w.ok, true);
    if (!w.ok) return;
    assert.equal(w.value.name, "bass-01");
    assert.equal(w.value.bytes, Buffer.byteLength(text, "utf8"));
    assert.match(w.value.modified_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    assert.equal(await readFile(join(r.dir, "bass-01.patch.json"), "utf8"), text);
    const got = await r.store.read("bass-01");
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.equal(got.value.text, text);
    assert.deepEqual(got.value.info, w.value);
    const l = await r.store.list();
    assert.deepEqual(l, { ok: true, value: [w.value] });
  } finally {
    await r.cleanup();
  }
});

test("名前の検証(DAT-31): 規則に合わない名前は読み・書き・削除とも invalid_name で、何も作らない", async () => {
  const r = await rig();
  try {
    await r.store.write("ok", DOC, false);
    const badNames = [
      "../etc/x", "..", ".", "", "a/b", "a\\b", "/abs", "A", "Bass", "a b", "é", "_a", "-a", "a.b", "x.patch.json",
      "a".repeat(65), "con", "nul", "com1", "lpt9", "a\u0000b", "a\n",
    ];
    for (const name of badNames) {
      assert.deepEqual(await r.store.write(name, DOC, true), { ok: false, error: "invalid_name" }, `write ${JSON.stringify(name)}`);
      assert.deepEqual(await r.store.read(name), { ok: false, error: "invalid_name" }, `read ${JSON.stringify(name)}`);
      assert.deepEqual(await r.store.remove(name), { ok: false, error: "invalid_name" }, `remove ${JSON.stringify(name)}`);
    }
    // 文字列でない名前(型を無視して渡された場合)
    for (const name of [null, 1, {}, ["a"]] as unknown as string[]) {
      assert.deepEqual(await r.store.write(name, DOC, true), { ok: false, error: "invalid_name" });
      assert.deepEqual(await r.store.read(name), { ok: false, error: "invalid_name" });
    }
    assert.deepEqual(await readdir(r.dir), ["ok.patch.json"]);
    assert.deepEqual(await readdir(r.base), ["patches"]);
    // 境界: 64 文字は可
    assert.equal((await r.store.write("a".repeat(64), DOC, false)).ok, true);
  } finally {
    await r.cleanup();
  }
});

test("フォルダの外は読めない・書けない・消せない(上位参照)", async () => {
  const r = await rig();
  try {
    await mkdir(r.dir);
    await writeFile(join(r.base, "secret.patch.json"), "SECRET");
    assert.deepEqual(await r.store.read("../secret"), { ok: false, error: "invalid_name" });
    assert.deepEqual(await r.store.write("../secret", "X", true), { ok: false, error: "invalid_name" });
    assert.deepEqual(await r.store.remove("../secret"), { ok: false, error: "invalid_name" });
    assert.equal(await readFile(join(r.base, "secret.patch.json"), "utf8"), "SECRET");
  } finally {
    await r.cleanup();
  }
});

test("シンボリックリンクはたどらない: リンク越しに外を読まない・書かない", async () => {
  const r = await rig();
  try {
    await mkdir(r.dir);
    const outside = join(r.base, "outside.txt");
    await writeFile(outside, "OUTSIDE");
    await symlink(outside, join(r.dir, "link.patch.json"));
    // 読出し: 外の内容を返さない
    const got = await r.store.read("link");
    assert.equal(got.ok, false);
    if (!got.ok) assert.equal(got.error, "failed");
    // 上書きなし: 既にあるので exists(外は変わらない)
    assert.deepEqual(await r.store.write("link", DOC, false), { ok: false, error: "exists" });
    assert.equal(await readFile(outside, "utf8"), "OUTSIDE");
    // 上書き: リンク自体を通常のファイルに置き換える(外は変わらない)
    assert.equal((await r.store.write("link", DOC, true)).ok, true);
    assert.equal(await readFile(outside, "utf8"), "OUTSIDE");
    const again = await r.store.read("link");
    assert.equal(again.ok && again.value.text, DOC);
    // 削除: リンク自体を消す(外は残る)
    await symlink(outside, join(r.dir, "link2.patch.json"));
    assert.deepEqual(await r.store.remove("link2"), { ok: true, value: null });
    assert.equal(await readFile(outside, "utf8"), "OUTSIDE");
  } finally {
    await r.cleanup();
  }
});

test("上書き(DAT-33): overwrite が false なら exists で元のまま、true なら置き換える", async () => {
  const r = await rig();
  try {
    assert.equal((await r.store.write("p", "one", false)).ok, true);
    assert.deepEqual(await r.store.write("p", "two", false), { ok: false, error: "exists" });
    assert.equal(await readFile(join(r.dir, "p.patch.json"), "utf8"), "one");
    const w = await r.store.write("p", "three", true);
    assert.equal(w.ok && w.value.bytes, 5);
    assert.equal(await readFile(join(r.dir, "p.patch.json"), "utf8"), "three");
    // overwrite: true は、ないときは新しく作る
    assert.equal((await r.store.write("q", "new", true)).ok, true);
    assert.deepEqual(await readdir(r.dir), ["p.patch.json", "q.patch.json"]);
  } finally {
    await r.cleanup();
  }
});

test("件数上限: 新しい名前で上限を超えると too_many。上書きは対象外。数えるのは名前が規則に合う *.patch.json だけ", async () => {
  const r = await rig({ maxFiles: 3 });
  try {
    await mkdir(r.dir);
    // 数えないもの
    await writeFile(join(r.dir, "notes.txt"), "x");
    await writeFile(join(r.dir, "Bad Name.patch.json"), "x");
    await writeFile(join(r.dir, ".a.0123.tmp"), "x");
    for (const n of ["a", "b", "c"]) assert.equal((await r.store.write(n, DOC, false)).ok, true, n);
    assert.deepEqual(await r.store.write("d", DOC, false), { ok: false, error: "too_many" });
    assert.deepEqual(await r.store.write("d", DOC, true), { ok: false, error: "too_many" });
    assert.equal((await r.store.write("b", "changed", true)).ok, true); // 上書きは数を増やさない
    const l = await r.store.list();
    assert.deepEqual(l.ok && l.value.map((i) => i.name), ["a", "b", "c"]);
    // 1つ消せば、また書ける
    assert.deepEqual(await r.store.remove("a"), { ok: true, value: null });
    assert.equal((await r.store.write("d", DOC, false)).ok, true);
  } finally {
    await r.cleanup();
  }
});

test("件数上限は同時の書き込みでも超えない", async () => {
  const r = await rig({ maxFiles: 5 });
  try {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => r.store.write(`p${i}`, DOC, false)));
    assert.equal(results.filter((x) => x.ok).length, 5);
    assert.ok(results.filter((x) => !x.ok).every((x) => !x.ok && x.error === "too_many"));
    assert.equal((await readdir(r.dir)).length, 5);
  } finally {
    await r.cleanup();
  }
});

test("大きさの上限: 超える書き込みは too_large で何も作らない。外から置かれた大きなファイルも読まない", async () => {
  const r = await rig({ maxBytes: 100 });
  try {
    assert.equal((await r.store.write("fit", "x".repeat(100), false)).ok, true);
    assert.deepEqual(await r.store.write("big", "x".repeat(101), false), { ok: false, error: "too_large" });
    // バイト数で測る(「あ」は UTF-8 で 3 バイト)
    assert.deepEqual(await r.store.write("big", "あ".repeat(34), false), { ok: false, error: "too_large" });
    assert.equal((await r.store.write("jp", "あ".repeat(33), false)).ok, true);
    await writeFile(join(r.dir, "huge.patch.json"), "y".repeat(500));
    assert.deepEqual(await r.store.read("huge"), { ok: false, error: "too_large" });
    assert.deepEqual((await readdir(r.dir)).sort(), ["fit.patch.json", "huge.patch.json", "jp.patch.json"]);
  } finally {
    await r.cleanup();
  }
});

test("一時ファイル(DAT-32): 成功しても失敗しても一時ファイルを残さず、失敗時は元のファイルが壊れない", async () => {
  const r = await rig();
  try {
    await r.store.write("p", "one", false);
    await r.store.write("p", "two", true);
    await r.store.write("p", "zzz", false); // exists で失敗
    assert.deepEqual(await readdir(r.dir), ["p.patch.json"]);
    // 置き換えられない相手(同名のフォルダ)への書き込みは failed。一時ファイルは残らない
    await mkdir(join(r.dir, "d.patch.json"));
    await writeFile(join(r.dir, "d.patch.json", "keep"), "k");
    const w = await r.store.write("d", DOC, true);
    assert.equal(w.ok, false);
    if (!w.ok) assert.equal(w.error, "failed");
    assert.deepEqual((await readdir(r.dir)).sort(), ["d.patch.json", "p.patch.json"]);
    assert.equal(await readFile(join(r.dir, "d.patch.json", "keep"), "utf8"), "k");
    assert.equal(await readFile(join(r.dir, "p.patch.json"), "utf8"), "two");
    // フォルダは読めない(failed)が、一覧には載る(壊れたものを隠さない: DAT-34)
    const got = await r.store.read("d");
    assert.equal(got.ok, false);
    const l = await r.store.list();
    assert.deepEqual(l.ok && l.value.map((i) => i.name), ["d", "p"]);
  } finally {
    await r.cleanup();
  }
});

test("一覧: 名前の昇順。規則に合わない名前・一時ファイル・他の拡張子は載せない", async () => {
  const r = await rig();
  try {
    await mkdir(r.dir);
    for (const f of ["zeta.patch.json", "alpha.patch.json", "UPPER.patch.json", "x.json", ".hidden.patch.json", "con.patch.json", ".alpha.ab12.tmp"]) {
      await writeFile(join(r.dir, f), "{}");
    }
    await mkdir(join(r.dir, "sub"));
    await writeFile(join(r.dir, "sub", "inner.patch.json"), "{}"); // 下位フォルダは使わない(DAT-30)
    const l = await r.store.list();
    assert.equal(l.ok, true);
    if (!l.ok) return;
    assert.deepEqual(l.value.map((i) => i.name), ["alpha", "zeta"]);
    assert.equal(l.value[0].bytes, 2);
    assert.deepEqual(await r.store.read("sub/inner"), { ok: false, error: "invalid_name" });
  } finally {
    await r.cleanup();
  }
});

test("削除: あれば消し、なければ not_found", async () => {
  const r = await rig();
  try {
    await r.store.write("p", DOC, false);
    assert.deepEqual(await r.store.remove("p"), { ok: true, value: null });
    assert.deepEqual(await r.store.remove("p"), { ok: false, error: "not_found" });
    assert.deepEqual(await readdir(r.dir), []);
  } finally {
    await r.cleanup();
  }
});

test("UTF-8 でないファイルは failed。BOM は取り除かずに返す", async () => {
  const r = await rig();
  try {
    await mkdir(r.dir);
    await writeFile(join(r.dir, "bin.patch.json"), Buffer.from([0xff, 0xfe, 0x00]));
    const b = await r.store.read("bin");
    assert.equal(b.ok, false);
    if (!b.ok) assert.equal(b.error, "failed");
    await writeFile(join(r.dir, "bom.patch.json"), Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]));
    const m = await r.store.read("bom");
    assert.equal(m.ok && m.value.text, "﻿{}");
  } finally {
    await r.cleanup();
  }
});
