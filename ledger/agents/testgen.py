"""Test generator agent: a rule's conditions -> branch and boundary fixtures.

Each case is a complete set of input files (records keyed by copybook field names).
A deterministic `check_fixture` tool encodes the records with the copybook layouts and
checks key uniqueness and cross-file consistency, so the agent can fix fixtures before
submitting them. Expectations are recorded as notes only: pass/fail comes from
comparing the legacy run with the port run, never from the generator.
"""
from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation

from .. import log
from ..codec import layout, encode, decode
from ..harness.files import PROGRAM_FILES
from ..llm import run_agent

VALUE = {"type": "object", "properties": {"field": {"type": "string"}, "value": {"type": "string"}},
         "required": ["field", "value"], "additionalProperties": False}
RECORD = {"type": "object", "properties": {"values": {"type": "array", "items": VALUE}},
          "required": ["values"], "additionalProperties": False}


def fixture_schema(program: str) -> dict:
    files = PROGRAM_FILES[program]["inputs"]
    return {"type": "object", "properties": {k: {"type": "array", "items": RECORD} for k in files},
            "required": list(files), "additionalProperties": False}


def cases_schema(program: str) -> dict:
    return {"type": "object", "properties": {"cases": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "condition": {"type": "string", "description": "which branch or boundary of the rule this case exercises"},
            "expectation": {"type": "string", "description": "what the rule says should happen (a note, not an oracle)"},
            "fixture": fixture_schema(program),
        },
        "required": ["title", "condition", "expectation", "fixture"], "additionalProperties": False}}},
        "required": ["cases"], "additionalProperties": False}


def to_records(program: str, fixture: dict) -> dict[str, list[dict]]:
    out = {}
    for fname, recs in fixture.items():
        out[fname] = [{v["field"].strip().upper(): v["value"] for v in r["values"]} for r in recs]
    return out


def check_fixture(program: str, fixture: dict) -> tuple[list[str], list[str], dict[str, list[str]]]:
    """Returns (errors, warnings, encoded files). Errors must be fixed; warnings may be intended."""
    errors, warnings, encoded = [], [], {}
    files = PROGRAM_FILES[program]["inputs"]
    recs = to_records(program, fixture)
    decoded: dict[str, list[dict]] = {}
    for fname, cb in files.items():
        lay = layout(cb)
        byname = {f["name"]: f for f in lay["fields"]}
        encoded[fname] = []
        for i, r in enumerate(recs.get(fname, [])):
            vals = {}
            for k, v in r.items():
                f = byname.get(k)
                if not f or k == "FILLER":
                    errors.append(f"{fname}[{i}]: unknown field {k} (record {lay['record']})")
                    continue
                if f["kind"] == "9":
                    try:
                        d = Decimal(v.strip() or "0")
                    except InvalidOperation:
                        errors.append(f"{fname}[{i}].{k}: {v!r} is not a number")
                        continue
                    if d < 0 and not f["signed"]:
                        errors.append(f"{fname}[{i}].{k}: negative value for unsigned {f['pic']}")
                    if abs(d) >= Decimal(10) ** (f["digits"] - f["scale"]):
                        errors.append(f"{fname}[{i}].{k}: {v} does not fit {f['pic']}")
                    if d != d.quantize(Decimal(1).scaleb(-f["scale"])) if f["scale"] else d != int(d):
                        errors.append(f"{fname}[{i}].{k}: {v} has more decimals than {f['pic']}")
                    vals[k] = d
                else:
                    if len(v) > f["size"]:
                        errors.append(f"{fname}[{i}].{k}: {len(v)} chars exceeds {f['pic']}")
                    vals[k] = v
            rec = encode(vals, lay)
            encoded[fname].append(rec)
        decoded[fname] = [decode(e, lay) for e in encoded[fname]]

    def dup(fname, keyf, label):
        seen = set()
        for r in decoded.get(fname, []):
            k = keyf(r)
            if k in seen:
                errors.append(f"{fname}: duplicate {label} {k} (indexed file keys must be unique)")
            seen.add(k)

    dup("XREF", lambda r: r["XREF-CARD-NUM"], "XREF-CARD-NUM")
    dup("ACCOUNT", lambda r: r["ACCT-ID"], "ACCT-ID")
    dup("TCATBAL", lambda r: (r["TRANCAT-ACCT-ID"], r["TRANCAT-TYPE-CD"], r["TRANCAT-CD"]), "category balance key")
    if program == "CBACT04C":
        dup("XREF", lambda r: r["XREF-ACCT-ID"], "XREF-ACCT-ID (alternate key, no duplicates)")
        dup("DISCGRP", lambda r: (r["DIS-ACCT-GROUP-ID"], r["DIS-TRAN-TYPE-CD"], r["DIS-TRAN-CAT-CD"]), "disclosure group key")
        accts = {r["ACCT-ID"] for r in decoded.get("ACCOUNT", [])}
        xaccts = {r["XREF-ACCT-ID"] for r in decoded.get("XREF", [])}
        for r in decoded.get("TCATBAL", []):
            if r["TRANCAT-ACCT-ID"] not in accts:
                warnings.append(f"TCATBAL account {r['TRANCAT-ACCT-ID']} has no ACCOUNT record")
            if r["TRANCAT-ACCT-ID"] not in xaccts:
                warnings.append(f"TCATBAL account {r['TRANCAT-ACCT-ID']} has no XREF record")
        if not decoded.get("DISCGRP"):
            warnings.append("no DISCGRP records")
    else:
        cards = {r["XREF-CARD-NUM"]: r for r in decoded.get("XREF", [])}
        accts = {r["ACCT-ID"] for r in decoded.get("ACCOUNT", [])}
        for i, t in enumerate(decoded.get("DALYTRAN", [])):
            x = cards.get(t["DALYTRAN-CARD-NUM"])
            if not x:
                warnings.append(f"DALYTRAN[{i}] card {t['DALYTRAN-CARD-NUM']!r} not in XREF")
            elif x["XREF-ACCT-ID"] not in accts:
                warnings.append(f"DALYTRAN[{i}] card's account {x['XREF-ACCT-ID']} not in ACCOUNT")
        ids = [t["DALYTRAN-ID"] for t in decoded.get("DALYTRAN", [])]
        if len(set(ids)) != len(ids):
            warnings.append("duplicate DALYTRAN-ID values (posted transactions are keyed by id)")
        if not decoded.get("DALYTRAN"):
            errors.append("no DALYTRAN records")
    return errors, warnings, encoded


SYSTEM = """You are the test generator in Ledger. For one verified business rule of a legacy COBOL batch program you write test fixtures: complete, consistent sets of input records that exercise each branch of the rule and its boundaries. Every case is run through both the original COBOL program and a Python port, and their outputs are compared field by field, so a good case makes the rule's behaviour visible in the output files.

Guidance:
- One case per branch of the rule's When conditions, plus boundaries: values exactly at a limit, one cent over, a date equal to the limit and the day after, combinations of conditions where the rule says one result overrides another, zero and negative amounts where they matter.
- Keep each case small (normally 1-4 records per file) but complete: every file the program reads gets consistent records with matching keys, unless the case is deliberately about a missing record.
- Give values as strings: alphanumeric fields as text, numeric fields as plain decimal numbers such as "1250.75" or "-40.00" (no sign encoding, no padding). Omitted numeric fields default to 0 and omitted alphanumeric fields to spaces. Use the copybook field names exactly.
- Call check_fixture on each fixture before you submit it and fix every error. Warnings may be intentional (for example a card that is deliberately missing).
- Write 3 to 6 cases. In "expectation", say what the rule implies should happen; it is a note for reviewers, not the pass/fail oracle."""


def build_prompt(program: str, rule: dict) -> str:
    files = PROGRAM_FILES[program]["inputs"]
    lays = []
    for fname, cb in files.items():
        lay = layout(cb)
        lays.append(f"{fname}: {cb} {lay['record']} ({lay['size']} bytes)\n" + "\n".join(
            f"  {f['name']:28s} {f['pic']}" for f in lay["fields"] if f["name"] != "FILLER"))
    rule_view = {"id": rule["id"], "title": rule["title"], "summary": rule["summary"],
                 **{p: [{"text": c["text"], "fields": c["fields"], "literals": c["literals"]} for c in rule["scenario"][p]]
                    for p in ("given", "when", "then")}}
    extra = ""
    if program == "CBACT04C":
        extra = ("\nThe program runs with job PARM '2022071800'. Account, cross-reference and disclosure group "
                 "files are read by key, so every category balance's account needs ACCOUNT and XREF records.")
    return (f"Program: {program}. Input files and their record layouts:\n\n" + "\n\n".join(lays) + extra
            + "\n\nRule to test:\n" + json.dumps(rule_view, indent=1))


def generate_cases(rule: dict) -> list[dict]:
    program = rule["program"]
    schema = cases_schema(program)

    def tool_check(inp):
        errs, warns, enc = check_fixture(program, inp["fixture"])
        preview = {k: [r[:60] for r in v[:4]] for k, v in enc.items()}
        return json.dumps({"errors": errs, "warnings": warns, "encoded_preview_first_60_bytes": preview})

    tools = [{"name": "check_fixture",
              "description": "Encode a fixture with the copybook layouts and check field names, PIC fit, key uniqueness and cross-file consistency.",
              "input_schema": {"type": "object", "properties": {"fixture": fixture_schema(program)},
                               "required": ["fixture"], "additionalProperties": False}}]
    log.event(program, "testgen", "start", f"{rule['id']}: generating branch and boundary cases")
    out = run_agent("testgen", SYSTEM, build_prompt(program, rule), schema=schema, tools=tools,
                    tool_impl={"check_fixture": tool_check}, effort="high", max_turns=24,
                    log=lambda s, d: log.event(program, "testgen", "tool", f"{rule['id']} check_fixture"))
    cases = []
    for c in out["cases"]:
        errs, warns, _ = check_fixture(program, c["fixture"])
        if errs:
            log.event(program, "testgen", "drop", f"{rule['id']} case '{c['title']}' dropped: {errs[:3]}")
            continue
        cases.append({**c, "warnings": warns})
    log.event(program, "testgen", "done", f"{rule['id']}: {len(cases)} case(s)")
    return cases
