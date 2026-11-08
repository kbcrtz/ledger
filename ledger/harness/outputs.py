"""Read a case's output directory (legacy or port) into decoded records."""
from __future__ import annotations

from pathlib import Path

from ..codec import decode, split_records
from .files import PROGRAM_FILES, output_layout


def read_outputs(program: str, out_dir: Path) -> dict:
    res: dict = {"files": {}, "rc": None, "abend": False}
    rc_file = out_dir / "rc"
    if rc_file.exists():
        txt = rc_file.read_text().strip()
        res["rc"] = int(txt) if txt.lstrip("-").isdigit() else txt
    stdout = out_dir / "stdout.txt"
    if stdout.exists():
        so = stdout.read_text(errors="replace")
        res["abend"] = "LEDGER-ABEND" in so or "ABENDING PROGRAM" in so
        res["stdout_tail"] = so[-1500:]
    for name, cb in PROGRAM_FILES[program]["outputs"].items():
        lay = output_layout(cb)
        p = out_dir / f"{name}.dat"
        if not p.exists():
            res["files"][name] = None
            continue
        res["files"][name] = [decode(r, lay) for r in split_records(p.read_bytes(), lay["size"])]
    return res


def read_trace(out_dir: Path, program: str) -> list[int]:
    """Executed source lines of `program` from a GnuCOBOL -ftraceall trace (format %I|%L|%S)."""
    p = out_dir / "trace.txt"
    lines: set[int] = set()
    if not p.exists():
        return []
    for ln in p.read_text(errors="replace").splitlines():
        parts = ln.split("|")
        if len(parts) >= 2 and parts[0].strip().upper() == program:
            n = parts[1].strip()
            if n.isdigit():
                lines.add(int(n))
    return sorted(lines)
