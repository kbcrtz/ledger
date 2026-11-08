"""JSON-file store. Pipeline outputs live in data/*.json and are written only by the
pipeline; human review decisions and rule edits live separately in data/review/."""
from __future__ import annotations

import json
from pathlib import Path

from .paths import DATA

RULES = DATA / "rules.json"
REVIEW_DIR = DATA / "review"


def load(path: Path, default):
    return json.loads(path.read_text()) if path.exists() else default


def save(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=1, default=str))
    tmp.replace(path)


def load_rules() -> list[dict]:
    return load(RULES, [])


def save_rules(rules: list[dict]) -> None:
    save(RULES, rules)


def set_status(rule: dict, status: str, why: str, by: str = "pipeline") -> None:
    rule["status"] = status
    rule.setdefault("status_history", []).append({"status": status, "why": why, "by": by})
