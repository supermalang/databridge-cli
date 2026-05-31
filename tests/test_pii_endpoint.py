import yaml
import pytest


@pytest.fixture
def tmp_pii_workspace(tmp_path, monkeypatch):
    ws = tmp_path / "ws"
    ws.mkdir()
    cfg = {
        "api":  {"platform": "kobo", "url": "x", "token": "x"},
        "form": {"alias": "p", "uid": "x"},
        "questions": [],
        "pii": {
            "consent_column": "Consent",
            "redact": [{"column": "Phone", "strategy": "hash"}],
        },
    }
    (ws / "config.yml").write_text(yaml.dump(cfg, allow_unicode=True))
    monkeypatch.chdir(ws)
    yield ws


def test_get_pii_returns_block(tmp_pii_workspace, api_client):
    r = api_client.get("/api/pii")
    assert r.status_code == 200
    body = r.json()
    assert body["consent_column"] == "Consent"
    assert len(body["redact"]) == 1


def test_get_pii_returns_empty_when_no_block(tmp_path, monkeypatch, api_client):
    ws = tmp_path / "ws2"
    ws.mkdir()
    (ws / "config.yml").write_text(yaml.dump({
        "api": {"platform": "kobo", "url": "x", "token": "x"},
        "form": {"alias": "p", "uid": "x"}, "questions": [],
    }, allow_unicode=True))
    monkeypatch.chdir(ws)
    r = api_client.get("/api/pii")
    assert r.status_code == 200
    assert r.json() == {"consent_column": None, "consent_value": "yes", "redact": []}


def test_post_pii_writes_back(tmp_pii_workspace, api_client):
    payload = {
        "consent_column": "NewConsent",
        "consent_value":  "AGREE",
        "redact": [
            {"column": "Phone", "strategy": "mask"},
            {"column": "GPS",   "strategy": "generalize_geo", "decimals": 1},
        ],
    }
    r = api_client.post("/api/pii", json=payload)
    assert r.status_code == 200
    cfg = yaml.safe_load((tmp_pii_workspace / "config.yml").read_text())
    assert cfg["pii"]["consent_column"] == "NewConsent"
    assert cfg["pii"]["consent_value"] == "AGREE"
    assert len(cfg["pii"]["redact"]) == 2
