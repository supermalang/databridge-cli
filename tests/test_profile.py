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


from src.data.profile import profile_column


def test_profile_column_quantitative():
    s = pd.Series([10, 12, 14, 16, 18, 999], name="Age")
    p = profile_column(s, "quantitative")
    assert p["name"] == "Age" and p["role"] == "quantitative"
    assert p["count"] == 6 and p["missing"] == 0 and p["distinct"] == 6
    assert p["min"] == 10.0 and p["max"] == 999.0
    assert p["outlier_count"] == 1 and p["outlier_bounds"] is not None


def test_profile_column_quantitative_type_issue():
    s = pd.Series(["10", "n/a", "12", ""], name="Count")
    p = profile_column(s, "quantitative")
    assert p["type_issue_count"] == 1


def test_profile_column_categorical_low_cardinality_has_top_values():
    s = pd.Series(["A", "A", "B", None], name="Region")
    p = profile_column(s, "categorical")
    assert p["high_cardinality"] is False
    top = {d["value"]: d["count"] for d in p["top_values"]}
    assert top == {"A": 2, "B": 1}


def test_profile_column_high_cardinality_suppresses_values():
    s = pd.Series([f"v{i}" for i in range(25)], name="FreeText")
    p = profile_column(s, "qualitative")
    assert p["high_cardinality"] is True
    assert "top_values" not in p


def test_profile_column_date_range():
    s = pd.Series(["2026-01-01", "2026-01-31", None], name="When")
    p = profile_column(s, "date")
    assert p["min_date"].startswith("2026-01-01")
    assert p["span_days"] == 30


def test_profile_column_linkage_is_minimal():
    s = pd.Series([1, 2, 3], name="_root_id")
    p = profile_column(s, "linkage")
    assert p["role"] == "linkage"
    assert "min" not in p and "top_values" not in p


from src.data.profile import profile_table


def test_profile_table_columns_correlations_duplicates():
    df = pd.DataFrame({
        "_id": [1, 1, 3],
        "Region": ["N", "S", "N"],
        "Age": [10, 20, 30],
        "Income": [100, 200, 300],
    })
    role_map = {"Region": "categorical", "Age": "quantitative", "Income": "quantitative"}
    tp = profile_table(df, role_map)
    assert tp["rows"] == 3
    names = {c["name"]: c for c in tp["columns"]}
    assert names["_id"]["role"] == "linkage"
    assert names["Region"]["role"] == "categorical"
    assert any({p["a"], p["b"]} == {"Age", "Income"} for p in tp["correlations"])
    assert tp["duplicates"]["id_col"] == "_id"
    assert tp["duplicates"]["duplicate_rows"] == 2 and tp["duplicates"]["groups"] == 1


def test_profile_table_no_duplicates_returns_none():
    df = pd.DataFrame({"_id": [1, 2], "X": [3, 4]})
    tp = profile_table(df, {"X": "quantitative"})
    assert tp["duplicates"] is None
