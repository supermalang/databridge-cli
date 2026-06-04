import sys
import asyncio
import pytest
from fastapi.testclient import TestClient
import web.main as wm


@pytest.fixture(autouse=True)
def _reset_registry():
    wm._registry = wm._runs.RunRegistry()
    # Ensure no active project is set on the dev user (other test modules may have
    # activated a project, which would change lock_key from "__base__" to a project ID).
    try:
        with wm.db_session.SessionLocal() as _db:
            dev_user = wm.db_repo.get_user_by_sub(_db, "dev-local")
            if dev_user is not None and dev_user.active_project_id is not None:
                dev_user.active_project_id = None
                _db.commit()
    except Exception:
        pass
    yield
    wm._registry = wm._runs.RunRegistry()


@pytest.fixture(autouse=True)
def _isolated_base(tmp_path, monkeypatch):
    """A run resolves the (session-shared) active project and, on success, refreshes the
    BASE_DIR read-mirror via pull_workspace — which clears BASE_DIR's data/processed,
    reports, templates dirs. Redirect BASE_DIR to a temp dir so these run tests never
    touch the real repo dirs (a project left active by another test file would otherwise
    make a 'download' here clear the real templates/.gitkeep)."""
    monkeypatch.setattr(wm, "BASE_DIR", tmp_path)
    for sub in ("data/processed", "reports", "templates"):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)


def test_run_rejected_409_when_busy():
    wm._registry.start("download", "__base__")   # a no-project run holds the base lock
    client = TestClient(wm.app)
    resp = client.post("/api/run/build-report", json={})   # no active project -> "__base__"
    assert resp.status_code == 409
    assert len(wm._registry.active()) == 1        # the active run is untouched


def test_status_reflects_running():
    client = TestClient(wm.app)
    assert client.get("/api/status").json().get("running") is False
    wm._registry.start("download", "__base__")
    assert client.get("/api/status").json().get("running") is True


def test_lock_cleared_after_run(monkeypatch):
    class _FakeStdout:
        def __init__(self, lines): self._lines = list(lines)
        def __aiter__(self): return self
        async def __anext__(self):
            if not self._lines:
                raise StopAsyncIteration
            return self._lines.pop(0)

    class _FakeProc:
        def __init__(self): self.stdout = _FakeStdout([b"hello\n"]); self.returncode = 0
        async def wait(self): return 0

    async def _fake_exec(*a, **k):
        return _FakeProc()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _fake_exec)
    client = TestClient(wm.app)
    resp = client.post("/api/run/download", json={})
    assert resp.status_code == 200
    _ = resp.text  # consume the stream fully
    assert wm._registry.active() == []


def test_run_all_is_whitelisted_with_sample_and_period():
    assert "run-all" in wm.ALLOWED_COMMANDS
    assert "--sample" in wm.ALLOWED_COMMANDS["run-all"]
    assert "--period" in wm.ALLOWED_COMMANDS["run-all"]


def test_run_all_endpoint_builds_argv(monkeypatch):
    captured = {}
    async def _fake_stream(run_id, command, cmd, run_ctx=None):
        captured["cmd"] = cmd
        yield wm._sse("status", {"status": "running", "command": command})
        yield wm._sse("done", {})
    monkeypatch.setattr(wm, "_stream", _fake_stream)
    client = TestClient(wm.app)
    resp = client.post("/api/run/run-all", json={"sample": 5, "period": "Q1 2026"})
    assert resp.status_code == 200
    assert captured["cmd"] == [sys.executable, str(wm.BASE_DIR / "src" / "data" / "make.py"), "run-all", "--sample", "5", "--period", "Q1 2026"]


def test_unknown_command_still_400():
    client = TestClient(wm.app)
    assert client.post("/api/run/bogus", json={}).status_code == 400


def test_run_all_allows_auto_charts_flag():
    assert "--auto-charts" in wm.ALLOWED_COMMANDS["run-all"]


def test_run_all_endpoint_forwards_auto_charts(monkeypatch):
    captured = {}
    async def _fake_stream(run_id, command, cmd, run_ctx=None):
        captured["cmd"] = cmd
        yield wm._sse("status", {"status": "running", "command": command})
        yield wm._sse("done", {})
    monkeypatch.setattr(wm, "_stream", _fake_stream)
    client = TestClient(wm.app)
    resp = client.post("/api/run/run-all", json={"auto_charts": True})
    assert resp.status_code == 200
    assert "--auto-charts" in captured["cmd"]
