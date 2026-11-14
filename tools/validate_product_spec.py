#!/usr/bin/env python3
"""#3 製品仕様群の検査: ID定義の重複、内部参照切れ、要求→検証→タスクの網羅、相対リンク。"""
import re, os, sys, glob, json
R = os.path.join(os.path.dirname(__file__), "..")
FILES = sorted(glob.glob(os.path.join(R, "specifications/synthesizer/*.md"))) + sorted(glob.glob(os.path.join(R, "plans/*.md")))
ERR = []
PAT = {
 "REQ": r"REQ-(?:F|A|S|NF|X)-\d{3}", "VER": r"VER-(?:F|A|S|NF)-\d{3}[a-z]?", "CMD": r"CMD-\d{2}", "ERR": r"ERR-\d{3}",
 "EVT": r"EVT-\d{2}", "DEC": r"DEC-\d{3}", "OPEN": r"OPEN-\d{3}", "TASK": r"TASK-\d{3,4}", "AX": r"AX-\d{2}[a-z]?",
 "DX": r"DX-\d{2}", "DATV": r"DAT-V\d{2}", "DAT": r"DAT-\d{2}", "SC": r"SC-[HAX]\d",
}
HOME = {"REQ": "requirements.md", "VER": "verification-plan.md", "CMD": "operation-contract.md", "ERR": "operation-contract.md",
        "EVT": "operation-contract.md", "AX": "operation-contract.md", "DAT": "data-contract.md", "DATV": "data-contract.md",
        "DX": "data-contract.md", "DEC": "decisions.md", "OPEN": "decisions.md", "TASK": "implementation-plan.md", "SC": "product-spec.md"}
text = {f: open(f, encoding="utf-8").read() for f in FILES}
defined = {k: {} for k in PAT}
for f, t in text.items():
    for line in t.splitlines():
        s = line.strip()
        # 定義: 正本ファイルで、表の先頭2セル、または見出し・箇条書きの先頭(太字可)にIDがある行
        cands = []
        if s.startswith("|"):
            cells = [c.strip().strip("*`") for c in s.strip("|").split("|")][:2]
            cands = cells
        else:
            m = re.match(r"^(?:#+\s*|[-*]\s*)\**`?([A-Z]+-[A-Za-z0-9-]+?)`?\**(?=[\s::(（〜]|$)", s)
            if m: cands = [m.group(1)]
        for tok in cands:
            for k, p in PAT.items():
                if re.fullmatch(p, tok):
                    if os.path.basename(f) == HOME[k]: defined[k].setdefault(tok, f)
                    break
FUTURE = {"VER-NF-004b", "VER-NF-005b", "VER-NF-007l"}  # 目標決定後に追加すると明記された将来の小項目
# 外部ID
ext = set()
for f in glob.glob(os.path.join(R, "references/db/data/records/*.json")):
    r = json.load(open(f, encoding="utf-8")); ext |= {x["id"] for x in r["facts"]} | {e["id"] for e in r["entities"]}
mods = {os.path.basename(p)[:-3] for p in glob.glob(os.path.join(R, "specifications/modules/MOD-*.md"))}
coms = set(re.findall(r"^## (COM-\d\d)", open(os.path.join(R, "specifications/modules/common.md"), encoding="utf-8").read(), re.M))
tvs = set()
for p in glob.glob(os.path.join(R, "specifications/modules/MOD-*.md")): tvs |= set(re.findall(r"^\| (TV-MOD-[A-Z]+-\d{3}-\d{2})", open(p, encoding="utf-8").read(), re.M))

def expand(t, p):
    """ 'VER-F-001〜003' 'CMD-14〜16' の範囲表記を展開 """
    out = set(re.findall(p, t))
    return out
for f, t in text.items():
    b = os.path.basename(f)
    for k, p in PAT.items():
        for tok in set(re.findall(r"(?<![A-Za-z0-9-])" + p + r"(?![0-9])", t)):
            if k == "DAT" and re.fullmatch(PAT["DATV"], tok): continue
            base = tok
            if tok not in defined[k]:
                if k == "AX" and any(d.startswith(tok) for d in defined[k]): continue   # AX-02 は AX-02a〜 の総称
                if k == "VER" and tok in FUTURE: continue
                ERR.append(f"{b}: 未定義ID {tok}")
    for tok in set(re.findall(r"\bF-\d{3}-\d{3}\b", t)):
        if tok not in ext: ERR.append(f"{b}: DBに無い事実ID {tok}")
    for tok in set(re.findall(r"\bMOD-[A-Z]+-\d{3}\b", t)):
        if tok not in mods and tok != "MOD-XYZ-999": ERR.append(f"{b}: 未定義のモジュール仕様 {tok}")
    for tok in set(re.findall(r"\bCOM-\d\d\b", t)):
        if tok not in coms: ERR.append(f"{b}: 未定義の共通規約 {tok}")
    for tok in set(re.findall(r"\bTV-MOD-[A-Z]+-\d{3}-\d{2}\b", t)):
        if tok not in tvs: ERR.append(f"{b}: 未定義の検証例 {tok}")
    for l in re.findall(r"\]\(([^)#\s]+)(?:#[^)]*)?\)", t):
        if l.startswith("http") or not re.search(r"\.(md|json)$|/", l): continue
        if not os.path.exists(os.path.normpath(os.path.join(os.path.dirname(f), l))): ERR.append(f"{b}: リンク切れ {l}")
# 網羅: 初期版REQ → VER → TASK
req = [r for r in defined["REQ"] if not r.startswith("REQ-X")]
ver_text = text[[f for f in FILES if f.endswith("verification-plan.md")][0]]
plan_text = text[[f for f in FILES if f.endswith("implementation-plan.md")][0]]
for r in sorted(req):
    v = r.replace("REQ-", "VER-")
    if v not in defined["VER"]: ERR.append(f"網羅: {r} に対応する {v} が検証計画にない")
    if r not in plan_text: ERR.append(f"網羅: {r} が実装計画に現れない")
print("定義数:", {k: len(v) for k, v in defined.items()}, "/ TV", len(tvs))
if ERR:
    print(f"NG: {len(ERR)} 件")
    for e in sorted(set(ERR)): print(" -", e)
    sys.exit(1)
print("OK: 検査エラーなし")
