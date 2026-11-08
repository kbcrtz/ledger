"""Verifier: deterministic citation check first, then an LLM judge on meaning.

A clause passes only if (1) its cited lines exist, are tight, and literally contain
every listed field and literal, and (2) the judge agrees the cited code supports the
statement. Failing clauses go back to the extractor once; failing again -> flagged.
"""
from __future__ import annotations

import json
import re

from .. import log
from ..llm import run_agent
from .common import parsed, lines_of, code_lines, numbered, tokens_in

MAX_SPAN = 30


def allowed_files(program: str) -> set[str]:
    p = parsed(program)
    return {p["file"]} | {f"{c['name']}.cpy" for c in p["copybooks"]}


def check_clause(program: str, clause: dict) -> list[str]:
    errs = []
    src = clause.get("source") or {}
    f = src.get("file") or f"{program}.cbl"
    if f not in allowed_files(program):
        return [f"file {f} is not {program}.cbl or one of its copybooks"]
    lines = list(src.get("lines") or [])
    if len(lines) == 1:
        lines = [lines[0], lines[0]]
    if len(lines) != 2:
        return ["lines must be [first, last]"]
    a, b = lines
    n = len(lines_of(f))
    if not (1 <= a <= b <= n):
        return [f"lines {a}-{b} outside 1-{n}"]
    if b - a + 1 > MAX_SPAN:
        errs.append(f"span {a}-{b} is {b - a + 1} lines (max {MAX_SPAN})")
    code = code_lines(f, a, b)
    text = "\n".join(code)
    toks = tokens_in(text)
    if not clause.get("fields") and not clause.get("literals"):
        errs.append("clause lists no fields or literals, so its citation cannot be checked")
    for fld in clause.get("fields", []):
        name = fld.strip().upper()
        # allow reference modification / subscripts written like DALYTRAN-ORIG-TS (1:10)
        name = re.sub(r"\s*\(.*\)$", "", name)
        if name not in toks:
            errs.append(f"field {fld} does not appear in {f}:{a}-{b}")
    for lit in clause.get("literals", []):
        s = lit.strip().strip("'\"")
        if not s:
            continue
        if re.fullmatch(r"[+-]?\d+(\.\d+)?", s):
            ok = re.search(rf"(?<![\w.]){re.escape(s)}(?![\w])", text) is not None
        else:
            ok = s in text or s.upper() in text.upper()
        if not ok:
            errs.append(f"literal {lit!r} does not appear in {f}:{a}-{b}")
    return errs


JUDGE_SCHEMA = {
    "type": "object",
    "properties": {
        "verdicts": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "clause": {"type": "string", "description": "clause id as given, e.g. when[0]"},
                "supported": {"type": "boolean"},
                "reason": {"type": "string"},
            },
            "required": ["clause", "supported", "reason"], "additionalProperties": False}},
    },
    "required": ["verdicts"], "additionalProperties": False,
}

JUDGE_SYSTEM = """You are the verifier judge in Ledger. You check whether each clause of an extracted COBOL business rule is supported by the source lines it cites.

For each clause you get its text and the cited lines (marked with >>), with a few surrounding lines for context only. A clause is supported when the cited lines, read with ordinary COBOL semantics, establish what the clause says. Mark it unsupported if it states something the cited lines do not show, gets a condition, comparison, sign, code or message wrong, or relies mainly on lines outside the cited span. Be strict about meaning, not about wording. Give a one-sentence reason either way."""


def judge_rule(program: str, rule: dict) -> dict[str, dict]:
    parts = []
    for part in ("given", "when", "then"):
        for i, c in enumerate(rule["scenario"][part]):
            cid = f"{part}[{i}]"
            src = c.get("source") or {}
            f = src.get("file") or f"{program}.cbl"
            ln2 = list(src.get("lines") or [1])
            a, b = (ln2 + ln2)[:2]
            ls = lines_of(f)
            ctx = []
            for ln in range(max(1, a - 4), min(len(ls), b + 4) + 1):
                mark = ">>" if a <= ln <= b else "  "
                ctx.append(f"{mark}{ln:4d} {ls[ln - 1]}")
            parts.append(f"### {cid}: {c['text']}\nfields={c.get('fields')} literals={c.get('literals')}\n{f}:\n" + "\n".join(ctx))
    prompt = f"Rule {rule['id']}: {rule['title']}\n\n" + "\n\n".join(parts)
    out = run_agent("verifier", JUDGE_SYSTEM, prompt, schema=JUDGE_SCHEMA, effort="medium", max_tokens=32000)
    return {v["clause"]: v for v in out["verdicts"]}


def verify_rule(program: str, rule: dict) -> dict:
    """Returns {'passed': bool, 'clauses': [...], 'failures': [...]} for the rule's current scenario."""
    results, failures = [], []
    det = {}
    for part in ("given", "when", "then"):
        for i, c in enumerate(rule["scenario"][part]):
            det[f"{part}[{i}]"] = check_clause(program, c)
    # Only clauses that pass the deterministic check are worth the judge's time,
    # but we judge the whole rule in one call so it sees the full scenario.
    judged = judge_rule(program, rule) if any(not e for e in det.values()) else {}
    for cid, errs in det.items():
        v = judged.get(cid)
        res = {"clause": cid, "deterministic": {"passed": not errs, "errors": errs},
               "judge": ({"supported": v["supported"], "reason": v["reason"]} if (v and not errs) else None)}
        res["passed"] = not errs and bool(v and v["supported"])
        if not errs and not v:
            res["judge"] = {"supported": False, "reason": "judge returned no verdict for this clause"}
        results.append(res)
        if not res["passed"]:
            failures.append({"clause": cid, "errors": errs,
                             "judge": res["judge"]["reason"] if res["judge"] else None})
    return {"passed": not failures, "clauses": results, "failures": failures}


def log_result(program: str, rule: dict, res: dict, attempt: int) -> None:
    if res["passed"]:
        log.event(program, "verifier", "pass", f"{rule['id']} attempt {attempt}: all {len(res['clauses'])} clauses verified")
    else:
        for f in res["failures"]:
            why = "; ".join(f["errors"]) if f["errors"] else f"judge: {f['judge']}"
            log.event(program, "verifier", "reject", f"{rule['id']} {f['clause']} (attempt {attempt}): {why}")
