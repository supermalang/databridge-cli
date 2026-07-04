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


def test_ask_save_rejects_pii_bullet_list_with_data(monkeypatch):
    """Security (MNT-19 follow-up): the persistence path must validate too.

    A bullet_list dumps raw row values verbatim, so /api/ask/save must reject one
    naming a pii:true column (rather than trusting the client and persisting it).
    With data present the recipe is validated against the profile (which drops the
    PII column), so the save is rejected 4xx and nothing is written to config."""
    saved = {}
    cfg = {"charts": [],
           "questions": [{"export_label": "Story", "type": "text", "pii": True}],
           "pii": {"redact": []}}
    df = pd.DataFrame({"_id": [1, 2, 3], "Story": ["a", "b", "c"]})
    monkeypatch.setattr(wm, "load_config", lambda *a, **k: cfg)
    monkeypatch.setattr(wm, "load_processed_data", lambda *a, **k: (df, {}))
    monkeypatch.setattr(wm, "write_config", lambda c, p: saved.update({"cfg": c}))
    with TestClient(wm.app) as client:
        resp = client.post("/api/ask/save",
                           json={"recipe": {"name": "stories", "type": "bullet_list",
                                            "questions": ["Story"]}})
    assert resp.status_code == 400, resp.text
    assert saved == {}, "a rejected recipe must not be persisted"
    assert cfg["charts"] == []


def test_ask_save_rejects_pii_bullet_list_without_data(monkeypatch):
    """Same gate before any download: with no data to profile, the cfg-only
    PII/hidden bullet_list gate still rejects the save so it can't be smuggled in
    and dumped verbatim at build time."""
    saved = {}
    cfg = {"charts": [],
           "questions": [{"export_label": "Story", "type": "text", "pii": True}],
           "pii": {"redact": []}}
    monkeypatch.setattr(wm, "load_config", lambda *a, **k: cfg)
    monkeypatch.setattr(wm, "write_config", lambda c, p: saved.update({"cfg": c}))
    # load_processed_data left un-mocked → real FileNotFoundError (no data).
    with TestClient(wm.app) as client:
        resp = client.post("/api/ask/save",
                           json={"recipe": {"name": "stories", "type": "bullet_list",
                                            "questions": ["Story"]}})
    assert resp.status_code == 400, resp.text
    assert saved == {}, "a rejected recipe must not be persisted"
    assert cfg["charts"] == []


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
