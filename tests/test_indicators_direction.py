import pandas as pd
from src.reports.indicators import compute_indicators


def _ind(**kw):
    base = {"name": "a", "stat": "sum", "question": "V", "target": 100}
    base.update(kw)
    return base


# A 'sum' of V = total across the row below.
def _df(total=80):
    return pd.DataFrame({"V": [total]})


def test_increase_default_unchanged():
    ctx = compute_indicators([_ind()], _df(80))
    assert ctx["ind_a_pct_achievement"] == "80.0%"


def test_increase_explicit_matches_default():
    ctx = compute_indicators([_ind(direction="increase")], _df(80))
    assert ctx["ind_a_pct_achievement"] == "80.0%"


def test_decrease_met_is_100():
    ctx = compute_indicators([_ind(direction="decrease")], _df(100))
    assert ctx["ind_a_pct_achievement"] == "100.0%"


def test_decrease_missed_below_100():
    ctx = compute_indicators([_ind(direction="decrease")], _df(200))
    assert ctx["ind_a_pct_achievement"] == "50.0%"


def test_decrease_overachieved_above_100():
    ctx = compute_indicators([_ind(direction="decrease")], _df(50))
    assert ctx["ind_a_pct_achievement"] == "200.0%"


def test_decrease_zero_value_is_na():
    ctx = compute_indicators([_ind(direction="decrease")], _df(0))
    assert ctx["ind_a_pct_achievement"] == "N/A"


def test_unknown_direction_falls_back_to_increase():
    ctx = compute_indicators([_ind(direction="sideways")], _df(80))
    assert ctx["ind_a_pct_achievement"] == "80.0%"


def test_string_zero_target_is_na_not_crash():
    # Quoted "0" target slips past the numeric guard; must degrade to "N/A",
    # not blank the whole indicator.
    ctx = compute_indicators([_ind(target="0")], _df(80))
    assert ctx["ind_a_pct_achievement"] == "N/A"
    assert ctx["ind_a"] == "80"  # indicator value itself still computed
