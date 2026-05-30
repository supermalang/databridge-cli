import pandas as pd
from src.data.profile import null_stats, iqr_bounds, numeric_outliers


def test_null_stats_counts_nan_and_blank_as_missing():
    s = pd.Series(["a", "", None, "b"])
    assert null_stats(s) == {"present": 2, "missing": 2, "missing_pct": 0.5}


def test_null_stats_empty_series():
    assert null_stats(pd.Series([], dtype=object)) == {"present": 0, "missing": 0, "missing_pct": 0.0}


def test_iqr_bounds_3x_default():
    s = pd.Series([10, 12, 14, 16, 18, 20])
    lo, hi = iqr_bounds(s)
    assert round(lo, 1) == -2.5 and round(hi, 1) == 32.5


def test_iqr_bounds_none_when_too_few_or_constant():
    assert iqr_bounds(pd.Series([1, 2, 3])) is None
    assert iqr_bounds(pd.Series([5, 5, 5, 5])) is None


def test_numeric_outliers_flags_extreme_value():
    s = pd.Series([10, 12, 14, 16, 18, 999])
    out = numeric_outliers(s)
    assert out["count"] == 1
    assert out["examples"] == [999]
    assert out["bounds"] is not None


def test_numeric_outliers_empty_when_no_bounds():
    assert numeric_outliers(pd.Series([1, 2, 3])) == {"count": 0, "bounds": None, "examples": []}


from src.data.profile import correlations


def test_correlations_returns_strong_pair():
    df = pd.DataFrame({"a": [1, 2, 3, 4, 5], "b": [2, 4, 6, 8, 10], "c": [5, 3, 6, 2, 9]})
    result = correlations(df, ["a", "b", "c"])
    pair = next(p for p in result if {p["a"], p["b"]} == {"a", "b"})
    assert pair["method"] == "pearson"
    assert round(pair["r"], 2) == 1.0


def test_correlations_skips_below_threshold_and_needs_two_columns():
    df = pd.DataFrame({"a": [1, 2, 3, 4]})
    assert correlations(df, ["a"]) == []
    df2 = pd.DataFrame({"a": [1, 2, 3, 4], "b": [1, 1, 1, 2]})
    assert all(abs(p["r"]) >= 0.1 for p in correlations(df2, ["a", "b"]))
