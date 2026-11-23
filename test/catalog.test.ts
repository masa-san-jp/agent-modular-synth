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
  assert.equal(catalog.size, 19);
});

// ---- 分類・単位・未接続時の値・列挙の選択肢(CMD-01。仕様から生成した表 src/modules/meta.generated.ts) ----

test("生成した付随情報(meta.generated.ts)は、今の仕様から作り直したものと一致する", async () => {
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync("python3", [join(root, "tools", "build_module_meta.py"), "--check"], { encoding: "utf8" });
  assert.match(out, /^OK/);
});

test("全19種別: 分類は仕様のフロントマター、ポートの単位と未接続時の値は仕様 §3 と実装の両方に一致する", async () => {
  const { REGISTRY: reg } = await import("../src/modules/registry.js");
  let ports = 0;
  for (const info of catalog.values()) {
    const md = readFileSync(join(root, "specifications", "modules", `${info.type}.md`), "utf8");
    assert.equal(info.category, md.match(/^category:\s*(\S+)/m)![1], `${info.type} の分類`);
    const def = reg.get(info.type)!(48000).def;
    const spec = new Map<string, { unit: string; un: string }>();
    for (const r of rows(section(md, "3. "))) {
      if (r.length < 8) continue;
      for (const n of names(r[0]!)) spec.set(n, { unit: r[4]!, un: r[7]! });
    }
    for (const p of [...info.inputs, ...info.outputs]) {
      const sp = spec.get(p.name)!;
      assert.ok(sp.unit.replace(/`/g, "").startsWith(p.unit), `${info.type}.${p.name} の単位「${p.unit}」は仕様「${sp.unit}」の先頭`);
      assert.ok(p.unit.length > 0);
      ports++;
    }
    for (const p of info.outputs) assert.equal(p.unconnected, null, `${info.type}.${p.name}: 出力は null`);
    for (const p of info.inputs) {
      const u = p.unconnected!;
      const engine = def.inputs.find((d) => d.name === p.name)!.unconnected ?? 0;
      // 定数なら、実装(エンジンの定義)の値と一致する。内部接続・メッセージ入力は value が null
      if (u.value !== null) {
        assert.equal(u.value, engine, `${info.type}.${p.name} の未接続時の値`);
        assert.equal(u.normal, null);
        assert.ok(spec.get(p.name)!.un.replace(/[−`]/g, (c) => (c === "−" ? "-" : "")).includes(`${u.value} V`), `${info.type}.${p.name}: 仕様の未接続時「${spec.get(p.name)!.un}」`);
      } else if (u.normal !== null) {
        assert.ok(spec.get(p.name)!.un.includes(`normal=${u.normal}`), `${info.type}.${p.name}`);
      }
    }
  }
  assert.equal(ports, 100, `照合したポート ${ports}`);
  // 定数でない入力は、この3つだけ
  const special: string[] = [];
  for (const info of catalog.values()) for (const p of info.inputs) if (p.unconnected!.value === null) special.push(`${info.type}.${p.name}=${p.unconnected!.normal}`);
  assert.deepEqual(special.sort(), ["MOD-IO-001.IN_R=IN_L", "MOD-IO-002.MIDI=null", "MOD-RND-001.IN=NOISE[n]"]);
});

test("module.list_types(CMD-01): category・単位・未接続時の値が埋まり、列挙型は kind: enum と values を持つ", async () => {
  const { listTypes } = await import("../src/control/envelope.js");
  const out = listTypes(catalog, {}, "MOD-IO-001", "MOD-IO-003", ["level"]);
  assert.ok("types" in out);
  if (!("types" in out)) return;
  type P = { name: string; kind: string; unit: string | null; min: number; max: number; default: number; values?: { value: number; label: string }[] };
  type T = { type: string; category: string; ports: { name: string; direction: string; unit: string; unconnected: unknown }[]; params: P[] };
  const types = out.types as unknown as T[];
  const enums: string[] = [];
  for (const t of types) {
    assert.equal(typeof t.category, "string");
    assert.ok(t.category.length > 0);
    for (const p of t.ports) {
      assert.equal(typeof p.unit, "string", `${t.type}.${p.name}`);
      assert.equal(p.unconnected === null, p.direction === "out", `${t.type}.${p.name}`);
    }
    for (const p of t.params) {
      assert.ok(["float", "int", "enum", "bool"].includes(p.kind), `${t.type}.${p.name}: ${p.kind}`);
      if (p.kind === "enum") {
        enums.push(`${t.type}.${p.name}`);
        // 選択肢は範囲のすべての整数を、重複なく覆う
        assert.deepEqual(p.values!.map((v) => v.value), Array.from({ length: p.max - p.min + 1 }, (_, i) => p.min + i));
        for (const v of p.values!) assert.ok(v.label.length > 0);
        assert.equal(p.unit, null);
      } else {
        assert.equal("values" in p, false, `${t.type}.${p.name}`);
        if (p.kind === "bool") assert.equal(p.unit, null);
        else if (p.name !== "seed") assert.equal(typeof p.unit, "string", `${t.type}.${p.name} の単位`);
      }
    }
  }
  assert.deepEqual(enums.sort(), ["MOD-AMP-001.response", "MOD-FNC-001.response", "MOD-IO-003.trig_mode", "MOD-SAT-001.mode"]);
  const amp = types.find((t) => t.type === "MOD-AMP-001")!.params.find((p) => p.name === "response")!;
  assert.deepEqual(amp.values, [{ value: 0, label: "線形" }, { value: 1, label: "指数" }]);
  assert.equal(types.find((t) => t.type === "MOD-OSC-001")!.category, "oscillator");
  assert.deepEqual(types.find((t) => t.type === "MOD-CLK-001")!.ports.find((p) => p.name === "run")!.unconnected, { value: 10, normal: null });
});
