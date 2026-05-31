import pandas as pd
from src.reports.indicators import compute_indicators


def test_no_per_period_arg_keeps_legacy_behavior():
    df = pd.DataFrame({"score": [10, 20, 30]})
    inds = [{"name": "avg_score", "stat": "mean", "question": "score"}]
    ctx = compute_indicators(inds, df)
    assert "ind_avg_score" in ctx
    assert "ind_avg_score_delta" not in ctx
    assert "ind_avg_score_pct_change" not in ctx


def test_per_period_emits_p_slug_placeholders():
    df_current = pd.DataFrame({"score": [80, 90]})
    df_q1      = pd.DataFrame({"score": [70, 60]})
    df_q2      = pd.DataFrame({"score": [80, 90]})
    inds = [{"name": "avg_score", "stat": "mean", "question": "score"}]
    per_period = {
        "q1_2026": {"df": df_q1, "is_baseline": True,  "label": "Q1 2026"},
        "q2_2026": {"df": df_q2, "is_baseline": False, "label": "Q2 2026"},
    }
    ctx = compute_indicators(inds, df_current, per_period=per_period)
    assert "ind_avg_score_p_q1_2026" in ctx
    assert "ind_avg_score_p_q2_2026" in ctx


def test_per_period_computes_delta_and_pct_change_against_baseline():
    df_current = pd.DataFrame({"score": [80, 90]})  # mean = 85
    df_q1      = pd.DataFrame({"score": [70, 60]})  # mean = 65 (baseline)
    inds = [{"name": "avg_score", "stat": "mean", "question": "score"}]
    per_period = {
        "q1_2026": {"df": df_q1, "is_baseline": True, "label": "Q1 2026"},
    }
    ctx = compute_indicators(inds, df_current, per_period=per_period)
    assert "ind_avg_score_delta" in ctx
    # Delta = 85 - 65 = 20
    assert "20" in ctx["ind_avg_score_delta"]
    # Pct change = (20 / 65) * 100 ≈ 30.8%
    assert "30.8" in ctx["ind_avg_score_pct_change"]


def test_per_period_handles_zero_baseline_gracefully():
    df_current = pd.DataFrame({"score": [10]})
    df_q1      = pd.DataFrame({"score": [0]})
    inds = [{"name": "x", "stat": "mean", "question": "score"}]
    per_period = {"q1_2026": {"df": df_q1, "is_baseline": True, "label": "Q1 2026"}}
    ctx = compute_indicators(inds, df_current, per_period=per_period)
    assert ctx["ind_x_pct_change"] == "N/A"


def test_per_period_with_no_baseline_emits_p_slug_only():
    df_current = pd.DataFrame({"score": [80]})
    df_q1      = pd.DataFrame({"score": [70]})
    inds = [{"name": "x", "stat": "mean", "question": "score"}]
    per_period = {"q1_2026": {"df": df_q1, "is_baseline": False, "label": "Q1 2026"}}
    ctx = compute_indicators(inds, df_current, per_period=per_period)
    assert "ind_x_p_q1_2026" in ctx
    assert "ind_x_delta" not in ctx
