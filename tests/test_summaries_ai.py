from unittest import mock
import pandas as pd
from src.reports import summaries


def test_ai_summary_uses_lf_client(monkeypatch):
    df = pd.DataFrame({"Age": [10, 20, 30]})
    ai_cfg = {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o", "max_tokens": 500}
    cfg = [{"name": "age_note", "stat": "ai", "questions": ["Age"], "prompt": "summarise age"}]
    fake_msgs = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
    with mock.patch("src.utils.lf_client.get_prompt", return_value=fake_msgs) as gp, \
         mock.patch("src.utils.lf_client.chat", return_value="Average age is 20.") as ch:
        out = summaries.compute_summaries(cfg, df, ai_cfg=ai_cfg)
    assert out["summary_age_note"] == "Average age is 20."
    assert gp.call_args.args[0] == "summaries"
    assert ch.call_args.kwargs["trace_name"] == "summaries"
    variables = gp.call_args.args[1] if len(gp.call_args.args) > 1 else gp.call_args.kwargs["variables"]
    assert set(["language", "focus_line", "data_block", "example_block"]) <= set(variables)


def test_non_ai_summary_unaffected():
    df = pd.DataFrame({"Region": ["N", "S", "N"]})
    cfg = [{"name": "reg", "stat": "distribution", "questions": ["Region"]}]
    out = summaries.compute_summaries(cfg, df)
    assert "summary_reg" in out and out["summary_reg"] != "N/A"
