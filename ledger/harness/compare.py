"""Field-by-field comparison of legacy and port outputs."""
from __future__ import annotations

from decimal import Decimal

from ..codec import Invalid
from .files import PROGRAM_FILES, MASKED_BY_FILE

KEYS = {"TRANSACT": "TRAN-ID", "ACCOUNT": "ACCT-ID", "TCATBAL": ("TRANCAT-ACCT-ID", "TRANCAT-TYPE-CD", "TRANCAT-CD"),
        "DALYREJS": "DALYTRAN-ID"}


def _j(v):
    if isinstance(v, Invalid):
        return {"invalid": str(v)}
    if isinstance(v, Decimal):
        return str(v)
    return v


def _key(fname, rec):
    k = KEYS.get(fname)
    if isinstance(k, tuple):
        return "/".join(str(rec.get(x)) for x in k)
    return str(rec.get(k)).strip() if k else None


def outcome(res: dict) -> str:
    if res.get("abend"):
        return "abend"
    return f"rc={res.get('rc')}"


def compare(program: str, legacy: dict, port: dict, max_diffs: int = 300) -> dict:
    diffs = []
    lo, po = outcome(legacy), outcome(port)
    if lo != po:
        diffs.append({"file": "(run)", "record": None, "key": None, "field": "outcome", "legacy": lo, "port": po})
    summary = {}
    for fname in PROGRAM_FILES[program]["outputs"]:
        masked = MASKED_BY_FILE.get((program, fname), set())
        L = legacy["files"].get(fname) or []
        P = port["files"].get(fname) or []
        nd = 0
        if len(L) != len(P):
            diffs.append({"file": fname, "record": None, "key": None, "field": "(record count)", "legacy": len(L), "port": len(P)})
            nd += 1
        for i in range(max(len(L), len(P))):
            a = L[i] if i < len(L) else None
            b = P[i] if i < len(P) else None
            if a is None or b is None:
                rec = a or b
                diffs.append({"file": fname, "record": i, "key": _key(fname, rec), "field": "(record)",
                              "legacy": "present" if a else "missing", "port": "present" if b else "missing"})
                nd += 1
                continue
            for f in a:
                if f in masked:
                    continue
                if a.get(f) != b.get(f):
                    diffs.append({"file": fname, "record": i, "key": _key(fname, a), "field": f,
                                  "legacy": _j(a.get(f)), "port": _j(b.get(f))})
                    nd += 1
        summary[fname] = {"legacy_records": len(L), "port_records": len(P), "differences": nd, "masked": sorted(masked)}
    return {"match": not diffs, "differences": diffs[:max_diffs], "difference_count": len(diffs),
            "files": summary, "outcome": {"legacy": lo, "port": po}}


def jsonable_outputs(res: dict, limit: int = 60) -> dict:
    return {"rc": res.get("rc"), "abend": res.get("abend"), "outcome": outcome(res),
            "files": {k: (None if v is None else [{f: _j(x) for f, x in r.items()} for r in v[:limit]])
                      for k, v in res["files"].items()},
            "counts": {k: (None if v is None else len(v)) for k, v in res["files"].items()}}
