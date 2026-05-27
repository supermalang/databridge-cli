from unittest import mock
from src.reports import ai_summary_suggester as ass

def _cfg():
    return {"ai": {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o", "max_tokens": 1500},
            "form": {"alias": "survey"},
            "questions": [{"export_label": "Region", "category": "categorical"}]}

def test_summary_suggester_uses_lf_client():
    fake_msgs = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
    with mock.patch("src.utils.lf_client.get_prompt", return_value=fake_msgs) as gp, \
         mock.patch("src.utils.lf_client.chat",
                    return_value='{"summaries":[{"name":"s1","stat":"distribution","questions":["Region"]}]}') as ch:
        out = ass.suggest_summaries(_cfg())
    assert out and out[0]["name"] == "s1"
    assert gp.call_args.args[0] == "summary_suggester"
    assert ch.call_args.kwargs["trace_name"] == "summary_suggester"
    variables = gp.call_args.args[1] if len(gp.call_args.args) > 1 else gp.call_args.kwargs["variables"]
    assert {"header_line", "form_alias", "columns_block",
            "existing_summaries_block", "existing_charts_block"} <= set(variables)
