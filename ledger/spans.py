"""Source spans of a clause: the primary `source` plus up to MAX_EXTRA spans under `also`.

A fact often needs two places, e.g. the statement in the program and the field's PIC
declaration in a copybook. Every consumer of citations (verifier, integrity hashes,
coverage, impact) goes through clause_spans so extra spans are never ignored.
"""
from __future__ import annotations

MAX_EXTRA = 2


def norm_lines(lines) -> list[int]:
    ls = [int(x) for x in (lines or [])]
    if len(ls) == 1:
        ls = ls * 2
    return ls[:2]


def norm_span(s: dict | None, default_file: str = "") -> dict:
    s = s or {}
    return {"file": s.get("file") or default_file, "lines": norm_lines(s.get("lines"))}


def clause_spans(c: dict) -> list[dict]:
    out = [c["source"]] if c.get("source") else []
    out += list(c.get("also") or [])
    return out


def lines_in(c: dict, file: str) -> set[int]:
    """Line numbers of `file` cited by any span of the clause."""
    out: set[int] = set()
    for s in clause_spans(c):
        if s.get("file") == file and len(s.get("lines") or []) == 2:
            out |= set(range(s["lines"][0], s["lines"][1] + 1))
    return out
