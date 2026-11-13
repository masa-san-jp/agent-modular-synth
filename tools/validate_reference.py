#!/usr/bin/env python3
"""リファレンスDBの検査: 必須項目・ID重複・参照切れ・列挙値・確認済み事実の根拠。"""
import json, re, sys, glob, os
from collections import Counter

ROOT = os.path.join(os.path.dirname(__file__), "..", "references", "db", "data")
ERR = []
def err(m): ERR.append(m)

def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)

CAT = {"hardware_modular","semi_modular","software_modular","software_environment"}
ERA = {"historical","current"}
TSTAT = {"confirmed","insufficient_sources","out_of_scope"}
KIND = {"system","module","signal_standard","patch_storage","control_interface"}
FCAT = {"oscillator","noise","filter","waveshaper","amplifier_mixer","envelope","lfo","modulation_other","clock_sequencer","random_logic","time_effect","io_utility","routing","system","other"}
SIG = {"audio","cv","gate","trigger","clock","event","other","unknown"}
BASIS = {"manufacturer_doc","api_doc","licensed_source","third_party","measurement","advertising"}
CONF = {"high","medium","low"}
DOCT = {"manufacturer_manual","spec","api_doc","source_code","third_party","other"}
RS = {"confirmed","unconfirmed"}
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MECH = ("patching","timing","state_save","external_control")

def req(obj, keys, ctx):
    for k in keys:
        if k not in obj or obj[k] in ("", None) and k not in NULLABLE:
            err(f"{ctx}: 必須項目 '{k}' が未設定")
NULLABLE = {"version","range","default","relations","mechanisms"}

def main():
    targets = load(os.path.join(ROOT, "targets.json"))["targets"]
    only = set(sys.argv[1:])  # 引数があればその対象のみ検査(作業中用)
    tids = [t["id"] for t in targets]
    for d, c in Counter(tids).items():
        if c > 1: err(f"対象ID重複: {d}")
    for t in targets:
        req(t, ["id","name","maker","category","era","selection_reason","status","status_note"], f"target {t.get('id')}")
        if not re.fullmatch(r"T-\d{3}", t.get("id","")): err(f"対象ID形式不正: {t.get('id')}")
        if t.get("category") not in CAT: err(f"{t['id']}: category 不正")
        if t.get("era") not in ERA: err(f"{t['id']}: era 不正")
        if t.get("status") not in TSTAT: err(f"{t['id']}: status 不正")

    all_ent, all_fact, all_src = {}, {}, {}
    stats = Counter()
    for t in targets:
        tid = t["id"]; num = tid[2:]
        if only and tid not in only: continue
        rp = os.path.join(ROOT,"records",f"{tid}.json"); sp = os.path.join(ROOT,"sources",f"{tid}.json")
        if t["status"] == "out_of_scope" and not os.path.exists(rp):
            continue
        if not os.path.exists(rp) or not os.path.exists(sp):
            err(f"{tid}: records/sources ファイルがない (状態={t['status']})"); continue
        rec, srcs = load(rp), load(sp)
        if rec.get("target_id") != tid: err(f"{tid}: records.target_id 不一致")
        sids = set()
        for s in srcs.get("sources", []):
            req(s, ["id","title","publisher","url","doc_version","doc_type","accessed_on","checked_scope","link_status","license_note"], f"source {s.get('id')}")
            if not re.fullmatch(rf"SRC-{num}-\d{{2}}", s.get("id","")): err(f"出典ID形式不正: {s.get('id')}")
            if s["id"] in all_src: err(f"出典ID重複: {s['id']}")
            all_src[s["id"]] = s; sids.add(s["id"])
            if s.get("doc_type") not in DOCT: err(f"{s['id']}: doc_type 不正")
            if not DATE.match(s.get("accessed_on","")): err(f"{s['id']}: accessed_on 形式不正")
            if s.get("link_status") not in {"ok","unreachable"}: err(f"{s['id']}: link_status 不正")
        fids, eids = set(), set()
        for e in rec.get("entities", []):
            req(e, ["id","kind","name","maker","function_category","purpose","status"], f"entity {e.get('id')}")
            if not re.fullmatch(rf"REF-{num}-\d{{3}}", e.get("id","")): err(f"エンティティID形式不正: {e.get('id')}")
            if e["id"] in all_ent: err(f"エンティティID重複: {e['id']}")
            all_ent[e["id"]] = e; eids.add(e["id"])
            if e.get("kind") not in KIND: err(f"{e['id']}: kind 不正")
            if e.get("function_category") not in FCAT: err(f"{e['id']}: function_category 不正")
            if e.get("version") is None and e.get("version_status") != "unconfirmed":
                err(f"{e['id']}: version が null なら version_status=unconfirmed が必要")
            for p in e.get("ports", []):
                if p.get("signal_type") not in SIG: err(f"{e['id']} port {p.get('name')}: signal_type 不正")
                if p.get("direction") not in {"in","out"}: err(f"{e['id']} port {p.get('name')}: direction 不正")
                if p.get("range_status") not in RS: err(f"{e['id']} port {p.get('name')}: range_status 不正")
                if p.get("range_status") == "unconfirmed" and p.get("range") is not None:
                    err(f"{e['id']} port {p.get('name')}: 未確認なのに range に値がある")
                if p.get("range_status") == "confirmed" and not p.get("fact_ids"):
                    err(f"{e['id']} port {p.get('name')}: 確認済みなのに fact_ids がない")
            for p in e.get("params", []):
                for k in ("range","default"):
                    st = p.get(k+"_status")
                    if st not in RS: err(f"{e['id']} param {p.get('name')}: {k}_status 不正")
                    if st == "unconfirmed" and p.get(k) is not None: err(f"{e['id']} param {p.get('name')}: 未確認なのに {k} に値")
                    if st == "confirmed" and not p.get("fact_ids"): err(f"{e['id']} param {p.get('name')}: 確認済みなのに fact_ids がない")
            for m, v in (e.get("mechanisms") or {}).items():
                if m not in MECH: err(f"{e['id']}: mechanisms.{m} 未定義キー")
                if v is not None and not v.get("fact_ids"): err(f"{e['id']}: mechanisms.{m} に fact_ids がない")
        for f in rec.get("facts", []):
            req(f, ["id","entity_id","topic","statement","basis","confidence","source_id","locator","verified_on"], f"fact {f.get('id')}")
            if not re.fullmatch(rf"F-{num}-\d{{3}}", f.get("id","")): err(f"事実ID形式不正: {f.get('id')}")
            if f["id"] in all_fact: err(f"事実ID重複: {f['id']}")
            all_fact[f["id"]] = f; fids.add(f["id"])
            if f.get("entity_id") not in eids: err(f"{f['id']}: entity_id 参照切れ {f.get('entity_id')}")
            if f.get("source_id") not in sids: err(f"{f['id']}: source_id 参照切れ {f.get('source_id')}")
            if f.get("basis") not in BASIS: err(f"{f['id']}: basis 不正")
            if f.get("confidence") not in CONF: err(f"{f['id']}: confidence 不正")
            if not DATE.match(f.get("verified_on","")): err(f"{f['id']}: verified_on 形式不正")
            if len(f.get("statement","")) > 600: err(f"{f['id']}: statement が長すぎる(転載の疑い)")
        # fact_ids 参照切れ
        def chk(ids, ctx):
            for i in ids or []:
                if i not in fids: err(f"{ctx}: fact_ids 参照切れ {i}")
        for e in rec.get("entities", []):
            for p in e.get("ports", []) + e.get("params", []): chk(p.get("fact_ids"), e["id"])
            for m, v in (e.get("mechanisms") or {}).items():
                if v: chk(v.get("fact_ids"), e["id"])
            for k in ("features","constraints"):
                for it in e.get(k, []):
                    if isinstance(it, dict): chk(it.get("fact_ids"), e["id"])
                    if isinstance(it, dict) and not it.get("fact_ids"): err(f"{e['id']}: {k} の項目に fact_ids がない")
            for k, v in (e.get("relations") or {}).items():
                if v and v not in eids: err(f"{e['id']}: relations.{k} 参照切れ {v}")
        for u in rec.get("unconfirmed", []):
            req(u, ["item","tried_sources","impact_on_spec"], f"{tid} unconfirmed")
            for s in u.get("tried_sources", []):
                if s not in sids: err(f"{tid} unconfirmed: tried_sources 参照切れ {s}")
            if u.get("entity_id") and u["entity_id"] not in eids: err(f"{tid} unconfirmed: entity_id 参照切れ")
        # 重複検出
        c = Counter((e["maker"], e["name"], e.get("version")) for e in rec.get("entities", []) if e.get("status")!="retired")
        for k, n in c.items():
            if n > 1: err(f"{tid}: 製品/モジュール/版の重複 {k}")
        if t["status"] == "confirmed" and not rec.get("facts"): err(f"{tid}: confirmed なのに事実がない")
        stats["entities"] += len(rec.get("entities",[])); stats["facts"] += len(rec.get("facts",[]))
        stats["sources"] += len(srcs.get("sources",[])); stats["unconfirmed"] += len(rec.get("unconfirmed",[]))
    stats["targets"] = len(targets)
    print("集計:", dict(stats))
    if ERR:
        print(f"NG: {len(ERR)} 件")
        for m in ERR: print(" -", m)
        sys.exit(1)
    print("OK: 検査エラーなし")

if __name__ == "__main__":
    main()
