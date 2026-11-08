"""Pipeline log: append-only JSONL of agent steps, verifier rejections, retries."""
from __future__ import annotations

import json
import threading
import time

from .paths import DATA

_lock = threading.Lock()
LOG = DATA / "pipeline_log.jsonl"


def event(program: str | None, agent: str, step: str, message: str, **detail) -> None:
    rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "program": program, "agent": agent,
           "step": step, "message": message, **({"detail": detail} if detail else {})}
    with _lock:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with LOG.open("a") as f:
            f.write(json.dumps(rec) + "\n")
    print(f"[{agent}] {program or ''} {step}: {message}", flush=True)


def reset() -> None:
    if LOG.exists():
        LOG.unlink()
