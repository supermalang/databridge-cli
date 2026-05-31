import sys
from fastapi.testclient import TestClient
import web.main as wm


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
