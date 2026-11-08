"""Claude client for Legibol's agents: plain Python, manual tool loop, disk cache.

Every Messages API request is cached under cache/llm/<agent>/<sha256 of request>.json.
A tool loop is deterministic on replay because each turn's request includes the
previous (cached) responses and deterministic tool results.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any, Callable

from .paths import ROOT, CACHE

MODEL = os.environ.get("LEDGER_MODEL", "claude-opus-5-5")
BETAS = ["server-side-fallback-2026-07-01"]   # refusal fallback, routed by category


class LLMUnavailable(RuntimeError):
    pass


class LLMError(RuntimeError):
    pass


def load_env() -> None:
    env = ROOT / ".env"
    if env.exists():
        for ln in env.read_text().splitlines():
            ln = ln.strip()
            if not ln or ln.startswith("#") or "=" not in ln:
                continue
            k, v = ln.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if v and not os.environ.get(k):
                os.environ[k] = v


def have_key() -> bool:
    load_env()
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


_client = None
STATS = {"calls": 0, "cache_hits": 0, "input_tokens": 0, "output_tokens": 0}


def _get_client():
    global _client
    if _client is None:
        if not have_key():
            raise LLMUnavailable("ANTHROPIC_API_KEY not set (env or ledger/.env)")
        import anthropic
        _client = anthropic.Anthropic(max_retries=4, timeout=900.0)
    return _client


def request_hash(params: dict) -> str:
    return hashlib.sha256(json.dumps(params, sort_keys=True, ensure_ascii=True).encode()).hexdigest()


def _clean_block(b: dict) -> dict:
    """Keep only input-valid fields of a response content block when echoing it back."""
    t = b.get("type")
    if t == "text":
        return {"type": "text", "text": b["text"]}
    if t == "tool_use":
        return {"type": "tool_use", "id": b["id"], "name": b["name"], "input": b["input"]}
    if t == "thinking":
        return {"type": "thinking", "thinking": b.get("thinking", ""), "signature": b["signature"]}
    if t == "redacted_thinking":
        return {"type": "redacted_thinking", "data": b["data"]}
    return {k: v for k, v in b.items() if v is not None}


def create(agent: str, params: dict) -> dict:
    """One cached Messages API call. Returns the response as a plain dict."""
    key = request_hash(params)
    path = CACHE / agent / f"{key}.json"
    if path.exists():
        STATS["cache_hits"] += 1
        return json.loads(path.read_text())["response"]
    if os.environ.get("LEDGER_REPLAY_ONLY"):
        raise LLMUnavailable(f"replay-only mode and no cache entry for {agent} {key[:12]}")
    client = _get_client()
    t0 = time.time()
    with client.beta.messages.stream(betas=BETAS, fallbacks="default", **params) as stream:
        msg = stream.get_final_message()
    resp = msg.to_dict()
    STATS["calls"] += 1
    u = resp.get("usage") or {}
    STATS["input_tokens"] += (u.get("input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0)
    STATS["output_tokens"] += u.get("output_tokens") or 0
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"agent": agent, "key": key, "seconds": round(time.time() - t0, 1),
                                "request": params, "response": resp}, indent=1))
    return resp


def _check(value: Any, schema: dict, where: str = "$") -> list[str]:
    """Minimal JSON-schema check for tool inputs (eager input streaming skips server validation)."""
    errs = []
    t = schema.get("type")
    if t == "object":
        if not isinstance(value, dict):
            return [f"{where}: expected object"]
        for r in schema.get("required", []):
            if r not in value:
                errs.append(f"{where}.{r}: missing")
        for k, sub in schema.get("properties", {}).items():
            if k in value:
                errs += _check(value[k], sub, f"{where}.{k}")
    elif t == "array":
        if not isinstance(value, list):
            return [f"{where}: expected array"]
        for i, v in enumerate(value):
            errs += _check(v, schema.get("items", {}), f"{where}[{i}]")
    elif t == "string" and not isinstance(value, str):
        errs.append(f"{where}: expected string")
    elif t == "integer" and not (isinstance(value, int) and not isinstance(value, bool)):
        errs.append(f"{where}: expected integer")
    if "enum" in schema and value not in schema["enum"]:
        errs.append(f"{where}: not in {schema['enum']}")
    return errs


def run_agent(agent: str, system: str, user: str | list, *, schema: dict,
              tools: list[dict] | None = None, tool_impl: dict[str, Callable[[dict], str]] | None = None,
              effort: str = "high", max_turns: int = 16, max_tokens: int = 64000,
              log: Callable[[str, dict], None] | None = None) -> dict:
    """Run one agent to a structured (JSON-schema) final answer, executing tool calls locally."""
    tools = tools or []
    tool_defs = [dict(t, eager_input_streaming=True) for t in tools]
    schemas = {t["name"]: t["input_schema"] for t in tools}
    messages: list[dict] = [{"role": "user", "content": user}]
    for turn in range(max_turns):
        params = {
            "model": MODEL,
            "max_tokens": max_tokens,
            "system": system,
            "messages": messages,
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": effort, "format": {"type": "json_schema", "schema": schema}},
        }
        if tool_defs:
            params["tools"] = tool_defs
        resp = create(agent, params)
        stop = resp.get("stop_reason")
        if stop == "refusal":
            raise LLMError(f"{agent}: refusal {resp.get('stop_details')}")
        if stop == "max_tokens":
            raise LLMError(f"{agent}: hit max_tokens")
        blocks = resp.get("content", [])
        if stop == "tool_use":
            messages.append({"role": "assistant", "content": [_clean_block(b) for b in blocks]})
            results = []
            for b in blocks:
                if b.get("type") != "tool_use":
                    continue
                errs = _check(b.get("input"), schemas.get(b["name"], {}))
                if b["name"] not in (tool_impl or {}):
                    out, is_err = f"unknown tool {b['name']}", True
                elif errs:
                    out, is_err = "invalid input: " + "; ".join(errs), True
                else:
                    try:
                        out, is_err = tool_impl[b["name"]](b["input"]), False
                    except Exception as e:  # tool errors go back to the model
                        out, is_err = f"error: {e}", True
                if log:
                    log("tool", {"agent": agent, "tool": b["name"], "input": b["input"], "error": is_err})
                results.append({"type": "tool_result", "tool_use_id": b["id"], "content": out, "is_error": is_err})
            messages.append({"role": "user", "content": results})
            continue
        if stop == "pause_turn":
            messages.append({"role": "assistant", "content": [_clean_block(b) for b in blocks]})
            continue
        text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text")
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            raise LLMError(f"{agent}: final answer was not JSON ({e}): {text[:300]}")
    raise LLMError(f"{agent}: no final answer after {max_turns} turns")
