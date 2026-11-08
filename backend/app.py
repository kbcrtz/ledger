"""Ledger review API (FastAPI).

Pipeline outputs (data/rules.json, tests.json, results.json, coverage.json, port.json,
pipeline_log.jsonl) are read-only here. Human decisions and rule edits are stored in
data/review/ and overlaid on the pipeline status:

  stale     a rule edit (or a changed cited line / port function) since verification
  diverged  a human-approved edit whose expected mismatches are recorded with who/why
  approved / rejected   a reviewer's decision
"""
from __future__ import annotations

import copy
import datetime as dt
import hashlib
import json
import sys
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ledger import store  # noqa: E402
from ledger.paths import DATA, CBL_DIR, CPY_DIR, GENERATED  # noqa: E402
from ledger.integrity import cited_sha, port_sha  # noqa: E402
from ledger.spans import clause_spans, lines_in  # noqa: E402

app = FastAPI(title="Ledger")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
REVIEW = DATA / "review"
_lock = threading.Lock()


def now() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


def rules() -> list[dict]:
    return store.load_rules()


def results() -> dict:
    return store.load(DATA / "results.json", {"cases": {}, "sample": {}, "rules": {}})


def review_state(rule_id: str) -> dict:
    return store.load(REVIEW / f"{rule_id}.json", {"review": {"by": None, "decision": None, "note": None, "at": None},
                                                   "edit": None, "history": []})


def save_review(rule_id: str, st: dict) -> None:
    store.save(REVIEW / f"{rule_id}.json", st)


def file_lines(name: str) -> list[str]:
    p = CBL_DIR / name if name.lower().endswith(".cbl") else CPY_DIR / name
    if not p.exists() or p.parent not in (CBL_DIR, CPY_DIR):
        raise HTTPException(404, f"no source file {name}")
    return [ln.rstrip("\r\n") for ln in p.read_text(encoding="latin-1").split("\n")]


def effective(rule: dict, st: dict) -> dict:
    """Effective status plus why."""
    edit = st.get("edit")
    if edit:
        if edit.get("divergence"):
            return {"status": "diverged", "why": f"intended divergence approved by {edit['divergence']['by']}: {edit['divergence']['note']}"}
        if edit.get("reverify"):
            return {"status": "stale", "why": "edited and re-verified; expected mismatches await approval"}
        return {"status": "stale", "why": f"rule edited by {edit['by']} since verification; re-verify needed"}
    va = rule.get("verified_against")
    if va and rule["status"] == "verified":
        if va.get("cited_sha") != cited_sha(rule):
            return {"status": "stale", "why": "a cited COBOL line changed since verification"}
        if va.get("port_sha") and va.get("port_sha") != port_sha(rule["program"]):
            return {"status": "stale", "why": "the port module changed since verification"}
    rv = st.get("review") or {}
    if rv.get("decision") in ("approved", "rejected"):
        return {"status": rv["decision"], "why": f"{rv['decision']} by {rv['by']}" + (f": {rv['note']}" if rv.get("note") else ""),
                "pipeline_status": rule["status"]}
    last = (rule.get("status_history") or [{}])[-1]
    return {"status": rule["status"], "why": last.get("why", "")}


def rule_view(rule: dict, res: dict | None = None) -> dict:
    res = res or results()
    st = review_state(rule["id"])
    eff = effective(rule, st)
    rr = res.get("rules", {}).get(rule["id"], {"cases": 0, "passed": 0})
    return {**rule, "pipeline_status": rule["status"], "status": eff["status"], "status_why": eff["why"],
            "tests_passed": rr["passed"], "tests_total": rr["cases"], "review": st["review"], "edit": st.get("edit"),
            "review_history": st.get("history", [])}


@app.get("/api/summary")
def summary():
    res = results()
    rv = [rule_view(r, res) for r in rules()]
    totals: dict[str, int] = {}
    for r in rv:
        totals[r["status"]] = totals.get(r["status"], 0) + 1
    cases = res.get("cases", {})
    sample = {p: {"match": s.get("match"), "difference_count": s.get("difference_count"), "outcome": s.get("outcome"),
                  "files": s.get("files")} for p, s in res.get("sample", {}).items()}
    cov = store.load(DATA / "coverage.json", {})
    return {"totals": totals, "rules": len(rv),
            "cases": {"total": len(cases), "passed": sum(1 for c in cases.values() if c["match"])},
            "sample": sample,
            "coverage": {p: {k: v for k, v in c.items() if k not in ("lines", "uncovered_lines")} for p, c in cov.items()},
            "port": store.load(DATA / "port.json", {})}


@app.get("/api/rules")
def list_rules():
    res = results()
    out = []
    for r in rules():
        v = rule_view(r, res)
        out.append({k: v[k] for k in ("id", "title", "program", "paragraph", "summary", "status", "status_why",
                                      "pipeline_status", "tests_passed", "tests_total", "port_function")})
    return out


def impact(rule: dict, res: dict) -> dict:
    """Trace graph neighbourhood: lines, fields, tests and port functions linked to the rule."""
    lines = []
    fields = set()
    for part in ("given", "when", "then"):
        for c in rule["scenario"][part]:
            lines.extend({"file": s["file"], "lines": s["lines"]} for s in clause_spans(c))
            fields |= set(c["fields"])
    prog_file = f"{rule['program']}.cbl"
    cited = {ln for l in lines if l["file"] == prog_file and len(l["lines"]) == 2 for ln in range(l["lines"][0], l["lines"][1] + 1)}
    direct = list(rule.get("tests", []))
    executing = []
    for cid, c in res.get("cases", {}).items():
        if c["program"] != rule["program"] or cid in direct:
            continue
        if cited & set(c.get("executed_lines", [])):
            executing.append(cid)
    sample = res.get("sample", {}).get(rule["program"], {})
    sample_hits = bool(cited & set(sample.get("executed_lines", [])))
    others = []
    for o in rules():
        if o["id"] == rule["id"] or o["program"] != rule["program"]:
            continue
        ofields = {f for part in ("given", "when", "then") for c in o["scenario"][part] for f in c["fields"]}
        olines = {ln for part in ("given", "when", "then") for c in o["scenario"][part]
                  for ln in lines_in(c, prog_file)}
        shared_lines = sorted(cited & olines)
        if shared_lines:
            others.append({"id": o["id"], "title": o["title"], "shared_lines": shared_lines,
                           "shared_fields": sorted(fields & ofields)})
    return {"lines": lines, "fields": sorted(fields), "tests_direct": direct, "tests_executing_cited_lines": executing,
            "sample_executes_cited_lines": sample_hits, "port_functions": rule.get("port_functions") or
            ([rule["port_function"]] if rule.get("port_function") else []), "rules_sharing_lines": others}


@app.get("/api/rules/{rule_id}")
def get_rule(rule_id: str):
    res = results()
    r = next((x for x in rules() if x["id"] == rule_id), None)
    if not r:
        raise HTTPException(404, "no such rule")
    v = rule_view(r, res)
    v["cases"] = [{"id": t, **res["cases"][t]} for t in r.get("tests", []) if t in res.get("cases", {})]
    v["impact"] = impact(r, res)
    v["sample"] = res.get("sample", {}).get(r["program"])
    if v["sample"]:
        v["sample"] = {k: v["sample"][k] for k in ("match", "difference_count", "differences", "files", "outcome")}
    return v


@app.get("/api/source/{name}")
def source(name: str):
    return {"file": name, "lines": file_lines(name)}


@app.get("/api/port/{program}")
def port_source(program: str, variant: str | None = None):
    name = program.lower() if not variant else variant
    p = GENERATED / f"{name}.py"
    if not p.exists():
        raise HTTPException(404, "no port module")
    return {"module": f"port.generated.{name}", "source": p.read_text()}


@app.get("/api/log")
def pipeline_log(program: str | None = None):
    p = DATA / "pipeline_log.jsonl"
    out = []
    if p.exists():
        for ln in p.read_text().splitlines():
            e = json.loads(ln)
            if program and e.get("program") not in (program, None):
                continue
            out.append(e)
    return out


@app.get("/api/coverage")
def coverage():
    return store.load(DATA / "coverage.json", {})


@app.get("/api/cases/{case_id}")
def get_case(case_id: str):
    res = results()
    c = res.get("cases", {}).get(case_id)
    if not c and case_id.startswith("SAMPLE-"):
        c = res.get("sample", {}).get(case_id.removeprefix("SAMPLE-"))
    if not c:
        raise HTTPException(404, "no such case")
    return c


class Review(BaseModel):
    decision: str
    by: str
    note: str | None = None


@app.post("/api/rules/{rule_id}/review")
def post_review(rule_id: str, body: Review):
    if body.decision not in ("approved", "rejected", "clear"):
        raise HTTPException(400, "decision must be approved, rejected or clear")
    if not body.by.strip():
        raise HTTPException(400, "a reviewer name is required")
    with _lock:
        st = review_state(rule_id)
        st["review"] = ({"by": None, "decision": None, "note": None, "at": None} if body.decision == "clear"
                        else {"by": body.by, "decision": body.decision, "note": body.note, "at": now()})
        st["history"].append({"event": f"review:{body.decision}", "by": body.by, "note": body.note, "at": now()})
        save_review(rule_id, st)
    return get_rule(rule_id)


class ClauseEdit(BaseModel):
    part: str
    index: int
    text: str


class Edit(BaseModel):
    by: str
    note: str | None = None
    clauses: list[ClauseEdit]


@app.post("/api/rules/{rule_id}/edit")
def post_edit(rule_id: str, body: Edit):
    r = next((x for x in rules() if x["id"] == rule_id), None)
    if not r:
        raise HTTPException(404, "no such rule")
    if not body.by.strip():
        raise HTTPException(400, "an editor name is required")
    edited = copy.deepcopy(r["scenario"])
    changes = []
    for c in body.clauses:
        if c.part not in edited or not (0 <= c.index < len(edited[c.part])):
            raise HTTPException(400, f"no clause {c.part}[{c.index}]")
        before = edited[c.part][c.index]["text"]
        if before != c.text:
            edited[c.part][c.index] = {**edited[c.part][c.index], "text": c.text, "edited": True, "original_text": before}
            changes.append({"clause": f"{c.part}[{c.index}]", "before": before, "after": c.text})
    if not changes:
        raise HTTPException(400, "no clause changed")
    with _lock:
        st = review_state(rule_id)
        st["edit"] = {"by": body.by, "note": body.note, "at": now(), "scenario": edited, "changes": changes,
                      "stale": impact(r, results()), "reverify": None, "divergence": None}
        st["history"].append({"event": "edit", "by": body.by, "note": body.note, "at": now(), "changes": changes})
        save_review(rule_id, st)
    return get_rule(rule_id)


@app.post("/api/rules/{rule_id}/discard-edit")
def discard_edit(rule_id: str):
    with _lock:
        st = review_state(rule_id)
        if st.get("edit"):
            st["history"].append({"event": "edit-discarded", "by": st["edit"]["by"], "at": now()})
        st["edit"] = None
        save_review(rule_id, st)
    return get_rule(rule_id)


@app.post("/api/rules/{rule_id}/reverify")
def reverify(rule_id: str):
    """Regenerate the port for the edited rule (modernizer, cached) and re-run the rule's
    cases plus the sample data against legacy. Results are stored with the edit."""
    from ledger.impact import reverify_edit
    r = next((x for x in rules() if x["id"] == rule_id), None)
    st = review_state(rule_id)
    if not r or not st.get("edit"):
        raise HTTPException(400, "no pending edit for this rule")
    try:
        out = reverify_edit(r, st["edit"])
    except Exception as e:
        raise HTTPException(500, f"re-verify failed: {e}")
    with _lock:
        st = review_state(rule_id)
        st["edit"]["reverify"] = {**out, "at": now()}
        st["edit"]["divergence"] = None
        st["history"].append({"event": "reverify", "at": now(), "mismatches": out["mismatch_count"]})
        save_review(rule_id, st)
    return get_rule(rule_id)


class Divergence(BaseModel):
    by: str
    note: str


@app.post("/api/rules/{rule_id}/approve-divergence")
def approve_divergence(rule_id: str, body: Divergence):
    if not body.by.strip() or not body.note.strip():
        raise HTTPException(400, "approver name and a reason are required")
    with _lock:
        st = review_state(rule_id)
        e = st.get("edit")
        if not e or not e.get("reverify"):
            raise HTTPException(400, "re-verify the edit first")
        e["divergence"] = {"by": body.by, "note": body.note, "at": now(),
                           "expected_mismatches": e["reverify"]["mismatched_cases"]}
        st["history"].append({"event": "divergence-approved", "by": body.by, "note": body.note, "at": now()})
        save_review(rule_id, st)
    return get_rule(rule_id)
