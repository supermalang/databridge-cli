import uuid
from pathlib import Path
import pytest
from fastapi.testclient import TestClient


def _client():
    from web.main import app
    return TestClient(app)


@pytest.fixture
def isolated_base(tmp_path, monkeypatch):
    """Redirect the app's working-dir root to a temp dir so activate/run workspace
    operations (which clear/write data/processed, reports, templates) never touch the
    real repo dirs. The handlers pass base=BASE_DIR (a module global) to the workspace
    helpers, so patching wm.BASE_DIR fully isolates them."""
    import web.main as wm
    monkeypatch.setattr(wm, "BASE_DIR", tmp_path)
    for sub in ("data/processed", "reports", "templates"):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)
    return tmp_path


def _make_project_with_report(c, name, report_name):
    """Create a project, activate it, and push a report into its Minio prefix."""
    import web.main as wm
    from web.storage import factory
    from web.storage.base import storage_key
    pid = c.post("/api/projects", json={"name": name}).json()["id"]
    c.post(f"/api/projects/{pid}/activate")
    with wm.db_session.SessionLocal() as db:
        proj = db.get(wm.db_repo.Project, uuid.UUID(pid))
        org_id = str(proj.org_id)
    store = factory.get_storage()
    store.put_bytes(storage_key(org_id, pid, "reports", report_name), b"DOCX")
    return pid


def test_activate_pulls_workspace_into_reports_dir(isolated_base):
    with _client() as c:
        pid = _make_project_with_report(c, "WS-A", "ra.docx")
        r = c.post(f"/api/projects/{pid}/activate")     # re-activate -> fresh pull
        assert r.status_code == 200
        assert (isolated_base / "reports" / "ra.docx").exists()


def test_activate_swaps_mirror_between_projects(isolated_base):
    with _client() as c:
        pid_a = _make_project_with_report(c, "WS-1", "a_only.docx")
        pid_b = _make_project_with_report(c, "WS-2", "b_only.docx")
        c.post(f"/api/projects/{pid_a}/activate")
        assert (isolated_base / "reports" / "a_only.docx").exists()
        assert not (isolated_base / "reports" / "b_only.docx").exists()
        c.post(f"/api/projects/{pid_b}/activate")
        assert (isolated_base / "reports" / "b_only.docx").exists()
        assert not (isolated_base / "reports" / "a_only.docx").exists()


def test_successful_run_pushes_outputs(isolated_base, monkeypatch):
    import web.main as wm
    from web.storage import factory
    from web.storage.base import storage_key

    class _FakeStdout:
        def __init__(self, lines): self._lines = list(lines)
        def __aiter__(self): return self
        async def __anext__(self):
            if not self._lines:
                raise StopAsyncIteration
            return self._lines.pop(0)

    class _FakeProc:
        def __init__(self):
            self.stdout = _FakeStdout([b"working\n", b"done\n"])
            self.returncode = 0
        async def wait(self): return 0

    async def _fake_exec(*a, **k):
        cwd = Path(k["cwd"])
        (cwd / "reports").mkdir(parents=True, exist_ok=True)
        (cwd / "reports" / "produced.docx").write_bytes(b"NEW")
        return _FakeProc()

    monkeypatch.setattr(wm.asyncio, "create_subprocess_exec", _fake_exec)
    wm._registry = wm._runs.RunRegistry()

    with _client() as c:
        pid = _make_project_with_report(c, "WS-RUN", "seed.docx")
        c.post(f"/api/projects/{pid}/activate")
        with wm.db_session.SessionLocal() as db:
            org_id = str(db.get(wm.db_repo.Project, uuid.UUID(pid)).org_id)
        resp = c.post("/api/run/build-report", json={})
        assert resp.status_code == 200
        _ = resp.text          # drain the SSE stream so _stream completes
        store = factory.get_storage()
        assert storage_key(org_id, pid, "reports", "produced.docx") in \
            store.list(f"orgs/{org_id}/projects/{pid}/")


def test_run_executes_in_tempdir_and_persists(isolated_base, monkeypatch):
    import web.main as wm
    from web.storage import factory
    from web.storage.base import storage_key

    captured = {}

    class _FakeStdout:
        def __init__(self, lines): self._lines = list(lines)
        def __aiter__(self): return self
        async def __anext__(self):
            if not self._lines:
                raise StopAsyncIteration
            return self._lines.pop(0)

    class _FakeProc:
        def __init__(self):
            self.stdout = _FakeStdout([b"working\n"])
            self.returncode = 0
        async def wait(self): return 0

    async def _fake_exec(*a, **k):
        cwd = Path(k["cwd"])
        captured["cwd"] = cwd
        (cwd / "reports").mkdir(parents=True, exist_ok=True)
        (cwd / "reports" / "produced.docx").write_bytes(b"NEW")
        return _FakeProc()

    monkeypatch.setattr(wm.asyncio, "create_subprocess_exec", _fake_exec)
    wm._registry = wm._runs.RunRegistry()

    with _client() as c:
        pid = _make_project_with_report(c, "WS-ISO", "seed.docx")
        c.post(f"/api/projects/{pid}/activate")
        with wm.db_session.SessionLocal() as db:
            org_id = str(db.get(wm.db_repo.Project, uuid.UUID(pid)).org_id)
        resp = c.post("/api/run/build-report", json={})
        assert resp.status_code == 200
        _ = resp.text                                  # drain SSE so _stream finishes

        assert captured["cwd"] != isolated_base
        assert not captured["cwd"].exists()            # tempdir cleaned up
        store = factory.get_storage()
        assert storage_key(org_id, pid, "reports", "produced.docx") in \
            store.list(f"orgs/{org_id}/projects/{pid}/")
        assert (isolated_base / "reports" / "produced.docx").exists()   # read-mirror refreshed


def test_run_hydrate_failure_releases_lock(isolated_base, monkeypatch):
    import web.main as wm
    monkeypatch.setattr(wm.storage_workspace, "hydrate_run_dir",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("hydrate boom")))
    wm._registry = wm._runs.RunRegistry()
    with _client() as c:
        pid = _make_project_with_report(c, "WS-HYD", "seed.docx")
        c.post(f"/api/projects/{pid}/activate")
        resp = c.post("/api/run/build-report", json={})
        assert resp.status_code == 200
        body = resp.text
        assert "hydrate boom" in body or "error" in body
        assert wm._registry.active() == []             # lock released
