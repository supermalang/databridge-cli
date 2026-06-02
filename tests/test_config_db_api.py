import yaml
from fastapi.testclient import TestClient


def _client():
    from web.main import app
    return TestClient(app)


def test_get_config_returns_active_project_yaml():
    with _client() as c:
        r = c.get("/api/config")
        assert r.status_code == 200
        body = r.json()
        assert "content" in body and "exists" in body


def test_post_config_persists_to_active_project():
    with _client() as c:
        new_cfg = {"api": {"platform": "kobo", "url": "http://x", "token": "t"},
                   "form": {"uid": "U", "alias": "demo"}, "filters": ["Age > 0"]}
        r = c.post("/api/config", json={"content": yaml.safe_dump(new_cfg)})
        assert r.status_code == 200
        got = yaml.safe_load(c.get("/api/config").json()["content"])
        assert got["form"]["alias"] == "demo"
        assert got["filters"] == ["Age > 0"]


def test_post_invalid_yaml_400():
    with _client() as c:
        r = c.post("/api/config", json={"content": "key: : : ["})
        assert r.status_code == 400
