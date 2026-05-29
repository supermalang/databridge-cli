import re
from unittest import mock
import pandas as pd
from src.data import classifier

_VAR_RE = re.compile(r"\{\{\s*(\w+)\s*\}\}")

AI = {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o", "max_tokens": 1500}

def test_discover_themes_uses_classifier_discover_prompt(monkeypatch):
    # Ensure Langfuse is disabled so get_prompt takes the seed path and runs
    # compile_messages against the real caller variables.
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)

    s = pd.Series(["water is bad", "no food", "water again"])
    with mock.patch("src.utils.lf_client.chat", return_value='{"themes":["Water","Food"]}') as ch:
        themes = classifier.discover_themes(s, "Issues", 2, AI)

    assert themes == ["Water", "Food"]
    assert ch.call_args.kwargs["trace_name"] == "classifier_discover"

    # Verify real compile ran: no pure-word {{tokens}} remain unresolved.
    sent = ch.call_args.args[0]
    for m in sent:
        unresolved = set(_VAR_RE.findall(m["content"]))
        assert not unresolved, (
            f"Message role={m['role']!r} has unresolved {{{{...}}}} tokens: {unresolved}"
        )

def test_classify_responses_uses_classifier_classify_prompt(monkeypatch):
    # Ensure Langfuse is disabled so get_prompt takes the seed path and runs
    # compile_messages against the real caller variables.
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)

    s = pd.Series(["water bad", "hungry"])
    with mock.patch("src.utils.lf_client.chat",
                    return_value='{"classifications":{"water bad":"Water","hungry":"Food"}}') as ch:
        out = classifier.classify_responses(s, ["Water", "Food"], "Issues", AI)

    assert list(out) == ["Water", "Food"]
    assert ch.call_args.kwargs["trace_name"] == "classifier_classify"

    # Verify real compile ran: no pure-word {{tokens}} remain unresolved.
    sent = ch.call_args.args[0]
    for m in sent:
        unresolved = set(_VAR_RE.findall(m["content"]))
        assert not unresolved, (
            f"Message role={m['role']!r} has unresolved {{{{...}}}} tokens: {unresolved}"
        )
