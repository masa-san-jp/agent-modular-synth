#!/usr/bin/env python3
"""DBから人が読める索引・比較表・不足一覧を生成する(事実本文は複製せず、ID参照とDB由来の要約文のみ)。"""
import json, os, glob
R = os.path.join(os.path.dirname(__file__), "..")
D = os.path.join(R, "references", "db", "data")
OUT = os.path.join(R, "references", "db", "docs")
def load(p): return json.load(open(p, encoding="utf-8"))
targets = load(os.path.join(D, "targets.json"))
T = targets["targets"]
rec = {t["id"]: load(f"{D}/records/{t['id']}.json") for t in T if os.path.exists(f"{D}/records/{t['id']}.json")}
src = {t["id"]: load(f"{D}/sources/{t['id']}.json")["sources"] for t in T if os.path.exists(f"{D}/sources/{t['id']}.json")}
CATJ = {"hardware_modular":"ハード モジュラー","semi_modular":"セミモジュラー","software_modular":"ソフト モジュラー","software_environment":"ソフト 環境"}
STJ = {"confirmed":"確認済み","insufficient_sources":"資料不足","out_of_scope":"対象外"}
FCJ = {"oscillator":"発振","noise":"ノイズ","filter":"フィルタ","waveshaper":"波形整形","amplifier_mixer":"増幅・ミックス","envelope":"エンベロープ","lfo":"LFO","modulation_other":"その他変調","clock_sequencer":"クロック・シーケンス","random_logic":"ランダム・論理","time_effect":"時間系","io_utility":"入出力・ユーティリティ","routing":"ルーティング"}
def w(name, text): open(os.path.join(OUT, name), "w", encoding="utf-8").write(text)

# --- 索引
L = ["# リファレンスDB 索引", "", "自動生成(`tools/build_reference_docs.py`)。事実の正本は `references/db/data/`。本書はDBへの入口で、事実本文を複製しない。", "",
     "## 対象一覧", "", "| 対象ID | 名称 | 種別 | 時代 | 状態 | エンティティ | 事実 | 出典 | 未確認 | DB |", "|---|---|---|---|---|---|---|---|---|---|"]
for t in T:
    r = rec.get(t["id"], {}); i = t["id"]
    L.append(f"| {i} | {t['name']} | {CATJ[t['category']]} | {'歴史的' if t['era']=='historical' else '現行'} | {STJ[t['status']]} | {len(r.get('entities',[]))} | {len(r.get('facts',[]))} | {len(src.get(i,[]))} | {len(r.get('unconfirmed',[]))} | [records](../data/records/{i}.json) / [sources](../data/sources/{i}.json) |")
L += ["", "## エンティティ索引", ""]
for t in T:
    r = rec.get(t["id"]);
    if not r: continue
    L += [f"### {t['id']} {t['name']}", "", f"選定理由: {t['selection_reason']}", "", "| ID | 種別 | 名称 | 機能カテゴリ | 事実数 |", "|---|---|---|---|---|"]
    fc = {}
    for f in r["facts"]: fc[f["entity_id"]] = fc.get(f["entity_id"], 0) + 1
    for e in r["entities"]:
        L.append(f"| {e['id']} | {e['kind']} | {e['name']} | {FCJ.get(e['function_category'], e['function_category'])} | {fc.get(e['id'],0)} |")
    L.append("")
L += ["## 出典台帳", "", "| 出典ID | 資料名 | 種別 | 版 | 確認日 | リンク状態 |", "|---|---|---|---|---|---|"]
for t in T:
    for s in src.get(t["id"], []):
        L.append(f"| {s['id']} | {s['title']} | {s['doc_type']} | {s['doc_version']} | {s['accessed_on']} | {s['link_status']} |")
L += ["", "URLと確認範囲・利用条件は各 `sources/<対象ID>.json` を参照。"]
w("index.md", "\n".join(L) + "\n")

# --- 比較表
L = ["# 機能比較表", "", "自動生成。各セルは根拠DBへ辿れるエンティティIDを示す。広告上の主張・第三者評価・実測・未確認は混同していない(事実の `basis` はDBで確認)。セルが「-」の項目は、調査したがモジュール単位で記録していない、またはその機種に該当しない。", "",
     "## 1. 機能カテゴリ別: 調査済みモジュール", "", "| 機能カテゴリ | " + " | ".join(t["id"] for t in T) + " |", "|---|" + "---|" * len(T)]
for fc, label in FCJ.items():
    row = []
    for t in T:
        es = [e for e in rec.get(t["id"], {}).get("entities", []) if e["kind"] == "module" and e["function_category"] == fc]
        row.append("<br>".join(f"{e['name']} ({e['id']})" for e in es) or "-")
    if any(c != "-" for c in row): L.append(f"| {label} | " + " | ".join(row) + " |")
L += ["", "## 2. 横断項目", "", "| 対象 | 種別 | 信号規約 | パッチ保存 | 外部制御・プログラム制御 |", "|---|---|---|---|---|"]
def refs(r, kind):
    es = [e for e in r.get("entities", []) if e["kind"] == kind]
    return "<br>".join(f"{e['id']} {e['name']}" for e in es) or "未記録"
for t in T:
    r = rec.get(t["id"], {})
    L.append(f"| {t['id']} {t['name']} | {CATJ[t['category']]} | {refs(r,'signal_standard')} | {refs(r,'patch_storage')} | {refs(r,'control_interface')} |")
L += ["", "## 3. 共通点と機種固有の差(DBから抽出した要約)", "", "各エンティティの `purpose` と特徴を以下に示す(自分の言葉の要約。根拠は `fact_ids` からDBへ)。", ""]
for t in T:
    r = rec.get(t["id"], {})
    for e in r.get("entities", []):
        if e["kind"] in ("signal_standard", "patch_storage", "control_interface"):
            ids = sorted({i for k in ("features", "constraints") for it in e.get(k, []) for i in it.get("fact_ids", [])})
            L.append(f"- **{e['id']} {e['name']}**: {e['purpose']} (根拠: {', '.join(ids[:6]) or '-'}{' ほか' if len(ids)>6 else ''})")
w("comparison.md", "\n".join(L) + "\n")

# --- 不足一覧
L = ["# 不足・未確認一覧と次段への引継ぎ", "", "自動生成。#2(機能別仕様)が調査のやり直しなしに使える範囲と、保留すべき範囲を判断するための一覧。", "",
     "## 対象ごとの状態", "", "| 対象 | 状態 | 備考 |", "|---|---|---|"]
for t in T: L.append(f"| {t['id']} {t['name']} | {STJ[t['status']]} | {t['status_note']} |")
L += ["", "## 未確認項目", ""]
for t in T:
    r = rec.get(t["id"], {});
    if not r.get("unconfirmed"): continue
    L += [f"### {t['id']} {t['name']}", "", "| 対象エンティティ | 不足項目 | 試した資料 | 仕様化への影響 |", "|---|---|---|---|"]
    for u in r["unconfirmed"]:
        L.append(f"| {u.get('entity_id','(対象全体)')} | {u['item']} | {', '.join(u['tried_sources'])} | {u['impact_on_spec']} |")
    L.append("")
L += ["## アクセス不能だった資料", "", "| 出典ID | 資料 | URL |", "|---|---|---|"]
for t in T:
    for s in src.get(t["id"], []):
        if s["link_status"] != "ok": L.append(f"| {s['id']} | {s['title']} | {s['url']} |")
w("gaps.md", "\n".join(L) + "\n")
print("生成: index.md comparison.md gaps.md")
