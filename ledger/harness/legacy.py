"""Run the original CardDemo COBOL under GnuCOBOL 3.1.2 in Docker.

Inputs are fixed-width record files (no newlines) under <case>/in/. The container
loads them into Berkeley DB indexed files with the programs' own key definitions,
runs the unchanged program with DD_<ASSIGN> mappings and a frozen COB_CURRENT_DATE,
dumps the indexed outputs back to fixed-width records, and also runs a -ftraceall
build to record executed lines.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from ..paths import ROOT

IMAGE = "ledger-cobol:3.1.2"


def _container_path(p: Path) -> str:
    return "/ledger/" + str(p.resolve().relative_to(ROOT))


def ensure_image() -> None:
    r = subprocess.run(["docker", "image", "inspect", IMAGE], capture_output=True)
    if r.returncode != 0:
        subprocess.run(["docker", "build", "-t", IMAGE, str(ROOT / "harness" / "docker")], check=True)


def build() -> str:
    ensure_image()
    r = subprocess.run(["docker", "run", "--rm", "-v", f"{ROOT}:/ledger", IMAGE, "bash", "/ledger/harness/build.sh"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"COBOL build failed:\n{r.stdout}\n{r.stderr}")
    return r.stdout.strip()


def run_cases(program: str, case_dirs: list[Path], parm: str | None = None) -> None:
    if not (ROOT / "harness" / "build" / "bin" / "LDLOAD").exists():
        build()
    if not case_dirs:
        return
    env = []
    if parm:
        env = ["-e", f"LEDGER_PARM={parm}"]
    # Batch in chunks to keep argv small.
    for i in range(0, len(case_dirs), 40):
        chunk = case_dirs[i:i + 40]
        cmd = ["docker", "run", "--rm", "-v", f"{ROOT}:/ledger", *env, IMAGE, "bash",
               "/ledger/harness/run_cases.sh", program, *[_container_path(c) for c in chunk]]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"legacy run failed: {r.stderr[-2000:]}")
