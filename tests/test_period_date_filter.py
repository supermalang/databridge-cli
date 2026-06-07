"""Tests for date-range period filtering (Output tab → reporting period).

A period that carries started/ended dates slices a single download by each
submission's `_submission_time`; label-only periods keep the legacy per-period
file model untouched.
"""
import pandas as pd

from src.data.transform import filter_to_period, _data_prefix, load_data


# ── _data_prefix: date-range vs label-only ────────────────────────────────────
def test_data_prefix_label_only_period_uses_slug():
    assert _data_prefix("monitoring", {"label": "Q1 2026", "slug": "q1_2026"}) == "monitoring_q1_2026"


def test_data_prefix_date_range_period_is_plain_alias():
    p = {"label": "Q1 2026", "slug": "q1_2026", "started": "2026-01-01", "ended": "2026-03-31"}
    assert _data_prefix("monitoring", p) == "monitoring"


def test_data_prefix_no_period_is_plain_alias():
    assert _data_prefix("monitoring", None) == "monitoring"


# ── filter_to_period ──────────────────────────────────────────────────────────
def _df():
    return pd.DataFrame({
        "_id": [1, 2, 3, 4],
        "_submission_time": ["2026-01-15", "2026-02-20", "2026-04-05", "2026-12-31"],
        "Age": [10, 20, 30, 40],
    })


def test_filter_keeps_only_rows_in_range():
    period = {"started": "2026-01-01", "ended": "2026-03-31"}
    out, _ = filter_to_period(_df(), {}, period)
    assert list(out["_id"]) == [1, 2]


def test_filter_end_is_inclusive_of_whole_day():
    df = pd.DataFrame({"_id": [1], "_submission_time": ["2026-03-31T18:30:00"], "Age": [1]})
    out, _ = filter_to_period(df, {}, {"started": "2026-01-01", "ended": "2026-03-31"})
    assert len(out) == 1   # a submission late on the end day is still included


def test_filter_prunes_orphaned_repeat_rows():
    repeats = {"visits": pd.DataFrame({"_root_id": [1, 2, 3, 3], "v": ["a", "b", "c", "d"]})}
    out, out_repeats = filter_to_period(_df(), repeats, {"started": "2026-01-01", "ended": "2026-03-31"})
    assert set(out_repeats["visits"]["_root_id"]) == {1, 2}   # rows under _id 3 dropped


def test_filter_noop_without_dates():
    out, _ = filter_to_period(_df(), {}, {"label": "Q1 2026", "slug": "q1_2026"})
    assert len(out) == 4


def test_filter_noop_when_no_submission_time_column():
    df = pd.DataFrame({"_id": [1, 2], "Age": [10, 20]})
    out, _ = filter_to_period(df, {}, {"started": "2026-01-01", "ended": "2026-03-31"})
    assert len(out) == 2   # skipped, not crashed


def test_filter_only_started_open_ended():
    out, _ = filter_to_period(_df(), {}, {"started": "2026-03-01"})
    assert list(out["_id"]) == [3, 4]


# ── load_data captures the submission-time meta column ────────────────────────
def test_load_data_captures_submission_time():
    submissions = [
        {"_id": 1, "_submission_time": "2026-01-15T09:00:00", "age": 10},
        {"_id": 2, "_submission_time": "2026-02-15T09:00:00", "age": 20},
    ]
    cfg = {
        "form": {"alias": "t"},
        "questions": [
            {"kobo_key": "age", "label": "Age", "type": "integer",
             "category": "quantitative", "export_label": "Age"},
        ],
    }
    df, _ = load_data(submissions, cfg)
    assert "_submission_time" in df.columns
    assert list(df["_submission_time"]) == ["2026-01-15T09:00:00", "2026-02-15T09:00:00"]
