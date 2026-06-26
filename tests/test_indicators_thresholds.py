"""ME-2 — Variance / traffic-light dashboards (RED-first spec).

Contract derived from the ME-2 acceptance criteria:

- Indicators accept per-indicator ``warning`` and ``critical`` numeric thresholds,
  expressed on the ``pct_achievement`` scale (percent of target; e.g. 70 means 70%).
- ``compute_indicators`` exposes a RAG status per indicator at
  ``ind_<name>_status`` ∈ {"ok", "warning", "critical"} (green / amber / red).
- A traffic-light progress table is rendered for the report (and surfaced to the
  Validate panel) via ``build_traffic_light_table(indicators_cfg, indicators_context)``,
  returning rows shaped::

      {indicator, baseline, target, actual, pct, status}

  one per indicator that defines a target.
- Below-threshold indicators are flagged (status warning/critical), above-threshold
  indicators are not (status ok).

RAG semantics (chosen deliberately, on the pct_achievement scale):
    pct >= warning              -> "ok"       (green)
    critical <= pct < warning   -> "warning"  (amber)
    pct < critical              -> "critical"  (red)

These tests must FAIL on current code because neither the per-indicator
``ind_<name>_status`` field nor ``build_traffic_light_table`` exist yet.
"""
import pytest
import pandas as pd

from src.reports.indicators import compute_indicators


def _ind(actual, **kw):
    """An indicator whose 'sum' over column V equals `actual`, target 100.

    With target 100, pct_achievement == actual (so the threshold tests read
    directly off the configured warning/critical values).
    """
    base = {"name": "a", "stat": "sum", "question": "V", "target": 100}
    base.update(kw)
    df = pd.DataFrame({"V": [actual]})
    return base, df


# --------------------------------------------------------------------------- #
# AC: indicators accept warning/critical and expose a RAG status              #
# --------------------------------------------------------------------------- #

def test_warning_status_when_pct_between_critical_and_warning():
    # warning=70, critical=50, pct_achievement = 65 -> amber/warning
    ind, df = _ind(65, warning=70, critical=50)
    ctx = compute_indicators([ind], df)
    assert ctx["ind_a_pct_achievement"] == "65.0%"
    assert ctx["ind_a_status"] == "warning"


def test_critical_status_when_pct_below_critical():
    # warning=70, critical=50, pct_achievement = 45 -> red/critical
    ind, df = _ind(45, warning=70, critical=50)
    ctx = compute_indicators([ind], df)
    assert ctx["ind_a_pct_achievement"] == "45.0%"
    assert ctx["ind_a_status"] == "critical"


def test_ok_status_when_pct_exceeds_warning():
    # warning=70, critical=50, pct_achievement = 80 -> green/ok (no flag)
    ind, df = _ind(80, warning=70, critical=50)
    ctx = compute_indicators([ind], df)
    assert ctx["ind_a_pct_achievement"] == "80.0%"
    assert ctx["ind_a_status"] == "ok"


def test_ok_status_at_warning_boundary():
    # pct exactly at warning threshold counts as ok (>= warning -> green)
    ind, df = _ind(70, warning=70, critical=50)
    ctx = compute_indicators([ind], df)
    assert ctx["ind_a_status"] == "ok"


def test_warning_status_at_critical_boundary():
    # pct exactly at critical threshold counts as warning (>= critical -> amber)
    ind, df = _ind(50, warning=70, critical=50)
    ctx = compute_indicators([ind], df)
    assert ctx["ind_a_status"] == "warning"


# --------------------------------------------------------------------------- #
# AC: a traffic-light progress table renders with the correct RAG status      #
# --------------------------------------------------------------------------- #

def _table():
    """Import the builder lazily so the module-level import errors don't mask
    the other (compute_indicators) failures with a collection-time ImportError."""
    from src.reports.indicators import build_traffic_light_table
    return build_traffic_light_table


def test_traffic_light_table_row_shape_and_status():
    build_traffic_light_table = _table()
    ind, df = _ind(65, baseline=40, warning=70, critical=50)
    ctx = compute_indicators([ind], df)

    table = build_traffic_light_table([ind], ctx)
    rows = table["rows"]
    assert len(rows) == 1
    row = rows[0]
    # Required columns: Indicator | Baseline | Target | Actual | % | status
    for col in ("indicator", "baseline", "target", "actual", "pct", "status"):
        assert col in row, f"missing column '{col}' in traffic-light row"
    assert row["status"] == "warning"


def test_traffic_light_table_status_reflects_each_threshold():
    build_traffic_light_table = _table()
    inds = [
        {"name": "good", "stat": "sum", "question": "V", "target": 100,
         "warning": 70, "critical": 50},
        {"name": "amber", "stat": "sum", "question": "V", "target": 100,
         "warning": 70, "critical": 50},
        {"name": "red", "stat": "sum", "question": "V", "target": 100,
         "warning": 70, "critical": 50},
    ]
    # Each indicator reads its own actual from its own one-row frame; here we
    # drive pct via separate compute calls then merge contexts.
    ctx = {}
    ctx.update(compute_indicators([inds[0]], pd.DataFrame({"V": [80]})))   # ok
    ctx.update(compute_indicators([inds[1]], pd.DataFrame({"V": [65]})))   # warning
    ctx.update(compute_indicators([inds[2]], pd.DataFrame({"V": [45]})))   # critical

    table = build_traffic_light_table(inds, ctx)
    by_name = {r["indicator"]: r["status"] for r in table["rows"]}
    assert by_name["good"] == "ok"
    assert by_name["amber"] == "warning"
    assert by_name["red"] == "critical"


def test_traffic_light_table_carries_baseline_target_actual_pct():
    build_traffic_light_table = _table()
    ind, df = _ind(80, baseline=40, warning=70, critical=50)
    ctx = compute_indicators([ind], df)

    row = build_traffic_light_table([ind], ctx)["rows"][0]
    assert row["indicator"] == "a"
    assert "40" in str(row["baseline"])
    assert "100" in str(row["target"])
    assert "80" in str(row["actual"])
    assert "80.0%" in str(row["pct"])
    assert row["status"] == "ok"
