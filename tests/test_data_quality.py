import pandas as pd
from src.reports.data_quality import build_data_quality, compute_data_quality


def _df():
    # Age uses 10 values so iqr_bounds returns a finite fence with 9999 as the sole outlier.
    # With [20..28, 9999]: Q1=21.75, Q3=26.25, IQR=4.5, fence=[8.75, 40.25] → 9999 outside.
    # (4-value [20,21,22,999] produced count=0 because the fence is too wide at k=3.)
    return pd.DataFrame({
        "_id":   [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],          # linkage col (underscore) -> excluded in fallback
        "Name":  ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],   # 100% complete, all unique
        "Phone": ["x", None, "y", "z", "w", None, "v", "u", "t", "s"], # 80% complete (8/10)
        "Age":   [20, 21, 22, 23, 24, 25, 26, 27, 28, 9999],            # 1 outlier (9999)
        "Site":  ["N", "N", "S", "S", "N", "N", "S", "S", "N", "S"],   # duplicates present
    })


def test_rows_have_formatted_metrics_from_questions():
    cfg = {"questions": [
        {"export_label": "Phone", "category": "qualitative"},
        {"export_label": "Site", "category": "categorical"},
    ]}
    dq = build_data_quality(cfg, _df())
    assert dq["has_data"] is True
    by = {r["column"]: r for r in dq["rows"]}
    assert set(by) == {"Phone", "Site"}                  # curated to configured questions
    assert by["Phone"]["completeness"] == "80.0%"
    assert by["Phone"]["outlier_rate"] == "—"            # non-numeric
    # Site: N,N,S,S,N,N,S,S,N,S -> first occurrence of each value is "first",
    # duplicated(keep="first") marks subsequent occurrences. N appears 5 times (4 dups),
    # S appears 5 times (4 dups) -> 8 duplicated of 10 = 80%
    assert by["Site"]["duplicate_rate"] == "80.0%"


def test_fallback_to_all_columns_excludes_linkage():
    dq = build_data_quality({}, _df())                   # no questions -> all non-_ columns
    cols = {r["column"] for r in dq["rows"]}
    assert "_id" not in cols
    assert {"Name", "Phone", "Age", "Site"} <= cols


def test_outlier_rate_for_numeric_column():
    dq = build_data_quality({"questions": [{"export_label": "Age", "category": "quantitative"}]}, _df())
    age = dq["rows"][0]
    # Age has 10 values; 9999 is beyond the 3xIQR fence [8.75, 40.25] -> 1/10 = 10%
    assert age["outlier_rate"] == "10.0%"


def test_empty_df_has_no_data():
    assert build_data_quality({}, pd.DataFrame()) == {"has_data": False, "rows": [], "tables": []}
    assert build_data_quality({}, None) == {"has_data": False, "rows": [], "tables": []}


def test_complete_unique_column():
    dq = build_data_quality({"questions": [{"export_label": "Name"}]}, _df())
    name = dq["rows"][0]
    assert name["completeness"] == "100.0%"
    assert name["duplicate_rate"] == "0.0%"


def test_compute_returns_numeric_values():
    cfg = {"questions": [
        {"export_label": "Phone", "category": "qualitative"},
        {"export_label": "Site", "category": "categorical"},
    ]}
    dq = compute_data_quality(cfg, _df())
    assert dq["has_data"] is True
    by = {r["column"]: r for r in dq["rows"]}
    assert by["Phone"]["completeness"] == 80.0          # float, not "80.0%"
    assert by["Phone"]["outlier_rate"] is None          # non-numeric -> None
    assert by["Site"]["duplicate_rate"] == 80.0


def test_compute_outlier_rate_numeric():
    dq = compute_data_quality(
        {"questions": [{"export_label": "Age", "category": "quantitative"}]}, _df())
    assert dq["rows"][0]["outlier_rate"] == 10.0


def test_compute_complete_unique_column():
    dq = compute_data_quality({"questions": [{"export_label": "Name"}]}, _df())
    name = dq["rows"][0]
    assert name["completeness"] == 100.0
    assert name["duplicate_rate"] == 0.0


def test_compute_empty_df_has_no_data():
    assert compute_data_quality({}, pd.DataFrame()) == {"has_data": False, "rows": [], "tables": []}
    assert compute_data_quality({}, None) == {"has_data": False, "rows": [], "tables": []}


def test_compute_bad_column_yields_all_none(monkeypatch):
    import src.reports.data_quality as dq_mod

    def _boom(col, s):
        raise ValueError("boom")

    monkeypatch.setattr(dq_mod, "_column_row", _boom)
    dq = compute_data_quality({"questions": [{"export_label": "Name"}]}, _df())
    row = dq["rows"][0]
    assert row["column"] == "Name"
    assert row["completeness"] is None
    assert row["outlier_rate"] is None
    assert row["duplicate_rate"] is None


def _repeats():
    # household_members: Name 100% complete & unique; Age has 1 outlier (9999)
    return {"household_members": pd.DataFrame({
        "_root_id": [1, 1, 2, 2, 3, 3, 4, 4, 5, 5],
        "Name": ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
        "Age":  [20, 21, 22, 23, 24, 25, 26, 27, 28, 9999],
    })}


def test_compute_includes_repeat_tables():
    dq = compute_data_quality({}, _df(), _repeats())
    assert [t["name"] for t in dq["tables"]] == ["household_members"]
    rows = {r["column"]: r for r in dq["tables"][0]["rows"]}
    assert "_root_id" not in rows                 # linkage col excluded by fallback
    assert rows["Name"]["completeness"] == 100.0
    assert rows["Age"]["outlier_rate"] == 10.0


def test_compute_omits_empty_repeat_table():
    dq = compute_data_quality({}, _df(), {"empty_rt": pd.DataFrame()})
    assert dq["tables"] == []


def test_compute_no_repeats_gives_empty_tables():
    dq = compute_data_quality({}, _df())
    assert dq["tables"] == []


def test_build_formats_repeat_tables():
    dq = build_data_quality({}, _df(), _repeats())
    t = dq["tables"][0]
    assert t["name"] == "household_members"
    by = {r["column"]: r for r in t["rows"]}
    assert by["Name"]["completeness"] == "100.0%"
    assert by["Age"]["outlier_rate"] == "10.0%"
    assert all(isinstance(r["completeness"], str) for r in dq["rows"])


def test_compute_omits_linkage_only_repeat_table():
    # Non-empty table but only linkage columns -> no displayable rows -> omitted.
    linkage_only = {"links": pd.DataFrame({"_root_id": [1, 2], "_row_id": ["1.0", "2.0"]})}
    dq = compute_data_quality({}, _df(), linkage_only)
    assert dq["tables"] == []
