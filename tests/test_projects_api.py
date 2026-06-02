import yaml
from fastapi.testclient import TestClient


def _client():
    from web.main import app
    return TestClient(app)


def test_list_projects_includes_active():
    with _client() as c:
        r = c.get("/api/projects")
        assert r.status_code == 200
        body = r.json()
        assert "projects" in body and "active_id" in body


def test_create_and_activate_project_switches_config():
    with _client() as c:
        r = c.post("/api/projects", json={"name": "Second"})
        assert r.status_code == 200
        pid = r.json()["id"]
        c.post("/api/projects/" + pid + "/activate")
        cfg = {"api": {"platform": "kobo", "url": "u", "token": "t"},
               "form": {"uid": "U", "alias": "second"}}
        c.post("/api/config", json={"content": yaml.safe_dump(cfg)})
        got = yaml.safe_load(c.get("/api/config").json()["content"])
        assert got["form"]["alias"] == "second"
        assert c.get("/api/projects").json()["active_id"] == pid


def test_activate_unknown_project_404():
    with _client() as c:
        import uuid
        r = c.post("/api/projects/" + str(uuid.uuid4()) + "/activate")
        assert r.status_code == 404


def test_run_command_releases_lock_if_bridge_fails(monkeypatch):
    """If the run-time config mirror raises, the single-flight lock must NOT stick."""
    import web.main as wm
    from fastapi.testclient import TestClient

    def _boom(*a, **k):
        raise RuntimeError("mirror failed")

    monkeypatch.setattr(wm.db_bridge, "mirror_active", _boom)
    wm._running_command = None
    client = TestClient(wm.app, raise_server_exceptions=False)
    r = client.post("/api/run/download", json={})
    assert r.status_code == 500           # the failure surfaces
    assert wm._running_command is None     # ...but the lock was released
