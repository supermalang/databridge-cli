import re
from unittest import mock
import pandas as pd
from src.reports import narrator
from src.utils.seed_prompts import SEED_PROMPTS

_VAR_RE = re.compile(r"\{\{\s*(\w+)\s*\}\}")


def test_narrator_no_ai_cfg_returns_empty():
    out = narrator.generate_narrative({}, {}, pd.DataFrame({"a": [1]}), [], {}, [])
    assert out == {"summary_text": "", "observations": "", "recommendations": ""}


def test_narrator_calls_lf_client_and_parses(monkeypatch):
    # Ensure Langfuse is disabled so get_prompt takes the seed path and runs
    # compile_messages against the real caller variables.
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)

    ai_cfg = {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o", "max_tokens": 1500}
    df = pd.DataFrame({"Region": ["North", "South", "North"]})
    with mock.patch("src.utils.lf_client.chat",
                    return_value='{"summary_text":"S","observations":"O","recommendations":"R"}') as ch:
        out = narrator.generate_narrative(ai_cfg, {"title": "T", "period": "Q1"}, df, [], {}, [])

    assert out == {"summary_text": "S", "observations": "O", "recommendations": "R"}
    assert ch.call_args.kwargs["trace_name"] == "narrator"
    assert ch.call_args.kwargs["json_mode"] is True
    assert ch.call_args.kwargs["output_schema"] == \
        SEED_PROMPTS["narrator"]["config"]["output_schema"]

    # Verify real compile ran: no pure-word {{tokens}} remain unresolved.
    sent = ch.call_args.args[0]
    for m in sent:
        unresolved = set(_VAR_RE.findall(m["content"]))
        assert not unresolved, (
            f"Message role={m['role']!r} has unresolved {{{{...}}}} tokens: {unresolved}"
        )
