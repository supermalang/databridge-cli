import pandas as pd
from fastapi.testclient import TestClient
import web.main as wm


def test_base_tables_catalog(monkeypatch):
    main_df = pd.DataFrame({"_id": [12], "Region": ["North"]})
    members = pd.DataFrame({
        "_parent_index": [12], "_root_id": [12], "_parent_row_id": [12],
        "_row_id": ["12.0"], "_row_index": [0], "Name": ["A"],
    })
    illnesses = pd.DataFrame({
        "_parent_index": [12], "_root_id": [12], "_parent_row_id": ["12.0"],
        "_row_id": ["12.0.0"], "_row_index": [0], "Illness": ["flu"],
    })
    repeats = {
        "household_members": members,
        "household_members_illnesses": illnesses,
    }
    monkeypatch.setattr(wm, "load_config", lambda *_a, **_k: {})
    monkeypatch.setattr(wm, "load_processed_data", lambda *_a, **_k: (main_df, repeats))

    client = TestClient(wm.app)
    resp = client.get("/api/base-tables")
    assert resp.status_code == 200
    tables = {t["name"]: t for t in resp.json()["tables"]}

    assert tables["main"]["rows"] == 1
    assert tables["main"]["parent"] is None
    assert "Region" in tables["main"]["columns"]

    assert tables["household_members"]["parent"] == "main"
    assert tables["household_members_illnesses"]["parent"] == "household_members"
    assert "Illness" in tables["household_members_illnesses"]["columns"]
    assert "_row_id" in tables["household_members_illnesses"]["linkage"]


def test_base_tables_no_data_returns_empty(monkeypatch):
    def _raise(*_a, **_k):
        raise FileNotFoundError("no data")
    monkeypatch.setattr(wm, "load_config", lambda *_a, **_k: {})
    monkeypatch.setattr(wm, "load_processed_data", _raise)

    client = TestClient(wm.app)
    resp = client.get("/api/base-tables")
    assert resp.status_code == 200
    body = resp.json()
    assert body["tables"] == []
    assert "message" in body
