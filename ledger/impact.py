"""Change impact: re-verify an edited rule.

1. Run the verifier on the edited scenario (recorded, not blocking: an intended change
   is expected to stop matching its cited lines).
2. Ask the modernizer to update only the edited rule's code, starting from the current
   port module; the result is written to a separate module so the verified port stays.
3. Re-run every case of the program plus the sample data: legacy vs the edited port.
   Cases that now differ are the expected mismatches a reviewer can approve.
"""
from __future__ import annotations

import difflib
import re

from . import log, store
from .agents.modernizer import modernize
from .agents.verifier import verify_rule
from .paths import GENERATED


def _strip_header(src: str) -> str:
    return re.sub(r'^""".*?"""\n', "", src, count=1, flags=re.S)


def reverify_edit(rule: dict, edit: dict) -> dict:
    from .pipeline import run_harness, sample_cases, TESTS
    prog = rule["program"]
    edited = {**rule, "scenario": edit["scenario"],
              "human_change": {"by": edit["by"], "note": edit.get("note"), "changes": edit["changes"]}}
    log.event(prog, "impact", "start", f"{rule['id']} edited by {edit['by']}: re-verifying "
              f"{len(edit['changes'])} changed clause(s)")
    vres = verify_rule(prog, edited)
    log.event(prog, "impact", "verifier", f"{rule['id']} edited scenario: "
              + ("all clauses still supported by cited lines" if vres["passed"] else
                 f"{len(vres['failures'])} clause(s) no longer match the source (expected for an intended change)"))
    rules = store.load_rules()
    port_rules = [edited if r["id"] == rule["id"] else r for r in rules
                  if r["program"] == prog and (r["status"] in ("traced", "verified") or r["id"] == rule["id"])]
    base_path = GENERATED / f"{prog.lower()}.py"
    existing = _strip_header(base_path.read_text()) if base_path.exists() else None
    slug = rule["id"].lower().replace("-", "_")
    variant = f"{prog.lower()}_edit_{slug}"
    m = modernize(prog, port_rules, existing=existing, changed=[rule["id"]], module_name=variant)
    tests = [t for t in store.load(TESTS, []) if t["program"] == prog]
    res = run_harness(prog, tests + sample_cases(prog), module_name=m["module"], tag=f"impact/{slug}")
    cases = {}
    for cid, r in res.items():
        cases[cid] = {"match": r["match"], "difference_count": r["difference_count"],
                      "differences": r["differences"][:40], "files": r["files"], "outcome": r["outcome"],
                      "rule_id": next((t["rule_id"] for t in tests if t["id"] == cid), None)}
    baseline = store.load(store.DATA / "results.json", {"cases": {}, "sample": {}})
    def base_match(cid):
        if cid.startswith("SAMPLE-"):
            return baseline.get("sample", {}).get(prog, {}).get("match")
        return baseline.get("cases", {}).get(cid, {}).get("match")
    changed = [cid for cid, c in cases.items() if c["match"] != base_match(cid)]
    mismatched = [cid for cid, c in cases.items() if not c["match"]]
    new_src = _strip_header((GENERATED / f"{variant}.py").read_text())
    diff = "".join(difflib.unified_diff((existing or "").splitlines(True), new_src.splitlines(True),
                                        f"{prog.lower()}.py (verified)", f"{variant}.py (edited)"))
    log.event(prog, "impact", "done", f"{rule['id']}: {len(mismatched)} case(s) now differ from legacy, "
              f"{len(changed)} changed outcome vs the verified port")
    return {"module": m["module"], "verifier": vres, "cases": cases, "mismatched_cases": mismatched,
            "mismatch_count": len(mismatched), "changed_vs_baseline": changed, "port_diff": diff,
            "port_links": m["links"], "gaps": m["gaps"]}
