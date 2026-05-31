import pandas as pd
from src.data import run_state
from src.data.transform import export_data, load_processed_data


def _cfg(tmp_path, **extra):
    cfg = {
        "form": {"alias": "survey"},
        "export": {"format": "csv", "output_dir": str(tmp_path / "data")},
        "report": {"output_dir": str(tmp_path / "reports")},
        "charts": [{"name": "c", "type": "bar", "questions": ["Region"]}],
    }
    cfg.update(extra)
    return cfg


def test_config_fingerprint_stable_and_sensitive(tmp_path):
    cfg = _cfg(tmp_path)
    fp = run_state.config_fingerprint(cfg)
    assert fp == run_state.config_fingerprint(cfg)                       # stable
    cfg2 = _cfg(tmp_path, charts=[{"name": "c2", "type": "pie", "questions": ["Region"]}])
    assert run_state.config_fingerprint(cfg2) != fp                      # report-relevant change
    cfg3 = _cfg(tmp_path)
    cfg3["some_unrelated_key"] = {"x": 1}
    assert run_state.config_fingerprint(cfg3) == fp                      # unrelated key ignored


def test_data_fingerprint_none_when_no_data(tmp_path):
    assert run_state.data_fingerprint(_cfg(tmp_path)) is None


def test_data_fingerprint_changes_with_content(tmp_path):
    cfg = _cfg(tmp_path)
    export_data(pd.DataFrame({"_id": [1, 2], "Region": ["N", "S"]}), cfg)
    fp1 = run_state.data_fingerprint(cfg)
    assert fp1 is not None and fp1 == run_state.data_fingerprint(cfg)    # stable
    export_data(pd.DataFrame({"_id": [1, 2], "Region": ["N", "E"]}), cfg)  # content changed
    assert run_state.data_fingerprint(cfg) != fp1


def test_state_roundtrip_and_report_is_current(tmp_path):
    cfg = _cfg(tmp_path)
    export_data(pd.DataFrame({"_id": [1], "Region": ["N"]}), cfg)
    # no report yet -> not current
    assert run_state.report_is_current(cfg) is False
    # drop a report + record matching state -> current
    rdir = tmp_path / "reports"; rdir.mkdir(parents=True, exist_ok=True)
    (rdir / "survey_report.docx").write_text("x")
    run_state.save_state(cfg, run_state.data_fingerprint(cfg), run_state.config_fingerprint(cfg), built_at="2026-05-31T00:00:00")
    assert run_state.load_state(cfg)["data"] == run_state.data_fingerprint(cfg)
    assert run_state.report_is_current(cfg) is True
    # config change -> stale
    cfg["charts"] = [{"name": "z", "type": "pie", "questions": ["Region"]}]
    assert run_state.report_is_current(cfg) is False
