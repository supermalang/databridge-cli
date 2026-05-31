import re
from unittest import mock
from src.reports import ai_view_suggester as avs

_VAR_RE = re.compile(r"\{\{\s*(\w+)\s*\}\}")

def _cfg():
    return {"ai": {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o", "max_tokens": 1500},
            "form": {"alias": "survey"},
            "questions": [{"export_label": "Region", "category": "categorical"}]}

def test_view_suggester_uses_lf_client(monkeypatch):
    # Ensure Langfuse is disabled so get_prompt takes the seed path and runs
    # compile_messages against the real caller variables.
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)

    with mock.patch("src.utils.lf_client.chat",
                    return_value='{"views":[{"name":"v1","source":"main"}]}') as ch:
        out = avs.suggest_views(_cfg())

    assert out and out[0]["name"] == "v1"
    assert ch.call_args.kwargs["trace_name"] == "view_suggester"
    assert "views" in ch.call_args.kwargs["output_schema"]["properties"]

    # Verify real compile ran: no pure-word {{tokens}} remain unresolved.
    sent = ch.call_args.args[0]
    for m in sent:
        unresolved = set(_VAR_RE.findall(m["content"]))
        assert not unresolved, (
            f"Message role={m['role']!r} has unresolved {{{{...}}}} tokens: {unresolved}"
        )
