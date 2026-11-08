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
from ..spans import clause_spans, MAX_EXTRA
from .common import parsed, lines_of, code_lines, numbered, tokens_in

MAX_SPAN = 30


def allowed_files(program: str) -> set[str]:
    p = parsed(program)
    return {p["file"]} | {f"{c['name']}.cpy" for c in p["copybooks"]}


def _span_label(spans: list[tuple[str, int, int]]) -> str:
    return " + ".join(f"{f}:{a}-{b}" for f, a, b in spans)


def check_clause(program: str, clause: dict) -> list[str]:
    """Deterministic check over every cited span (primary `source` plus `also`).
    Each span must be valid and tight; every listed field and literal must appear in
    at least one of them."""
    errs = []
    raw = clause_spans(clause) or [{}]
    if len(raw) > 1 + MAX_EXTRA:
        errs.append(f"{len(raw) - 1} extra spans (max {MAX_EXTRA})")
    spans, texts = [], []
    for s in raw:
        f = s.get("file") or f"{program}.cbl"
        if f not in allowed_files(program):
            return [f"file {f} is not {program}.cbl or one of its copybooks"]
        lines = list(s.get("lines") or [])
        if len(lines) == 1:
            lines = [lines[0], lines[0]]
        if len(lines) != 2:
            return ["lines must be [first, last]"]
        a, b = lines
        n = len(lines_of(f))
        if not (1 <= a <= b <= n):
            return [f"lines {a}-{b} of {f} outside 1-{n}"]
        if b - a + 1 > MAX_SPAN:
            errs.append(f"span {f}:{a}-{b} is {b - a + 1} lines (max {MAX_SPAN})")
        spans.append((f, a, b))
        texts.append("\n".join(code_lines(f, a, b)))
    text = "\n".join(texts)
    where = _span_label(spans)
    toks = tokens_in(text)
    if not clause.get("fields") and not clause.get("literals"):
        errs.append("clause lists no fields or literals, so its citation cannot be checked")
    for fld in clause.get("fields", []):
        name = fld.strip().upper()
        # allow reference modification / subscripts written like DALYTRAN-ORIG-TS (1:10)
        name = re.sub(r"\s*\(.*\)$", "", name)
        if name not in toks:
            errs.append(f"field {fld} does not appear in {where}")
    for lit in clause.get("literals", []):
        s = lit.strip().strip("'\"")
        if not s:
            continue
        if re.fullmatch(r"[+-]?\d+(\.\d+)?", s):
            ok = re.search(rf"(?<![\w.]){re.escape(s)}(?![\w])", text) is not None
        else:
            ok = s in text or s.upper() in text.upper()
        if not ok:
            errs.append(f"literal {lit!r} does not appear in {where}")
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

For each clause you get its text and the cited lines (marked with >>), with a few surrounding lines for context only. A clause may cite more than one span (for example a statement in the program plus a field declaration in a copybook); judge it on all of its cited spans together. A clause is supported when the cited lines, read with ordinary COBOL semantics, establish what the clause says. Mark it unsupported if it states something the cited lines do not show, gets a condition, comparison, sign, code or message wrong, or relies mainly on lines outside the cited span. Be strict about meaning, not about wording. Give a one-sentence reason either way."""


def clause_key(c: dict) -> str:
    """Identity of a clause's content: unchanged text, spans, fields and literals mean
    an earlier verdict on it still holds."""
    return json.dumps({k: c.get(k) for k in ("text", "source", "also", "fields", "literals")}, sort_keys=True)


def clause_items(rule: dict):
    for part in ("given", "when", "then"):
        for i, c in enumerate(rule["scenario"][part]):
            yield f"{part}[{i}]", c


def judge_rule(program: str, rule: dict, only: set[str] | None = None) -> dict[str, dict]:
    """Judge the rule's clauses in one call. With `only`, the other clauses are shown as
    already-verified context and the judge returns verdicts just for `only`."""
    parts = []
    for part in ("given", "when", "then"):
        for i, c in enumerate(rule["scenario"][part]):
            cid = f"{part}[{i}]"
            if only is not None and cid not in only:
                parts.append(f"### {cid} (already verified; context only, no verdict needed): {c['text']}")
                continue
            blocks = []
            for src in clause_spans(c) or [{}]:
                f = src.get("file") or f"{program}.cbl"
                ln2 = list(src.get("lines") or [1])
                a, b = (ln2 + ln2)[:2]
                ls = lines_of(f)
                ctx = []
                for ln in range(max(1, a - 4), min(len(ls), b + 4) + 1):
                    mark = ">>" if a <= ln <= b else "  "
                    ctx.append(f"{mark}{ln:4d} {ls[ln - 1]}")
                blocks.append(f"{f}:\n" + "\n".join(ctx))
            parts.append(f"### {cid}: {c['text']}\nfields={c.get('fields')} literals={c.get('literals')}\n" + "\n".join(blocks))
    prompt = f"Rule {rule['id']}: {rule['title']}\n\n" + "\n\n".join(parts)
    if only is not None:
        prompt += "\n\nGive verdicts only for the clauses that are not marked already verified."
    out = run_agent("verifier", JUDGE_SYSTEM, prompt, schema=JUDGE_SCHEMA, effort="medium", max_tokens=32000)
    return {v["clause"]: v for v in out["verdicts"]}


def verify_rule(program: str, rule: dict, prior: dict[str, dict] | None = None) -> dict:
    """Returns {'passed': bool, 'clauses': [...], 'failures': [...]} for the rule's current scenario.

    `prior` maps clause_key -> an earlier passing clause result. A clause whose content is
    unchanged keeps that verdict instead of being re-judged, so a retry only re-checks
    the clauses the extractor actually changed (the judge is not perfectly consistent,
    and re-judging unchanged clauses let retries break clauses that had passed)."""
    prior = prior or {}
    results, failures = [], []
    det, keys = {}, {}
    for cid, c in clause_items(rule):
        det[cid] = check_clause(program, c)
        keys[cid] = clause_key(c)
    reuse = {cid for cid, errs in det.items() if not errs and keys[cid] in prior}
    todo = {cid for cid, errs in det.items() if not errs and cid not in reuse}
    # Only clauses that pass the deterministic check are worth the judge's time,
    # but we judge the whole rule in one call so it sees the full scenario.
    judged = (judge_rule(program, rule, only=todo if reuse else None) if todo else {})
    for cid, errs in det.items():
        if cid in reuse:
            res = {**prior[keys[cid]], "clause": cid, "reused": True}
            results.append(res)
            continue
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
