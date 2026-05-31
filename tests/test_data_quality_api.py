import pandas as pd
from fastapi.testclient import TestClient
import web.main as wm


def test_data_quality_endpoint_returns_numeric_rows(monkeypatch):
    cfg = {"questions": [
        {"export_label": "Phone", "category": "qualitative"},
        {"export_label": "Age", "category": "quantitative"},
    ]}
    main_df = pd.DataFrame({
        "_id":   [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        "Phone": ["x", None, "y", "z", "w", None, "v", "u", "t", "s"],  # 80% complete
        "Age":   [20, 21, 22, 23, 24, 25, 26, 27, 28, 9999],            # 1 outlier
    })
    monkeypatch.setattr(wm, "load_config", lambda *_a, **_k: cfg)
    monkeypatch.setattr(wm, "load_processed_data", lambda *_a, **_k: (main_df, {}))

    resp = TestClient(wm.app).get("/api/data-quality")
    assert resp.status_code == 200
    body = resp.json()
    assert body["has_data"] is True
    by = {r["column"]: r for r in body["rows"]}
    assert by["Phone"]["completeness"] == 80.0
    assert by["Phone"]["outlier_rate"] is None
    assert by["Age"]["outlier_rate"] == 10.0


def test_data_quality_endpoint_no_data(monkeypatch):
    def _raise(*_a, **_k):
        raise FileNotFoundError("no data")
    monkeypatch.setattr(wm, "load_config", lambda *_a, **_k: {})
    monkeypatch.setattr(wm, "load_processed_data", _raise)
    body = TestClient(wm.app).get("/api/data-quality").json()
    assert body["has_data"] is False
    assert body["rows"] == []
    assert "message" in body


def test_data_quality_endpoint_includes_repeat_tables(monkeypatch):
    cfg = {"questions": [{"export_label": "Age", "category": "quantitative"}]}
    main_df = pd.DataFrame({"_id": [1, 2, 3], "Age": [10, 20, 30]})
    repeats = {"members": pd.DataFrame({"_root_id": [1, 2, 3], "Name": ["a", "b", "c"]})}
    monkeypatch.setattr(wm, "load_config", lambda *_a, **_k: cfg)
    monkeypatch.setattr(wm, "load_processed_data", lambda *_a, **_k: (main_df, repeats))

    body = TestClient(wm.app).get("/api/data-quality").json()
    assert body["has_data"] is True
    assert [t["name"] for t in body["tables"]] == ["members"]
    cols = {r["column"] for r in body["tables"][0]["rows"]}
    assert "Name" in cols and "_root_id" not in cols
