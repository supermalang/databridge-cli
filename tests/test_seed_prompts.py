import re
from src.utils.seed_prompts import SEED_PROMPTS

EXPECTED_NAMES = {
    "narrator", "summaries", "chart_suggester", "template_generator",
    "summary_suggester", "view_suggester", "classifier_discover", "classifier_classify",
}

def test_all_eight_prompts_present():
    assert set(SEED_PROMPTS) == EXPECTED_NAMES

def test_each_entry_is_messages_plus_config():
    for name, entry in SEED_PROMPTS.items():
        assert isinstance(entry, dict), f"{name} must be a dict"
        assert set(entry) >= {"messages", "config"}, f"{name} missing keys: {set(entry)}"
        assert isinstance(entry["config"], dict), f"{name} config must be a dict"
        msgs = entry["messages"]
        roles = [m["role"] for m in msgs]
        assert roles == ["system", "user"], f"{name} roles = {roles}"
        for m in msgs:
            assert isinstance(m["content"], str) and m["content"].strip()

def test_no_leftover_single_brace_format_slots():
    single = re.compile(r"(?<!\{)\{[a-z_][a-z0-9_]*\}(?!\})")
    for name, entry in SEED_PROMPTS.items():
        for m in entry["messages"]:
            assert not single.search(m["content"]), f"{name} has a single-brace slot"

def test_narrator_user_has_expected_variables():
    user = SEED_PROMPTS["narrator"]["messages"][1]["content"]
    for var in ("language", "title", "period", "n_submissions",
                "indicators_block", "stats_block", "categorical_block",
                "summaries_block", "charts_block"):
        assert "{{" + var + "}}" in user

def test_narrator_has_output_schema():
    schema = SEED_PROMPTS["narrator"]["config"]["output_schema"]
    assert schema["type"] == "object"
    assert set(schema["required"]) == {"summary_text", "observations", "recommendations"}
    assert schema["additionalProperties"] is False
