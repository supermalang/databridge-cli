import sys
import asyncio
import pytest
from fastapi.testclient import TestClient
import web.main as wm


@pytest.fixture(autouse=True)
def _reset_running():
    wm._running_command = None
    yield
    wm._running_command = None


def test_run_rejected_409_when_busy():
    wm._running_command = "download"
    client = TestClient(wm.app)
    resp = client.post("/api/run/build-report", json={})
    assert resp.status_code == 409
    assert "download" in resp.json()["detail"]
    assert wm._running_command == "download"   # active run untouched


def test_status_reflects_running():
    client = TestClient(wm.app)
    assert client.get("/api/status").json().get("running") is False
    wm._running_command = "download"
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
    assert wm._running_command is None


def test_run_all_is_whitelisted_with_sample_and_period():
    assert "run-all" in wm.ALLOWED_COMMANDS
    assert "--sample" in wm.ALLOWED_COMMANDS["run-all"]
    assert "--period" in wm.ALLOWED_COMMANDS["run-all"]


def test_run_all_endpoint_builds_argv(monkeypatch):
    captured = {}
    async def _fake_stream(command, cmd):
        captured["command"] = command
        captured["cmd"] = cmd
        if False:
            yield ""  # make this an async generator
    monkeypatch.setattr(wm, "_stream", _fake_stream)
    client = TestClient(wm.app)
    resp = client.post("/api/run/run-all", json={"sample": 5, "period": "Q1 2026"})
    assert resp.status_code == 200
    assert captured["cmd"] == [sys.executable, "src/data/make.py", "run-all", "--sample", "5", "--period", "Q1 2026"]


def test_unknown_command_still_400():
    client = TestClient(wm.app)
    assert client.post("/api/run/bogus", json={}).status_code == 400
