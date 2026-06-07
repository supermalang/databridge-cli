"""Security: pandas .query() filter strings come from user-editable config and
must not be able to execute arbitrary code (RCE via the `@` resolver / dunder
gadget chains). See security audit finding #1."""
import os
import pandas as pd
import pytest

from src.data.transform import apply_filters, safe_query


@pytest.fixture
def df():
    return pd.DataFrame({"Age": [10, 30, 50], "Region": ["north", "south", "north"]})


# ---- legitimate filters keep working -------------------------------------

def test_legitimate_comparison_filter(df):
    out = safe_query(df, "Age > 30")
    assert list(out["Age"]) == [50]


def test_legitimate_string_filter(df):
    out = safe_query(df, "Region == 'north'")
    assert list(out["Age"]) == [10, 50]


def test_backtick_column_name_filter():
    d = pd.DataFrame({"Number of Students": [0, 5, 9]})
    out = safe_query(d, "`Number of Students` > 0")
    assert list(out["Number of Students"]) == [5, 9]


# ---- malicious filters are rejected, never executed ----------------------

def test_at_resolver_is_rejected(df):
    """The `@` local/global resolver reaches module globals (e.g. @pd) and is the
    documented RCE vector. It must be rejected outright."""
    with pytest.raises(ValueError):
        safe_query(df, '@pd.io.common.os.getpid() > 0')


def test_dunder_access_is_rejected(df):
    with pytest.raises(ValueError):
        safe_query(df, "Age.__class__.__mro__ == 1")


def test_malicious_filter_does_not_execute_code(tmp_path, df):
    """End-to-end: a payload that would write a file must NOT write it, whether via
    safe_query directly or through apply_filters."""
    marker = tmp_path / "pwned.txt"
    payload = f'@pd.io.common.os.system("touch {marker}") == 0'

    with pytest.raises(ValueError):
        safe_query(df, payload)
    assert not marker.exists()

    # apply_filters in strict mode must surface the rejection, not run the code
    with pytest.raises(ValueError):
        apply_filters(df, {"filters": [payload]}, {}, strict=True)
    assert not marker.exists()


def test_apply_filters_nonstrict_skips_malicious(tmp_path, df):
    """Non-strict mode (the default download path) must skip the bad filter
    without executing it — data passes through unfiltered, no file written."""
    marker = tmp_path / "pwned2.txt"
    payload = f'@pd.io.common.os.system("touch {marker}") == 0'
    out, _ = apply_filters(df, {"filters": [payload]}, {}, strict=False)
    assert not marker.exists()
    assert len(out) == len(df)  # bad filter skipped, nothing removed


# ---- indicator filters go through the same guard --------------------------

def test_indicator_filter_legitimate(df):
    from src.reports.indicators import _resolve_source
    out = _resolve_source({"filter": "Age > 30"}, df, {})
    assert list(out["Age"]) == [50]


def test_indicator_filter_malicious_does_not_execute(tmp_path, df):
    """An indicator filter is editor-editable config (and reachable via
    /api/ask/save). It must be guarded like apply_filters — skipped, not run."""
    from src.reports.indicators import _resolve_source
    marker = tmp_path / "pwned_ind.txt"
    payload = f'@pd.io.common.os.system("touch {marker}") == 0'
    out = _resolve_source({"filter": payload}, df, {})
    assert not marker.exists()
    assert len(out) == len(df)  # bad filter skipped, nothing removed
