"""XTF-13 — Build options for Express & regular build.

Tests the API/whitelist half of the contract (the frontend half is covered by the
Playwright E2E in frontend/tests/e2e/build-options.spec.ts):

  - "--split-sample" is in ALLOWED_COMMANDS["build-report"]
  - RunPayload.split_sample is accepted and forwarded into the build-report argv as
    "--split-sample <N>", alongside the existing "--split-by <col>"
  - a request omitting both produces NEITHER flag (current default behavior)

Mock seam: monkeypatch wm._stream and capture the constructed `cmd` argv — the exact
pattern used by tests/test_run_all_api.py (run-all argv test). This isolates the argv
construction in run_command from the subprocess/registry/streaming machinery.
"""
import sys
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
    """Keep run tests off the real repo dirs (see tests/test_run_all_api.py)."""
    monkeypatch.setattr(wm, "BASE_DIR", tmp_path)
    for sub in ("data/processed", "reports", "templates"):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)


def _capture_argv(monkeypatch):
    """Stub wm._stream to capture the constructed argv without spawning a subprocess."""
    captured = {}

    async def _fake_stream(run_id, command, cmd, run_ctx=None):
        captured["cmd"] = cmd
        yield wm._sse("status", {"status": "running", "command": command})
        yield wm._sse("done", {})

    monkeypatch.setattr(wm, "_stream", _fake_stream)
    return captured


# ── AC: --split-sample whitelisted ──────────────────────────────────────────

def test_build_report_split_sample_whitelisted():
    """ALLOWED_COMMANDS['build-report'] must include --split-sample (it is currently missing)."""
    assert "--split-sample" in wm.ALLOWED_COMMANDS["build-report"]


def test_build_report_split_by_still_whitelisted():
    """--split-by remains whitelisted (regression guard for the same list)."""
    assert "--split-by" in wm.ALLOWED_COMMANDS["build-report"]


# ── AC: split_by + split_sample forwarded into argv ─────────────────────────

def test_build_report_split_sample_forwarded(monkeypatch):
    """POST {split_by: 'Site', split_sample: 2} → argv carries --split-by Site AND --split-sample 2."""
    captured = _capture_argv(monkeypatch)
    client = TestClient(wm.app)
    resp = client.post("/api/run/build-report", json={"split_by": "Site", "split_sample": 2})
    assert resp.status_code == 200
    _ = resp.text  # consume the stream

    cmd = captured["cmd"]
    # --split-by Site present (as an adjacent flag/value pair).
    assert "--split-by" in cmd
    assert cmd[cmd.index("--split-by") + 1] == "Site"
    # --split-sample 2 present (string-encoded like every other numeric flag).
    assert "--split-sample" in cmd
    assert cmd[cmd.index("--split-sample") + 1] == "2"


def test_build_report_split_sample_only(monkeypatch):
    """split_sample alone forwards --split-sample without requiring --split-by."""
    captured = _capture_argv(monkeypatch)
    client = TestClient(wm.app)
    resp = client.post("/api/run/build-report", json={"split_sample": 3})
    assert resp.status_code == 200
    _ = resp.text

    cmd = captured["cmd"]
    assert "--split-sample" in cmd
    assert cmd[cmd.index("--split-sample") + 1] == "3"
    assert "--split-by" not in cmd


# ── AC: omitting both → neither flag (current default behavior) ──────────────

def test_build_report_omitting_both_yields_neither_flag(monkeypatch):
    """No split_by / no split_sample → neither --split-by nor --split-sample in argv."""
    captured = _capture_argv(monkeypatch)
    client = TestClient(wm.app)
    resp = client.post("/api/run/build-report", json={})
    assert resp.status_code == 200
    _ = resp.text

    cmd = captured["cmd"]
    assert "--split-by" not in cmd
    assert "--split-sample" not in cmd
    # Sanity: the build-report command itself was constructed.
    assert cmd[:3] == [sys.executable, str(wm.BASE_DIR / "src" / "data" / "make.py"), "build-report"]
