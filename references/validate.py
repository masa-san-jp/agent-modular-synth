"""Offline structural checks for the reference database; Python standard library only."""
import json, pathlib, re
root = pathlib.Path(__file__).resolve().parent
sources = json.loads((root / "sources/catalog.json").read_text())
records = [json.loads(p.read_text()) for d in ("instruments", "modules") for p in sorted((root/d).glob("*.json"))]
def require(condition, message):
    if not condition: raise ValueError(message)
ids = [x["id"] for x in sources + records]
require(len(ids) == len(set(ids)), "duplicate ID")
src = {s["id"]: s for s in sources}
rid = {r["id"] for r in records}
for s in sources:
    for k in ("id","publisher","title","url","version","sections","checked_on","scope","access_status","evidence_type","reuse"):
        require(k in s and bool(s[k]), f"{s['id']}: missing {k}")
    require(s["access_status"] in ("accessed","unavailable"), "invalid access status")
    require(s["url"].startswith("https://"), "source URL")
seen = set()
for r in records:
    for k in ("id","name","maker","kind","version","parent_id","categories","status","facts","unknowns","rights"):
        require(k in r, f"{r['id']}: missing {k}")
    key = (r["maker"].casefold(), r["name"].casefold(), r["version"].casefold())
    require(key not in seen, "duplicate product/name/version")
    seen.add(key)
    require(r["parent_id"] is None or r["parent_id"] in rid, "broken parent")
    require(r["status"] in ("documented_partial","unavailable"), "status")
    require(bool(r["unknowns"]), "unknowns required")
    for f in r["facts"]:
        require(all(k in f for k in ("topic","value","evidence","certainty")), "fact missing field")
        e=f["evidence"]
        require(e["source_id"] in src and bool(e["section"]), "broken source/section")
        require(src[e["source_id"]]["access_status"] == "accessed", "unread source as evidence")
        require(f["certainty"] == "documented_not_measured", "evidence certainty")
for p in list(root.glob("*.md")) + [root.parent/"README.md"]:
    for link in re.findall(r"\]\(([^)]+)\)", p.read_text()):
        if "://" in link or link.startswith("#"): continue
        require((p.parent/link.split("#")[0]).exists(), f"broken local link {p}: {link}")
print(f"PASS: {len(records)} records; {len(sources)} sources; unique IDs, fields, references, duplicate keys and local Markdown links")
