# Materialized Project Workspace + Minio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Minio the durable per-project store for project files and turn the local `data/processed`/`reports`/`templates` dirs into a materialized mirror of the active project — pulled on activate, pushed after a successful run — leaving the read/listing/download endpoints unchanged.

**Architecture:** A new `web/storage/workspace.py` bridges project files ↔ Minio (via 3a's `Storage`/`storage_key`) ↔ local dirs, exposing `pull_workspace`/`push_outputs`/`is_empty`. `web/main.py` calls `pull_workspace` on project activate and `push_outputs` after a successful run (single-flight retained, `cwd=BASE_DIR` unchanged). Bootstrap pushes the legacy project's existing local files once. Concurrency/per-job tempdirs are deferred to 3c.

**Tech Stack:** Python (pathlib/shutil), the 3a `web/storage/` package, FastAPI, pytest (LocalStorage backend).

Spec: [docs/superpowers/specs/2026-06-02-project-workspace-minio-design.md](../specs/2026-06-02-project-workspace-minio-design.md)

---

## File Structure

- **Create** `web/storage/workspace.py` — `CATEGORY_DIRS`, `project_files`, `pull_workspace`, `push_outputs`, `is_empty`.
- **Modify** `web/main.py` — `activate_project` (pull on activate); `run_command`/`_stream` (push on success).
- **Modify** `web/db/bootstrap.py` — `import_legacy_workspace` + call it from `init_db`.
- **Modify** `CLAUDE.md` — short note on the workspace mirror.
- **Create** `tests/test_workspace.py`, `tests/test_workspace_wiring.py`.

**Contract (used across tasks):**
```
CATEGORY_DIRS = {"processed": "data/processed", "reports": "reports", "templates": "templates"}
pull_workspace(org_id: str, project_id: str, base=BASE_DIR) -> int   # clears local dirs, downloads from Minio, returns #files
push_outputs(org_id: str, project_id: str, base=BASE_DIR) -> int     # uploads local dirs to Minio, returns #files
is_empty(org_id: str, project_id: str) -> bool                        # True if no objects under any category prefix
```
`processed` excludes the `data/processed/charts/` subdir on both pull (preserve it) and push (skip it). Keys are `storage_key(org_id, project_id, category, <filename>)` (3a). `raw` is never synced.

---

## Task 1: workspace.py module

**Files:** Create `web/storage/workspace.py`; Test `tests/test_workspace.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_workspace.py`:
```python
import pytest
from web.storage import factory, workspace


@pytest.fixture
def storage(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.setenv("STORAGE_LOCAL_DIR", str(tmp_path / "minio"))
    factory.reset_storage()
    yield factory.get_storage()
    factory.reset_storage()


def _seed_local(base):
    (base / "data" / "processed").mkdir(parents=True)
    (base / "data" / "processed" / "form_data_1.csv").write_text("a,b\n1,2\n")
    (base / "data" / "processed" / "charts").mkdir()
    (base / "data" / "processed" / "charts" / "c.png").write_bytes(b"PNG")     # excluded
    (base / "data" / "raw").mkdir(parents=True)
    (base / "data" / "raw" / "raw.json").write_text("{}")                       # excluded
    (base / "reports").mkdir()
    (base / "reports" / "r1.docx").write_bytes(b"DOCX")
    (base / "templates").mkdir()
    (base / "templates" / "t1.docx").write_bytes(b"TPL")


def test_push_then_pull_roundtrip(storage, tmp_path):
    src = tmp_path / "src"; _seed_local(src)
    n = workspace.push_outputs("o1", "p1", base=src)
    assert n == 3                                  # csv + report + template (charts/raw excluded)

    dest = tmp_path / "dest"
    (dest / "data" / "processed").mkdir(parents=True)
    (dest / "reports").mkdir(); (dest / "templates").mkdir()
    pulled = workspace.pull_workspace("o1", "p1", base=dest)
    assert pulled == 3
    assert (dest / "data" / "processed" / "form_data_1.csv").read_text() == "a,b\n1,2\n"
    assert (dest / "reports" / "r1.docx").read_bytes() == b"DOCX"
    assert (dest / "templates" / "t1.docx").read_bytes() == b"TPL"


def test_push_excludes_charts_and_raw(storage, tmp_path):
    src = tmp_path / "src"; _seed_local(src)
    workspace.push_outputs("o1", "p1", base=src)
    keys = storage.list("orgs/o1/projects/p1/")
    assert not any("charts" in k for k in keys)
    assert not any("raw" in k for k in keys)
    assert "orgs/o1/projects/p1/processed/form_data_1.csv" in keys


def test_pull_clears_stale_but_preserves_charts(storage, tmp_path):
    src = tmp_path / "src"; _seed_local(src)
    workspace.push_outputs("o1", "p1", base=src)
    # a different local base that has a STALE report + a local charts dir to preserve
    dest = tmp_path / "dest"
    (dest / "data" / "processed" / "charts").mkdir(parents=True)
    (dest / "data" / "processed" / "charts" / "keep.png").write_bytes(b"KEEP")
    (dest / "reports").mkdir(); (dest / "reports" / "old.docx").write_bytes(b"OLD")
    (dest / "templates").mkdir()
    workspace.pull_workspace("o1", "p1", base=dest)
    assert not (dest / "reports" / "old.docx").exists()                  # stale cleared
    assert (dest / "reports" / "r1.docx").exists()                       # pulled
    assert (dest / "data" / "processed" / "charts" / "keep.png").exists()  # charts preserved


def test_is_empty(storage, tmp_path):
    assert workspace.is_empty("o1", "p1") is True
    src = tmp_path / "src"; _seed_local(src)
    workspace.push_outputs("o1", "p1", base=src)
    assert workspace.is_empty("o1", "p1") is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_workspace.py -v`
Expected: FAIL — `ImportError: cannot import name 'workspace'`.

- [ ] **Step 3: Implement**

Create `web/storage/workspace.py`:
```python
"""Bridge a project's files (Minio, durable) <-> the local working dirs (a materialized
mirror of the ACTIVE project). Uses the 3a Storage abstraction; keys via storage_key."""
from pathlib import Path
from typing import Dict, List

from web.storage.base import storage_key
from web.storage.factory import get_storage

# category -> local dir (relative to base)
CATEGORY_DIRS: Dict[str, str] = {
    "processed": "data/processed",
    "reports": "reports",
    "templates": "templates",
}
_CHARTS_SUBDIR = "charts"   # under data/processed; regenerable, never synced


def _local_dir(base: Path, category: str) -> Path:
    return Path(base) / CATEGORY_DIRS[category]


def _local_files(base: Path, category: str) -> List[Path]:
    """Top-level files in a category dir, excluding the processed/charts subdir."""
    d = _local_dir(base, category)
    if not d.is_dir():
        return []
    return [f for f in d.iterdir() if f.is_file()]


def project_files(org_id: str, project_id: str, base=".") -> Dict[str, List[Path]]:
    return {cat: _local_files(Path(base), cat) for cat in CATEGORY_DIRS}


def push_outputs(org_id: str, project_id: str, base=".") -> int:
    """Upload the local mirror dirs to Minio under the project prefix. Returns #files."""
    store = get_storage()
    n = 0
    for category, files in project_files(org_id, project_id, base).items():
        for f in files:
            store.put_file(storage_key(org_id, project_id, category, f.name), f)
            n += 1
    return n


def pull_workspace(org_id: str, project_id: str, base=".") -> int:
    """Clear the local mirror dirs (preserving processed/charts) then download the
    project's files from Minio. Returns #files pulled."""
    store = get_storage()
    n = 0
    for category in CATEGORY_DIRS:
        d = _local_dir(Path(base), category)
        d.mkdir(parents=True, exist_ok=True)
        for f in _local_files(Path(base), category):     # top-level files only; keeps charts/
            f.unlink()
        prefix = storage_key(org_id, project_id, category, "")
        for key in store.list(prefix):
            name = key[len(prefix):]
            dest = d / name
            store.get_file(key, dest)
            n += 1
    return n


def is_empty(org_id: str, project_id: str) -> bool:
    store = get_storage()
    base_prefix = f"orgs/{org_id}/projects/{project_id}/"
    return len(store.list(base_prefix)) == 0
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_workspace.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add web/storage/workspace.py tests/test_workspace.py
git commit -m "feat(storage): project workspace mirror (pull/push/is_empty)"
```

---

## Task 2: Pull the workspace on project activate

**Files:** Modify `web/main.py`; Test `tests/test_workspace_wiring.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_workspace_wiring.py`:
```python
import uuid
from fastapi.testclient import TestClient


def _client():
    from web.main import app
    return TestClient(app)


def _make_project_with_report(c, name, report_name):
    """Create a project, activate it, and push a report into its Minio prefix."""
    from web.main import app  # noqa
    import web.main as wm
    from web.storage import workspace, factory
    pid = c.post("/api/projects", json={"name": name}).json()["id"]
    c.post(f"/api/projects/{pid}/activate")
    # find org_id for this project
    with wm.db_session.SessionLocal() as db:
        proj = db.get(wm.db_repo.Project, uuid.UUID(pid))
        org_id = str(proj.org_id)
    store = factory.get_storage()
    from web.storage.base import storage_key
    store.put_bytes(storage_key(org_id, pid, "reports", report_name), b"DOCX")
    return pid


def test_activate_pulls_workspace_into_reports_dir(tmp_path, monkeypatch):
    with _client() as c:
        pid = _make_project_with_report(c, "WS-A", "ra.docx")
        # re-activate to trigger a fresh pull of the (now non-empty) Minio prefix
        r = c.post(f"/api/projects/{pid}/activate")
        assert r.status_code == 200
        import web.main as wm
        assert (wm.REPORTS_DIR / "ra.docx").exists()


def test_activate_swaps_mirror_between_projects(monkeypatch):
    with _client() as c:
        import web.main as wm
        pid_a = _make_project_with_report(c, "WS-1", "a_only.docx")
        pid_b = _make_project_with_report(c, "WS-2", "b_only.docx")
        c.post(f"/api/projects/{pid_a}/activate")
        assert (wm.REPORTS_DIR / "a_only.docx").exists()
        assert not (wm.REPORTS_DIR / "b_only.docx").exists()
        c.post(f"/api/projects/{pid_b}/activate")
        assert (wm.REPORTS_DIR / "b_only.docx").exists()
        assert not (wm.REPORTS_DIR / "a_only.docx").exists()
```

Note: these tests write into the repo's real `reports/` dir (gitignored). That's acceptable
for the test (the mirror IS those dirs); the swap test asserts the clearing behavior.

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_workspace_wiring.py -v`
Expected: FAIL — both reports coexist (no pull/clear on activate yet).

- [ ] **Step 3: Implement**

In `web/main.py`, add the workspace import near the other db/storage imports:
```python
from web.storage import workspace as storage_workspace
```
Replace the `activate_project` handler body so it fetches the project and pulls its workspace:
```python
@app.post("/api/projects/{project_id}/activate")
def activate_project(project_id: str, request: Request, db: Session = Depends(db_session.get_db)):
    import uuid as _uuid
    user = _current_user(request, db)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        pid = _uuid.UUID(project_id)
        db_repo.set_active_project(db, user, pid)
    except (db_repo.AccessError, ValueError):
        raise HTTPException(status_code=404, detail="Project not found")
    project = db_repo.get_project_for_user(db, user, pid)
    db_bridge.mirror_active(db, user)
    storage_workspace.pull_workspace(str(project.org_id), str(project.id), base=BASE_DIR)
    return {"ok": True, "active_id": project_id}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_workspace_wiring.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Run the full suite**

Run: `PYTHONPATH=. pytest tests/ -q`
Expected: PASS. (The legacy/dev project has no Minio objects yet, so activating it pulls 0 files and clears the mirror dirs — if a pre-existing test depends on stale files in `reports/`/`data/processed/` surviving an activate, note and report it; none is expected since tests create their own data.)

- [ ] **Step 6: Commit**

```bash
git add web/main.py tests/test_workspace_wiring.py
git commit -m "feat(api): pull active project's workspace from Minio on activate"
```

---

## Task 3: Push outputs to Minio after a successful run

**Files:** Modify `web/main.py`; Test `tests/test_workspace_wiring.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_workspace_wiring.py`:
```python
def test_successful_run_pushes_outputs(monkeypatch):
    import asyncio
    import web.main as wm
    from web.storage import factory
    from web.storage.base import storage_key

    # a fake subprocess that "produces" a report in the mirror, then exits 0
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
        # simulate the CLI writing an output report into the mirror
        wm.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        (wm.REPORTS_DIR / "produced.docx").write_bytes(b"NEW")
        return _FakeProc()

    monkeypatch.setattr(wm.asyncio, "create_subprocess_exec", _fake_exec)
    wm._running_command = None

    with _client() as c:
        pid = _make_project_with_report(c, "WS-RUN", "seed.docx")
        c.post(f"/api/projects/{pid}/activate")
        with wm.db_session.SessionLocal() as db:
            org_id = str(db.get(wm.db_repo.Project, __import__("uuid").UUID(pid)).org_id)
        # run a whitelisted command; stream to completion
        resp = c.post("/api/run/build-report", json={})
        assert resp.status_code == 200
        _ = resp.text          # drain the SSE stream so _stream completes
        store = factory.get_storage()
        assert storage_key(org_id, pid, "reports", "produced.docx") in \
            store.list(f"orgs/{org_id}/projects/{pid}/")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_workspace_wiring.py::test_successful_run_pushes_outputs -v`
Expected: FAIL — `produced.docx` is not in Minio (no push on success yet).

- [ ] **Step 3: Implement**

In `web/main.py`, the `run_command` handler already resolves the user under the single-flight
lock. Extend that block to also resolve the active project's ids and thread them into
`_stream`. Replace the existing mirror block + `_stream` call:
```python
    _running_command = command  # reserve synchronously (atomic: no await before return)
    _ws_ids = None
    try:
        with db_session.SessionLocal() as _db:
            _user, _project = _active_project(request, _db)
            if _project is not None:
                db_bridge.mirror_active(_db, _user)
                _ws_ids = (str(_project.org_id), str(_project.id))
    except Exception:
        _running_command = None
        raise
    return StreamingResponse(
        _stream(command, cmd, _ws_ids),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```
Update `_stream` to accept the ids and push on success:
```python
async def _stream(command: str, cmd: list, ws_ids=None) -> AsyncGenerator[str, None]:
    global _last_status, _proc, _running_command
    _last_status = {"command": command, "status": "running", "finished_at": None}
    yield _sse("status", {"status": "running", "command": command})
    yield _sse("log", {"line": f"$ {' '.join(cmd)}", "level": "cmd"})
    env = {**os.environ, "PYTHONPATH": str(BASE_DIR), "PYTHONUNBUFFERED": "1"}
    try:
        _proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT, cwd=str(BASE_DIR), env=env,
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
    if status == "success" and ws_ids is not None:
        try:
            storage_workspace.push_outputs(ws_ids[0], ws_ids[1], base=BASE_DIR)
        except Exception as e:   # CLI work already succeeded; a push failure must not crash
            yield _sse("log", {"line": f"Warning: failed to persist outputs to storage: {e}", "level": "error"})
    _last_status = {"command": command, "status": status, "finished_at": datetime.now().isoformat()}
    yield _sse("status", {**_last_status})
    yield _sse("done", {})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_workspace_wiring.py -v`
Expected: PASS (all 3).

- [ ] **Step 5: Run the full suite**

Run: `PYTHONPATH=. pytest tests/ -q`
Expected: PASS. (The existing `tests/test_run_all_api.py` calls `_stream(command, cmd)` and constructs `run_command` — verify the new optional `ws_ids=None` param keeps those green; the default makes the push a no-op.)

- [ ] **Step 6: Commit**

```bash
git add web/main.py tests/test_workspace_wiring.py
git commit -m "feat(api): push run outputs to Minio on success (single-flight)"
```

---

## Task 4: Bootstrap — persist the legacy project's existing files once

**Files:** Modify `web/db/bootstrap.py`; Test `tests/test_bootstrap_workspace.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_bootstrap_workspace.py`:
```python
import pytest
from web.db import session as dbs
from web.db import bootstrap, provision, repository as repo
from web.storage import factory


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'bw.db'}")
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.setenv("STORAGE_LOCAL_DIR", str(tmp_path / "minio"))
    dbs.reset_engine(); dbs.init_schema(); factory.reset_storage()
    s = dbs.SessionLocal()
    yield s
    s.close(); dbs.reset_engine(); factory.reset_storage()


def test_import_legacy_workspace_pushes_once(tmp_path, db):
    u = provision.ensure_dev_user(db)
    org_id = str(repo._user_org_ids(db, u)[0])
    # a legacy project with a local report under a temp base
    base = tmp_path / "repo"
    (base / "reports").mkdir(parents=True)
    (base / "reports" / "legacy.docx").write_bytes(b"OLD")
    (base / "data" / "processed").mkdir(parents=True)
    (base / "templates").mkdir()
    proj = repo.create_project(db, user=u, name="Legacy", org_id=repo._user_org_ids(db, u)[0])

    n1 = bootstrap.import_legacy_workspace(db, proj, base=base)
    assert n1 == 1
    store = factory.get_storage()
    assert any("legacy.docx" in k for k in store.list(f"orgs/{org_id}/projects/{proj.id}/"))
    # idempotent: second call is a no-op because the prefix is now non-empty
    n2 = bootstrap.import_legacy_workspace(db, proj, base=base)
    assert n2 == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_bootstrap_workspace.py -v`
Expected: FAIL — `AttributeError: module 'web.db.bootstrap' has no attribute 'import_legacy_workspace'`.

- [ ] **Step 3: Implement**

In `web/db/bootstrap.py`, add (after `import_legacy_config`):
```python
def import_legacy_workspace(db, project, base=None) -> int:
    """One-time: push the project's existing local files to Minio if its prefix is empty.
    Returns #files pushed (0 if already populated). Idempotent."""
    from pathlib import Path
    from web.storage import workspace
    base = Path(base) if base is not None else Path(__file__).resolve().parent.parent.parent
    org_id, project_id = str(project.org_id), str(project.id)
    if not workspace.is_empty(org_id, project_id):
        return 0
    return workspace.push_outputs(org_id, project_id, base=base)
```
Then call it from `init_db` for the dev/legacy project. Replace the auth-disabled branch in `init_db`:
```python
    if not auth.auth_enabled():
        with dbs.SessionLocal() as db:
            dev = provision.ensure_dev_user(db)
            project = import_legacy_config(db, owner=dev)
            if project is not None:
                import_legacy_workspace(db, project)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_bootstrap_workspace.py -v`
Expected: PASS (1 passed).

- [ ] **Step 5: Run the full suite**

Run: `PYTHONPATH=. pytest tests/ -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/db/bootstrap.py tests/test_bootstrap_workspace.py
git commit -m "feat(db): persist legacy project's local files to Minio at bootstrap"
```

---

## Task 5: Docs

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1: Document the workspace mirror**

In `CLAUDE.md`, in the "App database & project model (web/db/)" subsection added in Slice 2 (or just after it), add ~6 lines: project **files** (data sessions, reports, templates) are stored durably in **Minio** per project (`web/storage/`); the local `data/processed`/`reports`/`templates` dirs are a **materialized mirror of the active project** — pulled from Minio on project activate, and run outputs pushed back on success (`web/storage/workspace.py`). `raw`/`charts` are not synced (regenerable). Requires `S3_*` env (Minio); tests use the local-fs backend. Concurrency/per-job isolation is deferred (single-flight retained).

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: Minio project workspace mirror"
```

---

## Self-Review notes

- **Spec coverage:** `workspace.py` module with pull/push/is_empty + category map + charts/raw exclusion (T1) · pull on activate, mirror swap (T2) · push outputs on run success under single-flight, threaded project ids (T3) · bootstrap legacy push, idempotent (T4) · listing/downloads unchanged (untouched — verified by full-suite runs in T2–T4) · error handling: push failure logged not fatal (T3), activate pull surfaces but leaves active set (T2) · docs (T5). Concurrency/tempdirs/runs-table correctly absent (3c).
- **charts/raw exclusion:** `_local_files` returns only top-level files of each category dir; `data/processed/charts/` (a subdir) and `data/raw` (a different category, not in `CATEGORY_DIRS`) are never enumerated → never pushed; `pull_workspace` unlinks only top-level files → `charts/` preserved. Tested in T1.
- **Signature consistency:** `pull_workspace(org_id, project_id, base)`, `push_outputs(org_id, project_id, base)`, `is_empty(org_id, project_id)` used identically in T1–T4; `_stream(command, cmd, ws_ids=None)` default keeps existing `tests/test_run_all_api.py` callers green.
- **No placeholders**; every code step complete.
- **Known interim (documented in spec):** the mirror is process-wide → safe only under single-flight; concurrent different-project runs await 3c.
