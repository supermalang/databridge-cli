import re
from unittest import mock
import pandas as pd
from src.reports import summaries

_VAR_RE = re.compile(r"\{\{\s*(\w+)\s*\}\}")


def test_ai_summary_uses_lf_client(monkeypatch):
    # Ensure Langfuse is disabled so get_prompt takes the seed path and runs
    # compile_messages against the real caller variables.
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)

    df = pd.DataFrame({"Age": [10, 20, 30]})
    ai_cfg = {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o", "max_tokens": 500}
    cfg = [{"name": "age_note", "stat": "ai", "questions": ["Age"], "prompt": "summarise age"}]
    with mock.patch("src.utils.lf_client.chat", return_value="Average age is 20.") as ch:
        out = summaries.compute_summaries(cfg, df, ai_cfg=ai_cfg)

    assert out["summary_age_note"] == "Average age is 20."
    assert ch.call_args.kwargs["trace_name"] == "summaries"
    assert ch.call_args.kwargs["output_schema"] is None    # summaries is plain text

    # Verify real compile ran: no pure-word {{tokens}} remain unresolved.
    sent = ch.call_args.args[0]
    for m in sent:
        unresolved = set(_VAR_RE.findall(m["content"]))
        assert not unresolved, (
            f"Message role={m['role']!r} has unresolved {{{{...}}}} tokens: {unresolved}"
        )


def test_non_ai_summary_unaffected():
    df = pd.DataFrame({"Region": ["N", "S", "N"]})
    cfg = [{"name": "reg", "stat": "distribution", "questions": ["Region"]}]
    out = summaries.compute_summaries(cfg, df)
    assert "summary_reg" in out and out["summary_reg"] != "N/A"
