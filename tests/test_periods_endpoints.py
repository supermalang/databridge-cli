import yaml
import pytest


@pytest.fixture
def tmp_periods_workspace(tmp_path, monkeypatch):
    ws = tmp_path / "ws"
    ws.mkdir()
    cfg = {
        "api":  {"platform": "kobo", "url": "x", "token": "x"},
        "form": {"alias": "p", "uid": "x"},
        "questions": [],
        "periods": {
            "current":  "Q1 2026",
            "baseline": "Q1 2026",
            "registry": [
                {"label": "Q1 2026", "slug": "q1_2026"},
                {"label": "Q2 2026", "slug": "q2_2026"},
            ],
        },
    }
    (ws / "config.yml").write_text(yaml.dump(cfg, allow_unicode=True))
    monkeypatch.chdir(ws)
    yield ws


def test_get_periods_returns_block(tmp_periods_workspace, api_client):
    r = api_client.get("/api/periods")
    assert r.status_code == 200
    body = r.json()
    assert body["current"] == "Q1 2026"
    assert body["baseline"] == "Q1 2026"
    assert len(body["registry"]) == 2


def test_post_current_period_updates_config(tmp_periods_workspace, api_client):
    r = api_client.post("/api/periods/current", json={"label": "Q2 2026"})
    assert r.status_code == 200
    body = r.json()
    assert body["current"] == "Q2 2026"

    cfg = yaml.safe_load((tmp_periods_workspace / "config.yml").read_text())
    assert cfg["periods"]["current"] == "Q2 2026"


def test_post_registry_appends_new_period(tmp_periods_workspace, api_client):
    r = api_client.post("/api/periods/registry", json={"label": "Q3 2026"})
    assert r.status_code == 200
    body = r.json()
    assert any(e["label"] == "Q3 2026" for e in body["registry"])

    cfg = yaml.safe_load((tmp_periods_workspace / "config.yml").read_text())
    labels = [e["label"] for e in cfg["periods"]["registry"]]
    assert "Q3 2026" in labels


def test_delete_registry_removes_period(tmp_periods_workspace, api_client):
    r = api_client.delete("/api/periods/registry/q2_2026")
    assert r.status_code == 200
    body = r.json()
    assert not any(e["slug"] == "q2_2026" for e in body["registry"])


def test_get_periods_empty_when_no_periods_block(tmp_path, monkeypatch, api_client):
    ws = tmp_path / "ws2"
    ws.mkdir()
    cfg = {"api": {"platform": "kobo", "url": "x", "token": "x"},
           "form": {"alias": "p", "uid": "x"}, "questions": []}
    (ws / "config.yml").write_text(yaml.dump(cfg, allow_unicode=True))
    monkeypatch.chdir(ws)
    r = api_client.get("/api/periods")
    assert r.status_code == 200
    body = r.json()
    assert body == {"current": None, "baseline": None, "registry": []}
