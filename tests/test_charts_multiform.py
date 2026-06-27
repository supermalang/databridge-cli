"""ME-7 — Chart `form:` selector for multi-form.

Tests are derived strictly from the ME-7 Acceptance Criteria:
  - A chart with `form: <alias>` renders from that alias's DataFrame
  - A chart without `form:` renders from the default DataFrame (no regression)
  - An unknown alias fails with a clear error (not a silent wrong-data chart)

We test `_resolve_chart_df` — the module-level helper that encapsulates the
per-form selection logic — directly with small DataFrames so no matplotlib,
file I/O, or template machinery is needed.
"""
import pandas as pd
import pytest

from src.reports.builder import _resolve_chart_df


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def baseline_df():
    return pd.DataFrame({"Score": [10, 20, 30], "_id": [1, 2, 3]})


@pytest.fixture
def endline_df():
    return pd.DataFrame({"Score": [70, 80, 90], "_id": [4, 5, 6]})


@pytest.fixture
def default_df():
    return pd.DataFrame({"Score": [1, 2, 3], "_id": [7, 8, 9]})


@pytest.fixture
def per_form(baseline_df, endline_df):
    return {
        "baseline": {"df": baseline_df, "repeat_tables": {}},
        "endline":  {"df": endline_df,  "repeat_tables": {}},
    }


# ---------------------------------------------------------------------------
# AC1 — form: baseline selects the baseline DataFrame, not the default
# ---------------------------------------------------------------------------

def test_form_selector_baseline(default_df, per_form, baseline_df):
    chart_cfg = {"name": "pre_score", "type": "bar", "questions": ["Score"], "form": "baseline"}
    df_out, _ = _resolve_chart_df(chart_cfg, default_df, {}, per_form)
    assert df_out["Score"].mean() == baseline_df["Score"].mean()
    assert df_out["Score"].mean() != default_df["Score"].mean()


# AC2 — form: endline selects the endline DataFrame
def test_form_selector_endline(default_df, per_form, endline_df):
    chart_cfg = {"name": "post_score", "type": "bar", "questions": ["Score"], "form": "endline"}
    df_out, _ = _resolve_chart_df(chart_cfg, default_df, {}, per_form)
    assert df_out["Score"].mean() == endline_df["Score"].mean()
    assert df_out["Score"].mean() != default_df["Score"].mean()


# AC3 — no form: key uses the default DataFrame (no regression)
def test_no_form_key_uses_default(default_df, per_form):
    chart_cfg = {"name": "overall", "type": "bar", "questions": ["Score"]}
    df_out, _ = _resolve_chart_df(chart_cfg, default_df, {}, per_form)
    assert df_out["Score"].tolist() == default_df["Score"].tolist()


# AC3b — absent per_form still works when chart has no form: key
def test_no_form_key_and_no_per_form(default_df):
    chart_cfg = {"name": "overall", "type": "bar", "questions": ["Score"]}
    df_out, _ = _resolve_chart_df(chart_cfg, default_df, {}, per_form=None)
    assert df_out["Score"].tolist() == default_df["Score"].tolist()


# AC4 — unknown alias raises a clear error
def test_unknown_alias_raises(default_df, per_form):
    chart_cfg = {"name": "bad", "type": "bar", "questions": ["Score"], "form": "nonexistent"}
    with pytest.raises(ValueError, match="nonexistent"):
        _resolve_chart_df(chart_cfg, default_df, {}, per_form)


# AC4b — unknown alias when per_form is None also raises (no silent wrong-data chart)
def test_unknown_alias_raises_when_per_form_none(default_df):
    chart_cfg = {"name": "bad", "type": "bar", "questions": ["Score"], "form": "baseline"}
    with pytest.raises(ValueError, match="baseline"):
        _resolve_chart_df(chart_cfg, default_df, {}, per_form=None)
