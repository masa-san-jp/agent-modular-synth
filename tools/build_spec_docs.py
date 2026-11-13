#!/usr/bin/env python3
"""仕様から追跡表(仕様ID→リファレンスID→出典)・仮定一覧・保留一覧を生成する。"""
import re, os, glob, json
R = os.path.join(os.path.dirname(__file__), "..")
SD = os.path.join(R, "specifications", "modules")
facts, ents, srcs = {}, {}, {}
for f in glob.glob(os.path.join(R, "references/db/data/records/*.json")):
    r = json.load(open(f, encoding="utf-8"))
    for x in r["facts"]: facts[x["id"]] = x
    for e in r["entities"]: ents[e["id"]] = e
for f in glob.glob(os.path.join(R, "references/db/data/sources/*.json")):
    for s in json.load(open(f, encoding="utf-8"))["sources"]: srcs[s["id"]] = s
curated = {}
for d in ("instruments", "modules"):
    for f in glob.glob(os.path.join(R, "references", d, "*.json")):
        j = json.load(open(f, encoding="utf-8")); curated[j["id"]] = j

def parse(path):
    t = open(path, encoding="utf-8").read()
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", t, re.S); fm = {}
    for line in m.group(1).splitlines():
        line = re.sub(r"\s+#.*$", "", line)
        if ":" in line:
            k, v = line.split(":", 1); v = v.strip()
            fm[k.strip()] = [x.strip() for x in v.strip("[]").split(",") if x.strip()] if v.startswith("[") else v
    secs = {h.partition("\n")[0].strip(): h.partition("\n")[2] for h in re.split(r"^## ", m.group(2), flags=re.M)[1:]}
    return fm, secs
def rows(c):
    r = [l for l in c.splitlines() if l.strip().startswith("|")]
    return [[x.strip() for x in l.strip().strip("|").split("|")] for l in r[2:]]

specs = {}
for p in sorted(glob.glob(os.path.join(SD, "MOD-*.md"))):
    fm, secs = parse(p); specs[fm["spec_id"]] = (fm, secs)
TOK = re.compile(r"\b(?:REF-\d{3}-\d{3}|F-\d{3}-\d{3}|I\d{3}|M\d{3})\b")

# 追跡表
L = ["# 追跡表: 仕様ID → リファレンスID → 出典", "", "自動生成(`tools/build_spec_docs.py`)。仕様本文の §2 の根拠IDと、DBの事実が持つ出典ID・節を結ぶ。DBの事実本文は複製しない。", "",
     "| 仕様ID | 名称 | 参照リファレンス(フロントマター) | [R] 件数 | [A] 件数 | [X] 件数 |", "|---|---|---|---|---|---|"]
for sid, (fm, secs) in specs.items():
    rs = rows(secs["2. 由来と抽象化"]); c = {k: sum(1 for r in rs if r[1] == k) for k in ("[R]", "[A]", "[X]")}
    L.append(f"| [{sid}]({sid}.md) | {fm['title']} | {', '.join(fm['refs'])} | {c['[R]']} | {c['[A]']} | {c['[X]']} |")
L += ["", "## [R](原著の事実)ごとの出典", ""]
for sid, (fm, secs) in specs.items():
    L += [f"### {sid} {fm['title']}", "", "| 記述ID | 根拠ID | 出典ID | 節・箇所 | 根拠の種別/確度 |", "|---|---|---|---|---|"]
    for r in rows(secs["2. 由来と抽象化"]):
        if r[1] != "[R]": continue
        for tok in dict.fromkeys(TOK.findall(r[3])):
            if tok in facts:
                f = facts[tok]; L.append(f"| {r[0]} | {tok} | {f['source_id']} | {f['locator']} | {f['basis']}/{f['confidence']} |")
            elif tok in curated:
                c = curated[tok]; L.append(f"| {r[0]} | {tok} | (精査済みDB) | {c.get('name','')} | 精査済みレコード |")
            elif tok in ents:
                L.append(f"| {r[0]} | {tok} | (エンティティ) | {ents[tok]['name']} | - |")
    L.append("")
open(os.path.join(SD, "traceability.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")

# 仮定一覧
L = ["# 設計仮定[A]・抽象化[X]の一覧と判断記録", "", "自動生成。各仕様 §2 の [A]/[X] 行を集約する。資料が一意に定めない部分をこの仕様で決めたもの。#3 で見直せる。根拠となる原著の事実は [traceability](traceability.md) を参照。", ""]
for sid, (fm, secs) in specs.items():
    L += [f"## {sid} {fm['title']}", "", "| ID | 種別 | 記述 | 根拠・理由 |", "|---|---|---|---|"]
    for r in rows(secs["2. 由来と抽象化"]):
        if r[1] in ("[A]", "[X]"): L.append(f"| {sid}/{r[0]} | {r[1]} | {r[2]} | {r[3]} |")
    L.append("")
open(os.path.join(SD, "assumptions.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")

# 保留一覧
L = ["# 未確認・保留事項一覧(#3への引継ぎ)", "", "自動生成。各仕様 §11 を集約する。", ""]
for sid, (fm, secs) in specs.items():
    L += [f"## {sid} {fm['title']}", "", secs["11. 未確認・保留事項"].strip(), ""]
open(os.path.join(SD, "open-issues.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")
print("生成: traceability.md assumptions.md open-issues.md")
