import re
from unittest import mock
from src.reports import ai_summary_suggester as ass

_VAR_RE = re.compile(r"\{\{\s*(\w+)\s*\}\}")

def _cfg():
    return {"ai": {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o", "max_tokens": 1500},
            "form": {"alias": "survey"},
            "questions": [{"export_label": "Region", "category": "categorical"}]}

def test_summary_suggester_uses_lf_client(monkeypatch):
    # Ensure Langfuse is disabled so get_prompt takes the seed path and runs
    # compile_messages against the real caller variables.
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)

    with mock.patch("src.utils.lf_client.chat",
                    return_value='{"summaries":[{"name":"s1","stat":"distribution","questions":["Region"]}]}') as ch:
        out = ass.suggest_summaries(_cfg())

    assert out and out[0]["name"] == "s1"
    assert ch.call_args.kwargs["trace_name"] == "summary_suggester"
    assert "summaries" in ch.call_args.kwargs["output_schema"]["properties"]

    # Verify real compile ran: no pure-word {{tokens}} remain unresolved.
    # Note: {{ summary_<name> }} in the system prompt is intentional docxtpl documentation
    # and does NOT match \w+ (contains '<'), so it is safe and won't appear here.
    sent = ch.call_args.args[0]
    for m in sent:
        unresolved = set(_VAR_RE.findall(m["content"]))
        assert not unresolved, (
            f"Message role={m['role']!r} has unresolved {{{{...}}}} tokens: {unresolved}"
        )
