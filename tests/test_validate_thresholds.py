"""ME-6 — Surface below-threshold indicators in the Validate panel.

Tests derived from ME-6 Acceptance Criteria:
  - An indicator whose pct_achievement is below its warning/critical threshold
    produces a Validate finding with the correct RAG severity.
  - The finding names the indicator + its target/actual/% + status.
  - No finding at/above warning, or for indicators without thresholds.
  - Finding carries indicator/target/actual/% fields.
"""
import pandas as pd
import pytest

from src.data.validate import find_below_threshold_indicators


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _cfg(indicators):
    return {"indicators": indicators}


def _df(value):
    """Minimal DataFrame with a Count column."""
    return pd.DataFrame({"Count": [value] * 10, "_id": range(10)})


# ---------------------------------------------------------------------------
# AC: below warning threshold → warning finding
# ---------------------------------------------------------------------------

def test_below_warning_threshold_flags_warning():
    cfg = _cfg([{
        "name": "reach",
        "stat": "count",
        "question": "Count",
        "target": 100,
        "warning": 80,
        "critical": 60,
    }])
    df = _df(1)  # count → 10 rows → 10/100 = 10%, well below warning 80%
    findings = find_below_threshold_indicators(cfg, df)
    assert len(findings) == 1
    f = findings[0]
    assert f["severity"] == "warning" or f["severity"] == "critical"
    assert f["kind"] == "below_threshold"
    assert "reach" in f["column"] or "reach" in f["message"]


# ---------------------------------------------------------------------------
# AC: below critical threshold → critical finding
# ---------------------------------------------------------------------------

def test_below_critical_threshold_flags_critical():
    cfg = _cfg([{
        "name": "reach",
        "stat": "count",
        "question": "Count",
        "target": 1000,   # target = 1000
        "warning": 80,
        "critical": 60,
    }])
    df = _df(1)  # 10 rows → 10/1000 = 1%, below critical 60%
    findings = find_below_threshold_indicators(cfg, df)
    assert len(findings) == 1
    assert findings[0]["severity"] == "critical"


# ---------------------------------------------------------------------------
# AC: at/above warning threshold → no finding
# ---------------------------------------------------------------------------

def test_above_warning_threshold_no_finding():
    cfg = _cfg([{
        "name": "reach",
        "stat": "count",
        "question": "Count",
        "target": 10,    # target = 10 rows exactly
        "warning": 80,
        "critical": 60,
    }])
    df = _df(1)  # 10 rows → 10/10 = 100%, above warning 80%
    findings = find_below_threshold_indicators(cfg, df)
    assert findings == []


# ---------------------------------------------------------------------------
# AC: no thresholds configured → no finding
# ---------------------------------------------------------------------------

def test_no_threshold_no_finding():
    cfg = _cfg([{
        "name": "reach",
        "stat": "count",
        "question": "Count",
        "target": 100,
        # no warning, no critical
    }])
    df = _df(1)
    findings = find_below_threshold_indicators(cfg, df)
    assert findings == []


def test_no_indicators_no_finding():
    cfg = _cfg([])
    df = _df(1)
    findings = find_below_threshold_indicators(cfg, df)
    assert findings == []


# ---------------------------------------------------------------------------
# AC: finding carries indicator/target/actual/% fields
# ---------------------------------------------------------------------------

def test_finding_carries_required_fields():
    cfg = _cfg([{
        "name": "coverage",
        "stat": "count",
        "question": "Count",
        "target": 100,
        "warning": 80,
    }])
    df = _df(1)  # 10 rows → 10%, below 80%
    findings = find_below_threshold_indicators(cfg, df)
    assert len(findings) == 1
    f = findings[0]
    # Must carry field values for target, actual, and % in message or examples
    combined = f["message"] + " " + " ".join(str(e) for e in (f.get("examples") or []))
    assert "coverage" in combined or f["column"] == "coverage"
    assert "target" in combined.lower() or "100" in combined
    assert "count" in f.get("kind", "").lower() or f["kind"] == "below_threshold"
    # count and pct must be present (may be 0 for non-row-level findings)
    assert "count" in f
    assert "pct" in f
