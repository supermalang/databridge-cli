import pandas as pd
from fastapi.testclient import TestClient
import web.main as wm


def test_preview_returns_breakdown(tmp_path, monkeypatch):
    monkeypatch.setattr(wm, "DATA_DIR", tmp_path)
    pd.DataFrame({"Region": ["N", "N", "S"], "Doses": [10, 20, 5]}).to_csv(
        tmp_path / "survey_data.csv", index=False)
    client = TestClient(wm.app)
    resp = client.post("/api/indicators/preview", json={
        "indicator": {"name": "doses", "stat": "sum", "question": "Doses", "disaggregate_by": "Region"},
        "data_file": "survey_data.csv",
    })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["value"] == "35"   # overall sum: 10+20+5=35
    by = {r["group"]: r["value"] for r in body["breakdown"]}
    assert by == {"N": 30, "S": 5}


def test_preview_no_disaggregation_returns_empty_breakdown(tmp_path, monkeypatch):
    monkeypatch.setattr(wm, "DATA_DIR", tmp_path)
    pd.DataFrame({"Doses": [10, 20, 5]}).to_csv(tmp_path / "survey_data.csv", index=False)
    client = TestClient(wm.app)
    resp = client.post("/api/indicators/preview", json={
        "indicator": {"name": "doses", "stat": "sum", "question": "Doses"},
        "data_file": "survey_data.csv",
    })
    assert resp.status_code == 200
    assert resp.json()["breakdown"] == []
