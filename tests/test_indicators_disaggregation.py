import pandas as pd
from src.reports.indicators import compute_indicators, _render_breakdown_table


def _df():
    return pd.DataFrame({
        "Region": ["North", "North", "South", "South", "South"],
        "Sex":    ["F", "M", "F", "M", "F"],
        "Doses":  [10, 20, 5, 7, 3],
    })


def test_sum_disaggregated_by_one_column():
    ctx = compute_indicators(
        [{"name": "doses", "stat": "sum", "question": "Doses", "disaggregate_by": "Region"}], _df())
    assert ctx["ind_doses"] == "45"   # overall, number-formatted
    rows = ctx["ind_doses_breakdown"]
    by = {r["group"]: r["value"] for r in rows}
    assert by == {"North": 30, "South": 15}
    assert [r["group"] for r in rows] == ["North", "South"]   # sorted by group
    assert {r["formatted"] for r in rows} == {"30", "15"}


def test_count_disaggregated():
    ctx = compute_indicators(
        [{"name": "n", "stat": "count", "question": "Doses", "disaggregate_by": "Sex"}], _df())
    by = {r["group"]: r["value"] for r in ctx["ind_n_breakdown"]}
    assert by == {"F": 3, "M": 2}


def test_two_column_disaggregation_joins_labels():
    ctx = compute_indicators(
        [{"name": "d", "stat": "sum", "question": "Doses", "disaggregate_by": ["Region", "Sex"]}], _df())
    groups = {r["group"] for r in ctx["ind_d_breakdown"]}
    assert "North / F" in groups and "South / M" in groups


def test_missing_disaggregate_column_is_failsoft():
    ctx = compute_indicators(
        [{"name": "d", "stat": "sum", "question": "Doses", "disaggregate_by": "Nope"}], _df())
    assert ctx["ind_d"] == "45"             # scalar still computed
    assert ctx["ind_d_breakdown"] == []
    assert ctx["ind_d_table"] == "N/A"


def test_no_disaggregate_by_is_backward_compatible():
    ctx = compute_indicators([{"name": "d", "stat": "sum", "question": "Doses"}], _df())
    assert ctx["ind_d"] == "45"
    assert "ind_d_breakdown" not in ctx
    assert "ind_d_table" not in ctx


def test_render_breakdown_table():
    rows = [{"group": "North", "value": 30, "formatted": "30"},
            {"group": "South", "value": 15, "formatted": "15"}]
    assert _render_breakdown_table(rows) == "North: 30\nSouth: 15"
    assert _render_breakdown_table([]) == ""
