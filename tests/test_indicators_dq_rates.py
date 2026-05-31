import pandas as pd
import pytest
from src.reports.indicators import compute_indicators, _compute


# ---- outlier_rate ----
def test_outlier_rate_flags_extreme_value():
    # 9 tight values + 1 extreme; with k=3 IQR the 1000 is an outlier -> 1/10 = 10%
    df = pd.DataFrame({"V": [10, 11, 12, 13, 14, 15, 16, 17, 18, 1000]})
    ctx = compute_indicators(
        [{"name": "o", "stat": "outlier_rate", "question": "V", "format": "percent"}], df)
    assert ctx["ind_o"] == "10.0%"


def test_outlier_rate_zero_when_constant():
    df = pd.DataFrame({"V": [5, 5, 5, 5, 5]})   # no IQR fence -> 0 outliers
    ctx = compute_indicators(
        [{"name": "o", "stat": "outlier_rate", "question": "V", "format": "percent"}], df)
    assert ctx["ind_o"] == "0.0%"


def test_outlier_rate_zero_on_non_numeric():
    df = pd.DataFrame({"V": ["a", "b", "c", "d"]})
    ctx = compute_indicators(
        [{"name": "o", "stat": "outlier_rate", "question": "V", "format": "percent"}], df)
    assert ctx["ind_o"] == "0.0%"


# ---- duplicate_rate ----
def test_duplicate_rate_counts_redundant_copies():
    df = pd.DataFrame({"ID": ["a", "a", "b", "c"]})   # one redundant copy of 'a' -> 1/4 = 25%
    ctx = compute_indicators(
        [{"name": "d", "stat": "duplicate_rate", "question": "ID", "format": "percent"}], df)
    assert ctx["ind_d"] == "25.0%"


def test_duplicate_rate_zero_when_unique():
    df = pd.DataFrame({"ID": ["a", "b", "c"]})
    ctx = compute_indicators(
        [{"name": "d", "stat": "duplicate_rate", "question": "ID", "format": "percent"}], df)
    assert ctx["ind_d"] == "0.0%"


# ---- shared: require a question ----
def test_dq_rates_require_question_raise():
    with pytest.raises(ValueError):
        _compute({"stat": "outlier_rate"}, pd.DataFrame({"A": [1, 2]}))
    with pytest.raises(ValueError):
        _compute({"stat": "duplicate_rate"}, pd.DataFrame({"A": [1, 2]}))


def test_dq_rate_no_question_failsoft_via_compute_indicators():
    ctx = compute_indicators([{"name": "x", "stat": "outlier_rate"}], pd.DataFrame({"A": [1, 2]}))
    assert ctx["ind_x"] == "N/A"


# ---- disaggregation interplay ----
def test_duplicate_rate_supports_disaggregation():
    df = pd.DataFrame({
        "Region": ["N", "N", "S", "S"],
        "ID":     ["a", "a", "b", "c"],   # N: a,a -> 1/2=50% ; S: b,c -> 0%
    })
    ctx = compute_indicators(
        [{"name": "d", "stat": "duplicate_rate", "question": "ID",
          "format": "percent", "disaggregate_by": "Region"}], df)
    by = {r["group"]: r["formatted"] for r in ctx["ind_d_breakdown"]}
    assert by == {"N": "50.0%", "S": "0.0%"}
