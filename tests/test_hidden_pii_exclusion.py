"""Hidden + PII columns must be excluded from the Profile, Validate and Data-Quality
stages, so they match Load/Analyze/Present (which never surface them)."""
import pandas as pd

from src.data.profile import profile_dataset
from src.data.validate import validate_dataset
from src.reports.data_quality import compute_data_quality
from src.utils.config import excluded_column_names, drop_excluded_columns


def _cfg():
    return {"questions": [
        {"export_label": "Region", "category": "categorical"},
        {"export_label": "Age", "category": "quantitative"},
        {"export_label": "Notes", "type": "note"},                    # effective-hidden
        {"export_label": "Phone", "category": "qualitative", "pii": True},
        {"export_label": "Name", "category": "qualitative", "hidden": True},
    ]}


def _df():
    return pd.DataFrame({
        "Region": ["N", "S", "N"], "Age": [10, 20, 30],
        "Notes": ["a", "b", "c"], "Phone": ["1", "2", "3"], "Name": ["x", "y", "z"],
        "_id": [1, 2, 3],   # linkage column — must be preserved
    })


EXCLUDED = {"Notes", "Phone", "Name"}


def test_excluded_column_names_picks_hidden_and_pii():
    assert excluded_column_names(_cfg()) == EXCLUDED


def test_drop_excluded_columns_preserves_linkage_and_visible():
    df, repeats = drop_excluded_columns(_cfg(), _df(), {"members": _df()})
    assert set(df.columns) == {"Region", "Age", "_id"}
    assert set(repeats["members"].columns) == {"Region", "Age", "_id"}


def test_drop_excluded_columns_noop_without_flags():
    cfg = {"questions": [{"export_label": "Region"}, {"export_label": "Age"}]}
    df = _df()
    out, _ = drop_excluded_columns(cfg, df, {})
    assert list(out.columns) == list(df.columns)   # unchanged


def test_profile_excludes_hidden_and_pii():
    prof = profile_dataset(_cfg(), _df(), {})
    cols = {c["name"] for c in prof["main"]["columns"]}
    assert not (EXCLUDED & cols)
    assert {"Region", "Age"} <= cols


def test_validate_excludes_hidden_and_pii():
    report = validate_dataset(_cfg(), _df(), {})
    cols = {f.get("column") for f in report.get("findings", []) if f.get("column")}
    assert not (EXCLUDED & cols)


def test_data_quality_excludes_hidden_and_pii():
    dq = compute_data_quality(_cfg(), _df(), {})
    cols = {r["column"] for r in dq["rows"]}
    assert not (EXCLUDED & cols)
    assert {"Region", "Age"} <= cols
