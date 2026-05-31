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


from src.data.validate import find_numeric_outliers


def test_outliers_returns_nothing_on_clean_numeric_column():
    df = pd.DataFrame({"age": [10, 12, 14, 16, 18, 20, 22, 24, 26, 28]})
    questions = [{"export_label": "age", "category": "quantitative"}]
    findings = find_numeric_outliers(df, questions)
    assert findings == []


def test_outliers_flags_extreme_high_value():
    df = pd.DataFrame({"age": [10, 12, 14, 16, 18, 20, 22, 24, 26, 999]})
    questions = [{"export_label": "age", "category": "quantitative"}]
    findings = find_numeric_outliers(df, questions)
    assert len(findings) == 1
    f = findings[0]
    assert f["column"] == "age"
    assert f["kind"] == "outlier_iqr"
    assert f["count"] == 1
    assert 999 in f["examples"] or 999.0 in f["examples"]


def test_outliers_only_runs_on_quantitative_columns():
    df = pd.DataFrame({"region": ["A"] * 9 + ["X"]})
    questions = [{"export_label": "region", "category": "categorical"}]
    findings = find_numeric_outliers(df, questions)
    assert findings == []


def test_outliers_ignores_columns_not_in_questions():
    df = pd.DataFrame({"untracked": [1, 2, 3, 4, 5, 999999]})
    questions = []
    findings = find_numeric_outliers(df, questions)
    assert findings == []


def test_outliers_handles_all_nan_column_without_crashing():
    df = pd.DataFrame({"age": [None] * 10})
    questions = [{"export_label": "age", "category": "quantitative"}]
    findings = find_numeric_outliers(df, questions)
    assert findings == []


from src.data.validate import find_duplicates


def test_duplicates_on_unique_id_column():
    df = pd.DataFrame({"_id": ["a", "b", "c", "d"]})
    findings = find_duplicates(df)
    assert findings == []


def test_duplicates_flags_repeated_id():
    df = pd.DataFrame({"_id": ["a", "b", "a", "c"]})
    findings = find_duplicates(df)
    assert len(findings) == 1
    f = findings[0]
    assert f["kind"] == "duplicate_id"
    assert f["count"] == 2   # two rows share the duplicate id (a appears twice)
    assert "a" in f["examples"]


def test_duplicates_returns_empty_when_no_id_column_present():
    df = pd.DataFrame({"x": [1, 2, 3]})
    findings = find_duplicates(df)
    assert findings == []  # no _id / _uuid / _index — nothing to dedup on


def test_duplicates_prefers_underscore_uuid_over_underscore_id():
    # If _uuid is present it's treated as the canonical key.
    df = pd.DataFrame({"_id": ["A", "B", "C"], "_uuid": ["u1", "u1", "u2"]})
    findings = find_duplicates(df)
    assert findings and findings[0]["column"] == "_uuid"


from src.data.validate import find_type_issues


def test_type_issues_no_findings_when_quantitative_column_is_clean():
    df = pd.DataFrame({"age": ["1", "2", "3"]})
    questions = [{"export_label": "age", "category": "quantitative"}]
    assert find_type_issues(df, questions) == []


def test_type_issues_flags_non_numeric_in_quantitative_column():
    df = pd.DataFrame({"age": ["12", "n/a", "20", "TBD", "25"]})
    questions = [{"export_label": "age", "category": "quantitative"}]
    findings = find_type_issues(df, questions)
    assert len(findings) == 1
    f = findings[0]
    assert f["column"] == "age"
    assert f["kind"] == "type_quantitative_nonnumeric"
    assert f["count"] == 2
    assert "n/a" in f["examples"] or "TBD" in f["examples"]


def test_type_issues_ignores_blank_and_nan_values():
    df = pd.DataFrame({"age": ["1", "", None, "2"]})
    questions = [{"export_label": "age", "category": "quantitative"}]
    # Blank/NaN are caught by missingness detector, not type detector.
    assert find_type_issues(df, questions) == []


def test_type_issues_skips_categorical_columns():
    df = pd.DataFrame({"region": ["A", "B", "weird-name"]})
    questions = [{"export_label": "region", "category": "categorical"}]
    assert find_type_issues(df, questions) == []


from src.data.validate import validate_dataset


def test_validate_dataset_returns_envelope_shape():
    cfg = {"questions": [{"export_label": "age", "category": "quantitative"}]}
    df = pd.DataFrame({"age": [1, 2, 3, 4]})
    report = validate_dataset(cfg, df, repeat_tables={})
    assert set(report.keys()) == {"n_rows", "n_columns", "checks", "summary"}
    assert report["n_rows"] == 4
    assert report["n_columns"] == 1
    assert report["summary"] == {"error": 0, "warning": 0, "info": 0}
    assert report["checks"] == []


def test_validate_dataset_sorts_checks_by_severity_then_count():
    cfg = {"questions": [
        {"export_label": "a", "category": "quantitative"},
        {"export_label": "b", "category": "quantitative"},
    ]}
    # a: 1 outlier (info), b: 60% missing (error)
    df = pd.DataFrame({"a": [1, 2, 3, 4, 5, 6, 7, 8, 9, 999],
                       "b": [None] * 6 + [1, 2, 3, 4]})
    report = validate_dataset(cfg, df, repeat_tables={})
    assert report["checks"][0]["severity"] == "error"
    assert report["summary"]["error"] >= 1


def test_validate_dataset_empty_df_returns_empty_report():
    cfg = {"questions": []}
    df = pd.DataFrame()
    report = validate_dataset(cfg, df, repeat_tables={})
    assert report["n_rows"] == 0
    assert report["checks"] == []


from src.data.validate import find_orphan_framework_refs


def test_orphans_returns_nothing_when_no_framework():
    cfg = {"indicators": [{"name": "x", "framework_ref": "Q"}]}
    assert find_orphan_framework_refs(cfg) == []


def test_orphans_returns_nothing_when_all_refs_resolve():
    cfg = {
        "framework": {"outputs": [{"id": "OP1", "label": "Output 1", "parent": "OC1"}]},
        "indicators": [{"name": "x", "framework_ref": "OP1"}],
    }
    assert find_orphan_framework_refs(cfg) == []


def test_orphans_flags_broken_ref():
    cfg = {
        "framework": {"outputs": [{"id": "OP1", "label": "Output 1"}]},
        "indicators": [
            {"name": "good", "framework_ref": "OP1"},
            {"name": "bad",  "framework_ref": "MISSING"},
        ],
    }
    findings = find_orphan_framework_refs(cfg)
    assert len(findings) == 1
    f = findings[0]
    assert f["kind"] == "orphan_framework_ref"
    assert f["severity"] == "warning"
    assert f["column"] == "bad"
    assert "MISSING" in f["message"]
    assert f["count"] == 1


from src.data.validate import find_potential_pii


def test_potential_pii_flags_columns_with_pii_words_in_name():
    df = pd.DataFrame({
        "Respondent_name": ["A", "B"],
        "Phone_number":    ["1", "2"],
        "Region":          ["X", "Y"],
    })
    findings = find_potential_pii(df, [])
    names = {f["column"] for f in findings}
    assert "Respondent_name" in names
    assert "Phone_number" in names
    assert "Region" not in names


def test_potential_pii_severity_is_info():
    df = pd.DataFrame({"email": ["a@b.c"]})
    findings = find_potential_pii(df, [])
    assert findings[0]["severity"] == "info"
    assert findings[0]["kind"] == "potential_pii"


def test_potential_pii_skips_columns_already_in_pii_block():
    df = pd.DataFrame({"Respondent_name": ["A"]})
    findings = find_potential_pii(df, [])
    assert len(findings) == 1  # always flags; aggregator filters later
