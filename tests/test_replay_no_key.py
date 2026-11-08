"""Replay must work with no API key: a key is needed only when a call misses the cache."""
import json

import pytest

from ledger import llm


@pytest.fixture
def no_key(monkeypatch, tmp_path):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(llm, "load_env", lambda: None)   # ignore a local .env
    monkeypatch.setattr(llm, "CACHE", tmp_path)
    monkeypatch.setattr(llm, "_client", None)
    return tmp_path


def test_cache_hit_needs_no_key(no_key, monkeypatch):
    monkeypatch.setenv("LEDGER_REPLAY_ONLY", "1")
    params = {"model": "m", "messages": [{"role": "user", "content": "hi"}]}
    key = llm.request_hash(params)
    (no_key / "extractor").mkdir()
    (no_key / "extractor" / f"{key}.json").write_text(json.dumps({"response": {"content": []}}))
    assert llm.create("extractor", params) == {"content": []}


def test_replay_miss_names_the_missing_entry(no_key, monkeypatch):
    monkeypatch.setenv("LEDGER_REPLAY_ONLY", "1")
    with pytest.raises(llm.LLMUnavailable, match="replay-only"):
        llm.create("extractor", {"model": "m", "messages": []})


def test_live_miss_without_key_says_key_missing(no_key, monkeypatch):
    monkeypatch.delenv("LEDGER_REPLAY_ONLY", raising=False)
    with pytest.raises(llm.LLMUnavailable, match="ANTHROPIC_API_KEY"):
        llm.create("extractor", {"model": "m", "messages": []})
