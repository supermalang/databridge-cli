from src.utils import lf_client


def test_ask_charts_prompt_resolves_offline():
    msgs = lf_client.get_prompt("ask_charts", {
        "question": "How many people by region?",
        "catalog": "{}",
        "chart_types": "bar: >=1 categorical",
    })
    assert isinstance(msgs, list) and msgs
    blob = " ".join(m["content"] for m in msgs)
    assert "How many people by region?" in blob


def test_ask_caption_prompt_resolves_offline():
    msgs = lf_client.get_prompt("ask_caption", {"charts_block": "chart_a — Region: N=5"})
    blob = " ".join(m["content"] for m in msgs)
    assert "chart_a" in blob
