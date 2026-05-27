from unittest import mock
from src.reports import ai_chart_suggester as acs

def _cfg():
    return {
        "ai": {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o", "max_tokens": 1500},
        "form": {"alias": "survey"},
        "questions": [{"export_label": "Region", "category": "categorical"}],
    }

def test_suggest_charts_uses_lf_client():
    fake_msgs = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
    with mock.patch("src.utils.lf_client.get_prompt", return_value=fake_msgs) as gp, \
         mock.patch("src.utils.lf_client.chat",
                    return_value='{"charts":[{"name":"r","type":"bar","questions":["Region"]}]}') as ch:
        charts = acs.suggest_charts(_cfg())
    assert charts and charts[0]["name"] == "r"
    assert gp.call_args.args[0] == "chart_suggester"
    assert ch.call_args.kwargs["trace_name"] == "chart_suggester"
    assert ch.call_args.kwargs["json_mode"] is True
    assert ch.call_args.kwargs["max_tokens"] >= 3000
    variables = gp.call_args.args[1] if len(gp.call_args.args) > 1 else gp.call_args.kwargs["variables"]
    assert "columns_block" in variables and "form_alias" in variables
