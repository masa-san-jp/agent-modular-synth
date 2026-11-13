#!/usr/bin/env python3
"""機能別モジュール仕様の検査: ID重複・必須節・表の空欄・参照切れ・検証例の網羅・カタログ整合。"""
import re, os, sys, glob, json

ROOT = os.path.join(os.path.dirname(__file__), "..")
SPEC_DIR = os.path.join(ROOT, "specifications", "modules")
ERR, WARN = [], []
def err(m): ERR.append(m)

# --- リファレンスDBのID集合
ids = set()
for f in glob.glob(os.path.join(ROOT, "references", "db", "data", "records", "*.json")):
    r = json.load(open(f, encoding="utf-8"))
    ids |= {e["id"] for e in r["entities"]} | {x["id"] for x in r["facts"]}
for d in ("instruments", "modules"):
    for f in glob.glob(os.path.join(ROOT, "references", d, "*.json")):
        ids.add(json.load(open(f, encoding="utf-8"))["id"])
ids |= {json.load(open(f, encoding="utf-8"))["id"] for f in []}

STATUS = {"specified", "deferred", "out_of_scope"}
SECTIONS = ["1. 目的と範囲", "2. 由来と抽象化", "3. ポート", "4. パラメータ", "5. 内部状態と初期化・リセット",
            "6. 振る舞い", "7. 共通規約との関係", "8. 異常入力・境界・数値安定性", "9. 保存・復元・版互換",
            "10. 検証例", "11. 未確認・保留事項"]
KINDS = ["正常", "境界", "無効入力", "未接続", "リセット"]
ID_TOKEN = re.compile(r"\b(?:REF-\d{3}-\d{3}|F-\d{3}-\d{3}|I\d{3}|M\d{3}|S\d{3}|T-\d{3})\b")

def front_matter(text, path):
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m: err(f"{path}: フロントマターがない"); return {}, text
    fm = {}
    for line in m.group(1).splitlines():
        line = re.sub(r"\s+#.*$", "", line)
        if ":" not in line: continue
        k, v = line.split(":", 1); v = v.strip()
        if v.startswith("["): v = [x.strip() for x in v.strip("[]").split(",") if x.strip()]
        fm[k.strip()] = v
    return fm, text[m.end():]

def sections(body):
    parts = re.split(r"^## ", body, flags=re.M)[1:]
    out = {}
    for p in parts:
        head, _, content = p.partition("\n")
        out[head.strip()] = content
    return out

def table_rows(content):
    rows = [l for l in content.splitlines() if l.strip().startswith("|")]
    return [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows[2:]] if len(rows) > 2 else []

common = open(os.path.join(SPEC_DIR, "common.md"), encoding="utf-8").read()
com_ids = set(re.findall(r"^## (COM-\d\d)", common, re.M))

seen = {}
specs = {}
for path in sorted(glob.glob(os.path.join(SPEC_DIR, "MOD-*.md"))):
    name = os.path.basename(path)
    text = open(path, encoding="utf-8").read()
    fm, body = front_matter(text, name)
    sid = fm.get("spec_id", "")
    if not re.fullmatch(r"MOD-[A-Z]+-\d{3}", sid): err(f"{name}: spec_id 形式不正 '{sid}'")
    if name != f"{sid}.md": err(f"{name}: ファイル名と spec_id が不一致")
    if sid in seen: err(f"{name}: spec_id 重複 {sid}")
    seen[sid] = name; specs[sid] = fm
    st = fm.get("status")
    if st not in STATUS: err(f"{name}: status 不正 '{st}'"); continue
    for k in ("title", "category", "version", "refs", "common"):
        if not fm.get(k): err(f"{name}: フロントマター '{k}' が空")
    for r in fm.get("refs", []):
        if r not in ids: err(f"{name}: refs の参照切れ {r}")
    for c in fm.get("common", []):
        if c not in com_ids: err(f"{name}: common の参照切れ {c}")
    sec = sections(body)
    for s in SECTIONS:
        if s not in sec: err(f"{name}: 節 '{s}' がない"); continue
        if not sec[s].strip(): err(f"{name}: 節 '{s}' が空")
    if st != "specified": continue
    # 本文中の COM 参照
    for c in set(re.findall(r"COM-\d\d", body)):
        if c not in com_ids: err(f"{name}: 本文の COM 参照切れ {c}")
    # 表の空欄
    for s, minrows, cols in (("3. ポート", 1, 8), ("2. 由来と抽象化", 1, 4), ("10. 検証例", 3, 6)):
        c = sec.get(s, "")
        rows = table_rows(c)
        if len(rows) < minrows and "該当なし" not in c: err(f"{name}: 節 '{s}' の表が不足(行数 {len(rows)})")
        for r in rows:
            if len(r) != cols: err(f"{name}: 節 '{s}' の表で列数不一致 {r[:1]}")
            elif any(x == "" for x in r): err(f"{name}: 節 '{s}' の表に空欄 {r[:1]}")
    # パラメータ表(空でもよいが「該当なし」要)
    c4 = sec.get("4. パラメータ", "")
    rows4 = table_rows(c4)
    if not rows4 and "該当なし" not in c4: err(f"{name}: §4 が空(パラメータなしなら『該当なし』と理由)")
    for r in rows4:
        if len(r) != 7 or any(x == "" for x in r): err(f"{name}: §4 の表の列/空欄 {r[:1]}")
    # [R] は根拠ID必須
    for r in table_rows(sec.get("2. 由来と抽象化", "")):
        if len(r) == 4 and r[1] == "[R]" and not ID_TOKEN.search(r[3]): err(f"{name}: §2 の [R] に根拠IDがない {r[0]}")
        if len(r) == 4 and r[1] not in ("[R]", "[A]", "[X]"): err(f"{name}: §2 の種別が不正 {r[1]}")
    for tok in set(ID_TOKEN.findall(sec.get("2. 由来と抽象化", ""))):
        if tok not in ids: err(f"{name}: §2 の参照切れ {tok}")
    # 検証例
    c10 = sec.get("10. 検証例", "")
    tvs = table_rows(c10)
    tvids = [r[0] for r in tvs if r]
    for t in tvids:
        if not re.fullmatch(rf"TV-{re.escape(sid)}-\d{{2}}", t): err(f"{name}: 検証例ID形式不正 {t}")
    if len(set(tvids)) != len(tvids): err(f"{name}: 検証例ID重複")
    kinds = {r[1] for r in tvs if len(r) > 1}
    need = KINDS + (["保存復元"] if fm.get("stateful") == "true" else [])
    for k in need:
        if k not in kinds and not re.search(rf"該当しない[:：].*{k}|{k}[^\n]*該当しない", c10):
            err(f"{name}: 検証例に種別 '{k}' がない(該当しないなら理由を書く)")
    if re.search(r"TODO|TBD|XXX", body.replace("MOD-XXX-000", "")): err(f"{name}: TODO/TBD/XXX が残っている")

# --- カタログ整合
cat = open(os.path.join(SPEC_DIR, "catalog.md"), encoding="utf-8").read()
cat_ids = {}
for m in re.finditer(r"^\| (MOD-[A-Z]+-\d{3}) \|.*?\| (specified|deferred|out_of_scope) \|", cat, re.M):
    cat_ids[m.group(1)] = m.group(2)
for sid, st in cat_ids.items():
    if sid not in specs: err(f"catalog: {sid} の仕様ファイルがない")
    elif specs[sid].get("status") != st: err(f"catalog: {sid} の状態が不一致(カタログ {st} / 仕様 {specs[sid].get('status')})")
for sid in specs:
    if sid not in cat_ids: err(f"{sid}: カタログに載っていない")
for tok in set(re.findall(r"REF-\d{3}-\d{3}", cat)):
    if tok not in ids: err(f"catalog: 参照切れ {tok}")

# --- Markdown内部リンク
for f in glob.glob(os.path.join(SPEC_DIR, "*.md")):
    for l in re.findall(r"\]\(([^)#\s]+)\)", open(f, encoding="utf-8").read()):
        if l.startswith("http"): continue
        if not os.path.exists(os.path.normpath(os.path.join(os.path.dirname(f), l))): err(f"{os.path.basename(f)}: リンク切れ {l}")

n_spec = sum(1 for v in specs.values() if v.get("status") == "specified")
print(f"仕様ファイル {len(specs)}(specified {n_spec})/ カタログ {len(cat_ids)} / DB-ID {len(ids)}")
if ERR:
    print(f"NG: {len(ERR)} 件")
    for m in ERR: print(" -", m)
    sys.exit(1)
print("OK: 検査エラーなし")
