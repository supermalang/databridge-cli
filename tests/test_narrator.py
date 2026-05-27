from unittest import mock
import pandas as pd
from src.reports import narrator


def test_narrator_no_ai_cfg_returns_empty():
    out = narrator.generate_narrative({}, {}, pd.DataFrame({"a": [1]}), [], {}, [])
    assert out == {"summary_text": "", "observations": "", "recommendations": ""}


def test_narrator_calls_lf_client_and_parses(monkeypatch):
    ai_cfg = {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o", "max_tokens": 1500}
    df = pd.DataFrame({"Region": ["North", "South", "North"]})
    fake_msgs = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
    with mock.patch("src.utils.lf_client.get_prompt", return_value=fake_msgs) as gp, \
         mock.patch("src.utils.lf_client.chat",
                    return_value='{"summary_text":"S","observations":"O","recommendations":"R"}') as ch:
        out = narrator.generate_narrative(ai_cfg, {"title": "T", "period": "Q1"}, df, [], {}, [])
    assert out == {"summary_text": "S", "observations": "O", "recommendations": "R"}
    assert gp.call_args.args[0] == "narrator"
    assert ch.call_args.kwargs["trace_name"] == "narrator"
    assert ch.call_args.kwargs["json_mode"] is True
    variables = gp.call_args.args[1] if len(gp.call_args.args) > 1 else gp.call_args.kwargs["variables"]
    assert "categorical_block" in variables and "n_submissions" in variables
