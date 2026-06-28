import pandas as pd
from fastapi.testclient import TestClient
import web.main as wm


def test_ask_endpoint_returns_proposals(monkeypatch):
    cfg = {"ai": {"provider": "openai", "api_key": "sk-x"},
           "questions": [{"export_label": "Region", "category": "categorical"}]}
    df = pd.DataFrame({"_id": [1, 2, 3], "Region": ["N", "E", "E"]})
    monkeypatch.setattr(wm, "load_config", lambda *a, **k: cfg)
    monkeypatch.setattr(wm, "load_processed_data", lambda *a, **k: (df, {}))
    monkeypatch.setattr(wm.ask_engine, "ask",
                        lambda q, c, d, r: {"proposals": [{"recipe": {"name": "x"}, "image": "data:image/png;base64,AAA", "caption": "cap"}],
                                            "skipped": [], "message": None})
    client = TestClient(wm.app)
    resp = client.post("/api/ask", json={"question": "by region?"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["proposals"][0]["caption"] == "cap"


def test_ask_endpoint_no_data(monkeypatch):
    monkeypatch.setattr(wm, "load_config", lambda *a, **k: {})
    def _raise(*a, **k):
        raise FileNotFoundError("no data")
    monkeypatch.setattr(wm, "load_processed_data", _raise)
    client = TestClient(wm.app)
    body = client.post("/api/ask", json={"question": "q"}).json()
    assert body["proposals"] == [] and "Download" in body["message"]


def test_ask_save_appends(monkeypatch):
    saved = {}
    cfg = {"charts": []}
    monkeypatch.setattr(wm, "load_config", lambda *a, **k: cfg)
    monkeypatch.setattr(wm, "write_config", lambda c, p: saved.update({"charts": c["charts"]}))
    # Use the context-manager form so the lifespan runs init_db(), provisioning the
    # dev user + active project that _require("editor") needs. Without this, a cold
    # run (no prior test has bootstrapped the DB) returns 400 "No active project".
    with TestClient(wm.app) as client:
        resp = client.post("/api/ask/save", json={"recipe": {"name": "by_region", "type": "bar", "questions": ["Region"]}})
    assert resp.status_code == 200 and resp.json()["name"] == "by_region"
    assert saved["charts"][0]["name"] == "by_region"


def test_ask_save_indicator_appends_to_indicators(monkeypatch):
    saved = {}
    cfg = {}
    monkeypatch.setattr(wm, "load_config", lambda *a, **k: cfg)
    monkeypatch.setattr(wm, "write_config", lambda c, p: saved.update(c))
    with TestClient(wm.app) as client:
        resp = client.post("/api/ask/save",
                           json={"recipe": {"name": "n_rows", "stat": "count"}, "kind": "indicator"})
    assert resp.status_code == 200 and resp.json()["name"] == "n_rows"
    assert saved["indicators"][0]["name"] == "n_rows"


def test_ask_refine_endpoint(monkeypatch):
    cfg = {"ai": {"provider": "openai", "api_key": "sk-x"}, "questions": []}
    df = pd.DataFrame({"_id": [1, 2, 3]})
    monkeypatch.setattr(wm, "load_config", lambda *a, **k: cfg)
    monkeypatch.setattr(wm, "load_processed_data", lambda *a, **k: (df, {}))
    monkeypatch.setattr(wm.ask_engine, "refine_item",
                        lambda recipe, kind, instr, c, d, r: {"proposal": {"kind": "chart", "recipe": {"name": "x"}, "image": "data:image/png;base64,AAA", "caption": "cap"}, "skipped": None, "message": None})
    client = TestClient(wm.app)
    resp = client.post("/api/ask/refine", json={"recipe": {"name": "x", "type": "bar"}, "kind": "chart", "instruction": "make it a line chart"})
    assert resp.status_code == 200
    assert resp.json()["proposal"]["caption"] == "cap"


def test_ask_refine_endpoint_no_data(monkeypatch):
    monkeypatch.setattr(wm, "load_config", lambda *a, **k: {})
    def _raise(*a, **k):
        raise FileNotFoundError("no data")
    monkeypatch.setattr(wm, "load_processed_data", _raise)
    client = TestClient(wm.app)
    body = client.post("/api/ask/refine", json={"recipe": {}, "kind": "chart", "instruction": "x"}).json()
    assert body["proposal"] is None and "Download" in body["message"]
