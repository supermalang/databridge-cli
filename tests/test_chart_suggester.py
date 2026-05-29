import re
from unittest import mock
from src.reports import ai_chart_suggester as acs

_VAR_RE = re.compile(r"\{\{\s*(\w+)\s*\}\}")

def _cfg():
    return {
        "ai": {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o", "max_tokens": 1500},
        "form": {"alias": "survey"},
        "questions": [{"export_label": "Region", "category": "categorical"}],
    }

def test_suggest_charts_uses_lf_client(monkeypatch):
    # Ensure Langfuse is disabled so get_prompt takes the seed path and runs
    # compile_messages against the real caller variables.
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)

    with mock.patch("src.utils.lf_client.chat",
                    return_value='{"charts":[{"name":"r","type":"bar","questions":["Region"]}]}') as ch:
        charts = acs.suggest_charts(_cfg())

    assert charts and charts[0]["name"] == "r"
    assert ch.call_args.kwargs["trace_name"] == "chart_suggester"
    assert ch.call_args.kwargs["json_mode"] is True
    assert ch.call_args.kwargs["max_tokens"] >= 3000

    # Verify real compile ran: no pure-word {{tokens}} remain unresolved.
    sent = ch.call_args.args[0]
    for m in sent:
        unresolved = set(_VAR_RE.findall(m["content"]))
        assert not unresolved, (
            f"Message role={m['role']!r} has unresolved {{{{...}}}} tokens: {unresolved}"
        )
