"""Fingerprints recorded at verification time, so later changes mark a rule stale."""
from __future__ import annotations

import hashlib

from .paths import CBL_DIR, CPY_DIR, GENERATED


def _lines(name: str) -> list[str]:
    p = CBL_DIR / name if name.lower().endswith(".cbl") else CPY_DIR / name
    return [ln.rstrip("\r\n") for ln in p.read_text(encoding="latin-1").split("\n")]


def cited_sha(rule: dict) -> str:
    h = hashlib.sha256()
    for part in ("given", "when", "then"):
        for c in rule["scenario"][part]:
            f, ln = c["source"]["file"], c["source"]["lines"]
            try:
                h.update("\n".join(_lines(f)[ln[0] - 1: ln[1]]).encode())
            except Exception:
                h.update(b"?")
    return h.hexdigest()[:16]


def port_sha(program: str) -> str | None:
    p = GENERATED / f"{program.lower()}.py"
    return hashlib.sha256(p.read_bytes()).hexdigest()[:16] if p.exists() else None
