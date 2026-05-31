# Orchestrator — Single-Flight Command Runs Design

**Date:** 2026-05-31
**Status:** Design (decisions made autonomously per the owner's "run autonomously" directive; review async)
**Roadmap:** Orchestrator robustness, following Slice 1 (`run-all`) + Slice 2 (staleness). Closes the deferred `_proc` concurrency limitation.

---

## 1. Problem

`web/main.py` streams CLI runs through a single module-global `_proc`. If a second `POST /api/run/{command}` starts while one is active, `_stream` overwrites `_proc`: the first stream's `await _proc.wait()` and the `finally: _proc = None` then race against the second run, and `/api/stop` can only see whichever proc was assigned last. Worse, two concurrent pipeline runs mutate the **same shared state** (`config.yml`, `data/processed/`), which can corrupt a download or report. This is a local single-user tool — concurrent pipeline runs are never desirable.

## 2. Decision

**Single-flight:** at most one command runs at a time. A new `POST /api/run/{command}` while one is active is **rejected with HTTP 409** (not queued), naming the active command. This both fixes the `_proc` race (only one proc ever exists) and prevents shared-state corruption.

- **Reject, not queue** — queueing would let a stale run mutate state after the user changed config; immediate 409 is clearer and matches the tool's single-user model.
- **Out of scope:** true multi-process parallelism (wrong for one shared config); per-session queues; changing `/api/stop` semantics (it already terminates the single active proc).

## 3. Design

### `web/main.py`
- Add module global `_running_command: Optional[str] = None` (next to `_proc`).
- In `run_command` (the endpoint), **after** the `ALLOWED_COMMANDS` check and arg-building, **before** returning the `StreamingResponse`:
  - If `_running_command is not None`: `raise HTTPException(status_code=409, detail=f"A command is already running ('{_running_command}'). Stop it or wait for it to finish.")`.
  - Else reserve synchronously: `_running_command = command`.
  - **Atomicity:** there is no `await` between the check and the assignment, so within the asyncio event loop the check-and-set is atomic — two near-simultaneous requests cannot both pass. The reservation MUST happen in the endpoint (synchronous), not inside `_stream` (which runs lazily only when the client consumes the response, leaving a race window).
- In `_stream`'s existing `finally:` block, also clear it: `_running_command = None` (so every terminal path — success, error, spawn failure, client disconnect/GeneratorExit — releases the lock).
- `GET /api/status` returns `{**_last_status, "running": _running_command is not None}` so any client/tab can reflect run state (today `running` is only tracked client-side per-hook).

### `frontend/src/hooks/useCommand.js`
- After `fetch`, before reading the body: if `!res.ok`, read the JSON `detail` and surface it as an error log + terminal error status, then return — instead of silently parsing a non-SSE body (current behavior swallows a 409 with no user feedback). Specifically:
  ```js
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try { detail = (await res.json()).detail || detail; } catch {}
    onLogRef.current?.(detail, 'error');
    onStatusRef.current?.({ command, status: 'error', error: detail });
    finalStatus = 'error';
    return;            // finally still runs (clears running/activeCmd)
  }
  ```
  (The client already guards with `if (running) return;` per hook instance; the 409 path covers a *second tab/client* hitting the same backend.)

## 4. Error handling
The lock is released on every `_stream` terminal path via `finally`. If the subprocess fails to spawn, the existing `except` sets error status and `finally` clears the lock. If the client disconnects mid-stream, Starlette closes the generator (GeneratorExit) → `finally` runs → lock cleared. A 409 leaves the active run untouched.

## 5. Testing (TDD)
`tests/test_run_all_api.py` (extend) — add an **autouse fixture** resetting `wm._running_command = None` between tests (the stubbed `_stream` in existing tests does not run the real `finally`, so the lock must be reset to avoid cross-test leakage):
- **409 when busy:** set `wm._running_command = "download"` → `POST /api/run/build-report` returns 409, and its detail mentions `download`. A second assertion: the active run is unaffected (no exception).
- **lock cleared after a run:** monkeypatch `asyncio.create_subprocess_exec` with a fake proc (stdout yields one line, `wait()` → returncode 0); consume the real `_stream` via the endpoint with `TestClient`; assert `wm._running_command is None` afterward.
- **status reflects running:** `GET /api/status` returns `running: False` when idle; `True` when `_running_command` is set.
- Existing tests still pass (the autouse reset keeps `test_run_all_endpoint_builds_argv`'s stubbed-stream reservation from leaking).

Full suite green (currently 302).

## 6. Risks
- **Reservation leak if the generator never runs:** Starlette always drives the StreamingResponse generator (consuming it to send the body) and closes it on disconnect, so `finally` runs. The only non-paired case is a test that stubs `_stream` — handled by the autouse reset fixture.
- **No await between check and set** must be preserved — a future edit that adds an `await` between them would reintroduce a race. Noted in a code comment.
