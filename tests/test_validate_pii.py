"""The name-based potential-PII detector matches on word boundaries, not substrings —
so it stops false-positiving on words like 'relative' (which contains 'lat')."""
import pandas as pd

from src.data.validate import find_potential_pii


def _flagged(columns):
    df = pd.DataFrame({c: [1, 2, 3] for c in columns})
    return {f["column"] for f in find_potential_pii(df, [])}


def test_does_not_flag_substring_false_positives():
    cols = [
        "Importance relative des groupes",  # 're·LAT·ive' must NOT match 'lat'
        "filename", "username", "surname",  # contain 'name' mid-word
        "Region", "Translate notes",
    ]
    assert _flagged(cols) == set()


def test_flags_real_pii_names():
    cols = ["Respondent name", "Phone number", "Email", "GPS point",
            "Latitude", "gps_lon", "user_name", "National ID"]
    assert _flagged(cols) == set(cols)


def test_empty_df_returns_nothing():
    assert find_potential_pii(pd.DataFrame(), []) == []
