import uuid
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
import web.main as wm


@pytest.fixture(autouse=True)
def _reset_registry():
    wm._registry = wm._runs.RunRegistry()
    yield
    wm._registry = wm._runs.RunRegistry()


@pytest.fixture(autouse=True)
def _isolated_base(tmp_path, monkeypatch):
    monkeypatch.setattr(wm, "BASE_DIR", tmp_path)
    for sub in ("data/processed", "reports", "templates"):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)


def _client():
    return TestClient(wm.app)


def _fake_exec_factory():
    class _FakeStdout:
        def __init__(self, lines): self._lines = list(lines)
        def __aiter__(self): return self
        async def __anext__(self):
            if not self._lines:
                raise StopAsyncIteration
            return self._lines.pop(0)

    class _FakeProc:
        def __init__(self):
            self.stdout = _FakeStdout([b"done\n"])
            self.returncode = 0
        async def wait(self): return 0

    async def _fake_exec(*a, **k):
        cwd = Path(k["cwd"])
        (cwd / "reports").mkdir(parents=True, exist_ok=True)
        (cwd / "reports" / "out.docx").write_bytes(b"X")
        return _FakeProc()
    return _fake_exec


def test_run_id_in_stream_and_stop_unknown_404(monkeypatch):
    monkeypatch.setattr(wm.asyncio, "create_subprocess_exec", _fake_exec_factory())
    with _client() as c:
        body = c.post("/api/run/download", json={}).text   # drains the stream
        assert '"run_id"' in body
    assert _client().post("/api/stop/" + uuid.uuid4().hex).status_code == 404


def test_same_project_second_run_409():
    # Clear any active project on the dev user so lock_key resolves to "__base__"
    with wm.db_session.SessionLocal() as db:
        u = wm.db_repo.get_user_by_sub(db, "dev-local")
        if u is not None:
            u.active_project_id = None
            db.commit()
    wm._registry.start("download", "__base__")             # hold the base lock
    assert _client().post("/api/run/download", json={}).status_code == 409


def test_cap_exceeded_429(monkeypatch):
    # Clear any active project on the dev user so lock_key resolves to "__base__"
    with wm.db_session.SessionLocal() as db:
        u = wm.db_repo.get_user_by_sub(db, "dev-local")
        if u is not None:
            u.active_project_id = None
            db.commit()
    monkeypatch.setenv("MAX_CONCURRENT_RUNS", "1")
    wm._registry.start("download", "p-other")              # fills the only slot
    r = _client().post("/api/run/download", json={})        # base key, but cap is full
    assert r.status_code == 429
    assert r.headers.get("Retry-After") == "2"


def test_status_lists_active_runs():
    wm._registry.start("build-report", "p1")
    wm._registry.start("download", "p2")
    body = _client().get("/api/status").json()
    assert body["running"] is True
    keys = {r["project_id"] for r in body["runs"]}
    assert keys == {"p1", "p2"}
