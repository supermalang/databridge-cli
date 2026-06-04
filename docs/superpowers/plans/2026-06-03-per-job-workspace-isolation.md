# Per-Job Temp-Workspace Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run each CLI command in its own temp directory — hydrate the project's config (DB) + the command's required inputs (Minio) into the tempdir, run `cwd=<tempdir>`, then push outputs to Minio, sync changed config to the DB, and refresh the active read-mirror — keeping the global single-flight lock and `/api/stop`/`/api/status` unchanged.

**Architecture:** `web/storage/workspace.py` gains a storage-pure `RUN_INPUTS` manifest + `hydrate_run_dir` (write config.yml + pull the command's input categories into a dest dir). `web/main.py`'s `_stream` creates a tempdir, hydrates, runs there, and on success calls a new `_persist_run_outputs` helper (push to Minio + sync config to DB + refresh the `BASE_DIR` read-mirror), then removes the tempdir. When there's no active project (`run_ctx=None`) `_stream` falls back to the legacy `cwd=BASE_DIR` path (keeps existing run tests green).

**Tech Stack:** Python (tempfile/shutil/pathlib), the 3a/3b `web/storage/` package, FastAPI, pytest (LocalStorage backend).

Spec: [docs/superpowers/specs/2026-06-03-per-job-workspace-isolation-design.md](../specs/2026-06-03-per-job-workspace-isolation-design.md)

---

## File Structure

- **Modify** `web/storage/workspace.py` — add `RUN_INPUTS` + `hydrate_run_dir` (storage-pure; writes config.yml from a dict, pulls input categories from Minio into a dest dir).
- **Modify** `web/main.py` — `run_command` (absolute `make.py` path + capture `run_ctx=(org_id, project_id, cfg)`); `_stream` (tempdir hydrate→run→dehydrate, legacy fallback); new `_persist_run_outputs` helper.
- **Modify** `CLAUDE.md` — note per-run tempdir isolation.
- **Modify** `tests/test_workspace_wiring.py` — update the 3b e2e test (fake CLI writes into the tempdir cwd) + add 3c-i e2e tests.
- **Create** `tests/test_run_workspace.py` — unit tests for `RUN_INPUTS`/`hydrate_run_dir`.

**Contract (used across tasks):**
```
RUN_INPUTS: dict[str, list[str]]    # command -> input categories to hydrate (config always written)
hydrate_run_dir(org_id, project_id, command, dest, cfg) -> int   # writes dest/config.yml; pulls inputs; #files pulled
_persist_run_outputs(org_id, project_id, dest) -> None           # push outputs + sync config to DB + refresh BASE_DIR mirror
_stream(command, cmd, run_ctx=None)   # run_ctx = (org_id, project_id, cfg) or None (legacy BASE_DIR path)
```

---

## Task 1: workspace.py — RUN_INPUTS manifest + hydrate_run_dir

**Files:** Modify `web/storage/workspace.py`; Test `tests/test_run_workspace.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_run_workspace.py`:
```python
import pytest
import yaml
from web.storage import factory, workspace


@pytest.fixture
def storage(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.setenv("STORAGE_LOCAL_DIR", str(tmp_path / "minio"))
    factory.reset_storage()
    yield factory.get_storage()
    factory.reset_storage()


def test_run_inputs_manifest():
    assert workspace.RUN_INPUTS["download"] == []
    assert workspace.RUN_INPUTS["build-report"] == ["processed", "templates"]
    assert workspace.RUN_INPUTS["generate-template"] == []
    assert workspace.RUN_INPUTS["suggest-charts"] == ["processed"]
    assert workspace.RUN_INPUTS["run-all"] == ["processed", "templates"]


def _seed_minio(storage, org, proj):
    from web.storage.base import storage_key
    storage.put_bytes(storage_key(org, proj, "processed", "form_data_1.csv"), b"a,b\n1,2\n")
    storage.put_bytes(storage_key(org, proj, "templates", "t1.docx"), b"TPL")


def test_hydrate_writes_config_and_pulls_inputs(storage, tmp_path):
    _seed_minio(storage, "o1", "p1")
    dest = tmp_path / "run"
    cfg = {"api": {"platform": "kobo"}, "form": {"alias": "demo"}}
    n = workspace.hydrate_run_dir("o1", "p1", "build-report", dest, cfg)
    assert n == 2                                  # processed + templates
    assert yaml.safe_load((dest / "config.yml").read_text()) == cfg
    assert (dest / "data" / "processed" / "form_data_1.csv").read_text() == "a,b\n1,2\n"
    assert (dest / "templates" / "t1.docx").read_bytes() == b"TPL"


def test_hydrate_download_pulls_no_inputs(storage, tmp_path):
    _seed_minio(storage, "o1", "p1")
    dest = tmp_path / "run"
    n = workspace.hydrate_run_dir("o1", "p1", "download", dest, {"api": {}, "form": {}})
    assert n == 0                                  # download regenerates processed; no inputs
    assert (dest / "config.yml").exists()
    assert not (dest / "data" / "processed" / "form_data_1.csv").exists()


def test_hydrate_unknown_command_uses_safe_default(storage, tmp_path):
    _seed_minio(storage, "o1", "p1")
    dest = tmp_path / "run"
    n = workspace.hydrate_run_dir("o1", "p1", "some-future-cmd", dest, {})
    assert n == 2                                  # default ["processed", "templates"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_run_workspace.py -v`
Expected: FAIL — `AttributeError: module 'web.storage.workspace' has no attribute 'RUN_INPUTS'`.

- [ ] **Step 3: Implement**

In `web/storage/workspace.py`, add the import for `write_config` at the top (next to the existing imports):
```python
from src.utils.config import write_config
```
Then add the manifest + `hydrate_run_dir` (after `is_empty`):
```python
# command -> input categories to hydrate into the run dir (config.yml is always written).
RUN_INPUTS = {
    "download": [],
    "fetch-questions": [],
    "push-prompts": [],
    "generate-template": [],
    "ai-generate-template": [],
    "build-report": ["processed", "templates"],
    "run-all": ["processed", "templates"],
    "suggest-charts": ["processed"],
    "suggest-views": ["processed"],
    "suggest-summaries": ["processed"],
    "suggest-tables": ["processed"],
    "suggest-indicators": ["processed"],
}
_DEFAULT_INPUTS = ["processed", "templates"]   # safe superset for unknown commands


def hydrate_run_dir(org_id: str, project_id: str, command: str, dest, cfg: dict) -> int:
    """Materialize a run's isolated workspace: write dest/config.yml from cfg, then
    download the command's input categories from Minio into dest. Returns #files pulled."""
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    write_config(cfg or {}, dest / "config.yml")
    store = get_storage()
    n = 0
    for category in RUN_INPUTS.get(command, _DEFAULT_INPUTS):
        d = dest / CATEGORY_DIRS[category]
        d.mkdir(parents=True, exist_ok=True)
        prefix = storage_key(org_id, project_id, category, "")
        for key in store.list(prefix):
            store.get_file(key, d / key[len(prefix):])
            n += 1
    return n
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_run_workspace.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add web/storage/workspace.py tests/test_run_workspace.py
git commit -m "feat(storage): RUN_INPUTS manifest + hydrate_run_dir for per-job runs"
```

---

## Task 2: Run each command in an isolated temp workspace

**Files:** Modify `web/main.py`, `tests/test_workspace_wiring.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_workspace_wiring.py` (the file already has `_client`, the `isolated_base` fixture, and `_make_project_with_report`):
```python
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
        # the CLI runs in the tempdir (cwd) — write a report THERE, not in BASE_DIR
        cwd = Path(k["cwd"])
        captured["cwd"] = cwd
        (cwd / "reports").mkdir(parents=True, exist_ok=True)
        (cwd / "reports" / "produced.docx").write_bytes(b"NEW")
        return _FakeProc()

    monkeypatch.setattr(wm.asyncio, "create_subprocess_exec", _fake_exec)
    wm._running_command = None

    with _client() as c:
        pid = _make_project_with_report(c, "WS-ISO", "seed.docx")
        c.post(f"/api/projects/{pid}/activate")
        with wm.db_session.SessionLocal() as db:
            org_id = str(db.get(wm.db_repo.Project, uuid.UUID(pid)).org_id)
        resp = c.post("/api/run/build-report", json={})
        assert resp.status_code == 200
        _ = resp.text                                  # drain SSE so _stream finishes

        # ran in a tempdir, NOT BASE_DIR
        assert captured["cwd"] != isolated_base
        assert not captured["cwd"].exists()            # tempdir cleaned up

        store = factory.get_storage()
        # output pushed to Minio from the tempdir
        assert storage_key(org_id, pid, "reports", "produced.docx") in \
            store.list(f"orgs/{org_id}/projects/{pid}/")
        # active read-mirror refreshed: the new report appears in BASE_DIR/reports
        assert (isolated_base / "reports" / "produced.docx").exists()


def test_run_hydrate_failure_releases_lock(isolated_base, monkeypatch):
    import web.main as wm
    monkeypatch.setattr(wm.storage_workspace, "hydrate_run_dir",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("hydrate boom")))
    wm._running_command = None
    with _client() as c:
        pid = _make_project_with_report(c, "WS-HYD", "seed.docx")
        c.post(f"/api/projects/{pid}/activate")
        resp = c.post("/api/run/build-report", json={})
        assert resp.status_code == 200
        body = resp.text
        assert "hydrate boom" in body or "error" in body
        assert wm._running_command is None             # lock released
```
(`Path` and `uuid` are already imported at the top of the file from earlier tasks; if `Path` is not, add `from pathlib import Path`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_workspace_wiring.py::test_run_executes_in_tempdir_and_persists -v`
Expected: FAIL — the run still executes in `BASE_DIR` (captured cwd == isolated_base) / no tempdir.

- [ ] **Step 3: Implement — absolute make.py path + run_ctx capture**

In `web/main.py`'s `run_command`, change the cmd's script path to absolute (so it resolves under `cwd=tempdir`). Replace:
```python
    cmd = [sys.executable, "src/data/make.py", command]
```
with:
```python
    cmd = [sys.executable, str(BASE_DIR / "src" / "data" / "make.py"), command]
```
Then replace the single-flight mirror block (the one that builds `_ws_ids`) with one that captures the full run context (ids + config dict):
```python
    _running_command = command  # reserve synchronously (atomic: no await before return)
    run_ctx = None
    try:
        with db_session.SessionLocal() as _db:
            _user, _project = _active_project(request, _db)
            if _project is not None:
                db_bridge.mirror_active(_db, _user)
                run_ctx = (str(_project.org_id), str(_project.id), dict(_project.config or {}))
    except Exception:
        _running_command = None
        raise
    return StreamingResponse(
        _stream(command, cmd, run_ctx),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

- [ ] **Step 4: Implement — `_persist_run_outputs` helper**

In `web/main.py`, add this helper near the other `_*` helpers (it needs `Path`, `yaml`, `tempfile`/`shutil` are imported at the top of main.py — `tempfile` and `shutil` may not be; add `import shutil` to the top imports if missing; `tempfile` IS already imported):
```python
def _persist_run_outputs(org_id: str, project_id: str, dest) -> None:
    """After a successful tempdir run: push outputs to Minio, sync a changed config.yml
    back to the DB, and refresh the active project's BASE_DIR read-mirror."""
    import uuid as _uuid
    storage_workspace.push_outputs(org_id, project_id, base=dest)
    cfg_path = Path(dest) / "config.yml"
    parsed = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {} if cfg_path.exists() else {}
    with db_session.SessionLocal() as db:
        project = db.get(db_repo.Project, _uuid.UUID(project_id))
        if project is None:
            return
        if parsed and parsed != project.config:
            db_repo.update_project_config(db, project, parsed)
        db_bridge.materialize_config(project)                          # refresh BASE_DIR/config.yml
        storage_workspace.pull_workspace(org_id, project_id, base=BASE_DIR)   # refresh read mirror
```

- [ ] **Step 5: Implement — rewrite `_stream` for tempdir isolation**

In `web/main.py`, ensure `import shutil` is at the top (add it to the existing `import asyncio, base64, io, json, os, sys, tempfile, zipfile` line → add `shutil`). Replace the whole `_stream` function with:
```python
async def _stream(command: str, cmd: list, run_ctx=None) -> AsyncGenerator[str, None]:
    global _last_status, _proc, _running_command
    _last_status = {"command": command, "status": "running", "finished_at": None}
    yield _sse("status", {"status": "running", "command": command})

    work_dir = None
    cwd = str(BASE_DIR)
    if run_ctx is not None:
        org_id, project_id, cfg = run_ctx
        work_dir = tempfile.mkdtemp(prefix="dbrun_")
        try:
            storage_workspace.hydrate_run_dir(org_id, project_id, command, work_dir, cfg)
        except Exception as e:
            shutil.rmtree(work_dir, ignore_errors=True)
            _running_command = None
            yield _sse("log", {"line": f"Error: failed to hydrate run workspace: {e}", "level": "error"})
            _last_status = {"command": command, "status": "error", "finished_at": datetime.now().isoformat()}
            yield _sse("status", {**_last_status})
            yield _sse("done", {})
            return
        cwd = work_dir

    yield _sse("log", {"line": f"$ {' '.join(cmd)}", "level": "cmd"})
    env = {**os.environ, "PYTHONPATH": str(BASE_DIR), "PYTHONUNBUFFERED": "1"}
    try:
        _proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT, cwd=cwd, env=env,
        )
        async for raw in _proc.stdout:
            line = raw.decode("utf-8", errors="replace").rstrip()
            yield _sse("log", {"line": line, "level": _classify(line)})
        await _proc.wait()
        status = "success" if _proc.returncode == 0 else "error"
    except Exception as e:
        yield _sse("log", {"line": f"Error: {e}", "level": "error"})
        status = "error"
    finally:
        _proc = None
        _running_command = None

    if status == "success" and run_ctx is not None:
        try:
            _persist_run_outputs(run_ctx[0], run_ctx[1], work_dir)
        except Exception as e:   # CLI work already succeeded; persistence failure must not crash
            yield _sse("log", {"line": f"Warning: failed to persist outputs to storage: {e}", "level": "error"})
    if work_dir:
        shutil.rmtree(work_dir, ignore_errors=True)

    _last_status = {"command": command, "status": status, "finished_at": datetime.now().isoformat()}
    yield _sse("status", {**_last_status})
    yield _sse("done", {})
```

- [ ] **Step 6: Update the 3b end-to-end test to the tempdir model**

In `tests/test_workspace_wiring.py`, the existing `test_successful_run_pushes_outputs` has its fake exec write into `isolated_base/reports` (the old BASE_DIR model). Update that fake to write into the run's cwd (the tempdir) so the push picks it up. Change the `_fake_exec` body in `test_successful_run_pushes_outputs` from writing `(isolated_base / "reports" / "produced.docx")` to:
```python
    async def _fake_exec(*a, **k):
        cwd = Path(k["cwd"])
        (cwd / "reports").mkdir(parents=True, exist_ok=True)
        (cwd / "reports" / "produced.docx").write_bytes(b"NEW")
        return _FakeProc()
```

- [ ] **Step 7: Run the wiring tests + full suite**

Run: `PYTHONPATH=. pytest tests/test_workspace_wiring.py -v`
Expected: PASS (all, incl. the two new 3c-i tests + the updated 3b test).
Run: `PYTHONPATH=. pytest tests/ -q`
Expected: PASS. `tests/test_run_all_api.py` drives `run_command` without a `with`-block lifespan → no active project → `run_ctx=None` → legacy `cwd=BASE_DIR` path with no hydrate/dehydrate → those tests stay green (the `_fake_stream` monkeypatch is positional, so the param rename to `run_ctx` is transparent). If any fails, report the specific failure.

- [ ] **Step 8: Commit**

```bash
git add web/main.py tests/test_workspace_wiring.py
git commit -m "feat(api): run each command in an isolated temp workspace (hydrate/run/dehydrate)"
```

---

## Task 3: Docs

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1: Document per-run isolation**

In `CLAUDE.md`, in the "Object storage & project workspace (web/storage/)" subsection, append ~4 lines: each run now executes in its **own temp directory** — `hydrate_run_dir` writes the project's config + pulls the command's input categories (`RUN_INPUTS` manifest) from Minio into the tempdir; the CLI runs with `cwd=<tempdir>` (absolute `make.py` path); on success outputs are pushed to Minio, a changed config is synced to the DB, and the active `BASE_DIR` read-mirror is refreshed; the tempdir is removed afterward. Runs are still **single-flight** (one at a time) — per-project concurrency is a later slice (3c-ii).

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: per-run temp-workspace isolation"
```

---

## Self-Review notes

- **Spec coverage:** `RUN_INPUTS` manifest + `hydrate_run_dir` (T1) · run in tempdir with absolute `make.py` path, `run_ctx` capture (T2) · dehydrate = push + config sync-back + active-mirror refresh via `_persist_run_outputs` (T2) · tempdir cleanup in all paths (T2) · hydrate-failure releases the lock + error status (T2 + test) · single-flight/global stop/status unchanged (untouched) · legacy `run_ctx=None` fallback keeps existing run tests green (T2) · docs (T3). Concurrency machinery correctly absent (3c-ii).
- **Replaces 3b push:** the 3b `push_outputs(base=BASE_DIR)` in `_stream` is removed; outputs are now pushed from the tempdir via `_persist_run_outputs`. The 3b activate-pull and read endpoints are untouched.
- **Signature consistency:** `_stream(command, cmd, run_ctx=None)`; `hydrate_run_dir(org_id, project_id, command, dest, cfg)`; `_persist_run_outputs(org_id, project_id, dest)` used consistently. `test_run_all_api`'s positional `_fake_stream` call is unaffected by the param rename.
- **Config sync-back** uses parse-and-compare (`parsed != project.config`) so formatting-only differences don't trigger a write/version-bump.
- **No placeholders**; every code step complete.
- **Known interim (spec):** still single-flight (one run at a time); per-run Minio round-trips on hydrate + refresh; dehydrate failure logged-not-fatal.
