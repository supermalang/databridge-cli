import pandas as pd
from src.utils.pii import apply_consent, apply_redaction, apply_pii, pii_summary


# ── apply_consent ──────────────────────────────────────────────────────────

def test_apply_consent_no_op_when_no_consent_column():
    df = pd.DataFrame({"x": [1, 2, 3]})
    cfg = {"pii": {}}
    out = apply_consent(df, cfg)
    assert len(out) == 3


def test_apply_consent_drops_rows_without_yes():
    df = pd.DataFrame({"Consent": ["yes", "no", "yes", ""], "x": [1, 2, 3, 4]})
    cfg = {"pii": {"consent_column": "Consent"}}
    out = apply_consent(df, cfg)
    assert len(out) == 2
    assert list(out["x"]) == [1, 3]


def test_apply_consent_custom_value():
    df = pd.DataFrame({"Consent": ["AGREE", "DECLINE"], "x": [1, 2]})
    cfg = {"pii": {"consent_column": "Consent", "consent_value": "AGREE"}}
    out = apply_consent(df, cfg)
    assert len(out) == 1


def test_apply_consent_missing_column_is_no_op_with_warning():
    df = pd.DataFrame({"x": [1, 2]})
    cfg = {"pii": {"consent_column": "NotPresent"}}
    out = apply_consent(df, cfg)
    assert len(out) == 2


# ── apply_redaction (per strategy) ─────────────────────────────────────────

def test_redact_drop_removes_column():
    df = pd.DataFrame({"a": [1, 2], "name": ["Alice", "Bob"]})
    cfg = {"pii": {"redact": [{"column": "name", "strategy": "drop"}]}}
    out = apply_redaction(df, cfg)
    assert "name" not in out.columns
    assert "a" in out.columns


def test_redact_hash_produces_8char_hex():
    df = pd.DataFrame({"phone": ["555-0001", "555-0002", "555-0001"]})
    cfg = {"pii": {"redact": [{"column": "phone", "strategy": "hash"}]}}
    out = apply_redaction(df, cfg)
    assert out["phone"][0] == out["phone"][2]
    assert out["phone"][0] != out["phone"][1]
    assert len(out["phone"][0]) == 8
    assert all(c in "0123456789abcdef" for c in out["phone"][0])


def test_redact_mask_replaces_non_null_with_stars():
    df = pd.DataFrame({"id": ["A123", None, "B456"]})
    cfg = {"pii": {"redact": [{"column": "id", "strategy": "mask"}]}}
    out = apply_redaction(df, cfg)
    assert out["id"][0] == "***"
    assert pd.isna(out["id"][1])
    assert out["id"][2] == "***"


def test_redact_generalize_geo_rounds_to_decimals():
    df = pd.DataFrame({"gps": ["12.3456789,45.6789012", "1.234,5.678"]})
    cfg = {"pii": {"redact": [{"column": "gps", "strategy": "generalize_geo", "decimals": 2}]}}
    out = apply_redaction(df, cfg)
    assert out["gps"][0] == "12.35,45.68"
    assert out["gps"][1] == "1.23,5.68"


def test_redact_generalize_geo_handles_single_float_column():
    df = pd.DataFrame({"lat": [12.3456789, 1.234]})
    cfg = {"pii": {"redact": [{"column": "lat", "strategy": "generalize_geo", "decimals": 1}]}}
    out = apply_redaction(df, cfg)
    assert out["lat"][0] == "12.3"
    assert out["lat"][1] == "1.2"


def test_redact_generalize_date_keeps_year_only():
    df = pd.DataFrame({"dob": ["1990-05-12", "2001-11-30"]})
    cfg = {"pii": {"redact": [{"column": "dob", "strategy": "generalize_date"}]}}
    out = apply_redaction(df, cfg)
    assert out["dob"][0] == "1990"
    assert out["dob"][1] == "2001"


def test_redact_unknown_strategy_is_no_op_with_warning():
    df = pd.DataFrame({"x": [1, 2]})
    cfg = {"pii": {"redact": [{"column": "x", "strategy": "bogus"}]}}
    out = apply_redaction(df, cfg)
    assert list(out["x"]) == [1, 2]


def test_redact_skips_columns_not_in_df():
    df = pd.DataFrame({"x": [1, 2]})
    cfg = {"pii": {"redact": [{"column": "missing", "strategy": "drop"}]}}
    out = apply_redaction(df, cfg)
    assert list(out.columns) == ["x"]


# ── apply_pii (the wrapper) ────────────────────────────────────────────────

def test_apply_pii_no_op_when_no_pii_block():
    df = pd.DataFrame({"x": [1, 2]})
    repeats = {"r1": pd.DataFrame({"y": [3]})}
    out_df, out_repeats = apply_pii(df, repeats, {})
    assert len(out_df) == 2
    assert "r1" in out_repeats


def test_apply_pii_applies_consent_then_redaction_to_main_and_repeats():
    df = pd.DataFrame({"Consent": ["yes", "no"], "name": ["A", "B"]})
    repeats = {"r1": pd.DataFrame({"name": ["X", "Y"]})}
    cfg = {"pii": {
        "consent_column": "Consent",
        "redact": [{"column": "name", "strategy": "drop"}],
    }}
    out_df, out_repeats = apply_pii(df, repeats, cfg)
    assert len(out_df) == 1
    assert "name" not in out_df.columns
    assert "name" not in out_repeats["r1"].columns


# ── pii_summary ────────────────────────────────────────────────────────────

def test_pii_summary_empty_when_no_pii():
    assert pii_summary({}) == ""


def test_pii_summary_lists_rules_when_present():
    cfg = {"pii": {
        "consent_column": "Consent",
        "redact": [
            {"column": "name", "strategy": "drop"},
            {"column": "phone", "strategy": "hash"},
        ],
    }}
    s = pii_summary(cfg)
    assert "consent" in s.lower()
    assert "2 column" in s.lower()
