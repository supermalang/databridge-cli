from unittest import mock
from src.reports import ai_view_suggester as avs

def _cfg():
    return {"ai": {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o", "max_tokens": 1500},
            "form": {"alias": "survey"},
            "questions": [{"export_label": "Region", "category": "categorical"}]}

def test_view_suggester_uses_lf_client():
    fake_msgs = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
    with mock.patch("src.utils.lf_client.get_prompt", return_value=fake_msgs) as gp, \
         mock.patch("src.utils.lf_client.chat",
                    return_value='{"views":[{"name":"v1","source":"main"}]}') as ch:
        out = avs.suggest_views(_cfg())
    assert out and out[0]["name"] == "v1"
    assert gp.call_args.args[0] == "view_suggester"
    assert ch.call_args.kwargs["trace_name"] == "view_suggester"
    variables = gp.call_args.args[1] if len(gp.call_args.args) > 1 else gp.call_args.kwargs["variables"]
    assert {"header_line", "form_alias", "main_cols_block",
            "existing_views_block", "existing_charts_block"} <= set(variables)
