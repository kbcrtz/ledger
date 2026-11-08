"""Verifier behaviour that needs no API key: multi-span citations and retry scope."""
import copy

from ledger.agents import verifier
from ledger.agents.verifier import check_clause, clause_items, clause_key, verify_rule


def clause(text, lines, fields, also=None, file="CBTRN02C.cbl"):
    return {"text": text, "source": {"file": file, "lines": lines}, "also": also or [],
            "fields": fields, "literals": []}


def test_field_may_come_from_an_extra_span():
    c = clause("x", [414, 414], ["DALYTRAN-ORIG-TS", "TRAN-CAT-BAL"])
    assert check_clause("CBTRN02C", c)  # TRAN-CAT-BAL is not on line 414
    c["also"] = [{"file": "CVTRA01Y.cpy", "lines": [9, 9]}]
    assert check_clause("CBTRN02C", c) == []


def test_too_many_extra_spans_rejected():
    c = clause("x", [414, 414], ["DALYTRAN-ORIG-TS"], also=[{"file": "CVTRA01Y.cpy", "lines": [9, 9]}] * 3)
    assert any("extra spans" in e for e in check_clause("CBTRN02C", c))


def test_retry_rejudges_only_changed_clauses(monkeypatch):
    calls = []

    def fake_judge(program, rule, only=None):
        calls.append(only)
        ids = only if only is not None else {cid for cid, _ in clause_items(rule)}
        return {cid: {"clause": cid, "supported": True, "reason": "ok"} for cid in ids}

    monkeypatch.setattr(verifier, "judge_rule", fake_judge)
    rule = {"id": "R", "title": "t", "scenario": {
        "given": [clause("a", [414, 414], ["DALYTRAN-ORIG-TS"])],
        "when": [clause("b", [407, 407], ["ACCT-CREDIT-LIMIT"])],
        "then": []}}
    first = verify_rule("CBTRN02C", rule)
    assert first["passed"] and calls == [None]

    prior = {clause_key(c): r for (_, c), r in zip(clause_items(rule), first["clauses"]) if r["passed"]}
    retry = copy.deepcopy(rule)
    retry["scenario"]["when"][0]["text"] = "b, reworded"
    res = verify_rule("CBTRN02C", retry, prior=prior)
    assert calls[-1] == {"when[0]"}
    assert [c.get("reused", False) for c in res["clauses"]] == [True, False]
    assert res["passed"]
