import pandas as pd
from fastapi.testclient import TestClient
import web.main as wm


def test_profile_endpoint_returns_per_table_profiles(monkeypatch):
    cfg = {"questions": [
        {"export_label": "Region", "category": "categorical"},
        {"export_label": "Age", "category": "quantitative"},
    ]}
    main_df = pd.DataFrame({"_id": [1, 2, 3], "Region": ["N", "S", "N"], "Age": [10, 20, 30]})
    repeats = {"household_members": pd.DataFrame({
        "_parent_index": [1], "_row_id": ["1.0"], "Name": ["A"],
    })}
    monkeypatch.setattr(wm, "load_config", lambda *_a, **_k: cfg)
    monkeypatch.setattr(wm, "load_processed_data", lambda *_a, **_k: (main_df, repeats))

    client = TestClient(wm.app)
    resp = client.get("/api/profile")
    assert resp.status_code == 200
    profiles = {p["name"]: p for p in resp.json()["profiles"]}
    assert "main" in profiles and "household_members" in profiles
    assert profiles["main"]["rows"] == 3
    age = next(c for c in profiles["main"]["columns"] if c["name"] == "Age")
    assert age["role"] == "quantitative" and "median" in age


def test_profile_endpoint_no_data(monkeypatch):
    def _raise(*_a, **_k):
        raise FileNotFoundError("no data")
    monkeypatch.setattr(wm, "load_config", lambda *_a, **_k: {})
    monkeypatch.setattr(wm, "load_processed_data", _raise)
    client = TestClient(wm.app)
    body = client.get("/api/profile").json()
    assert body["profiles"] == [] and "message" in body
