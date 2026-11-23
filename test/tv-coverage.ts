// 検証例の網羅を確認する: 実装済みモジュール(REGISTRY)の仕様 §10 にある全 TV-ID が、
// test/ の tv("TV-…") として登録されているか。未登録があれば失敗する。
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REGISTRY } from "../src/modules/registry.js";

const here = dirname(fileURLToPath(import.meta.url)); // dist/test
const root = join(here, "..", "..");
const specDir = join(root, "specifications", "modules");
const testDir = join(root, "test");

const registered = new Set<string>();
for (const f of readdirSync(testDir)) {
  if (!f.endsWith(".ts")) continue;
  const src = readFileSync(join(testDir, f), "utf8");
  for (const m of src.matchAll(/\btv\(\s*"(TV-MOD-[A-Z]+-\d{3}-\d{2})"/g)) registered.add(m[1]!);
}

let missing = 0;
let total = 0;
for (const specId of [...REGISTRY.keys()].sort()) {
  const spec = readFileSync(join(specDir, `${specId}.md`), "utf8");
  const ids = [...spec.matchAll(/^\| (TV-MOD-[A-Z]+-\d{3}-\d{2}) \|/gm)].map((m) => m[1]!);
  const miss = ids.filter((id) => !registered.has(id));
  total += ids.length;
  missing += miss.length;
  console.log(`${specId}: 検証例 ${ids.length} 件、登録 ${ids.length - miss.length} 件${miss.length ? "、未登録: " + miss.join(", ") : ""}`);
}
const specIds = new Set([...REGISTRY.keys()]);
const stray = [...registered].filter((id) => !specIds.has(id.slice(3, id.lastIndexOf("-"))));
if (stray.length) console.log(`仕様にない検証例の登録: ${stray.join(", ")}`);
console.log(`検証例の網羅: ${total - missing}/${total}(実装済みモジュール ${REGISTRY.size} 種 / 仕様 20 種)`);
if (missing > 0 || stray.length > 0) process.exit(1);
