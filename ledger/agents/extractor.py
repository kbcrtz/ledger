"""Extractor agent: one paragraph (plus callees and copybooks) -> Given/When/Then rules.

Every clause carries a source span, the data names and the literals it relies on, so
the verifier can check it deterministically before any LLM judge looks at it.
"""
from __future__ import annotations

import json

from .. import log
from ..cobol.parser import callee_closure
from ..llm import run_agent
from ..units import PLUMBING_PREFIXES
from .common import parsed, paragraph, paragraph_source, referenced_fields, field_table, numbered

CLAUSE = {
    "type": "object",
    "properties": {
        "text": {"type": "string", "description": "Plain-English statement a policy owner can read."},
        "file": {"type": "string", "description": "Source file the lines are in, e.g. CBTRN02C.cbl or CVACT01Y.cpy"},
        "lines": {"type": "array", "items": {"type": "integer"}, "description": "[first, last] line numbers, inclusive"},
        "fields": {"type": "array", "items": {"type": "string"}, "description": "COBOL data names this clause relies on; each must appear in the cited lines"},
        "literals": {"type": "array", "items": {"type": "string"}, "description": "Literal values (codes, messages, constants) this clause relies on, without quotes; each must appear in the cited lines"},
    },
    "required": ["text", "file", "lines", "fields", "literals"],
    "additionalProperties": False,
}
RULE = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "paragraph": {"type": "string", "description": "Main paragraph implementing the rule"},
        "summary": {"type": "string", "description": "One or two sentences for the catalog"},
        "given": {"type": "array", "items": CLAUSE},
        "when": {"type": "array", "items": CLAUSE},
        "then": {"type": "array", "items": CLAUSE},
    },
    "required": ["title", "paragraph", "summary", "given", "when", "then"],
    "additionalProperties": False,
}
RULES_SCHEMA = {
    "type": "object",
    "properties": {"rules": {"type": "array", "items": RULE}},
    "required": ["rules"],
    "additionalProperties": False,
}

SYSTEM = """You are the extractor in Ledger, a system that documents legacy COBOL business rules so that a modern port can be written from the rules alone and checked against the running original.

Write business rules as Given/When/Then scenarios in plain English that a policy owner can read and approve. Hard requirements:

- Every clause cites the exact source lines it comes from (file plus [first, last] line numbers from the numbered listing; keep spans tight, normally 1-12 lines). If a statement cannot be sourced to specific lines, leave it out.
- Every clause lists the COBOL data names ("fields") and literal values ("literals": codes, messages, constants, without quotes) it relies on. Each listed field and literal must literally appear in the cited lines; a checker will reject the clause otherwise. Cite a declaration line (for example a PIC clause in WORKING-STORAGE) when the clause depends on a field's size or precision.
- Describe what the code actually does, not what it was probably meant to do. If the code has surprising behaviour (a later check overwriting an earlier result, a branch that can never run, arithmetic that truncates, a check that ignores something), state that behaviour precisely in the rule.
- Separate business logic from file plumbing. Opening/closing files, file-status checks, and abend handling are plumbing; leave them out unless they change a business outcome. Balance and record updates (for example 2700-*, 2800-*, 1050-* paragraphs) are business logic: a port that skips them would produce different output files.
- Be precise enough that a developer who never sees the COBOL could reproduce the outputs exactly: name the output fields set, the exact codes and message texts, the order of checks, signs and arithmetic (COBOL truncates toward zero unless ROUNDED is written), and which records are created versus updated.
- Keep each clause to one checkable fact. When a fact depends on a record layout, field size or precision, put it in its own clause that cites the declaration. Do not restate in one clause what another clause (or another part of the program) establishes.
- Use the field names exactly as declared. Use the tools to read any other paragraph or field layout you need; do not guess line numbers.

Return only rules for the unit you are given, at most the number requested, each one a distinct behaviour with an observable effect on the program's outputs."""


def unit_prompt(unit: dict) -> str:
    prog = unit["program"]
    p = parsed(prog)
    names = []
    for r in unit["roots"]:
        for n in callee_closure(p, [r]):
            if n not in names and (n in unit["roots"] or not n.startswith(PLUMBING_PREFIXES)):
                names.append(n)
    src = "\n\n".join(paragraph_source(prog, n) for n in names)
    fields = referenced_fields(prog, src)
    others = [q["name"] for q in p["paragraphs"] if q["name"] not in names]
    sel = "\n".join(f"  {s['file']}: ASSIGN {s['assign']}, {s['organization']} {s['access']}, key {s['record_key']}"
                    + (f", alternate key {s['alternate_key']}" if s['alternate_key'] else "") for s in p["selects"])
    return f"""Program: {prog} ({p['file']}, {p['line_count']} lines). Copybooks: {', '.join(c['name'] for c in p['copybooks'])}.

Unit: {unit['id']}. Focus: {unit['focus']}
Return at most {unit['max_rules']} rule(s).

Files (FILE-CONTROL):
{sel}

Source for this unit (root paragraph(s) and their non-plumbing callees, with line numbers):

{src}

Layouts of data names referenced above (from the deterministic parser):
{field_table(fields)}

Other paragraphs you can read with get_paragraph: {', '.join(others)}"""


def tools_for(program: str):
    p = parsed(program)

    def get_paragraph(inp):
        return paragraph_source(program, inp["name"])

    def get_lines(inp):
        a, b = int(inp["first"]), int(inp["last"])
        if b - a > 120:
            b = a + 120
        return numbered(inp.get("file") or f"{program}.cbl", a, b)

    def get_field(inp):
        f = p["fields"].get(inp["name"].upper())
        return json.dumps(f) if f else f"no data item named {inp['name']}"

    tools = [
        {"name": "get_paragraph", "description": "Numbered source of one paragraph of the program.",
         "input_schema": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"], "additionalProperties": False}},
        {"name": "get_lines", "description": "Numbered source lines [first, last] of the program or a copybook (file e.g. 'CVACT01Y.cpy'; default the program).",
         "input_schema": {"type": "object", "properties": {"file": {"type": "string"}, "first": {"type": "integer"}, "last": {"type": "integer"}},
                          "required": ["file", "first", "last"], "additionalProperties": False}},
        {"name": "get_field", "description": "Layout of a data item: PIC, offset, size, record, declaring file and line.",
         "input_schema": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"], "additionalProperties": False}},
    ]
    return tools, {"get_paragraph": get_paragraph, "get_lines": get_lines, "get_field": get_field}


def _log(program):
    return lambda step, d: log.event(program, "extractor", step, f"{d.get('tool')}({json.dumps(d.get('input'))})")


def extract_unit(unit: dict) -> list[dict]:
    prog = unit["program"]
    tools, impl = tools_for(prog)
    log.event(prog, "extractor", "start", f"unit {unit['id']} roots={unit['roots']}")
    out = run_agent(f"extractor", SYSTEM, unit_prompt(unit), schema=RULES_SCHEMA, tools=tools, tool_impl=impl,
                    effort="high", log=_log(prog))
    rules = out["rules"][: unit["max_rules"]]
    log.event(prog, "extractor", "done", f"unit {unit['id']}: {len(rules)} rule(s) drafted",
              titles=[r["title"] for r in rules])
    return rules


REPAIR_SYSTEM = SYSTEM + """

You are now repairing one rule whose clauses failed verification. For each failed clause, fix the citation (lines, fields, literals) or the wording so it is exactly supported by the cited code, or remove the clause if it cannot be sourced. Keep passing clauses unchanged. Return the corrected rule as a single-element "rules" array."""


def repair_rule(unit: dict, rule: dict, failures: list[dict]) -> dict | None:
    prog = unit["program"]
    tools, impl = tools_for(prog)
    body = {k: rule[k] for k in ("title", "paragraph", "summary")} | {k: rule["scenario"][k] for k in ("given", "when", "then")}
    prompt = (unit_prompt(unit) + "\n\nRule to repair:\n" + json.dumps(body, indent=1)
              + "\n\nVerifier failures:\n" + json.dumps(failures, indent=1))
    log.event(prog, "extractor", "retry", f"{rule['id']}: repairing {len(failures)} failed clause(s)")
    out = run_agent("extractor", REPAIR_SYSTEM, prompt, schema=RULES_SCHEMA, tools=tools, tool_impl=impl,
                    effort="high", log=_log(prog))
    return out["rules"][0] if out["rules"] else None
