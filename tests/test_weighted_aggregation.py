"""ME-5 — Sampling weights.

Contract for the implementer
----------------------------
Option name: ``weight_column`` (a column name in the DataFrame).

Where it applies:
  * Indicators (src/reports/indicators.py, the ``mean`` stat in ``_compute``):
    when ``weight_column`` is set the indicator aggregates with
    ``numpy.average(values, weights=...)`` instead of a simple mean.
  * Charts (src/reports/charts.py, the aggregation seam ``_grouped_counts``):
    when ``weight_column`` is set the per-category aggregation of ``value_col``
    becomes a weighted average using the weights in ``weight_column``.

Absent => unchanged behaviour: indicators fall back to the simple ``Series.mean()``
and charts fall back to the existing ``groupby(...).agg(agg_fn)`` (default unweighted).

These tests are written BEFORE the implementation and must fail RED for the right
reason: ``weight_column`` is not yet supported, so the weighted result equals the
unweighted result (the option is currently ignored).
"""
import numpy as np
import pandas as pd

from src.reports.indicators import compute_indicators
from src.reports.charts import _grouped_counts


# ---------------------------------------------------------------------------
# Fixtures — weights chosen so the weighted mean clearly differs from the simple mean.
# values = [10, 20, 30]; weights = [1, 1, 8]
#   simple mean   = (10 + 20 + 30) / 3            = 20.0
#   weighted mean = (10*1 + 20*1 + 30*8) / 10     = 27.0
# ---------------------------------------------------------------------------
def _df():
    return pd.DataFrame({
        "Score":  [10, 20, 30],
        "weight": [1, 1, 8],
    })


SIMPLE_MEAN = 20.0
WEIGHTED_MEAN = 27.0  # numpy.average([10,20,30], weights=[1,1,8])


def test_weighted_mean_fixture_sanity():
    """Guard the fixture: numpy's weighted average really differs from the simple mean."""
    df = _df()
    assert df["Score"].mean() == SIMPLE_MEAN
    assert np.average(df["Score"], weights=df["weight"]) == WEIGHTED_MEAN
    assert WEIGHTED_MEAN != SIMPLE_MEAN


# ---------------------------------------------------------------------------
# Indicators
# ---------------------------------------------------------------------------
def test_indicator_mean_with_weight_column_is_weighted():
    """AC: when weight_column is set, the mean indicator is a weighted average."""
    ctx = compute_indicators(
        [{"name": "score", "stat": "mean", "question": "Score",
          "weight_column": "weight", "format": "decimal"}],
        _df(),
    )
    # decimal format -> 1 decimal place, thousands separator
    assert ctx["ind_score"] == "27.0"
    assert ctx["ind_score"] != "20.0"   # NOT the simple mean


def test_indicator_mean_without_weight_column_is_unweighted():
    """AC: unweighted behaviour unchanged when the option is absent."""
    ctx = compute_indicators(
        [{"name": "score", "stat": "mean", "question": "Score", "format": "decimal"}],
        _df(),
    )
    assert ctx["ind_score"] == "20.0"   # simple mean, unchanged


# ---------------------------------------------------------------------------
# Charts — aggregation seam (_grouped_counts).
# One category "G" holds all three rows, so the per-group aggregate of "Score"
# is the (weighted or simple) mean of [10, 20, 30].
# ---------------------------------------------------------------------------
def _chart_df():
    return pd.DataFrame({
        "Group":  ["G", "G", "G"],
        "Score":  [10, 20, 30],
        "weight": [1, 1, 8],
    })


def test_chart_aggregation_with_weight_column_is_weighted():
    """AC: a chart with weight_column set passes the weights to its aggregation."""
    opts = {"value_col": "Score", "agg": "mean", "weight_column": "weight"}
    result = _grouped_counts(_chart_df(), "Group", opts)
    assert float(result.loc["G"]) == WEIGHTED_MEAN   # 27.0
    assert float(result.loc["G"]) != SIMPLE_MEAN


def test_chart_aggregation_without_weight_column_is_unweighted():
    """AC: unchanged unweighted behaviour when weight_column is absent."""
    opts = {"value_col": "Score", "agg": "mean"}
    result = _grouped_counts(_chart_df(), "Group", opts)
    assert float(result.loc["G"]) == SIMPLE_MEAN   # 20.0, simple groupby mean
