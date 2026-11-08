"""Ledger pipeline CLI.

  python -m ledger.pipeline parse        # deterministic parser -> data/parsed/
  python -m ledger.pipeline extract      # extractor + verifier -> data/rules.json
  python -m ledger.pipeline port         # modernizer (traced rules only) -> port/generated/
  python -m ledger.pipeline testgen      # test generator -> data/tests.json
  python -m ledger.pipeline verify       # harness: legacy vs port on every case -> data/results.json
  python -m ledger.pipeline coverage     # -ftraceall coverage report -> data/coverage.json
  python -m ledger.pipeline all          # everything above, in order

All LLM calls are cached in cache/llm/, so re-running replays deterministically.
"""
from __future__ import annotations

import argparse
import sys
from concurrent.futures import ThreadPoolExecutor

from . import log, store
from .llm import STATS
from .units import UNITS


def _clause(c: dict) -> dict:
    from .spans import norm_span
    return {"text": c["text"], "source": norm_span(c),
            "also": [norm_span(s) for s in (c.get("also") or [])],
            "fields": c.get("fields", []), "literals": c.get("literals", [])}


def _rule_from_draft(rule_id: str, unit: dict, d: dict) -> dict:
    return {
        "id": rule_id, "title": d["title"], "program": unit["program"], "paragraph": d["paragraph"],
        "summary": d["summary"], "unit": unit["id"],
        "scenario": {k: [_clause(c) for c in d[k]] for k in ("given", "when", "then")},
        "notes": d.get("notes", []),
        "status": "extracted", "status_history": [{"status": "extracted", "why": "drafted by extractor", "by": "extractor"}],
        "verification": {"attempts": []}, "port_function": None, "tests": [],
    }


def cmd_parse(_):
    from .cobol.parser import write_parsed
    r = write_parsed(["CBTRN02C", "CBACT04C"])
    for p, d in r.items():
        log.event(p, "parser", "done", f"{len(d['paragraphs'])} paragraphs, "
                  f"{sum(len(x['performs']) for x in d['paragraphs'])} PERFORM edges, {len(d['fields'])} data items")


def _verify_and_retry(rule: dict) -> dict:
    from .agents.extractor import repair_rule
    from .agents.verifier import verify_rule, log_result, clause_items, clause_key
    unit = next(u for u in UNITS if u["id"] == rule["unit"])
    prog = unit["program"]
    res = verify_rule(prog, rule)
    rule["verification"]["attempts"].append(res)
    log_result(prog, rule, res, 1)
    if not res["passed"]:
        # Remember clauses that already passed, so the retry re-checks only changed ones.
        prior = {clause_key(c): r for (_, c), r in zip(clause_items(rule), res["clauses"]) if r["passed"]}
        fixed = repair_rule(unit, rule, res["failures"])
        if fixed:
            rule.update({k: fixed[k] for k in ("title", "paragraph", "summary")})
            rule["scenario"] = {k: [_clause(c) for c in fixed[k]] for k in ("given", "when", "then")}
            rule["notes"] = fixed.get("notes", [])
            rule["status_history"].append({"status": "extracted", "why": "retried after verifier rejection", "by": "extractor"})
            res = verify_rule(prog, rule, prior=prior)
            kept = sum(1 for c in res["clauses"] if c.get("reused"))
            log.event(prog, "verifier", "retry-scope",
                      f"{rule['id']}: kept {kept} unchanged passing clause(s), re-checked {len(res['clauses']) - kept}")
            rule["verification"]["attempts"].append(res)
            log_result(prog, rule, res, 2)
    if res["passed"]:
        store.set_status(rule, "traced", f"all clauses verified (attempt {len(rule['verification']['attempts'])})", "verifier")
    else:
        store.set_status(rule, "flagged", f"{len(res['failures'])} clause(s) failed verification after one retry", "verifier")
    return rule


def cmd_extract(args):
    from .agents.extractor import extract_unit
    # No key check here: cached answers replay without one, and llm.create raises
    # LLMUnavailable only when a call actually has to reach the API.
    units = [u for u in UNITS if not args.unit or u["id"] in args.unit]
    with ThreadPoolExecutor(max_workers=6) as ex:
        drafts = list(ex.map(extract_unit, units))
    rules, counters = [], {}
    for u, ds in zip(units, drafts):
        for d in ds:
            counters[u["program"]] = counters.get(u["program"], 0) + 1
            rules.append(_rule_from_draft(f"BR-{u['program']}-{counters[u['program']]:03d}", u, d))
    with ThreadPoolExecutor(max_workers=8) as ex:
        rules = list(ex.map(_verify_and_retry, rules))
    store.save_rules(rules)
    tally = {}
    for r in rules:
        tally[r["status"]] = tally.get(r["status"], 0) + 1
    log.event(None, "pipeline", "extract", f"{len(rules)} rules: {tally}")


def human_decision(rule_id: str) -> dict:
    return store.load(store.REVIEW_DIR / f"{rule_id}.json", {}).get("review") or {}


def eligible(rule: dict) -> bool:
    """Rules that reach the port and the test generator: traced by the verifier, or
    explicitly approved by a named reviewer in the review UI (logged as such)."""
    if rule["status"] in ("traced", "verified"):
        return True
    return human_decision(rule["id"]).get("decision") == "approved"


def _log_human_inclusions(rules, agent):
    for r in rules:
        if r["status"] not in ("traced", "verified"):
            d = human_decision(r["id"])
            log.event(r["program"], agent, "human-approved", f"{r['id']} included on approval by {d.get('by')} "
                      f"although the verifier flagged it")


PORT_META = store.DATA / "port.json"


def cmd_port(args):
    from .agents.modernizer import modernize
    rules = store.load_rules()
    meta = store.load(PORT_META, {})
    for prog in ("CBTRN02C", "CBACT04C"):
        tr = [r for r in rules if r["program"] == prog and eligible(r)]
        _log_human_inclusions(tr, "modernizer")
        if not tr:
            log.event(prog, "modernizer", "skip", "no traced rules; nothing to port")
            continue
        res = modernize(prog, tr)
        meta[prog] = {"module": res["module"], "rules": [r["id"] for r in tr], "links": res["links"], "gaps": res["gaps"]}
        for r in rules:
            if r["program"] == prog:
                fns = res["links"].get(r["id"])
                r["port_function"] = fns[0] if fns else None
                r["port_functions"] = fns or []
    store.save(PORT_META, meta)
    store.save_rules(rules)


TESTS = store.DATA / "tests.json"


def cmd_testgen(args):
    from .agents.testgen import generate_cases
    rules = store.load_rules()
    tr = [r for r in rules if eligible(r)]
    _log_human_inclusions(tr, "testgen")
    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(generate_cases, tr))
    tests, n = [], 0
    for r, cases in zip(tr, results):
        r["tests"] = []
        for c in cases:
            n += 1
            tid = f"T-{n:03d}"
            tests.append({"id": tid, "rule_id": r["id"], "program": r["program"], **c})
            r["tests"].append(tid)
    store.save(TESTS, tests)
    store.save_rules(rules)
    log.event(None, "testgen", "done", f"{len(tests)} cases for {len(tr)} traced rules")


RESULTS = store.DATA / "results.json"


def _write_case_inputs(program, case_dir, fixture):
    from .agents.testgen import check_fixture
    _, _, enc = check_fixture(program, fixture)
    (case_dir / "in").mkdir(parents=True, exist_ok=True)
    for fname, recs in enc.items():
        (case_dir / "in" / f"{fname}.dat").write_bytes("".join(recs).encode("latin-1"))


def run_harness(program: str, cases: list[dict], module_name: str | None = None, tag: str = "verify",
                legacy_cache: bool = True) -> dict:
    """Run legacy + port over cases [{id, fixture | inputs_from}], return {case_id: result}."""
    import shutil
    from .harness.legacy import run_cases
    from .harness.outputs import read_outputs, read_trace
    from .harness.compare import compare, jsonable_outputs
    from port.shell import run_case, load_module
    from .paths import RUNS
    base = RUNS / tag / program
    dirs = []
    for c in cases:
        d = base / c["id"]
        if d.exists():
            shutil.rmtree(d)
        if "fixture" in c:
            _write_case_inputs(program, d, c["fixture"])
        else:
            (d / "in").mkdir(parents=True)
            for fname, src in c["inputs"].items():
                shutil.copy(src, d / "in" / f"{fname}.dat")
        dirs.append(d)
    run_cases(program, dirs)
    try:
        mod = load_module(program, module_name)
    except Exception as e:
        mod = None
        log.event(program, "harness", "port-missing", f"cannot import port module: {e}")
    out = {}
    for c, d in zip(cases, dirs):
        legacy = read_outputs(program, d / "out")
        if mod is not None:
            run_case(program, d, mod)
            port = read_outputs(program, d / "port-out")
        else:
            port = {"files": {}, "rc": "NO_PORT", "abend": False}
        cmp = compare(program, legacy, port)
        out[c["id"]] = {"legacy": jsonable_outputs(legacy), "port": jsonable_outputs(port),
                        "port_stdout": (d / "port-out" / "stdout.txt").read_text()[-2000:] if (d / "port-out" / "stdout.txt").exists() else "",
                        "legacy_stdout": legacy.get("stdout_tail", ""),
                        "executed_lines": read_trace(d / "out", program), **cmp}
    return out


def sample_cases(program: str) -> list[dict]:
    """CardDemo's own sample data. CBACT04C runs on the files CBTRN02C posted (POSTTRAN then INTCALC)."""
    from .sample import write_sample_inputs
    from .paths import RUNS
    d = RUNS / "sample-inputs" / program
    write_sample_inputs(program, d)
    inputs = {f.stem: f for f in d.glob("*.dat")}
    if program == "CBACT04C":
        posted = RUNS / "verify" / "CBTRN02C" / "SAMPLE-CBTRN02C" / "out"
        inputs["TCATBAL"] = posted / "TCATBAL.dat"
        inputs["ACCOUNT"] = posted / "ACCOUNT.dat"
    return [{"id": f"SAMPLE-{program}", "inputs": inputs}]


def cmd_verify(args):
    rules = store.load_rules()
    tests = store.load(TESTS, [])
    results = {"cases": {}, "sample": {}, "rules": {}}
    for prog in ("CBTRN02C", "CBACT04C"):
        cases = [t for t in tests if t["program"] == prog]
        log.event(prog, "harness", "start", f"running {len(cases)} generated case(s) + sample data through GnuCOBOL and the port")
        res = run_harness(prog, cases + sample_cases(prog))
        for t in cases:
            r = res[t["id"]]
            results["cases"][t["id"]] = {"rule_id": t["rule_id"], "program": prog, "title": t["title"],
                                         "condition": t["condition"], "expectation": t["expectation"],
                                         "fixture": t["fixture"], "warnings": t.get("warnings", []), **r}
            log.event(prog, "harness", "match" if r["match"] else "mismatch",
                      f"{t['id']} ({t['rule_id']}) {t['title']}: " + ("legacy == port" if r["match"] else
                      f"{r['difference_count']} difference(s), first: {r['differences'][0]['file']}.{r['differences'][0]['field']}"))
        s = res[f"SAMPLE-{prog}"]
        results["sample"][prog] = s
        log.event(prog, "harness", "sample-" + ("match" if s["match"] else "mismatch"),
                  f"CardDemo sample data: outcome legacy {s['outcome']['legacy']} / port {s['outcome']['port']}, "
                  f"{s['difference_count']} difference(s); files {json_dumps_short(s['files'])}")
    for r in rules:
        cs = [results["cases"][t] for t in r.get("tests", []) if t in results["cases"]]
        passed = sum(1 for c in cs if c["match"])
        results["rules"][r["id"]] = {"cases": len(cs), "passed": passed}
        verifier_traced = any(h["by"] == "verifier" and h["status"] == "traced" for h in r.get("status_history", []))
        if cs and not verifier_traced:
            # human-approved rule that the verifier flagged: record the harness result, keep it flagged
            r["harness"] = {"cases": len(cs), "passed": passed}
            log.event(r["program"], "harness", "human-approved-rule", f"{r['id']}: {passed}/{len(cs)} case(s) match legacy")
        if verifier_traced:
            from .integrity import cited_sha, port_sha
            r["verified_against"] = {"cited_sha": cited_sha(r), "port_sha": port_sha(r["program"])}
            if cs and passed == len(cs):
                store.set_status(r, "verified", f"all {len(cs)} case(s) match legacy", "harness")
            elif cs:
                store.set_status(r, "flagged", f"{len(cs) - passed} of {len(cs)} case(s) differ from legacy", "harness")
            else:
                store.set_status(r, "traced", "no test cases generated", "harness")
    store.save(RESULTS, results)
    store.save_rules(rules)
    tally = {}
    for r in rules:
        tally[r["status"]] = tally.get(r["status"], 0) + 1
    log.event(None, "harness", "done", f"rule statuses after harness: {tally}")


def json_dumps_short(files):
    return ", ".join(f"{k} {v['legacy_records']}/{v['port_records']}" for k, v in files.items())


def cmd_coverage(args):
    from .agents.common import parsed, lines_of
    from .cobol.layout import is_comment
    from .spans import lines_in
    results = store.load(RESULTS, {})
    rules = store.load_rules()
    cov = {}
    for prog in ("CBTRN02C", "CBACT04C"):
        p = parsed(prog)
        proc = next(d for d in p["divisions"] if d["name"] == "PROCEDURE")
        ls = lines_of(p["file"])
        verbs = {"ACCEPT", "ADD", "CALL", "CLOSE", "COMPUTE", "CONTINUE", "DISPLAY", "EVALUATE", "EXIT", "GOBACK",
                 "IF", "INITIALIZE", "MOVE", "OPEN", "PERFORM", "READ", "REWRITE", "STOP", "STRING", "SUBTRACT",
                 "WRITE", "WHEN", "SET", "INSPECT", "UNSTRING", "MULTIPLY", "DIVIDE", "GO"}
        # Executable lines = lines that start a statement (what -ftraceall reports), not
        # ELSE / END-IF / INVALID KEY / continuation lines, and not paragraph headers.
        stmt_lines = [i for i in range(proc["start"] + 1, len(ls) + 1)
                      if ls[i - 1].strip() and not is_comment(ls[i - 1])
                      and not (len(ls[i - 1]) > 7 and ls[i - 1][7] != " ")
                      and ls[i - 1][7:].split()[0].rstrip(".").upper() in verbs]
        executed_by = {}
        all_cases = {**{k: v for k, v in results.get("cases", {}).items() if v["program"] == prog},
                     f"SAMPLE-{prog}": results.get("sample", {}).get(prog, {})}
        for cid, c in all_cases.items():
            for ln in c.get("executed_lines", []):
                executed_by.setdefault(ln, []).append(cid)
        cited = {}
        for r in rules:
            if r["program"] != prog:
                continue
            for part in ("given", "when", "then"):
                for c in r["scenario"][part]:
                    for ln in lines_in(c, p["file"]):
                        cited.setdefault(ln, set()).add(r["id"])
        sample_exec = set(results.get("sample", {}).get(prog, {}).get("executed_lines", []))
        uncovered = [ln for ln in stmt_lines if ln not in cited and ln not in executed_by]
        para_of = {}
        for para in p["paragraphs"]:
            for ln in range(para["start"], para["end"] + 1):
                para_of[ln] = para["name"]
        cov[prog] = {
            "statement_lines": len(stmt_lines),
            "executed_any": len([l for l in stmt_lines if l in executed_by]),
            "executed_by_sample": len([l for l in stmt_lines if l in sample_exec]),
            "trace_lines_sample": len(sample_exec),
            "cited_by_rules": len([l for l in stmt_lines if l in cited]),
            "neither": len(uncovered),
            "uncovered_lines": [{"line": l, "paragraph": para_of.get(l), "text": ls[l - 1].strip()} for l in uncovered],
            "lines": {str(l): {"executed": len(executed_by.get(l, [])), "cited_by": sorted(cited.get(l, []))} for l in stmt_lines},
        }
        log.event(prog, "coverage", "done", f"{cov[prog]['executed_any']}/{len(stmt_lines)} statement lines executed by some case "
                  f"(sample data alone: {len([l for l in stmt_lines if l in sample_exec])}; raw trace incl. paragraph entries: {len(sample_exec)}), {cov[prog]['cited_by_rules']} cited by rules, "
                  f"{len(uncovered)} neither cited nor executed")
    store.save(store.DATA / "coverage.json", cov)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="ledger.pipeline")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("parse")
    e = sub.add_parser("extract")
    e.add_argument("--unit", action="append", help="limit to unit id(s)")
    for name in ("port", "testgen", "verify", "coverage", "all"):
        sub.add_parser(name)
    args = ap.parse_args(argv)
    if args.cmd == "all":
        args.unit = None
        log.reset()
        for f in (cmd_parse, cmd_extract, cmd_port, cmd_testgen, cmd_verify, cmd_coverage):
            f(args)
    else:
        {"parse": cmd_parse, "extract": cmd_extract, "port": cmd_port, "testgen": cmd_testgen,
         "verify": cmd_verify, "coverage": cmd_coverage}[args.cmd](args)
    print(f"LLM: {STATS}", file=sys.stderr)


if __name__ == "__main__":
    main()
