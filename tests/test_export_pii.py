import pandas as pd
import pytest
from src.data.transform import export_data, load_processed_data
from src.utils.pii import PIIConfigError


def _cfg(tmp_path, **pii):
    cfg = {"form": {"alias": "survey"},
           "export": {"format": "csv", "output_dir": str(tmp_path)}}
    if pii:
        cfg["pii"] = pii
    return cfg


def test_export_redacts_and_consent_gates_by_default(tmp_path):
    df = pd.DataFrame({
        "_id": [1, 2, 3],
        "Consent": ["yes", "no", "yes"],
        "Name": ["A", "B", "C"],
        "Region": ["N", "S", "E"],
    })
    cfg = _cfg(tmp_path, consent_column="Consent",
               redact=[{"column": "Name", "strategy": "drop"}])
    export_data(df, cfg)
    reloaded, _ = load_processed_data(cfg)
    assert len(reloaded) == 2
    assert "Name" not in reloaded.columns


def test_export_raw_when_redact_false(tmp_path):
    df = pd.DataFrame({"_id": [1, 2], "Consent": ["yes", "no"], "Name": ["A", "B"]})
    cfg = _cfg(tmp_path, consent_column="Consent",
               redact=[{"column": "Name", "strategy": "drop"}])
    export_data(df, cfg, redact=False)
    reloaded, _ = load_processed_data(cfg)
    assert len(reloaded) == 2
    assert "Name" in reloaded.columns


def test_export_no_pii_block_unchanged(tmp_path):
    df = pd.DataFrame({"_id": [1, 2], "Region": ["N", "S"]})
    cfg = _cfg(tmp_path)
    export_data(df, cfg)
    reloaded, _ = load_processed_data(cfg)
    assert len(reloaded) == 2 and "Region" in reloaded.columns


def test_export_fail_closed_on_missing_column(tmp_path):
    df = pd.DataFrame({"_id": [1], "Region": ["N"]})
    cfg = _cfg(tmp_path, consent_column="Consent")
    with pytest.raises(PIIConfigError):
        export_data(df, cfg)


def test_reexport_already_gated_data_with_redact_false_is_safe(tmp_path):
    # Simulates _run_classify re-exporting data whose 'Name' column was already
    # dropped at the primary gated export. A strict re-gate would raise; redact=False must not.
    cfg = _cfg(tmp_path, consent_column="Consent",
               redact=[{"column": "Name", "strategy": "drop"}])
    already_gated = pd.DataFrame({"_id": [1], "Consent": ["yes"], "Region": ["N"]})  # Name already gone
    export_data(already_gated, cfg, redact=False)   # must NOT raise PIIConfigError
    reloaded, _ = load_processed_data(cfg)
    assert "Region" in reloaded.columns
