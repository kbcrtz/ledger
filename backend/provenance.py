"""How a rule was made: the parser's view of its paragraph and fields, and the exact
extractor call (prompt, lookups, raw answer) that produced its current wording.

Everything here is read back from files the pipeline already wrote: data/parsed/*.json
and the LLM cache in cache/llm/extractor/. Nothing is regenerated.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

from ledger.paths import CACHE, DATA, ROOT

PARTS = ("given", "when", "then")
UNIT_RE = re.compile(r"^Unit: (\S+?)\. Focus: (.*)$", re.M)


def _text(content) -> str:
    if isinstance(content, str):
        return content
    return "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")


def _between(s: str, start: str, end: str | None) -> str:
    i = s.find(start)
    if i < 0:
        return ""
    i += len(start)
    j = s.find(end, i) if end else -1
    return s[i:j if j >= 0 else None].strip("\n")


@lru_cache(maxsize=1)
def _calls(stamp: float) -> list[dict]:
    """Final turn of every cached extractor call, with its answer parsed."""
    out = []
    for p in sorted((CACHE / "extractor").glob("*.json")):
        d = json.loads(p.read_text())
        req, resp = d["request"], d["response"]
        answer = None
        for t in (b.get("text", "") for b in resp.get("content", []) if b.get("type") == "text"):
            try:
                answer = json.loads(t)
                break
            except Exception:
                continue
        if not answer or "rules" not in answer:
            continue  # an intermediate tool-use turn, not a final answer
        first = _text(req["messages"][0]["content"])
        m = UNIT_RE.search(first)
        lookups = []
        for msg in req["messages"]:
            if msg["role"] == "assistant" and not isinstance(msg["content"], str):
                lookups += [{"tool": b["name"], "input": b["input"]} for b in msg["content"] if b.get("type") == "tool_use"]
        out.append({
            "file": str(p.relative_to(ROOT)), "mtime": p.stat().st_mtime, "seconds": d.get("seconds"),
            "model": req.get("model"), "unit": m.group(1) if m else None, "focus": m.group(2) if m else None,
            "repair": "Rule to repair:" in first, "prompt": first, "lookups": lookups, "rules": answer["rules"],
        })
    return out


def _texts(scenario: dict) -> list[str]:
    return [c["text"] for p in PARTS for c in scenario.get(p, [])]


def provenance(rule: dict) -> dict:
    cache_dir = CACHE / "extractor"
    stamp = max((p.stat().st_mtime for p in cache_dir.glob("*.json")), default=0.0)
    calls = [c for c in _calls(stamp) if c["unit"] == rule.get("unit")]
    want = _texts(rule["scenario"])
    match, raw = None, None
    for c in sorted(calls, key=lambda c: c["mtime"], reverse=True):
        for r in c["rules"]:
            if _texts(r) == want:
                match, raw = c, r
                break
        if match:
            break

    parsed = _parsed(rule)
    if not match:
        return {"found": False, "parsed": parsed}
    prompt = match["prompt"]
    return {
        "found": True,
        "parsed": parsed,
        "model": match["model"], "seconds": match["seconds"], "cache_file": match["file"],
        "unit": match["unit"], "focus": match["focus"], "repair": match["repair"],
        "source": _between(prompt, "with line numbers):\n", "\n\nLayouts of data names"),
        "layouts": _between(prompt, "(from the deterministic parser):\n", "\n\nOther paragraphs"),
        "verifier_failures": _between(prompt, "Verifier failures:\n", None) if match["repair"] else None,
        "lookups": match["lookups"],
        "answer": raw,
    }


def _parsed(rule: dict) -> dict:
    """The deterministic parser's output for this rule's paragraph and the fields it names."""
    p = json.loads((DATA / "parsed" / f"{rule['program']}.json").read_text())
    para = next((x for x in p["paragraphs"] if x["name"] == rule["paragraph"]), None)
    names = sorted({f.upper() for part in PARTS for c in rule["scenario"][part] for f in c.get("fields", [])})
    fields = []
    for n in names:
        f = p["fields"].get(n)
        if f:
            fields.append({k: f.get(k) for k in ("name", "pic", "file", "line", "record", "offset", "size", "usage")})
    return {
        "program_file": p["file"], "line_count": p["line_count"],
        "paragraph_count": len(p["paragraphs"]), "field_count": len(p["fields"]),
        "paragraph": para and {k: para.get(k) for k in ("name", "start", "end", "performs", "performed_by")},
        "fields": fields,
    }
