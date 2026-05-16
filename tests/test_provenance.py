import pandas as pd
from src.utils.provenance import build_provenance


def test_build_provenance_basic_fields():
    cfg = {
        "form": {"alias": "monitoring"},
        "filters": ["Age > 0", "Region != 'Test'"],
        "report": {"period": "Q1 2026"},
    }
    df = pd.DataFrame({"a": [1, 2, 3, 4, 5]})
    prov = build_provenance(cfg, df, data_downloaded_at=None)
    assert prov["n_submissions"] == 5
    assert prov["filters"] == ["Age > 0", "Region != 'Test'"]
    assert prov["period"] == "Q1 2026"
    assert isinstance(prov["generated_at"], str) and len(prov["generated_at"]) >= 10
    assert isinstance(prov["config_hash"], str) and len(prov["config_hash"]) == 12


def test_build_provenance_empty_optional_fields():
    cfg = {"form": {"alias": "x"}}
    df = pd.DataFrame()
    prov = build_provenance(cfg, df, data_downloaded_at=None)
    assert prov["n_submissions"] == 0
    assert prov["filters"] == []
    assert prov["period"] == ""
    assert prov["data_downloaded_at"] == ""


def test_build_provenance_hash_stable_for_same_input():
    cfg = {"form": {"alias": "x"}, "filters": ["a > 1"], "questions": [{"kobo_key": "x"}]}
    df = pd.DataFrame()
    h1 = build_provenance(cfg, df, data_downloaded_at=None)["config_hash"]
    h2 = build_provenance(cfg, df, data_downloaded_at=None)["config_hash"]
    assert h1 == h2


def test_build_provenance_hash_changes_when_config_changes():
    cfg_a = {"form": {"alias": "x"}, "filters": ["a > 1"]}
    cfg_b = {"form": {"alias": "x"}, "filters": ["a > 2"]}
    df = pd.DataFrame()
    h_a = build_provenance(cfg_a, df, data_downloaded_at=None)["config_hash"]
    h_b = build_provenance(cfg_b, df, data_downloaded_at=None)["config_hash"]
    assert h_a != h_b


def test_provenance_footer_oneliner_present():
    cfg = {"form": {"alias": "m"}, "filters": [], "report": {"period": "Q1"}}
    df = pd.DataFrame({"a": [1, 2]})
    prov = build_provenance(cfg, df, data_downloaded_at=None)
    assert "footer" in prov and "Q1" in prov["footer"] and "2" in prov["footer"]


from src.utils.provenance import data_mtime


def test_data_mtime_returns_string_for_existing_file(tmp_path):
    f = tmp_path / "survey_data_2025-01.csv"
    f.write_text("a,b\n1,2\n")
    result = data_mtime(tmp_path, "survey")
    assert result is not None
    assert len(result) == 16  # YYYY-MM-DD HH:MM


def test_data_mtime_returns_none_when_no_file(tmp_path):
    assert data_mtime(tmp_path, "survey") is None
