import yaml
import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _isolated_base(tmp_path, monkeypatch):
    """Activating a project pulls its workspace from Minio into BASE_DIR's
    data/processed, reports, templates dirs (clearing top-level files first).
    Redirect BASE_DIR to a temp dir so these tests never clear the real repo dirs."""
    import web.main as wm
    monkeypatch.setattr(wm, "BASE_DIR", tmp_path)
    for sub in ("data/processed", "reports", "templates"):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)
    return tmp_path


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


def test_run_command_releases_lock_after_run(monkeypatch):
    """After a run completes (even if the subprocess itself succeeds), the registry lock
    must be released so subsequent runs are not rejected with 409."""
    import asyncio
    import web.main as wm
    from fastapi.testclient import TestClient

    class _FakeStdout:
        def __init__(self): self._done = False
        def __aiter__(self): return self
        async def __anext__(self):
            if not self._done:
                self._done = True
                return b"ok\n"
            raise StopAsyncIteration

    class _FakeProc:
        def __init__(self):
            self.stdout = _FakeStdout()
            self.returncode = 0
        async def wait(self): return 0

    async def _fake_exec(*a, **k): return _FakeProc()

    monkeypatch.setattr(wm.asyncio, "create_subprocess_exec", _fake_exec)
    wm._registry = wm._runs.RunRegistry()
    client = TestClient(wm.app)
    r = client.post("/api/run/download", json={})
    assert r.status_code == 200
    _ = r.text   # drain SSE stream so _stream finishes
    assert wm._registry.active() == []    # lock released after run
