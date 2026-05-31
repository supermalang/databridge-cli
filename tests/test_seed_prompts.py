import re
from src.utils.seed_prompts import SEED_PROMPTS

EXPECTED_NAMES = {
    "narrator", "summaries", "chart_suggester", "template_generator",
    "summary_suggester", "view_suggester", "classifier_discover", "classifier_classify",
    "ask_propose", "ask_caption",
}

def test_all_ten_prompts_present():
    assert set(SEED_PROMPTS) == EXPECTED_NAMES

def test_each_prompt_is_system_then_user():
    for name, msgs in SEED_PROMPTS.items():
        roles = [m["role"] for m in msgs]
        assert roles == ["system", "user"], f"{name} roles = {roles}"
        for m in msgs:
            assert isinstance(m["content"], str) and m["content"].strip()

def test_no_leftover_single_brace_format_slots():
    single = re.compile(r"(?<!\{)\{[a-z_][a-z0-9_]*\}(?!\})")
    for name, msgs in SEED_PROMPTS.items():
        for m in msgs:
            assert not single.search(m["content"]), f"{name} has a single-brace slot"

def test_narrator_user_has_expected_variables():
    user = SEED_PROMPTS["narrator"][1]["content"]
    for var in ("language", "title", "period", "n_submissions",
                "indicators_block", "stats_block", "categorical_block",
                "summaries_block", "charts_block"):
        assert "{{" + var + "}}" in user
