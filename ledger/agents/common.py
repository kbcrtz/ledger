"""Shared helpers for agents: numbered source excerpts and field layouts from the parser."""
from __future__ import annotations

import json
import re
from functools import lru_cache

from ..cobol.layout import source_lines, is_comment
from ..cobol.parser import parse_program
from ..paths import CBL_DIR, CPY_DIR


@lru_cache(maxsize=None)
def parsed(program: str) -> dict:
    return parse_program(program)


@lru_cache(maxsize=None)
def lines_of(file: str) -> list[str]:
    p = CBL_DIR / file if file.lower().endswith(".cbl") else CPY_DIR / file
    return source_lines(p)


def numbered(file: str, start: int, end: int) -> str:
    ls = lines_of(file)
    return "\n".join(f"{i:4d} {ls[i - 1]}" for i in range(max(1, start), min(len(ls), end) + 1))


def paragraph(program: str, name: str) -> dict | None:
    return next((p for p in parsed(program)["paragraphs"] if p["name"].upper() == name.strip().upper()), None)


def paragraph_source(program: str, name: str) -> str:
    p = paragraph(program, name)
    if not p:
        raise KeyError(f"no paragraph {name} in {program}")
    return f"--- {program}.cbl paragraph {p['name']} (lines {p['start']}-{p['end']}) ---\n" + numbered(f"{program}.cbl", p["start"], p["end"])


TOKEN = re.compile(r"[A-Z0-9][A-Z0-9-]*[A-Z0-9]|[A-Z0-9]", re.I)


def referenced_fields(program: str, text: str) -> dict:
    idx = parsed(program)["fields"]
    names = {t.upper() for t in TOKEN.findall(text)}
    return {n: idx[n] for n in sorted(names) if n in idx}


def field_table(fields: dict) -> str:
    rows = []
    for n, f in fields.items():
        pic = f.get("pic") or "group"
        rows.append(f"{n:34s} {pic:16s} record={f['record']} offset={f['offset']} size={f['size']} declared={f['file']}:{f['line']}")
    return "\n".join(rows)


def tokens_in(text: str) -> set[str]:
    return {t.upper() for t in TOKEN.findall(text)}


def code_lines(file: str, start: int, end: int) -> list[str]:
    """Non-comment cited lines (comments can't support a claim)."""
    ls = lines_of(file)
    return [ls[i - 1] for i in range(max(1, start), min(len(ls), end) + 1) if not is_comment(ls[i - 1])]
