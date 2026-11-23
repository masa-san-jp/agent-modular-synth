#!/usr/bin/env python3
"""モジュール仕様(specifications/modules/MOD-*.md)から、module.list_types が返す付随情報を作る。

出力: src/modules/meta.generated.ts(分類、ポートの単位と未接続時の値、パラメータの単位、列挙型の選択肢)。
正本は仕様のフロントマター(category)と §3(ポート)・§4(パラメータ)。このファイルを手で直さない。

使い方:
  python3 tools/build_module_meta.py          # 生成する
  python3 tools/build_module_meta.py --check  # 生成済みのファイルが仕様と一致するかだけを調べる(不一致なら終了コード 1)
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPECS = ROOT / "specifications" / "modules"
OUT = ROOT / "src" / "modules" / "meta.generated.ts"


def section(md: str, head: str) -> str:
    i = md.index(f"\n## {head}")
    j = md.find("\n## ", i + 4)
    return md[i : j if j >= 0 else None]


def rows(sec: str):
    lines = [l for l in sec.split("\n") if l.strip().startswith("|")]
    out = []
    for l in lines[2:]:
        out.append([c.strip() for c in re.sub(r"^\||\|$", "", l.strip()).split("|")])
    return out


def names(cell: str):
    c = cell.replace("`", "")
    m = re.match(r"^([A-Za-z_0-9]+)\[(\d+)\]\s*[〜~]\s*\1\[(\d+)\]", c)
    if m:
        return [f"{m.group(1)}[{i}]" for i in range(int(m.group(2)), int(m.group(3)) + 1)]
    k = re.match(r"^([A-Za-z_0-9]+)\[i\]\s*[((]i=(\d+)\.\.(\d+)[))]", c)
    if k:
        return [f"{k.group(1)}[{i}]" for i in range(int(k.group(2)), int(k.group(3)) + 1)]
    out = []
    for s in re.split(r"[、,/]", c):
        t = re.split(r"[\s((]", s.strip())[0]
        if re.match(r"^[A-Za-z_][A-Za-z_0-9\[\]]*$", t):
            out.append(t)
    return out


def head(cell: str) -> str:
    """セルの先頭の語(最初の括弧・句点の前まで)。"""
    return re.split(r"[((。]", cell.replace("`", ""), maxsplit=1)[0].strip()


def port_unit(cell: str) -> str:
    return head(cell)


def unconnected(cell: str):
    """未接続時の値。{"value": 数値 | None, "normal": 文字列 | None}。"""
    c = cell.replace("`", "").replace("−", "-").strip()
    m = re.match(r"^normal=\s*(.+)$", c)
    if m:
        rest = m.group(1)
        v = re.match(r"^(-?\d+(?:\.\d+)?)\s*V", rest)
        if v:
            return {"value": float(v.group(1)), "normal": None}
        return {"value": None, "normal": re.split(r"[\s((]", rest, maxsplit=1)[0]}
    v = re.match(r"^(-?\d+(?:\.\d+)?)\s*V", c)
    if v:
        return {"value": float(v.group(1)), "normal": None}
    return {"value": None, "normal": None}


def param_meta(unit_cell: str):
    c = unit_cell.replace("`", "")
    h = head(c)
    if h == "列挙":
        inside = re.search(r"[((]([^))]*)", c).group(1)
        values = []
        for part in re.split(r"[、,]", inside):
            m = re.match(r"^\s*(-?\d+)\s*=\s*([^。]+?)\s*$", part.split("。")[0])
            if m:
                values.append({"value": int(m.group(1)), "label": m.group(2)})
        if not values:
            raise SystemExit(f"列挙の選択肢を読めない: {unit_cell}")
        return {"unit": None, "values": values}
    if h in ("真偽", "論理", "uint32"):
        return {"unit": None}
    return {"unit": h}


def build():
    meta = {}
    for f in sorted(SPECS.glob("MOD-*.md")):
        md = f.read_text(encoding="utf8")
        spec_id = re.search(r"^spec_id:\s*(\S+)", md, re.M).group(1)
        category = re.search(r"^category:\s*(\S+)", md, re.M).group(1)
        ports = {}
        for r in rows(section(md, "3. ")):
            if len(r) < 8 or r[1] not in ("in", "out"):
                continue
            for n in names(r[0]):
                ports[n] = {"unit": port_unit(r[4]), **({"unconnected": unconnected(r[7])} if r[1] == "in" else {})}
        params = {}
        for r in rows(section(md, "4. ")):
            if len(r) < 4:
                continue
            for n in names(r[0]):
                params[n] = param_meta(r[1])
        meta[spec_id] = {"category": category, "ports": ports, "params": params}
    return meta


def render(meta) -> str:
    body = json.dumps(meta, ensure_ascii=False, indent=2)
    return (
        "// 生成物。手で直さない。正本はモジュール仕様(specifications/modules/MOD-*.md)のフロントマターと §3・§4。\n"
        "// 作り直す: python3 tools/build_module_meta.py\n"
        "export interface PortMeta {\n  unit: string;\n  /** 入力だけ。未接続時の値: 定数なら value [V]、他の信号へ内部接続されるなら normal(その名前)。 */\n"
        "  unconnected?: { value: number | null; normal: string | null };\n}\n"
        "export interface ParamMeta {\n  unit: string | null;\n  /** 列挙型の選択肢。 */\n  values?: { value: number; label: string }[];\n}\n"
        "export interface ModuleMeta {\n  category: string;\n  ports: Record<string, PortMeta>;\n  params: Record<string, ParamMeta>;\n}\n\n"
        f"export const MODULE_META: Record<string, ModuleMeta> = {body};\n"
    )


def main():
    text = render(build())
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text(encoding="utf8") != text:
            print(f"NG: {OUT.relative_to(ROOT)} が仕様と一致しない(python3 tools/build_module_meta.py で作り直す)")
            sys.exit(1)
        print(f"OK: {OUT.relative_to(ROOT)} は仕様と一致")
        return
    OUT.write_text(text, encoding="utf8")
    print(f"生成: {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
