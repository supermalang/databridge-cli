# Orchestrator — Single-Flight Command Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** At most one CLI command runs at a time behind the web API; a concurrent `POST /api/run/{command}` is rejected with HTTP 409, fixing the `_proc` race and preventing shared-state corruption.

**Architecture:** A synchronous check-and-set on a module global `_running_command` in `run_command` (atomic — no `await` between check and set), released in `_stream`'s `finally`. `/api/status` exposes `running`. The frontend hook surfaces non-OK responses (esp. 409).

**Tech Stack:** FastAPI, asyncio subprocess, pytest + TestClient, React.

**Spec:** `docs/superpowers/specs/2026-05-31-orchestrator-single-flight-runs-design.md`. On `main`: Slice 1 + 2 merged; suite 302.

## File structure
- **Modify:** `web/main.py` (global `_running_command`; guard in `run_command`; release in `_stream` finally; `running` in `/api/status`).
- **Modify:** `tests/test_run_all_api.py` (autouse reset fixture + 3 tests).
- **Modify:** `frontend/src/hooks/useCommand.js` (handle `!res.ok`).

---

## Task 1: Backend single-flight guard

**Files:** Modify `web/main.py`; Test `tests/test_run_all_api.py`.

- [ ] **Step 1: Add tests** to `tests/test_run_all_api.py`. First add an autouse fixture at the top (after imports), then the 3 tests:

```python
import asyncio
import pytest


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
    # active run untouched
    assert wm._running_command == "download"


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
```

- [ ] **Step 2: Run** — `PYTHONPATH=. python -m pytest tests/test_run_all_api.py -v` — expect the new tests to FAIL (no `_running_command`, no `running` key, no guard).

- [ ] **Step 3: Edit `web/main.py`:**
  (a) Near `_proc: Optional[asyncio.subprocess.Process] = None` (line ~29), add:
  ```python
  _running_command: Optional[str] = None  # single-flight: name of the in-flight run, else None
  ```
  (b) In `run_command`, immediately after the `if command not in ALLOWED_COMMANDS: raise HTTPException(...)` check and the arg-list construction, **before** `return StreamingResponse(...)`, add (NOTE: keep this synchronous — do NOT add any `await` between the check and the assignment, or the atomic check-and-set breaks):
  ```python
      global _running_command
      if _running_command is not None:
          raise HTTPException(status_code=409,
              detail=f"A command is already running ('{_running_command}'). Stop it or wait for it to finish.")
      _running_command = command  # reserve synchronously (atomic: no await before return)
  ```
  Place the `global _running_command` declaration at the top of the function body (Python requires `global` before first use; if the function has no other globals, add it as the first statement).
  (c) In `_stream`, extend the `global` line and the `finally` block:
  ```python
  async def _stream(command: str, cmd: list) -> AsyncGenerator[str, None]:
      global _last_status, _proc, _running_command
      ...
      finally:
          _proc = None
          _running_command = None
  ```
  (d) In `get_status` (`@app.get("/api/status")`), change `return _last_status` to:
  ```python
      return {**_last_status, "running": _running_command is not None}
  ```

- [ ] **Step 4: Run** — `PYTHONPATH=. python -m pytest tests/test_run_all_api.py -v` (all pass incl. existing `test_run_all_endpoint_builds_argv` — the autouse fixture clears the reservation it leaves). Then full suite `PYTHONPATH=. python -m pytest tests/ -q` (no regressions).

- [ ] **Step 5: Commit**
```bash
git add web/main.py tests/test_run_all_api.py
git commit -m "feat(web): single-flight command runs (409 when busy) + running in /api/status"
```

---

## Task 2: Frontend surfaces non-OK responses

**Files:** Modify `frontend/src/hooks/useCommand.js`.

- [ ] **Step 1:** In `useCommand.js`, inside the `try` block, right after `const res = await fetch(...)` and before `if (!res.body) throw ...`, insert:
```javascript
      if (!res.ok) {
        let detail = `Request failed (${res.status})`;
        try { detail = (await res.json()).detail || detail; } catch {}
        onLogRef.current?.(detail, 'error');
        onStatusRef.current?.({ command, status: 'error', error: detail });
        finalStatus = 'error';
        return;   // finally still resets running/activeCmd
      }
```
(The `return` inside `try` still runs the `finally` block, which calls `setRunning(false)` / `setActiveCmd(null)`.)

- [ ] **Step 2: Verify the build** — `cd frontend && npm run build` (expect a clean Vite build, no errors). If `node_modules` is absent, run `npm install` first.

- [ ] **Step 3: Commit**
```bash
git add frontend/src/hooks/useCommand.js
git commit -m "fix(web-ui): surface non-OK run responses (e.g. 409 already-running) in the log"
```

---

## Task 3: Docs

**Files:** Modify `CLAUDE.md`.

- [ ] **Step 1:** In the SSE log streaming implementation note (search "SSE log streaming" / "asyncio.create_subprocess_exec"), append a sentence:
> Runs are **single-flight**: while one command is active, a second `POST /api/run/{command}` is rejected with **HTTP 409** (the in-flight command is tracked in `_running_command`, released in `_stream`'s `finally`); `GET /api/status` reports `running`. This prevents two pipeline runs from clobbering the shared `_proc` and `config.yml`/`data/`.

- [ ] **Step 2: Verify** — `PYTHONPATH=. python -m pytest tests/ -q` (green).

- [ ] **Step 3: Commit**
```bash
git add CLAUDE.md
git commit -m "docs: document single-flight command runs"
```

---

## Self-review notes
- **Spec coverage:** global + atomic guard + release in finally (T1) ✓; 409 with active-command name (T1) ✓; `/api/status` running (T1) ✓; autouse reset fixture + 3 tests (T1) ✓; frontend non-OK handling (T2) ✓; docs (T3) ✓.
- **Atomicity:** guard is synchronous in `run_command`, comment warns against inserting `await`. Reservation in the endpoint (not the lazy generator).
- **No leak:** released on every `_stream` terminal path via `finally`; tests reset via autouse fixture.
- **No placeholders:** complete code throughout.
