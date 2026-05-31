import yaml
import pytest


@pytest.fixture
def tmp_framework_workspace(tmp_path, monkeypatch):
    ws = tmp_path / "ws"
    ws.mkdir()
    cfg = {
        "api":  {"platform": "kobo", "url": "x", "token": "x"},
        "form": {"alias": "fw", "uid": "x"},
        "questions": [],
        "framework": {
            "goal":     {"id": "GOAL", "label": "Reduce X"},
            "outcomes": [{"id": "OC1", "label": "Outcome 1", "parent": "GOAL"}],
            "outputs":  [{"id": "OP1.1", "label": "Output 1.1", "parent": "OC1"}],
        },
    }
    (ws / "config.yml").write_text(yaml.dump(cfg, allow_unicode=True))
    monkeypatch.chdir(ws)
    yield ws


def test_get_framework_returns_block(tmp_framework_workspace, api_client):
    r = api_client.get("/api/framework")
    assert r.status_code == 200
    body = r.json()
    assert body["goal"]["id"] == "GOAL"
    assert len(body["outcomes"]) == 1
    assert len(body["outputs"]) == 1


def test_get_framework_returns_empty_when_absent(tmp_path, monkeypatch, api_client):
    ws = tmp_path / "ws2"
    ws.mkdir()
    cfg = {"api": {"platform": "kobo", "url": "x", "token": "x"},
           "form": {"alias": "p", "uid": "x"}, "questions": []}
    (ws / "config.yml").write_text(yaml.dump(cfg, allow_unicode=True))
    monkeypatch.chdir(ws)
    r = api_client.get("/api/framework")
    assert r.status_code == 200
    assert r.json() == {"goal": None, "outcomes": [], "outputs": []}


def test_post_framework_writes_back(tmp_framework_workspace, api_client):
    new_fw = {
        "goal": {"id": "GOAL", "label": "Updated goal"},
        "outcomes": [{"id": "OC1", "label": "Outcome 1", "parent": "GOAL"}],
        "outputs": [
            {"id": "OP1.1", "label": "Output 1.1", "parent": "OC1"},
            {"id": "OP1.2", "label": "New output", "parent": "OC1"},
        ],
    }
    r = api_client.post("/api/framework", json=new_fw)
    assert r.status_code == 200
    cfg = yaml.safe_load((tmp_framework_workspace / "config.yml").read_text())
    assert len(cfg["framework"]["outputs"]) == 2
    assert cfg["framework"]["goal"]["label"] == "Updated goal"
