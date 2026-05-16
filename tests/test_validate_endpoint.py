"""Smoke test for /api/validate. Uses the in-process ASGI client + a temp workspace."""
import pandas as pd
import pytest
import yaml


@pytest.fixture
def tmp_workspace(tmp_path, monkeypatch):
    """Stage a config + a tiny data file the endpoint can read."""
    ws = tmp_path / "ws"
    (ws / "data" / "processed").mkdir(parents=True)
    csv = ws / "data" / "processed" / "vsmoke_data_20260101_120000.csv"
    # Use enough similar small values so that 999 is a clear IQR outlier.
    # With IQR of ~3 around [10-15], the 3*IQR upper bound is ~23, making 999 flagged.
    pd.DataFrame({
        "Region": ["A", "A", None, "B", "A", "B", "A", "B", "A"],
        "Age":    [10, 11, 12, 13, 14, 15, 10, 11, 999],
    }).to_csv(csv, index=False)

    cfg = {
        "api":  {"platform": "kobo", "url": "x", "token": "x"},
        "form": {"alias": "vsmoke", "uid": "x"},
        "questions": [
            {"kobo_key": "Region", "label": "Region", "type": "select_one",
             "category": "categorical", "group": "", "export_label": "Region"},
            {"kobo_key": "Age", "label": "Age", "type": "integer",
             "category": "quantitative", "group": "", "export_label": "Age"},
        ],
        "filters": [],
        "charts":  [],
        "report":  {"output_dir": str(ws / "reports")},
        "export":  {"format": "csv", "output_dir": str(ws / "data" / "processed")},
    }
    (ws / "config.yml").write_text(yaml.dump(cfg, allow_unicode=True))
    monkeypatch.chdir(ws)
    yield ws


def test_validate_endpoint_returns_report_envelope(tmp_workspace, api_client):
    r = api_client.post("/api/validate", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body.keys()) >= {"n_rows", "n_columns", "checks", "summary"}
    assert body["n_rows"] == 9


def test_validate_endpoint_finds_the_outlier(tmp_workspace, api_client):
    r = api_client.post("/api/validate", json={})
    body = r.json()
    # The Age column has a 999 — should appear as an outlier finding.
    outliers = [c for c in body["checks"] if c["kind"] == "outlier_iqr" and c["column"] == "Age"]
    assert outliers, f"expected an Age outlier; got {body['checks']}"
    assert 999 in outliers[0]["examples"] or 999.0 in outliers[0]["examples"]
