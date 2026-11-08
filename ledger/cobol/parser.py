"""Deterministic structural parser for the CardDemo batch programs.

Splits divisions and sections, finds paragraphs (including the unnamed main
paragraph right after PROCEDURE DIVISION), builds the PERFORM call graph, parses
FILE-CONTROL SELECTs, and lays out every data item (FILE SECTION, WORKING-STORAGE
with COPY expansion, LINKAGE) with PIC, offset and width.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from .layout import source_lines, is_comment, _statements, parse_entries, parse_copybook, flat_fields
from ..paths import CBL_DIR, CPY_DIR, DATA

MAIN = "(main)"
DIV_RE = re.compile(r"^\s*(IDENTIFICATION|ENVIRONMENT|DATA|PROCEDURE)\s+DIVISION\b", re.I)
SECT_RE = re.compile(r"^\s*(INPUT-OUTPUT|FILE|WORKING-STORAGE|LINKAGE|CONFIGURATION)\s+SECTION\s*\.", re.I)
PARA_RE = re.compile(r"^([A-Z0-9][A-Z0-9-]*)\s*\.\s*$", re.I)
PERFORM_RE = re.compile(r"\bPERFORM\s+([A-Z0-9][A-Z0-9-]*)(?:\s+(?:THRU|THROUGH)\s+([A-Z0-9][A-Z0-9-]*))?", re.I)
NOT_TARGETS = {"UNTIL", "VARYING", "WITH", "TEST", "FOREVER"}
COPY_RE = re.compile(r"^\s*COPY\s+([A-Z0-9-]+)", re.I)


def parse_program(name: str) -> dict:
    path = CBL_DIR / f"{name}.cbl"
    lines = source_lines(path)
    n = len(lines)
    divisions, sections = [], []
    for i, ln in enumerate(lines):
        if is_comment(ln):
            continue
        m = DIV_RE.match(ln)
        if m:
            divisions.append({"name": m.group(1).upper(), "start": i + 1})
        m = SECT_RE.match(ln)
        if m:
            sections.append({"name": m.group(1).upper(), "start": i + 1})
    for lst in (divisions, sections):
        for j, d in enumerate(lst):
            d["end"] = (lst[j + 1]["start"] - 1) if j + 1 < len(lst) else n
    proc = next(d for d in divisions if d["name"] == "PROCEDURE")
    data_div = next(d for d in divisions if d["name"] == "DATA")
    for s in sections:  # sections inside DATA DIVISION end at PROCEDURE DIVISION at the latest
        if s["start"] < proc["start"]:
            s["end"] = min(s["end"], proc["start"] - 1)

    # ---- paragraphs ----
    paras = []
    cur = {"name": MAIN, "start": proc["start"] + 1}
    for i in range(proc["start"], n):
        ln = lines[i]
        if not ln.strip() or is_comment(ln) or len(ln) < 8:
            continue
        if ln[7] != " " and PARA_RE.match(ln[7:].strip()):
            cur["end"] = i
            paras.append(cur)
            cur = {"name": PARA_RE.match(ln[7:].strip()).group(1).upper(), "start": i + 1}
    cur["end"] = n
    paras.append(cur)
    for p in paras:  # trim trailing blank / comment / divider lines
        e = p["end"]
        while e > p["start"] and (not lines[e - 1].strip() or is_comment(lines[e - 1])):
            e -= 1
        p["end"] = e
    para_names = {p["name"] for p in paras}
    for p in paras:
        calls = []
        for ln_no in range(p["start"], p["end"] + 1):
            ln = lines[ln_no - 1]
            if is_comment(ln):
                continue
            for m in PERFORM_RE.finditer(ln):
                tgt = m.group(1).upper()
                if tgt in NOT_TARGETS or tgt not in para_names:
                    continue
                calls.append({"target": tgt, "thru": (m.group(2) or "").upper() or None, "line": ln_no})
        p["performs"] = calls
        p["calls_external"] = [{"target": m.group(1), "line": ln_no}
                               for ln_no in range(p["start"], p["end"] + 1)
                               for m in re.finditer(r"\bCALL\s+'([^']+)'", lines[ln_no - 1])]
    callers: dict[str, list] = {p["name"]: [] for p in paras}
    for p in paras:
        for c in p["performs"]:
            callers[c["target"]].append({"source": p["name"], "line": c["line"]})
    for p in paras:
        p["performed_by"] = callers[p["name"]]

    # ---- FILE-CONTROL ----
    selects = []
    fc_text = []
    for i in range(0, data_div["start"] - 1):
        ln = lines[i]
        if not is_comment(ln):
            fc_text.append((i + 1, ln))
    blob, cur_sel = "", None
    for ln_no, ln in fc_text:
        m = re.search(r"\bSELECT\s+([A-Z0-9-]+)\s+ASSIGN\s+TO\s+([A-Z0-9-]+)", ln, re.I)
        if m:
            cur_sel = {"file": m.group(1).upper(), "assign": m.group(2).upper(), "line": ln_no, "text": ""}
            selects.append(cur_sel)
        if cur_sel is not None:
            cur_sel["text"] += " " + ln.strip()
    for s in selects:
        t = s.pop("text")
        for key, rx in (("organization", r"ORGANIZATION\s+IS\s+([A-Z]+)"), ("access", r"ACCESS\s+MODE\s+IS\s+([A-Z]+)"),
                        ("record_key", r"RECORD\s+KEY\s+IS\s+([A-Z0-9-]+)"), ("alternate_key", r"ALTERNATE\s+RECORD\s+KEY\s+IS\s+([A-Z0-9-]+)"),
                        ("status", r"FILE\s+STATUS\s+IS\s+([A-Z0-9-]+)")):
            m = re.search(rx, t, re.I)
            s[key] = m.group(1).upper() if m else None
        s["record_key"] = s["record_key"] if not (s["alternate_key"] and s["record_key"] == s["alternate_key"]) else s["record_key"]
        s["dd_env"] = f"DD_{s['assign']}"

    # ---- data items (with COPY expansion) ----
    data_sections = [s for s in sections if s["name"] in ("FILE", "WORKING-STORAGE", "LINKAGE")]
    records = []
    copybooks = []
    for s in data_sections:
        entries = []
        for ln_no, stmt in _statements(lines, s["start"], s["end"]):
            cm = COPY_RE.match(stmt)
            if cm:
                cb = cm.group(1).upper()
                copybooks.append({"name": cb, "line": ln_no, "section": s["name"]})
                cb_lines = source_lines(CPY_DIR / f"{cb}.cpy")
                for cln, cstmt in _statements(cb_lines, 0, len(cb_lines)):
                    entries.append((cln, f"{cb}.cpy", cstmt))
                continue
            if re.match(r"^\s*FD\s+", stmt, re.I):
                continue
            entries.append((ln_no, f"{name}.cbl", stmt))
        for r in parse_entries(entries):
            records.append({"section": s["name"], **r.to_dict(),
                            "fields": [f.to_dict() for f in r.walk() if f is not r]})
    field_index = {}
    for r in records:
        field_index.setdefault(r["name"], {k: r[k] for k in r if k != "fields"} | {"record": r["name"], "section": r["section"]})
        for f in r["fields"]:
            if f["name"] != "FILLER":
                field_index.setdefault(f["name"], f | {"record": r["name"], "section": r["section"]})

    return {
        "program": name, "file": path.name, "line_count": n,
        "divisions": divisions, "sections": sections,
        "paragraphs": paras, "selects": selects, "copybooks": copybooks,
        "records": records, "fields": field_index,
    }


def callee_closure(parsed: dict, roots: list[str]) -> list[str]:
    by = {p["name"]: p for p in parsed["paragraphs"]}
    seen, order, stack = set(), [], list(roots)
    while stack:
        n = stack.pop(0)
        if n in seen or n not in by:
            continue
        seen.add(n)
        order.append(n)
        for c in by[n]["performs"]:
            stack.append(c["target"])
    return order


def copybook_layouts(names: list[str]) -> dict:
    out = {}
    for cb in names:
        rec = parse_copybook(CPY_DIR / f"{cb}.cpy")[0]
        out[cb] = {"record": rec.name, "size": rec.size, "fields": flat_fields(rec)}
    return out


def write_parsed(programs: list[str]) -> dict:
    out_dir = DATA / "parsed"
    out_dir.mkdir(parents=True, exist_ok=True)
    result = {}
    for p in programs:
        parsed = parse_program(p)
        (out_dir / f"{p}.json").write_text(json.dumps(parsed, indent=1))
        result[p] = parsed
    from ..paths import COPYBOOKS
    (out_dir / "copybooks.json").write_text(json.dumps(copybook_layouts(COPYBOOKS), indent=1))
    return result
