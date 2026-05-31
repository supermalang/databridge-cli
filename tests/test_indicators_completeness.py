import pandas as pd
import pytest
from src.reports.indicators import compute_indicators, _compute


def test_completeness_percent_of_present():
    df = pd.DataFrame({"Phone": ["a", "b", "c", None]})   # 3 present of 4
    ctx = compute_indicators(
        [{"name": "phone_done", "stat": "completeness", "question": "Phone", "format": "percent"}], df)
    assert ctx["ind_phone_done"] == "75.0%"


def test_completeness_treats_blank_as_missing():
    df = pd.DataFrame({"Phone": ["a", "  ", "c", "d"]})   # blank-after-strip is missing -> 3 of 4
    ctx = compute_indicators(
        [{"name": "p", "stat": "completeness", "question": "Phone", "format": "percent"}], df)
    assert ctx["ind_p"] == "75.0%"


def test_completeness_requires_a_question_failsoft():
    # via compute_indicators: per-indicator guard -> "N/A"
    ctx = compute_indicators([{"name": "x", "stat": "completeness"}], pd.DataFrame({"A": [1, 2]}))
    assert ctx["ind_x"] == "N/A"


def test_compute_completeness_raises_without_question():
    with pytest.raises(ValueError):
        _compute({"stat": "completeness"}, pd.DataFrame({"A": [1, 2]}))


def test_completeness_supports_disaggregation():
    df = pd.DataFrame({
        "Region": ["N", "N", "S", "S"],
        "Phone":  ["a", None, "c", "d"],   # N: 1/2=50%, S: 2/2=100%
    })
    ctx = compute_indicators(
        [{"name": "p", "stat": "completeness", "question": "Phone",
          "format": "percent", "disaggregate_by": "Region"}], df)
    by = {r["group"]: r["formatted"] for r in ctx["ind_p_breakdown"]}
    assert by == {"N": "50.0%", "S": "100.0%"}


def test_completeness_empty_df_is_zero():
    ctx = compute_indicators(
        [{"name": "p", "stat": "completeness", "question": "Phone", "format": "percent"}],
        pd.DataFrame({"Phone": []}))
    assert ctx["ind_p"] == "0.0%"
