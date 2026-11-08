"""CardDemo's own sample data (app/data/ASCII), normalised to fixed-width records."""
from __future__ import annotations

from pathlib import Path

from .paths import SAMPLE_DIR

SAMPLE_FILES = {"DALYTRAN": ("dailytran.txt", 350), "XREF": ("cardxref.txt", 50),
                "ACCOUNT": ("acctdata.txt", 300), "TCATBAL": ("tcatbal.txt", 50),
                "DISCGRP": ("discgrp.txt", 50)}


def sample_records(name: str) -> list[str]:
    fname, size = SAMPLE_FILES[name]
    text = (SAMPLE_DIR / fname).read_text(encoding="latin-1")
    recs = []
    for ln in text.split("\n"):
        ln = ln.rstrip("\r")
        if not ln.strip():
            continue
        recs.append(ln[:size].ljust(size))   # cardxref lines are 36 bytes: pad FILLER
    return recs


def write_sample_inputs(program: str, in_dir: Path) -> None:
    from .harness.files import PROGRAM_FILES
    in_dir.mkdir(parents=True, exist_ok=True)
    for name in PROGRAM_FILES[program]["inputs"]:
        (in_dir / f"{name}.dat").write_bytes("".join(sample_records(name)).encode("latin-1"))
