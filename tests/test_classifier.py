from unittest import mock
import pandas as pd
from src.data import classifier

AI = {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o", "max_tokens": 1500}

def test_discover_themes_uses_classifier_discover_prompt():
    s = pd.Series(["water is bad", "no food", "water again"])
    fake_msgs = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
    with mock.patch("src.utils.lf_client.get_prompt", return_value=fake_msgs) as gp, \
         mock.patch("src.utils.lf_client.chat", return_value='{"themes":["Water","Food"]}') as ch:
        themes = classifier.discover_themes(s, "Issues", 2, AI)
    assert themes == ["Water", "Food"]
    assert gp.call_args.args[0] == "classifier_discover"
    assert ch.call_args.kwargs["trace_name"] == "classifier_discover"
    variables = gp.call_args.args[1] if len(gp.call_args.args) > 1 else gp.call_args.kwargs["variables"]
    assert {"label", "responses", "theme_count"} <= set(variables)

def test_classify_responses_uses_classifier_classify_prompt():
    s = pd.Series(["water bad", "hungry"])
    fake_msgs = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
    with mock.patch("src.utils.lf_client.get_prompt", return_value=fake_msgs) as gp, \
         mock.patch("src.utils.lf_client.chat",
                    return_value='{"classifications":{"water bad":"Water","hungry":"Food"}}') as ch:
        out = classifier.classify_responses(s, ["Water", "Food"], "Issues", AI)
    assert list(out) == ["Water", "Food"]
    assert gp.call_args.args[0] == "classifier_classify"
    assert ch.call_args.kwargs["trace_name"] == "classifier_classify"
    variables = gp.call_args.args[1] if len(gp.call_args.args) > 1 else gp.call_args.kwargs["variables"]
    assert {"label", "themes_str", "responses"} <= set(variables)
