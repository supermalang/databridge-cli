from src.utils.periods import slugify, current_period, parse_period_arg


def test_slugify_basic():
    assert slugify("Q1 2026") == "q1_2026"

def test_slugify_strips_accents():
    assert slugify("Année 1") == "annee_1"

def test_slugify_collapses_punctuation():
    assert slugify("Q1 2026 — Baseline!") == "q1_2026_baseline"

def test_slugify_truncates_long_labels():
    assert len(slugify("a very long period label " * 20)) <= 32

def test_slugify_strips_leading_trailing_underscores():
    s = slugify("___Q1 2026___")
    assert not s.startswith("_") and not s.endswith("_")

def test_current_period_returns_none_when_no_periods_block():
    assert current_period({}) is None

def test_current_period_returns_label_when_set():
    cfg = {"periods": {"current": "Q2 2026", "registry": [{"label": "Q2 2026", "slug": "q2_2026"}]}}
    p = current_period(cfg)
    assert p == {"label": "Q2 2026", "slug": "q2_2026"}

def test_current_period_auto_derives_slug_if_missing():
    cfg = {"periods": {"current": "Q2 2026", "registry": [{"label": "Q2 2026"}]}}
    p = current_period(cfg)
    assert p["slug"] == "q2_2026"

def test_parse_period_arg_explicit_label_overrides_current():
    cfg = {"periods": {"current": "Q1 2026", "registry": [
        {"label": "Q1 2026", "slug": "q1_2026"},
        {"label": "Q2 2026", "slug": "q2_2026"},
    ]}}
    p = parse_period_arg(cfg, "Q2 2026")
    assert p["label"] == "Q2 2026"

def test_parse_period_arg_unknown_label_creates_ephemeral():
    cfg = {"periods": {"current": "Q1 2026", "registry": []}}
    p = parse_period_arg(cfg, "Q3 2026")
    assert p == {"label": "Q3 2026", "slug": "q3_2026"}
