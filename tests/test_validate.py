import pandas as pd
from src.data.validate import compute_missingness


def test_missingness_flat_dataframe_no_missing():
    df = pd.DataFrame({"a": [1, 2, 3], "b": ["x", "y", "z"]})
    findings = compute_missingness(df)
    assert findings == []


def test_missingness_returns_warning_for_20_to_50_percent_missing():
    # 6 rows, 2 missing in 'a' → 33%
    df = pd.DataFrame({"a": [1, None, 3, None, 5, 6], "b": ["x"] * 6})
    findings = compute_missingness(df)
    a = [f for f in findings if f["column"] == "a"]
    assert len(a) == 1
    assert a[0]["severity"] == "warning"
    assert a[0]["count"] == 2
    assert round(a[0]["pct"], 2) == 0.33
    assert a[0]["kind"] == "missingness"


def test_missingness_returns_error_for_over_50_percent_missing():
    df = pd.DataFrame({"a": [1, None, None, None], "b": ["x"] * 4})
    findings = compute_missingness(df)
    a = [f for f in findings if f["column"] == "a"]
    assert a and a[0]["severity"] == "error"


def test_missingness_treats_empty_string_as_missing():
    df = pd.DataFrame({"a": ["", "", "", "x"]})
    findings = compute_missingness(df)
    a = [f for f in findings if f["column"] == "a"]
    assert a and a[0]["count"] == 3


def test_missingness_under_threshold_is_info_or_skipped():
    # 100 rows, 5 missing → 5% — at the 5% INFO threshold, classified info.
    df = pd.DataFrame({"a": [None] * 5 + [1] * 95})
    findings = compute_missingness(df)
    a = [f for f in findings if f["column"] == "a"]
    assert a and a[0]["severity"] == "info"
