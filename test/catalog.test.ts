// module.list_types の元になる定義(catalog)が、仕様 §3(ポート)・§4(パラメータ)と一致するかを機械的に確認する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildCatalog } from "../src/control/catalog.js";
import { REGISTRY } from "../src/modules/registry.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const catalog = buildCatalog(REGISTRY);

function section(md: string, head: string): string {
  const i = md.indexOf(`\n## ${head}`);
  assert.ok(i >= 0, `節 ${head} がない`);
  const j = md.indexOf("\n## ", i + 4);
  return md.slice(i, j < 0 ? undefined : j);
}
function rows(sec: string): string[][] {
  const lines = sec.split("\n").filter((l) => l.trim().startsWith("|"));
  return lines.slice(2).map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
}
/** `cv[1]`〜`cv[16]` のような範囲表記、`a` / `b` のような併記を名前の一覧に展開する。 */
function names(cell: string): string[] {
  const c = cell.replace(/`/g, "");
  const m = c.match(/^([A-Za-z_0-9]+)\[(\d+)\]\s*[〜~]\s*\1\[(\d+)\]/);
  if (m) {
    const out: string[] = [];
    for (let i = Number(m[2]); i <= Number(m[3]); i++) out.push(`${m[1]}[${i}]`);
    return out;
  }
  // `cv[i] (i=1..16)` の形
  const k = c.match(/^([A-Za-z_0-9]+)\[i\]\s*[((]i=(\d+)\.\.(\d+)[))]/);
  if (k) {
    const out: string[] = [];
    for (let i = Number(k[2]); i <= Number(k[3]); i++) out.push(`${k[1]}[${i}]`);
    return out;
  }
  return c.split(/[、,/]/).map((s) => s.trim().split(/[\s((]/)[0]!).filter((s) => /^[A-Za-z_][A-Za-z_0-9\[\]]*$/.test(s));
}
const num = (s: string): number | null => {
  const t = s.replace(/[−–]/g, "-").replace(/\s/g, "").replace(/^\+/, "");
  if (!/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(t)) return null;
  return Number(t);
};

let checkedDefaults = 0;
let checkedRanges = 0;
let unparsed: string[] = [];

for (const info of catalog.values()) {
  test(`${info.type}: ポート名とパラメータ名・範囲・既定値が仕様と一致`, () => {
    const md = readFileSync(join(root, "specifications", "modules", `${info.type}.md`), "utf8");
    const ver = md.match(/^version:\s*(\S+)/m)![1];
    assert.equal(info.specVersion, ver, "仕様版");
    // §3 ポート
    const ins: string[] = [];
    const outs: string[] = [];
    for (const r of rows(section(md, "3. "))) {
      if (r.length < 2) continue;
      const dir = r[1]!;
      const ns = names(r[0]!);
      if (dir === "in") ins.push(...ns);
      else if (dir === "out") outs.push(...ns);
    }
    assert.deepEqual(info.inputs.map((p) => p.name).sort(), [...ins].sort(), "入力ポート名");
    assert.deepEqual(info.outputs.map((p) => p.name).sort(), [...outs].sort(), "出力ポート名");
    // §4 パラメータ
    const specParams = new Map<string, { range: string; def: string }>();
    for (const r of rows(section(md, "4. "))) {
      if (r.length < 4) continue;
      for (const n of names(r[0]!)) specParams.set(n, { range: r[2]!, def: r[3]! });
    }
    assert.deepEqual(info.params.map((p) => p.name).sort(), [...specParams.keys()].sort(), "パラメータ名");
    for (const p of info.params) {
      const sp = specParams.get(p.name)!;
      const d = num(sp.def.replace(/`/g, "").split(/[((]/)[0]!);
      if (d !== null) {
        assert.equal(p.default, d, `${p.name} の既定値`);
        checkedDefaults++;
      } else unparsed.push(`${info.type}.${p.name} 既定値「${sp.def}」`);
      const m = sp.range.replace(/`/g, "").match(/^\s*([-+−–]?\s*[\d.]+(?:e-?\d+)?)\s*[〜~]\s*([-+−–]?\s*[\d.]+(?:e-?\d+)?)/i);
      let lo = m ? num(m[1]!) : null;
      let hi = m ? num(m[2]!) : null;
      const rangeText = sp.range.replace(/`/g, "");
      if (lo === null && /^0\s*または\s*1/.test(rangeText)) {
        lo = 0;
        hi = 1;
      }
      const list = rangeText.match(/^((?:[-+−]?\d+\s*,\s*)+[-+−]?\d+)/); // 「-2, -1, 0, +1, +2」の形
      if (lo === null && list) {
        const vs = list[1]!.split(",").map((x) => num(x)!);
        lo = Math.min(...vs);
        hi = Math.max(...vs);
      }
      if (lo !== null && hi !== null && p.kind !== "seed") {
        assert.equal(p.min, lo, `${p.name} の下限`);
        assert.equal(p.max, hi, `${p.name} の上限`);
        checkedRanges++;
      } else if (p.kind !== "seed") unparsed.push(`${info.type}.${p.name} 範囲「${sp.range}」`);
    }
  });
}

test("仕様との照合の件数", () => {
  console.log(`照合: 既定値 ${checkedDefaults} 件、範囲 ${checkedRanges} 件。機械的に読めなかった表記 ${unparsed.length} 件`);
  for (const u of unparsed) console.log(`  未照合: ${u}`);
  assert.equal(catalog.size, 18);
});
