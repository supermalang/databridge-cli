# Per-Project Run Concurrency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the global single-flight run machinery with an in-memory `RunRegistry` that allows different projects to run concurrently (serialized per project, bounded by a global cap), exposes per-run stop/status with a `run_id`, and has the frontend target stop by `run_id`.

**Architecture:** A new `web/runs.py` holds `RunRegistry` (per-`lock_key` lock + global cap + run_id minting + per-run proc tracking + stop), replacing the `_proc`/`_running_command`/`_last_status` module globals in `web/main.py`. `run_command` reserves a `run_id` via `registry.start` (409 per-project busy / 429 cap), drops the vestigial pre-run `mirror_active`, and threads `run_id` through `_stream`. `/api/status` aggregates active runs; `/api/stop/{run_id}` targets one. The frontend captures `run_id` from the stream and stops by id. Reads stay process-wide (out of scope).

**Tech Stack:** Python (asyncio/uuid), FastAPI, pytest, React.

Spec: [docs/superpowers/specs/2026-06-03-per-project-run-concurrency-design.md](../specs/2026-06-03-per-project-run-concurrency-design.md)

---

## File Structure

- **Create** `web/runs.py` — `RunRegistry`, `RunInfo`, `BusyError`, `CapError`.
- **Modify** `web/main.py` — instantiate `_registry`; remove `_proc`/`_running_command`/`_last_status`; rewrite `run_command`, `_stream`, `GET /api/status`, `POST /api/stop`; add `POST /api/stop/{run_id}`.
- **Modify** `frontend/src/hooks/useCommand.js` — capture `run_id`; `stop()` → `/api/stop/{run_id}`.
- **Modify** `tests/test_run_all_api.py` — single-flight tests → registry/per-key semantics.
- **Modify** `tests/test_workspace_wiring.py` — `test_run_hydrate_failure_releases_lock` asserts via the registry.
- **Create** `tests/test_runs.py` — `RunRegistry` unit tests.
- **Modify** `tests/test_run_concurrency_api.py` (create) — concurrency/stop/status API tests.
- **Modify** `CLAUDE.md` — concurrency note.

**Contract (used across tasks):**
```
RunRegistry.start(command, lock_key) -> run_id        # raises BusyError (same key active) / CapError (>= cap)
RunRegistry.attach_proc(run_id, proc); set_status(run_id, status); finish(run_id)
RunRegistry.get(run_id); active() -> [RunInfo]; last() -> RunInfo|None; async stop(run_id) -> bool
RunInfo.public() -> {"run_id","command","status","project_id"}   # project_id None for "__base__"
_stream(run_id, command, cmd, run_ctx=None)
lock_key = str(project_id) if active project else "__base__"
```

---

## Task 1: web/runs.py — RunRegistry

**Files:** Create `web/runs.py`; Test `tests/test_runs.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_runs.py`:
```python
import asyncio
import pytest
from web.runs import RunRegistry, BusyError, CapError


def test_start_returns_unique_run_ids():
    r = RunRegistry()
    a = r.start("download", "p1")
    b = r.start("build-report", "p2")
    assert a != b
    assert {x.run_id for x in r.active()} == {a, b}


def test_same_lock_key_is_busy():
    r = RunRegistry()
    r.start("download", "p1")
    with pytest.raises(BusyError):
        r.start("build-report", "p1")


def test_different_keys_concurrent():
    r = RunRegistry()
    r.start("download", "p1")
    r.start("download", "p2")            # no raise
    assert len(r.active()) == 2


def test_global_cap(monkeypatch):
    monkeypatch.setenv("MAX_CONCURRENT_RUNS", "2")
    r = RunRegistry()
    r.start("download", "p1")
    r.start("download", "p2")
    with pytest.raises(CapError):
        r.start("download", "p3")


def test_finish_releases_lock_and_slot(monkeypatch):
    monkeypatch.setenv("MAX_CONCURRENT_RUNS", "1")
    r = RunRegistry()
    rid = r.start("download", "p1")
    with pytest.raises(CapError):
        r.start("download", "p2")
    r.finish(rid)
    assert r.active() == []
    r.start("download", "p2")            # slot + key free now


def test_finish_records_last():
    r = RunRegistry()
    rid = r.start("download", "p1")
    r.set_status(rid, "success")
    r.finish(rid)
    assert r.last().run_id == rid
    assert r.last().status == "success"


def test_public_maps_base_to_none_project():
    r = RunRegistry()
    rid = r.start("download", "__base__")
    info = r.get(rid)
    assert info.public()["project_id"] is None
    rid2 = r.start("download", "p9")
    assert r.get(rid2).public()["project_id"] == "p9"


def test_stop_terminates_and_unknown_is_false():
    r = RunRegistry()

    class _FakeProc:
        def __init__(self): self.terminated = False
        def terminate(self): self.terminated = True
        async def wait(self): return 0
        def kill(self): pass

    rid = r.start("download", "p1")
    proc = _FakeProc()
    r.attach_proc(rid, proc)
    assert asyncio.run(r.stop(rid)) is True
    assert proc.terminated is True
    assert asyncio.run(r.stop("nope")) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_runs.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'web.runs'`.

- [ ] **Step 3: Implement**

Create `web/runs.py`:
```python
"""In-memory registry of active runs: per-lock_key serialization + a global concurrency
cap + per-run process tracking. Replaces the old global single-flight run state."""
import asyncio
import os
import uuid
from collections import deque
from datetime import datetime


class BusyError(Exception):
    """Another run holds this lock_key (e.g. the same project)."""


class CapError(Exception):
    """The global concurrency cap is reached."""


class RunInfo:
    def __init__(self, run_id: str, command: str, lock_key: str):
        self.run_id = run_id
        self.command = command
        self.lock_key = lock_key
        self.proc = None
        self.status = "running"
        self.started_at = datetime.now().isoformat()
        self.finished_at = None

    def public(self) -> dict:
        return {
            "run_id": self.run_id,
            "command": self.command,
            "status": self.status,
            "project_id": None if self.lock_key == "__base__" else self.lock_key,
            "finished_at": self.finished_at,
        }


class RunRegistry:
    def __init__(self):
        self._active = {}                 # run_id -> RunInfo
        self._recent = deque(maxlen=20)   # finished RunInfo, newest last

    def _cap(self) -> int:
        try:
            return int(os.environ.get("MAX_CONCURRENT_RUNS", "4"))
        except ValueError:
            return 4

    def start(self, command: str, lock_key: str) -> str:
        """Atomic check-and-reserve (no await). Raises BusyError / CapError."""
        if any(r.lock_key == lock_key for r in self._active.values()):
            raise BusyError(lock_key)
        if len(self._active) >= self._cap():
            raise CapError()
        run_id = uuid.uuid4().hex[:12]
        self._active[run_id] = RunInfo(run_id, command, lock_key)
        return run_id

    def attach_proc(self, run_id: str, proc) -> None:
        info = self._active.get(run_id)
        if info is not None:
            info.proc = proc

    def set_status(self, run_id: str, status: str) -> None:
        info = self._active.get(run_id)
        if info is not None:
            info.status = status

    def finish(self, run_id: str) -> None:
        info = self._active.pop(run_id, None)
        if info is not None:
            info.finished_at = datetime.now().isoformat()
            self._recent.append(info)

    def get(self, run_id: str):
        return self._active.get(run_id)

    def active(self):
        return list(self._active.values())

    def last(self):
        return self._recent[-1] if self._recent else None

    async def stop(self, run_id: str) -> bool:
        info = self._active.get(run_id)
        if info is None or info.proc is None:
            return False
        proc = info.proc
        try:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                proc.kill()
        except ProcessLookupError:
            pass
        return True
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_runs.py -v`
Expected: PASS (8 passed).

- [ ] **Step 5: Commit**

```bash
git add web/runs.py tests/test_runs.py
git commit -m "feat(runs): in-memory RunRegistry (per-key lock + global cap + stop)"
```

---

## Task 2: Wire the run path to the registry (remove globals)

**Files:** Modify `web/main.py`, `tests/test_run_all_api.py`, `tests/test_workspace_wiring.py`

- [ ] **Step 1: Update the run-all API tests to registry semantics (write the failing tests)**

In `tests/test_run_all_api.py`, replace the `_reset_running` fixture and the three single-flight tests. Replace:
```python
@pytest.fixture(autouse=True)
def _reset_running():
    wm._running_command = None
    yield
    wm._running_command = None
```
with:
```python
@pytest.fixture(autouse=True)
def _reset_registry():
    wm._registry = wm._runs.RunRegistry()
    yield
    wm._registry = wm._runs.RunRegistry()
```
Replace `test_run_rejected_409_when_busy`:
```python
def test_run_rejected_409_when_busy():
    wm._registry.start("download", "__base__")   # a no-project run holds the base lock
    client = TestClient(wm.app)
    resp = client.post("/api/run/build-report", json={})   # no active project -> "__base__"
    assert resp.status_code == 409
    assert len(wm._registry.active()) == 1        # the active run is untouched
```
Replace `test_status_reflects_running`:
```python
def test_status_reflects_running():
    client = TestClient(wm.app)
    assert client.get("/api/status").json().get("running") is False
    wm._registry.start("download", "__base__")
    assert client.get("/api/status").json().get("running") is True
```
Replace `test_lock_cleared_after_run` (keep its `_FakeStdout`/`_FakeProc`/`_fake_exec` body, but assert via the registry). Update its tail assertion from `assert wm._running_command is None` to:
```python
    assert wm._registry.active() == []
```
And update `test_run_all_endpoint_builds_argv`'s `_fake_stream` signature to the new `_stream` shape — change `def _fake_stream(command, cmd, run_ctx=None)` (or whatever it currently is) to:
```python
    async def _fake_stream(run_id, command, cmd, run_ctx=None):
        captured["cmd"] = cmd
        yield wm._sse("status", {"status": "running", "command": command})
        yield wm._sse("done", {})
```
(`run_id` is the new first positional arg.)

In `tests/test_workspace_wiring.py`, update `test_run_hydrate_failure_releases_lock`'s final assertion from `assert wm._running_command is None` to:
```python
        assert wm._registry.active() == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `PYTHONPATH=. pytest tests/test_run_all_api.py -v`
Expected: FAIL — `AttributeError: module 'web.main' has no attribute '_registry'`.

- [ ] **Step 3: Add the registry + remove the globals**

In `web/main.py`, near the other `from web...` imports add:
```python
from web import runs as _runs
```
After `app = FastAPI(...)` / `auth.register_auth(app)` (any module-level spot near the existing globals), add:
```python
_registry = _runs.RunRegistry()
```
Remove the three global declarations:
```python
_last_status: Dict = {"command": None, "status": "idle", "finished_at": None}
_proc: Optional[asyncio.subprocess.Process] = None
_running_command: Optional[str] = None  # single-flight: name of the in-flight run, else None
```

- [ ] **Step 4: Rewrite `run_command`'s reservation block**

In `web/main.py`'s `run_command`, remove `global _running_command` (top of the function). Replace the single-flight + mirror block (from `# Single-flight guard:` comment through the `return StreamingResponse(_stream(command, cmd, run_ctx), …)`) with:
```python
    # Resolve the active project (no await — atomic with the registry reservation below).
    run_ctx = None
    lock_key = "__base__"
    with db_session.SessionLocal() as _db:
        _user, _project = _active_project(request, _db)
        if _project is not None:
            run_ctx = (str(_project.org_id), str(_project.id), dict(_project.config or {}))
            lock_key = str(_project.id)
    try:
        run_id = _registry.start(command, lock_key)
    except _runs.BusyError:
        raise HTTPException(status_code=409,
                            detail="A run is already in progress for this project.")
    except _runs.CapError:
        raise HTTPException(status_code=429,
                            detail="Server is at run capacity; please retry shortly.",
                            headers={"Retry-After": "2"})
    return StreamingResponse(
        _stream(run_id, command, cmd, run_ctx),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```
(The pre-run `db_bridge.mirror_active(...)` is intentionally dropped — the run reads the tempdir's config.)

- [ ] **Step 5: Rewrite `_stream` to use the registry**

Replace the whole `_stream` function with:
```python
async def _stream(run_id: str, command: str, cmd: list, run_ctx=None) -> AsyncGenerator[str, None]:
    yield _sse("status", {"status": "running", "command": command, "run_id": run_id})

    work_dir = None
    cwd = str(BASE_DIR)
    if run_ctx is not None:
        org_id, project_id, cfg = run_ctx
        work_dir = tempfile.mkdtemp(prefix="dbrun_")
        try:
            storage_workspace.hydrate_run_dir(org_id, project_id, command, work_dir, cfg)
        except Exception as e:
            shutil.rmtree(work_dir, ignore_errors=True)
            _registry.set_status(run_id, "error")
            _registry.finish(run_id)
            yield _sse("log", {"line": f"Error: failed to hydrate run workspace: {e}", "level": "error"})
            yield _sse("status", {"command": command, "status": "error", "run_id": run_id,
                                  "finished_at": datetime.now().isoformat()})
            yield _sse("done", {})
            return
        cwd = work_dir

    yield _sse("log", {"line": f"$ {' '.join(cmd)}", "level": "cmd"})
    env = {**os.environ, "PYTHONPATH": str(BASE_DIR), "PYTHONUNBUFFERED": "1"}
    status = "error"
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT, cwd=cwd, env=env,
        )
        _registry.attach_proc(run_id, proc)
        async for raw in proc.stdout:
            line = raw.decode("utf-8", errors="replace").rstrip()
            yield _sse("log", {"line": line, "level": _classify(line)})
        await proc.wait()
        status = "success" if proc.returncode == 0 else "error"
    except Exception as e:
        yield _sse("log", {"line": f"Error: {e}", "level": "error"})
        status = "error"
    finally:
        _registry.set_status(run_id, status)
        _registry.finish(run_id)

    if status == "success" and run_ctx is not None:
        try:
            _persist_run_outputs(run_ctx[0], run_ctx[1], work_dir)
        except Exception as e:
            yield _sse("log", {"line": f"Warning: failed to persist outputs to storage: {e}", "level": "error"})
    if work_dir:
        shutil.rmtree(work_dir, ignore_errors=True)

    yield _sse("status", {"command": command, "status": status, "run_id": run_id,
                          "finished_at": datetime.now().isoformat()})
    yield _sse("done", {})
```

- [ ] **Step 6: Rewrite `/api/status` and `/api/stop`; add `/api/stop/{run_id}`**

Replace the `get_status` and `stop_command` handlers with:
```python
@app.get("/api/status")
async def get_status():
    active = _registry.active()
    resp = {"running": len(active) > 0, "runs": [r.public() for r in active]}
    last = _registry.last()
    if last is not None:
        lp = last.public()
        resp.update({"command": lp["command"], "status": lp["status"], "finished_at": lp["finished_at"]})
    return resp


@app.post("/api/stop/{run_id}")
async def stop_run(run_id: str):
    if not await _registry.stop(run_id):
        raise HTTPException(status_code=404, detail="No such active run")
    return {"ok": True}


@app.post("/api/stop")
async def stop_command():
    active = _registry.active()
    if len(active) == 1:
        await _registry.stop(active[0].run_id)
        return {"ok": True}
    if not active:
        return {"ok": False, "detail": "no running process"}
    raise HTTPException(status_code=400, detail="Multiple runs active; specify a run_id (/api/stop/{run_id}).")
```

- [ ] **Step 7: Run the updated tests + full suite**

Run: `PYTHONPATH=. pytest tests/test_run_all_api.py tests/test_workspace_wiring.py -v`
Expected: PASS.
Run: `PYTHONPATH=. pytest tests/ -q`
Expected: PASS. If any test referenced the removed globals (`_proc`/`_running_command`/`_last_status`), update it to the registry and report which + why.

- [ ] **Step 8: Commit**

```bash
git add web/main.py tests/test_run_all_api.py tests/test_workspace_wiring.py
git commit -m "feat(api): per-project run concurrency via RunRegistry (drop global single-flight)"
```

---

## Task 3: Concurrency / stop / status API tests

**Files:** Create `tests/test_run_concurrency_api.py`

These are additive E2E tests verifying the new behavior end-to-end.

- [ ] **Step 1: Write the tests**

Create `tests/test_run_concurrency_api.py`:
```python
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


def _fake_proc_factory():
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


def test_run_id_in_stream_and_stop_by_id(monkeypatch):
    monkeypatch.setattr(wm.asyncio, "create_subprocess_exec", _fake_proc_factory())
    with _client() as c:
        body = c.post("/api/run/download", json={}).text   # no active project -> ok
        assert '"run_id"' in body
    # stop a non-existent run -> 404
    assert _client().post("/api/stop/" + uuid.uuid4().hex).status_code == 404


def test_same_project_second_run_409():
    # reserve the base lock directly, then a no-project run collides
    wm._registry.start("download", "__base__")
    assert _client().post("/api/run/download", json={}).status_code == 409


def test_cap_exceeded_429(monkeypatch):
    monkeypatch.setenv("MAX_CONCURRENT_RUNS", "1")
    wm._registry.start("download", "p-other")          # fills the only slot
    r = _client().post("/api/run/download", json={})   # base key, but cap is full
    assert r.status_code == 429
    assert r.headers.get("Retry-After") == "2"


def test_status_lists_active_runs():
    wm._registry.start("build-report", "p1")
    wm._registry.start("download", "p2")
    body = _client().get("/api/status").json()
    assert body["running"] is True
    keys = {r["project_id"] for r in body["runs"]}
    assert keys == {"p1", "p2"}
```

- [ ] **Step 2: Run the tests**

Run: `PYTHONPATH=. pytest tests/test_run_concurrency_api.py -v`
Expected: PASS (4 passed). (The behavior is implemented in Task 2; these assert it E2E.)

- [ ] **Step 3: Commit**

```bash
git add tests/test_run_concurrency_api.py
git commit -m "test(api): per-project concurrency, cap, run_id, stop-by-id"
```

---

## Task 4: Frontend — capture run_id, stop by id

**Files:** Modify `frontend/src/hooks/useCommand.js`

Verified by `npm run build` (no JS test harness).

- [ ] **Step 1: Capture run_id + stop by id**

In `frontend/src/hooks/useCommand.js`:
- Add a ref for the run id near the other refs (after `const onStatusRef = ...`):
```js
  const runIdRef = useRef(null);
```
- In `run`, reset it at the start (right after `setRunning(true)`):
```js
    runIdRef.current = null;
```
- In the SSE parse loop, when a `status` event is handled, capture the run id. Change the `else if (ev === 'status')` block to:
```js
          } else if (ev === 'status') {
            if (payload.run_id) runIdRef.current = payload.run_id;
            finalStatus = payload.status;
            onStatusRef.current?.({ command, ...payload });
          }
```
- Change `stop` to target the captured run id, falling back to the legacy endpoint:
```js
  const stop = useCallback(async () => {
    const id = runIdRef.current;
    const url = id ? `/api/stop/${id}` : '/api/stop';
    try { await fetch(url, { method: 'POST' }); } catch {}
  }, []);
```

- [ ] **Step 2: Build**

Run: `cd /workspaces/databridge-cli/frontend && npm run build`
Expected: clean build, no errors.

- [ ] **Step 3: Commit**

```bash
cd /workspaces/databridge-cli
git add frontend/src/hooks/useCommand.js
git commit -m "feat(ui): capture run_id from the stream and stop by id"
```

---

## Task 5: Docs

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1: Document concurrency**

In `CLAUDE.md`, in the "Object storage & project workspace" subsection (or just after the per-run-isolation paragraph), replace the "still single-flight" sentence with ~5 lines: runs are now tracked by an in-memory `RunRegistry` (`web/runs.py`) — **one run per project at a time** (a second run for a busy project → `409`), different projects **concurrent** up to `MAX_CONCURRENT_RUNS` (default 4; over the cap → `429`). Each run has a `run_id` (in the first SSE `status` event); `POST /api/stop/{run_id}` stops a specific run and `GET /api/status` lists active runs. The `BASE_DIR` **read-mirror remains process-wide** (best-effort under concurrency) — multi-user read isolation is out of scope.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: per-project run concurrency (RunRegistry)"
```

---

## Self-Review notes

- **Spec coverage:** `RunRegistry` (start/attach_proc/set_status/finish/get/active/last/stop) + BusyError/CapError + cap from env (T1) · run_command reservation w/ 409/429 + drop pre-run mirror_active + run_id threading (T2) · `_stream` registry wiring + run_id in status event (T2) · `/api/status` aggregate + `/api/stop/{run_id}` + back-compat `/api/stop` (T2) · concurrency/cap/stop/status E2E (T3) · frontend run_id capture + stop-by-id (T4) · docs (T5) · "__base__" lock for no-project runs (T1,T2) · reads-process-wide unchanged (untouched). Globals removed (T2).
- **Signature consistency:** `_stream(run_id, command, cmd, run_ctx=None)` everywhere (run_command call, test fakes); `start(command, lock_key)`; `RunInfo.public()` keys `{run_id,command,status,project_id,finished_at}`.
- **Atomicity:** `run_command` resolves run_ctx + calls `registry.start` with no `await` between (sync DB session + sync start) — the reservation is atomic on the event loop, like the old single-flight.
- **Test migration:** the three old single-flight tests in `test_run_all_api.py` + the `test_run_hydrate_failure_releases_lock` assertion are migrated off the removed globals to the registry (T2).
- **No placeholders**; every code step complete.
- **Known end-state (spec):** reads share one process-wide `BASE_DIR` mirror (multi-user read isolation out of scope); in-memory registry (no cross-restart/replica persistence).
