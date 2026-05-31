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
