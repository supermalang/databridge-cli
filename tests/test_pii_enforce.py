import pandas as pd
import pytest
from src.utils.pii import PIIConfigError, validate_pii_config


def _cfg(**pii):
    return {"pii": pii} if pii else {}


def test_validate_ok_when_columns_present():
    main = pd.DataFrame({"Consent": ["yes"], "Phone": ["123"]})
    cfg = _cfg(consent_column="Consent", redact=[{"column": "Phone", "strategy": "hash"}])
    assert validate_pii_config(main, {}, cfg) is None


def test_validate_missing_consent_column_raises():
    main = pd.DataFrame({"Phone": ["123"]})
    cfg = _cfg(consent_column="Consent")
    with pytest.raises(PIIConfigError, match="consent_column 'Consent'"):
        validate_pii_config(main, {}, cfg)


def test_validate_missing_redact_column_everywhere_raises():
    main = pd.DataFrame({"Region": ["N"]})
    cfg = _cfg(redact=[{"column": "Phone", "strategy": "hash"}])
    with pytest.raises(PIIConfigError, match="redact column 'Phone'"):
        validate_pii_config(main, {}, cfg)


def test_validate_redact_column_in_repeat_is_ok():
    main = pd.DataFrame({"Region": ["N"]})
    repeats = {"household/members": pd.DataFrame({"MemberPhone": ["1"]})}
    cfg = _cfg(redact=[{"column": "MemberPhone", "strategy": "hash"}])
    assert validate_pii_config(main, repeats, cfg) is None


def test_validate_unknown_strategy_raises():
    main = pd.DataFrame({"Phone": ["1"]})
    cfg = _cfg(redact=[{"column": "Phone", "strategy": "encrypt"}])
    with pytest.raises(PIIConfigError, match="unknown strategy 'encrypt'"):
        validate_pii_config(main, {}, cfg)


def test_validate_no_pii_block_is_noop():
    assert validate_pii_config(pd.DataFrame({"X": [1]}), {}, {}) is None


from src.utils.pii import enforce_pii


def test_enforce_pii_consent_filters_and_redacts():
    main = pd.DataFrame({
        "_id": [1, 2, 3],
        "Consent": ["yes", "no", "yes"],
        "Name": ["A", "B", "C"],
        "Region": ["N", "S", "E"],
    })
    cfg = {"pii": {"consent_column": "Consent",
                   "redact": [{"column": "Name", "strategy": "drop"}]}}
    out, _ = enforce_pii(main, {}, cfg)
    assert list(out["_id"]) == [1, 3]
    assert "Name" not in out.columns
    assert "Consent" in out.columns


def test_enforce_pii_prunes_orphaned_repeat_rows():
    main = pd.DataFrame({"_id": [1, 2], "Consent": ["yes", "no"]})
    repeats = {"household/members": pd.DataFrame({
        "_parent_index": [1, 1, 2], "Member": ["a", "b", "c"],
    })}
    cfg = {"pii": {"consent_column": "Consent"}}
    _, out_repeats = enforce_pii(main, repeats, cfg)
    members = out_repeats["household/members"]
    assert list(members["_parent_index"]) == [1, 1]


def test_enforce_pii_no_block_returns_inputs_unchanged():
    main = pd.DataFrame({"_id": [1, 2], "Name": ["A", "B"]})
    repeats = {"r": pd.DataFrame({"_parent_index": [1], "X": [9]})}
    out, out_r = enforce_pii(main, repeats, {})
    assert list(out["Name"]) == ["A", "B"]
    assert list(out_r["r"]["X"]) == [9]


def test_enforce_pii_misconfig_raises():
    main = pd.DataFrame({"_id": [1], "Region": ["N"]})
    cfg = {"pii": {"consent_column": "Consent"}}
    with pytest.raises(PIIConfigError):
        enforce_pii(main, {}, cfg)
