"""Modernizer agent: writes the Python port from traced rules + copybook layouts only.

The prompt never contains COBOL source. A guard checks that no line of the program's
source appears in the prompt before it is sent; that separation is what makes a
legacy/port match meaningful evidence that the rules captured the behaviour.
"""
from __future__ import annotations

import ast
import hashlib
import importlib
import inspect
import json
import re
import sys

from .. import log
from ..codec import layout
from ..llm import run_agent
from ..paths import GENERATED
from .common import lines_of, parsed

COPYBOOKS_BY_PROGRAM = {
    "CBTRN02C": ["CVTRA06Y", "CVACT03Y", "CVACT01Y", "CVTRA01Y", "CVTRA05Y"],
    "CBACT04C": ["CVTRA01Y", "CVACT03Y", "CVTRA02Y", "CVACT01Y", "CVTRA05Y"],
}

SCHEMA = {
    "type": "object",
    "properties": {
        "module_source": {"type": "string", "description": "Complete Python module source"},
        "functions": {"type": "array", "items": {
            "type": "object",
            "properties": {"rule_id": {"type": "string"}, "function": {"type": "string"}},
            "required": ["rule_id", "function"], "additionalProperties": False}},
        "gaps": {"type": "array", "items": {"type": "string"},
                 "description": "Behaviour the program needs that no rule specifies, and what you assumed"},
    },
    "required": ["module_source", "functions", "gaps"], "additionalProperties": False,
}

SYSTEM = """You are the modernizer in Ledger. You write a Python 3 port of one legacy batch program using ONLY the business rules you are given (each already verified against the source) and the record layouts. You never see the legacy source, and you must not use any outside knowledge of this application: implement what the rules say, nothing more.

Requirements:
- Write one function per rule, decorated with @rule("<rule id>") from port.runtime, whose body implements that rule. A function may serve several rules if they describe one decision; then list all ids in the decorator.
- Write an entry point `def run(ctx) -> None` that drives the program over the input files exposed on ctx (API below) by composing the rule functions. Keep file handling to the ctx API: no open(), no os, no imports beyond decimal, datetime and port.runtime.
- Records are dicts keyed by the exact copybook field names. Numeric fields with decimals are decimal.Decimal, other numeric fields are int, alphanumeric fields are str padded to their full width. Output records you pass to ctx may omit fields (numeric fields then default to 0, alphanumeric to spaces); values are encoded with COBOL MOVE semantics (alphanumerics padded/truncated on the right, numerics truncated toward zero and to the field's PIC size).
- Money math uses Decimal and copies COBOL semantics: results are truncated toward zero unless a rule says ROUNDED, and a result stored in a field keeps only the digits its PIC allows. Use port.runtime.fit(value, digits, scale, signed) wherever a rule says a value is stored in or limited by a field's size, and port.runtime.fit_rounded for ROUNDED.
- Raise port.runtime.Abend for situations the rules say end the program abnormally.
- If the program needs behaviour that no rule specifies, choose the simplest behaviour, mark it with a comment starting `# GAP:` and list it in "gaps". Do not guess at legacy behaviour from general knowledge.
- Return the complete module source plus the rule -> function mapping."""


def ctx_api(program: str) -> str:
    from port import shell, runtime
    cls = shell.CONTEXTS[program]
    return inspect.getdoc(cls) + "\n\nport.runtime:\n" + inspect.getdoc(runtime)


def layouts_text(program: str) -> str:
    out = []
    for cb in COPYBOOKS_BY_PROGRAM[program]:
        lay = layout(cb)
        out.append(f"{cb} {lay['record']} ({lay['size']} bytes)")
        for f in lay["fields"]:
            out.append(f"  {f['name']:28s} {f['pic']:14s} offset {f['offset']:3d} size {f['size']}")
    return "\n".join(out)


def rules_for_prompt(rules: list[dict]) -> list[dict]:
    """Rules as the modernizer sees them: statements, fields and literals; no source spans."""
    out = []
    for r in rules:
        out.append({
            "id": r["id"], "title": r["title"], "summary": r["summary"],
            **{part: [{"text": c["text"], "fields": c["fields"], "literals": c["literals"]}
                      for c in r["scenario"][part]] for part in ("given", "when", "then")},
            # Only what changed matters to the port (who and why live in the audit trail),
            # so the cached port replays for the same edit regardless of the editor's name.
            **({"changed_by_human": [{"clause": c["clause"], "before": c["before"], "after": c["after"]}
                                     for c in r["human_change"]["changes"]]} if r.get("human_change") else {}),
        })
    return out


def assert_no_source(program: str, prompt: str) -> None:
    leaked = []
    p = parsed(program)
    proc_start = next(d["start"] for d in p["divisions"] if d["name"] == "PROCEDURE")
    for i, ln in enumerate(lines_of(p["file"]), start=1):
        s = ln[7:].strip() if len(ln) > 7 else ""
        if i >= proc_start and len(s) >= 18 and s in prompt:
            leaked.append(i)
    consecutive = any(b == a + 1 for a, b in zip(leaked, leaked[1:]))
    if consecutive or len(leaked) > 5:
        raise RuntimeError(f"modernizer prompt contains COBOL source lines {leaked[:10]}; refusing to send")
    if leaked:
        # A verified rule's own text may quote a single statement (e.g. a PERFORM it is about).
        log.event(program, "modernizer", "guard",
                  f"rule text quotes {len(leaked)} single source statement(s) (lines {leaked}); no code blocks in prompt")


def build_prompt(program: str, rules: list[dict], existing: str | None = None, changed: list[str] | None = None) -> str:
    parts = [f"Program to port: {program}. Module name: port.generated.{program.lower()}",
             "Context API (hand-written shell; this is the only I/O you have):\n" + ctx_api(program),
             "Record layouts (copybooks):\n" + layouts_text(program),
             "Verified business rules (the only specification):\n" + json.dumps(rules_for_prompt(rules), indent=1)]
    if existing is not None:
        parts.append("Current port module (generated earlier from these rules):\n```python\n" + existing + "\n```\n"
                     f"Rules {changed} have changed since that module was written. Update only the code that "
                     "implements those rules (and run() only if the change requires it). Leave every other "
                     "function exactly as it is. Return the complete updated module.")
    prompt = "\n\n".join(parts)
    assert_no_source(program, prompt)
    return prompt


FORBIDDEN = re.compile(r"\b(import\s+(os|sys|subprocess|socket|shutil|pathlib|importlib)|__import__|eval\(|exec\(|open\()")


def validate_module(program: str, src: str, rule_ids: list[str]) -> list[str]:
    errs = []
    try:
        tree = ast.parse(src)
    except SyntaxError as e:
        return [f"syntax error: {e}"]
    if FORBIDDEN.search(src):
        errs.append("module uses a forbidden import or builtin")
    names = {n.name for n in tree.body if isinstance(n, ast.FunctionDef)}
    if "run" not in names:
        errs.append("no run(ctx) entry point")
    linked = set()
    for n in tree.body:
        if isinstance(n, ast.FunctionDef):
            for d in n.decorator_list:
                if isinstance(d, ast.Call) and getattr(d.func, "id", "") == "rule":
                    linked |= {a.value for a in d.args if isinstance(a, ast.Constant)}
    missing = [r for r in rule_ids if r not in linked]
    if missing:
        errs.append(f"no @rule function for {missing}")
    return errs


def write_module(program: str, src: str, rule_ids: list[str], module_name: str | None = None) -> str:
    name = module_name or program.lower()
    GENERATED.mkdir(parents=True, exist_ok=True)
    header = (f'"""GENERATED by Ledger modernizer from traced rules {", ".join(rule_ids)}.\n'
              f'Written without access to the COBOL source. Do not edit by hand; re-run the pipeline.\n'
              f'sha256(source)={hashlib.sha256(src.encode()).hexdigest()[:16]}\n"""\n')
    (GENERATED / f"{name}.py").write_text(header + src)
    return name


def link_functions(module) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for fname, fn in vars(module).items():
        if callable(fn) and getattr(fn, "__ledger_rules__", None):
            for r in fn.__ledger_rules__:
                out.setdefault(r, []).append(f"{module.__name__.rsplit('.', 1)[-1]}.{fname}")
    return out


def modernize(program: str, rules: list[dict], existing: str | None = None, changed: list[str] | None = None,
              module_name: str | None = None) -> dict:
    ids = [r["id"] for r in rules]
    prompt = build_prompt(program, rules, existing, changed)
    log.event(program, "modernizer", "start", f"porting {len(rules)} traced rule(s): {', '.join(ids)}"
              + (f" (regenerating for changed {changed})" if changed else ""))
    for attempt in (1, 2):
        out = run_agent("modernizer", SYSTEM, prompt, schema=SCHEMA, effort="high")
        errs = validate_module(program, out["module_source"], ids)
        if not errs:
            break
        log.event(program, "modernizer", "invalid", f"attempt {attempt}: {'; '.join(errs)}")
        prompt = prompt + "\n\nYour previous module was rejected: " + "; ".join(errs) + ". Fix it."
    else:
        raise RuntimeError(f"modernizer produced an invalid module for {program}: {errs}")
    name = write_module(program, out["module_source"], ids, module_name)
    modname = f"port.generated.{name}"
    if modname in sys.modules:
        mod = importlib.reload(sys.modules[modname])
    else:
        mod = importlib.import_module(modname)
    links = link_functions(mod)
    for g in out["gaps"]:
        log.event(program, "modernizer", "gap", g)
    log.event(program, "modernizer", "done", f"wrote port/generated/{name}.py with {len(links)} linked rule(s)")
    return {"module": modname, "links": links, "gaps": out["gaps"], "source": out["module_source"]}
