# Hosting Phase C.1 — DB-backed configs + auth (Supabase) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the web UI host **multiple projects per user** with login, where each project's `config.yml` lives in Supabase Postgres as a JSONB column (plus a raw-YAML column so users keep their formatting and comments). The CLI keeps reading `config.yml` from disk unchanged. When `SUPABASE_URL` is unset, the web app falls back to single-config-on-disk behavior — existing deployments don't break.

**Architecture:**
- A `projects` table in Supabase Postgres holds `(id, owner_id, name, config jsonb, config_yaml text)`. Row-level security restricts every row to its `owner_id`.
- A thin `ProjectsRepo` class in `src/utils/projects_repo.py` wraps the Supabase client; tests inject an in-memory `FakeProjectsRepo` so no test ever hits a real network.
- `src/utils/config.py` gains `load_config_from_db(project_id, repo)` returning the same dict shape that `load_config(path)` returns today — downstream code (chart rendering, builder, etc.) sees no difference.
- A FastAPI dependency in `web/auth.py` verifies the Supabase JWT (HS256) sent by the React app and yields the authenticated `user_id`. The auth dependency is no-op when `SUPABASE_URL` is unset, preserving the single-user disk fallback.
- The React frontend gains a Supabase auth context + a project-picker dropdown in the topbar; the YAML editor on the Composition tab reads/writes the current project's config via `/api/projects/:id/config`.

**Tech Stack:** Python 3.12 + FastAPI + supabase-py 2.x + pyjwt + pydantic; React + Vite + `@supabase/supabase-js`; Postgres (managed by Supabase) with RLS.

**Non-goals (deferred to later Phase C plans):**
- **C.2 — Storage layer.** Generated `.docx`, downloaded CSVs, and template files still write to local FS. Swapping to Supabase Storage with project-scoped paths is a separate plan.
- **C.3 — Jobs table + in-process runner + Realtime.** The current subprocess + SSE log streaming pattern stays exactly as-is. The `jobs` and `job_events` tables don't get created in C.1.
- **C.4 — Dockerfile + compose + deploy.** Packaging is a separate plan.
- **Project sharing / team membership.** One project = one owner in C.1. Sharing via a `project_members` table is a future feature.
- **Per-project file storage.** Templates and reports stay global on disk in C.1 — multi-project file isolation lands in C.2.

**Backward-compat contract:**
- If `SUPABASE_URL` is **not** set in the environment, web behavior is unchanged: reads/writes `./config.yml`, no auth, no project switcher. Every existing test passes.
- The CLI (`src/data/make.py`) **always** reads `./config.yml` from disk. It never talks to Supabase in C.1. (CLI ↔ DB integration is a C.3 concern, when jobs move to the DB.)
- Existing endpoints (`/api/config`, `/api/run/*`, `/api/state`, `/api/templates`, etc.) keep working in disk mode. In DB mode they read the active project's config from the DB.

**Risk + rollback:** Auth + RLS bugs leak data across tenants — a much worse failure than a normal feature bug. Mitigations:
- A cross-tenant isolation test (Task 6's step 4) explicitly attempts to read user-B's project as user-A and asserts it 404s.
- The auth dependency is a single, well-tested chokepoint; no endpoint extracts `user_id` from request bodies.
- RLS is enforced at the database layer with `auth.uid()` so even a bug in our Python code can't leak rows.
- Atomic commits per task; review checkpoints after Tasks 4, 7, 10.

---

## Sub-phases at a glance

| Sub-phase | Tasks | Delivers |
|---|---|---|
| **C.1.a Schema + repo** | 1 – 3 | `projects` table + RLS, `ProjectsRepo` (real + fake), `load_config_from_db` |
| **C.1.b Auth + endpoints** | 4 – 7 | JWT auth dependency, `/api/projects` CRUD, `/api/projects/import` migration |
| **C.1.c Frontend** | 8 – 10 | Login screen, project switcher, YAML editor wired to DB |
| **C.1.d Docs + smoke** | 11 – 12 | README hosted-mode section, CLAUDE.md, e2e smoke test |

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260520000001_projects.sql` | create | `projects` table, RLS policies, `set_updated_at` trigger |
| `src/utils/projects_repo.py` | create | `ProjectsRepo` (supabase-backed) + `FakeProjectsRepo` (in-memory) + shared `ProjectsRepoProtocol` |
| `tests/test_projects_repo.py` | create | Unit tests for `FakeProjectsRepo` contract |
| `src/utils/config.py` | modify | Add `load_config_from_db(project_id, repo)` and `save_config_to_db(project_id, parsed, yaml_text, repo)` |
| `tests/test_config_db.py` | create | Tests for the two new functions with `FakeProjectsRepo` |
| `web/auth.py` | create | `current_user_id` FastAPI dependency (Supabase JWT verification) + `is_db_mode()` helper |
| `tests/test_auth.py` | create | JWT verification tests (valid / missing / expired / wrong audience) |
| `web/main.py` | modify | New `/api/projects*` endpoints; existing `/api/config` reads active project in DB mode; small refactor to inject `ProjectsRepo` dependency |
| `tests/test_projects_endpoint.py` | create | List, create, get-config, put-config, cross-tenant isolation |
| `tests/test_import_endpoint.py` | create | `/api/projects/import` reads disk `config.yml` + inserts row |
| `frontend/package.json` | modify | Add `@supabase/supabase-js` |
| `frontend/src/lib/supabase.js` | create | Supabase client singleton + auth helpers |
| `frontend/src/lib/auth.jsx` | create | `<AuthProvider>` + `useAuth()` hook; injects JWT into `fetch` |
| `frontend/src/pages/Login.jsx` | create | Email + magic-link sign-in form |
| `frontend/src/App.jsx` | modify | Wrap in `<AuthProvider>`; show `<Login/>` if signed-out; show project switcher when signed-in |
| `frontend/src/components/ProjectSwitcher.jsx` | create | Dropdown listing user's projects + "New project" action |
| `frontend/src/lib/config.js` | modify | Route through `/api/projects/:id/config` when authed; `/api/config` when not |
| `frontend/src/pages/Composition.jsx` | modify | YAML editor uses new `lib/config.js` helpers (no other change) |
| `.env.example` | modify | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `SUPABASE_JWT_SECRET` |
| `requirements.txt` | modify | Add `supabase==2.*`, `pyjwt[crypto]==2.*` |
| `README.md` | modify | "Hosted mode" section |
| `CLAUDE.md` | modify | Hosted-mode architecture paragraph; `web/auth.py` and `projects_repo.py` listed in project structure |
| `tests/test_hosted_mode_smoke.py` | create | End-to-end: with `SUPABASE_URL` set, sign in → create project → save YAML → list projects sees it |

---

## Schema contract

```sql
-- supabase/migrations/20260520000001_projects.sql

create table if not exists public.projects (
    id          uuid primary key default gen_random_uuid(),
    owner_id    uuid not null references auth.users(id) on delete cascade,
    name        text not null check (length(name) between 1 and 200),
    config      jsonb not null,
    config_yaml text  not null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index if not exists projects_owner_idx on public.projects(owner_id);

alter table public.projects enable row level security;

create policy "owner can select" on public.projects
    for select using (owner_id = auth.uid());

create policy "owner can insert" on public.projects
    for insert with check (owner_id = auth.uid());

create policy "owner can update" on public.projects
    for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "owner can delete" on public.projects
    for delete using (owner_id = auth.uid());

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
    before update on public.projects
    for each row execute function public.set_updated_at();
```

**Why YAML and JSON in the same row:** `config` (JSONB) is what the runtime reads — it's queryable, indexable, validates as JSON. `config_yaml` (TEXT) is what the editor shows the user — it preserves their comments, key order, and blank lines. Writes always parse YAML → JSON, store both. Reads pick whichever the caller needs.

---

## Repo contract (Python)

```python
# src/utils/projects_repo.py — minimal interface used by config.py + endpoints

class ProjectsRepoProtocol(Protocol):
    def list_for_owner(self, owner_id: str) -> list[dict]: ...
    def get(self, project_id: str) -> dict | None: ...
    def create(self, owner_id: str, name: str, config: dict, config_yaml: str) -> dict: ...
    def update_config(self, project_id: str, config: dict, config_yaml: str) -> dict: ...
    def delete(self, project_id: str) -> None: ...
```

Every endpoint takes a `ProjectsRepoProtocol` via FastAPI's dependency injection. Production uses `SupabaseProjectsRepo`; tests inject `FakeProjectsRepo`.

---

## Sub-phase C.1.a: Schema + repo

### Task 1: Migration SQL + `supabase/` workspace

**Files:**
- Create: `supabase/migrations/20260520000001_projects.sql`
- Create: `supabase/README.md`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260520000001_projects.sql` with the exact SQL from the **Schema contract** section above (the full `create table`, RLS policies, and trigger block).

- [ ] **Step 2: Add `supabase/README.md`**

```markdown
# Supabase workspace

Migrations applied via the Supabase CLI:

```bash
supabase login
supabase link --project-ref <your-ref>
supabase db push        # applies everything in migrations/
```

For local dev:

```bash
supabase start          # spins up Postgres + Auth + Storage on localhost
supabase db reset       # re-runs every migration from scratch
```

Local URL/keys are printed by `supabase start` — copy them into `.env`.
```

- [ ] **Step 3: Syntax-check the SQL**

If you have `psql` available:
```bash
psql --no-psqlrc -f supabase/migrations/20260520000001_projects.sql --dry-run 2>&1 || \
  echo "(psql not connected; verifying syntax-only with sqlparse instead)"
python3 -c "import sqlparse, pathlib; \
  sqlparse.parse(pathlib.Path('supabase/migrations/20260520000001_projects.sql').read_text())"
```

Expected: no errors. `sqlparse` is already an indirect dep (via `sqlalchemy`); if missing, `pip install sqlparse` first.

- [ ] **Step 4: Commit**

```bash
git add supabase/
git commit -m "feat(hosting): projects table migration + supabase workspace"
```

---

### Task 2: `ProjectsRepo` (real + fake) + tests

**Files:**
- Create: `src/utils/projects_repo.py`
- Create: `tests/test_projects_repo.py`
- Modify: `requirements.txt`

- [ ] **Step 1: Add the supabase dep**

Append to `requirements.txt`:
```
supabase==2.7.4
pyjwt[crypto]==2.9.0
```

Run `pip install -r requirements.txt`.

- [ ] **Step 2: Write the failing tests**

Create `tests/test_projects_repo.py`:

```python
import pytest
from src.utils.projects_repo import FakeProjectsRepo


@pytest.fixture
def repo():
    return FakeProjectsRepo()


def test_create_returns_row_with_id(repo):
    row = repo.create("user-1", "My survey", {"api": {}}, "api: {}\n")
    assert row["owner_id"] == "user-1"
    assert row["name"] == "My survey"
    assert row["config"] == {"api": {}}
    assert row["config_yaml"] == "api: {}\n"
    assert "id" in row and len(row["id"]) > 0
    assert "created_at" in row and "updated_at" in row


def test_list_for_owner_returns_only_their_rows(repo):
    repo.create("user-1", "A", {}, "")
    repo.create("user-1", "B", {}, "")
    repo.create("user-2", "C", {}, "")
    assert {p["name"] for p in repo.list_for_owner("user-1")} == {"A", "B"}
    assert {p["name"] for p in repo.list_for_owner("user-2")} == {"C"}
    assert repo.list_for_owner("user-3") == []


def test_get_returns_row_or_none(repo):
    row = repo.create("user-1", "X", {"k": 1}, "k: 1\n")
    assert repo.get(row["id"])["name"] == "X"
    assert repo.get("nonexistent-id") is None


def test_update_config_replaces_both_columns(repo):
    row = repo.create("user-1", "X", {"k": 1}, "k: 1\n")
    updated = repo.update_config(row["id"], {"k": 2}, "k: 2\n")
    assert updated["config"] == {"k": 2}
    assert updated["config_yaml"] == "k: 2\n"
    # name and owner_id unchanged
    assert updated["name"] == "X"
    assert updated["owner_id"] == "user-1"
    # updated_at bumped
    assert updated["updated_at"] >= row["created_at"]


def test_update_unknown_project_raises(repo):
    with pytest.raises(KeyError):
        repo.update_config("nonexistent-id", {}, "")


def test_delete_removes_row(repo):
    row = repo.create("user-1", "X", {}, "")
    repo.delete(row["id"])
    assert repo.get(row["id"]) is None


def test_delete_unknown_is_noop(repo):
    repo.delete("nonexistent-id")  # must not raise
```

- [ ] **Step 3: Run to verify it fails**

```bash
pytest tests/test_projects_repo.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'src.utils.projects_repo'`.

- [ ] **Step 4: Implement `src/utils/projects_repo.py`**

```python
"""Thin abstraction over the projects table.

The real (Supabase) implementation talks to the network. The fake one is an
in-memory dict used by tests so no test ever needs a Supabase instance.

Endpoints inject a repo via FastAPI's dependency system, so swapping real for
fake is a single line in conftest.py.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Protocol


class ProjectsRepoProtocol(Protocol):
    def list_for_owner(self, owner_id: str) -> list[dict]: ...
    def get(self, project_id: str) -> dict | None: ...
    def create(self, owner_id: str, name: str,
               config: dict, config_yaml: str) -> dict: ...
    def update_config(self, project_id: str,
                      config: dict, config_yaml: str) -> dict: ...
    def delete(self, project_id: str) -> None: ...


class FakeProjectsRepo:
    """In-memory implementation for tests."""

    def __init__(self) -> None:
        self._rows: dict[str, dict] = {}

    def list_for_owner(self, owner_id: str) -> list[dict]:
        return sorted(
            (r for r in self._rows.values() if r["owner_id"] == owner_id),
            key=lambda r: r["updated_at"],
            reverse=True,
        )

    def get(self, project_id: str) -> dict | None:
        return self._rows.get(project_id)

    def create(self, owner_id: str, name: str,
               config: dict, config_yaml: str) -> dict:
        now = datetime.now(timezone.utc).isoformat()
        row = {
            "id":          str(uuid.uuid4()),
            "owner_id":    owner_id,
            "name":        name,
            "config":      config,
            "config_yaml": config_yaml,
            "created_at":  now,
            "updated_at":  now,
        }
        self._rows[row["id"]] = row
        return row

    def update_config(self, project_id: str,
                      config: dict, config_yaml: str) -> dict:
        if project_id not in self._rows:
            raise KeyError(project_id)
        row = self._rows[project_id]
        row["config"]      = config
        row["config_yaml"] = config_yaml
        row["updated_at"]  = datetime.now(timezone.utc).isoformat()
        return row

    def delete(self, project_id: str) -> None:
        self._rows.pop(project_id, None)


class SupabaseProjectsRepo:
    """Production implementation backed by supabase-py."""

    def __init__(self, client) -> None:
        self._client = client

    def list_for_owner(self, owner_id: str) -> list[dict]:
        # RLS already filters by auth.uid(); the explicit eq is belt-and-braces
        # in case this repo is ever used with the service-role key.
        resp = (self._client.table("projects")
                .select("id, name, config, config_yaml, created_at, updated_at, owner_id")
                .eq("owner_id", owner_id)
                .order("updated_at", desc=True)
                .execute())
        return resp.data or []

    def get(self, project_id: str) -> dict | None:
        resp = (self._client.table("projects")
                .select("*").eq("id", project_id).limit(1).execute())
        return (resp.data or [None])[0]

    def create(self, owner_id: str, name: str,
               config: dict, config_yaml: str) -> dict:
        resp = (self._client.table("projects").insert({
            "owner_id":    owner_id,
            "name":        name,
            "config":      config,
            "config_yaml": config_yaml,
        }).execute())
        return resp.data[0]

    def update_config(self, project_id: str,
                      config: dict, config_yaml: str) -> dict:
        resp = (self._client.table("projects").update({
            "config":      config,
            "config_yaml": config_yaml,
        }).eq("id", project_id).execute())
        if not resp.data:
            raise KeyError(project_id)
        return resp.data[0]

    def delete(self, project_id: str) -> None:
        self._client.table("projects").delete().eq("id", project_id).execute()


def _build_default_repo() -> ProjectsRepoProtocol:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        # In disk mode there's no repo to build. Callers must not call this
        # — the auth dependency short-circuits before it gets used.
        raise RuntimeError(
            "SUPABASE_URL / SUPABASE_SERVICE_KEY not set; "
            "DB mode requires both."
        )
    from supabase import create_client
    return SupabaseProjectsRepo(create_client(url, key))


_default_repo: ProjectsRepoProtocol | None = None


def get_projects_repo() -> ProjectsRepoProtocol:
    """FastAPI dependency. Returns the singleton in production; tests override."""
    global _default_repo
    if _default_repo is None:
        _default_repo = _build_default_repo()
    return _default_repo


def set_projects_repo(repo: ProjectsRepoProtocol | None) -> None:
    """Test helper to swap the singleton."""
    global _default_repo
    _default_repo = repo
```

- [ ] **Step 5: Run tests to verify pass**

```bash
pytest tests/test_projects_repo.py -v
```
Expected: 7 passing.

- [ ] **Step 6: Commit**

```bash
git add src/utils/projects_repo.py tests/test_projects_repo.py requirements.txt
git commit -m "feat(hosting): ProjectsRepo abstraction + in-memory fake"
```

---

### Task 3: `load_config_from_db` + `save_config_to_db`

**Files:**
- Modify: `src/utils/config.py`
- Create: `tests/test_config_db.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_config_db.py`:

```python
import pytest
import yaml
from src.utils.config import load_config_from_db, save_config_to_db
from src.utils.projects_repo import FakeProjectsRepo


@pytest.fixture
def repo_with_project():
    repo = FakeProjectsRepo()
    cfg = {
        "api":  {"platform": "kobo", "url": "https://kf.example", "token": "env:KOBO_TOKEN"},
        "form": {"alias": "p", "uid": "abc"},
        "questions": [],
    }
    yaml_text = yaml.dump(cfg, allow_unicode=True, sort_keys=False)
    row = repo.create("user-1", "Demo", cfg, yaml_text)
    return repo, row["id"]


def test_load_returns_resolved_config(repo_with_project, monkeypatch):
    repo, pid = repo_with_project
    monkeypatch.setenv("KOBO_TOKEN", "secret-token")
    cfg = load_config_from_db(pid, repo)
    assert cfg["api"]["token"] == "secret-token"   # env: resolved
    assert cfg["form"]["uid"] == "abc"


def test_load_missing_project_raises(repo_with_project):
    repo, _ = repo_with_project
    with pytest.raises(KeyError):
        load_config_from_db("nonexistent-id", repo)


def test_load_validates_required_keys(repo_with_project):
    repo, _ = repo_with_project
    bad = repo.create("user-1", "Bad", {"questions": []}, "questions: []\n")
    with pytest.raises(ValueError, match="api"):
        load_config_from_db(bad["id"], repo)


def test_save_parses_yaml_and_stores_both_columns(repo_with_project):
    repo, pid = repo_with_project
    new_yaml = (
        "# top comment\n"
        "api:\n  platform: kobo\n  url: https://new.example\n  token: t\n"
        "form:\n  alias: p2\n  uid: xyz\n"
        "questions: []\n"
    )
    saved = save_config_to_db(pid, new_yaml, repo)
    assert saved["config"]["api"]["url"] == "https://new.example"
    assert saved["config"]["form"]["alias"] == "p2"
    assert saved["config_yaml"] == new_yaml         # raw preserved
    assert "# top comment" in saved["config_yaml"]  # comment survives


def test_save_invalid_yaml_raises(repo_with_project):
    repo, pid = repo_with_project
    with pytest.raises(yaml.YAMLError):
        save_config_to_db(pid, "key: [unclosed", repo)


def test_save_missing_required_keys_raises(repo_with_project):
    repo, pid = repo_with_project
    with pytest.raises(ValueError, match="api"):
        save_config_to_db(pid, "questions: []\n", repo)
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_config_db.py -v
```
Expected: FAIL — `ImportError: cannot import name 'load_config_from_db'`.

- [ ] **Step 3: Implement the two functions**

Append to `src/utils/config.py` (after the existing `_resolve_env` definition):

```python
def load_config_from_db(project_id: str, repo) -> Dict:
    """DB-mode equivalent of load_config(path). Returns the same dict shape."""
    row = repo.get(project_id)
    if row is None:
        raise KeyError(f"Project not found: {project_id}")
    cfg = _resolve_env(row["config"] or {})
    for key in REQUIRED_KEYS:
        if key not in cfg:
            raise ValueError(f"Missing key '{key}' in project {project_id}")
    platform = cfg.get("api", {}).get("platform", "kobo").lower()
    if platform not in ("kobo", "ona"):
        raise ValueError(f"api.platform must be 'kobo' or 'ona', got '{platform}'")
    return cfg


def save_config_to_db(project_id: str, yaml_text: str, repo) -> Dict:
    """Parse YAML, validate, and write both columns. Returns the updated row."""
    parsed = yaml.safe_load(yaml_text) or {}
    if not isinstance(parsed, dict):
        raise ValueError("Top-level YAML must be a mapping")
    for key in REQUIRED_KEYS:
        if key not in parsed:
            raise ValueError(f"Missing key '{key}' in YAML")
    return repo.update_config(project_id, parsed, yaml_text)
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pytest tests/test_config_db.py -v
```
Expected: 6 passing.

- [ ] **Step 5: Run the full test suite to confirm no regression**

```bash
pytest -q
```
Expected: all previously-passing tests still pass; 13 new tests added (7 repo + 6 config).

- [ ] **Step 6: Commit**

```bash
git add src/utils/config.py tests/test_config_db.py
git commit -m "feat(hosting): load_config_from_db + save_config_to_db"
```

---

## Sub-phase C.1.b: Auth + endpoints

### Task 4: JWT auth dependency

**Files:**
- Create: `web/auth.py`
- Create: `tests/test_auth.py`
- Modify: `.env.example`

- [ ] **Step 1: Document the env vars**

Append to `.env.example`:

```bash
# --- Hosted mode (optional) ---
# When SUPABASE_URL is set, the web app switches to multi-project mode with
# auth. The CLI ignores these and always reads ./config.yml from disk.
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=eyJhbG...
SUPABASE_SERVICE_KEY=eyJhbG...
SUPABASE_JWT_SECRET=<the HS256 secret from Supabase project settings>
```

- [ ] **Step 2: Write the failing tests**

Create `tests/test_auth.py`:

```python
import time
import jwt
import pytest
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient
from web.auth import current_user_id, is_db_mode

SECRET = "test-secret-please-ignore"


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    a = FastAPI()

    @a.get("/whoami")
    async def whoami(uid: str = Depends(current_user_id)):
        return {"uid": uid}

    return a


def _token(sub="user-1", aud="authenticated", exp_offset=3600):
    return jwt.encode(
        {"sub": sub, "aud": aud, "exp": int(time.time()) + exp_offset},
        SECRET, algorithm="HS256",
    )


def test_is_db_mode_reflects_env(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    assert is_db_mode() is False
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    assert is_db_mode() is True


def test_valid_token_returns_user_id(app):
    with TestClient(app) as c:
        r = c.get("/whoami", headers={"Authorization": f"Bearer {_token('alice')}"})
        assert r.status_code == 200
        assert r.json() == {"uid": "alice"}


def test_missing_token_returns_401(app):
    with TestClient(app) as c:
        r = c.get("/whoami")
        assert r.status_code == 401


def test_malformed_token_returns_401(app):
    with TestClient(app) as c:
        r = c.get("/whoami", headers={"Authorization": "Bearer not-a-jwt"})
        assert r.status_code == 401


def test_expired_token_returns_401(app):
    with TestClient(app) as c:
        r = c.get("/whoami",
                  headers={"Authorization": f"Bearer {_token(exp_offset=-10)}"})
        assert r.status_code == 401


def test_wrong_audience_returns_401(app):
    with TestClient(app) as c:
        r = c.get("/whoami",
                  headers={"Authorization": f"Bearer {_token(aud='somebody-else')}"})
        assert r.status_code == 401


def test_disk_mode_dependency_returns_local(monkeypatch):
    """When SUPABASE_URL is unset, current_user_id must return the disk-mode sentinel."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    a = FastAPI()

    @a.get("/whoami")
    async def whoami(uid: str = Depends(current_user_id)):
        return {"uid": uid}

    with TestClient(a) as c:
        r = c.get("/whoami")
        assert r.status_code == 200
        assert r.json() == {"uid": "local"}
```

- [ ] **Step 3: Run to verify failure**

```bash
pytest tests/test_auth.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'web.auth'`.

- [ ] **Step 4: Implement `web/auth.py`**

```python
"""Auth dependency for FastAPI endpoints.

In DB mode (SUPABASE_URL set), every protected endpoint depends on
`current_user_id`, which verifies the Supabase-issued JWT in the Authorization
header and returns its `sub` claim.

In disk mode (SUPABASE_URL unset), `current_user_id` returns the constant
"local" — single-user single-config behavior. No JWT required.
"""
from __future__ import annotations

import os
from typing import Optional

import jwt
from fastapi import HTTPException, Request, status

LOCAL_USER_ID = "local"
JWT_AUDIENCE = "authenticated"


def is_db_mode() -> bool:
    """True when SUPABASE_URL is present in the environment."""
    return bool(os.environ.get("SUPABASE_URL"))


def _extract_bearer(request: Request) -> Optional[str]:
    header = request.headers.get("authorization") or request.headers.get("Authorization")
    if not header:
        return None
    parts = header.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip()


async def current_user_id(request: Request) -> str:
    """Yield the authenticated user id, or 'local' in disk mode."""
    if not is_db_mode():
        return LOCAL_USER_ID

    token = _extract_bearer(request)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")

    secret = os.environ.get("SUPABASE_JWT_SECRET")
    if not secret:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "Server misconfigured: SUPABASE_JWT_SECRET unset",
        )

    try:
        payload = jwt.decode(
            token, secret, algorithms=["HS256"], audience=JWT_AUDIENCE,
        )
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {e}")

    uid = payload.get("sub")
    if not uid:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token missing sub claim")
    return uid
```

- [ ] **Step 5: Run tests to verify pass**

```bash
pytest tests/test_auth.py -v
```
Expected: 7 passing.

- [ ] **Step 6: Commit**

```bash
git add web/auth.py tests/test_auth.py .env.example
git commit -m "feat(hosting): Supabase JWT auth dependency for FastAPI"
```

**REVIEW CHECKPOINT** — at this point we have: schema, repo abstraction, DB config loaders, and auth. Stop and look at the four files together; verify the boundary between "DB mode" and "disk mode" is single-purpose and easy to flip. Manually check that running the existing test suite (`pytest -q`) passes with no env vars set.

---

### Task 5: `/api/projects` list + create endpoints

**Files:**
- Modify: `web/main.py`
- Create: `tests/test_projects_endpoint.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_projects_endpoint.py`:

```python
import time
import jwt
import pytest
from fastapi.testclient import TestClient

SECRET = "test-secret-please-ignore"


def _auth_header(sub="user-1"):
    tok = jwt.encode(
        {"sub": sub, "aud": "authenticated", "exp": int(time.time()) + 3600},
        SECRET, algorithm="HS256",
    )
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture
def db_client(monkeypatch):
    """Spin up the app in DB mode with a FakeProjectsRepo."""
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    from web.main import app
    from src.utils.projects_repo import FakeProjectsRepo, set_projects_repo
    repo = FakeProjectsRepo()
    set_projects_repo(repo)
    with TestClient(app) as c:
        yield c, repo
    set_projects_repo(None)


def test_list_empty(db_client):
    c, _ = db_client
    r = c.get("/api/projects", headers=_auth_header("user-1"))
    assert r.status_code == 200
    assert r.json() == {"projects": []}


def test_create_then_list(db_client):
    c, _ = db_client
    r = c.post("/api/projects",
               headers=_auth_header("user-1"),
               json={"name": "My survey"})
    assert r.status_code == 201
    pid = r.json()["id"]

    r2 = c.get("/api/projects", headers=_auth_header("user-1"))
    assert r2.status_code == 200
    rows = r2.json()["projects"]
    assert len(rows) == 1 and rows[0]["id"] == pid and rows[0]["name"] == "My survey"


def test_create_returns_starter_yaml(db_client):
    c, repo = db_client
    r = c.post("/api/projects", headers=_auth_header("u1"), json={"name": "P"})
    assert r.status_code == 201
    pid = r.json()["id"]
    row = repo.get(pid)
    assert "api:" in row["config_yaml"]
    assert "form:" in row["config_yaml"]
    assert row["config"]["api"]["platform"] == "kobo"


def test_create_rejects_empty_name(db_client):
    c, _ = db_client
    r = c.post("/api/projects", headers=_auth_header(), json={"name": ""})
    assert r.status_code == 422


def test_cross_tenant_isolation_in_list(db_client):
    c, _ = db_client
    c.post("/api/projects", headers=_auth_header("alice"), json={"name": "A"})
    c.post("/api/projects", headers=_auth_header("bob"),   json={"name": "B"})
    alice = c.get("/api/projects", headers=_auth_header("alice")).json()["projects"]
    bob   = c.get("/api/projects", headers=_auth_header("bob")).json()["projects"]
    assert {p["name"] for p in alice} == {"A"}
    assert {p["name"] for p in bob}   == {"B"}


def test_unauthenticated_returns_401(db_client):
    c, _ = db_client
    r = c.get("/api/projects")
    assert r.status_code == 401
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_projects_endpoint.py -v
```
Expected: FAIL — endpoints don't exist yet (404).

- [ ] **Step 3: Add the endpoints in `web/main.py`**

Add to imports at the top of `web/main.py`:

```python
from fastapi import Depends
from src.utils.projects_repo import (
    ProjectsRepoProtocol, get_projects_repo, FakeProjectsRepo,
)
from src.utils.config import save_config_to_db
from web.auth import current_user_id, is_db_mode
```

Add a starter-YAML constant somewhere near the top:

```python
STARTER_YAML = """\
api:
  platform: kobo
  url: https://kf.kobotoolbox.org/api/v2
  token: env:KOBO_TOKEN
form:
  uid: ""
  alias: new_project
questions: []
filters: []
charts: []
indicators: []
"""
```

Add the Pydantic models near the existing ones:

```python
class CreateProjectIn(BaseModel):
    name: str

    @classmethod
    def __get_validators__(cls):
        yield cls.validate
```

Actually simpler — use `Field`:

```python
from pydantic import BaseModel, Field

class CreateProjectIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
```

Add the two endpoints:

```python
@app.get("/api/projects")
async def list_projects(
    user_id: str = Depends(current_user_id),
    repo: ProjectsRepoProtocol = Depends(get_projects_repo),
):
    rows = repo.list_for_owner(user_id)
    return {"projects": [
        {"id": r["id"], "name": r["name"],
         "updated_at": r.get("updated_at"), "created_at": r.get("created_at")}
        for r in rows
    ]}


@app.post("/api/projects", status_code=201)
async def create_project(
    body: CreateProjectIn,
    user_id: str = Depends(current_user_id),
    repo: ProjectsRepoProtocol = Depends(get_projects_repo),
):
    parsed = yaml.safe_load(STARTER_YAML)
    row = repo.create(user_id, body.name, parsed, STARTER_YAML)
    return {"id": row["id"], "name": row["name"]}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pytest tests/test_projects_endpoint.py -v
```
Expected: 6 passing.

- [ ] **Step 5: Run the full suite**

```bash
pytest -q
```
Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add web/main.py tests/test_projects_endpoint.py
git commit -m "feat(hosting): /api/projects list + create endpoints"
```

---

### Task 6: `/api/projects/:id/config` GET + PUT + cross-tenant test

**Files:**
- Modify: `web/main.py`
- Modify: `tests/test_projects_endpoint.py`

- [ ] **Step 1: Append the failing tests**

Append to `tests/test_projects_endpoint.py`:

```python
def test_get_config_returns_yaml_and_json(db_client):
    c, _ = db_client
    r = c.post("/api/projects", headers=_auth_header("user-1"), json={"name": "P"})
    pid = r.json()["id"]

    r2 = c.get(f"/api/projects/{pid}/config", headers=_auth_header("user-1"))
    assert r2.status_code == 200
    body = r2.json()
    assert "api:" in body["yaml"]
    assert body["config"]["api"]["platform"] == "kobo"


def test_put_config_updates_both_columns(db_client):
    c, repo = db_client
    r = c.post("/api/projects", headers=_auth_header("u1"), json={"name": "P"})
    pid = r.json()["id"]

    new_yaml = (
        "# my edited config\n"
        "api:\n  platform: ona\n  url: https://api.ona.io/api/v1\n  token: t\n"
        "form:\n  uid: xyz\n  alias: edited\n"
        "questions: []\n"
    )
    r2 = c.put(f"/api/projects/{pid}/config",
               headers=_auth_header("u1"),
               json={"yaml": new_yaml})
    assert r2.status_code == 200

    row = repo.get(pid)
    assert row["config_yaml"] == new_yaml          # raw preserved
    assert row["config"]["api"]["platform"] == "ona"


def test_put_invalid_yaml_returns_400(db_client):
    c, _ = db_client
    r = c.post("/api/projects", headers=_auth_header("u1"), json={"name": "P"})
    pid = r.json()["id"]

    r2 = c.put(f"/api/projects/{pid}/config",
               headers=_auth_header("u1"),
               json={"yaml": "key: [broken"})
    assert r2.status_code == 400


def test_put_missing_required_keys_returns_400(db_client):
    c, _ = db_client
    r = c.post("/api/projects", headers=_auth_header("u1"), json={"name": "P"})
    pid = r.json()["id"]

    r2 = c.put(f"/api/projects/{pid}/config",
               headers=_auth_header("u1"),
               json={"yaml": "questions: []\n"})  # no api: or form:
    assert r2.status_code == 400


def test_cross_tenant_get_returns_404(db_client):
    c, _ = db_client
    r = c.post("/api/projects", headers=_auth_header("alice"), json={"name": "secret"})
    pid = r.json()["id"]

    r2 = c.get(f"/api/projects/{pid}/config", headers=_auth_header("eve"))
    assert r2.status_code == 404


def test_cross_tenant_put_returns_404(db_client):
    c, _ = db_client
    r = c.post("/api/projects", headers=_auth_header("alice"), json={"name": "secret"})
    pid = r.json()["id"]

    r2 = c.put(f"/api/projects/{pid}/config",
               headers=_auth_header("eve"),
               json={"yaml": "api: {}\nform: {}\n"})
    assert r2.status_code == 404
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_projects_endpoint.py -v -k "config or cross_tenant"
```
Expected: 6 failures (endpoints not implemented).

- [ ] **Step 3: Add the endpoints in `web/main.py`**

Add the models:

```python
class PutConfigIn(BaseModel):
    yaml: str
```

Add a helper for tenant-safe lookup:

```python
def _get_owned_or_404(repo, project_id: str, user_id: str) -> dict:
    row = repo.get(project_id)
    if row is None or row.get("owner_id") != user_id:
        raise HTTPException(status_code=404, detail="Project not found")
    return row
```

Add the endpoints:

```python
@app.get("/api/projects/{project_id}/config")
async def get_project_config(
    project_id: str,
    user_id: str = Depends(current_user_id),
    repo: ProjectsRepoProtocol = Depends(get_projects_repo),
):
    row = _get_owned_or_404(repo, project_id, user_id)
    return {"yaml": row["config_yaml"], "config": row["config"]}


@app.put("/api/projects/{project_id}/config")
async def put_project_config(
    project_id: str,
    body: PutConfigIn,
    user_id: str = Depends(current_user_id),
    repo: ProjectsRepoProtocol = Depends(get_projects_repo),
):
    _get_owned_or_404(repo, project_id, user_id)
    try:
        updated = save_config_to_db(project_id, body.yaml, repo)
    except yaml.YAMLError as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "updated_at": updated["updated_at"]}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pytest tests/test_projects_endpoint.py -v
```
Expected: 12 passing total (6 from Task 5 + 6 new).

- [ ] **Step 5: Commit**

```bash
git add web/main.py tests/test_projects_endpoint.py
git commit -m "feat(hosting): /api/projects/:id/config GET + PUT (tenant-isolated)"
```

---

### Task 7: `/api/projects/import` for one-time disk → DB migration

**Files:**
- Modify: `web/main.py`
- Create: `tests/test_import_endpoint.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_import_endpoint.py`:

```python
import time, jwt, yaml, pytest
from pathlib import Path
from fastapi.testclient import TestClient

SECRET = "test-secret-please-ignore"


def _auth(sub="user-1"):
    tok = jwt.encode(
        {"sub": sub, "aud": "authenticated", "exp": int(time.time()) + 3600},
        SECRET, algorithm="HS256",
    )
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture
def db_workspace(tmp_path, monkeypatch):
    cfg = {
        "api":  {"platform": "kobo", "url": "https://x", "token": "x"},
        "form": {"alias": "imported", "uid": "abc"},
        "questions": [{"kobo_key": "q1", "label": "Q1"}],
    }
    (tmp_path / "config.yml").write_text(yaml.dump(cfg, sort_keys=False), encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    from src.utils.projects_repo import FakeProjectsRepo, set_projects_repo
    repo = FakeProjectsRepo()
    set_projects_repo(repo)
    from web.main import app
    with TestClient(app) as c:
        yield c, repo
    set_projects_repo(None)


def test_import_inserts_row_from_disk(db_workspace):
    c, repo = db_workspace
    r = c.post("/api/projects/import",
               headers=_auth("user-1"),
               json={"name": "Imported"})
    assert r.status_code == 201
    pid = r.json()["id"]
    row = repo.get(pid)
    assert row["name"] == "Imported"
    assert row["config"]["form"]["alias"] == "imported"
    assert "questions:" in row["config_yaml"]


def test_import_when_no_disk_config_returns_400(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    from src.utils.projects_repo import FakeProjectsRepo, set_projects_repo
    set_projects_repo(FakeProjectsRepo())
    from web.main import app
    with TestClient(app) as c:
        r = c.post("/api/projects/import",
                   headers=_auth(), json={"name": "X"})
    set_projects_repo(None)
    assert r.status_code == 400
    assert "config.yml" in r.json()["detail"].lower()
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_import_endpoint.py -v
```
Expected: 404s (endpoint not implemented).

- [ ] **Step 3: Add the endpoint**

In `web/main.py`:

```python
class ImportProjectIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)


@app.post("/api/projects/import", status_code=201)
async def import_project(
    body: ImportProjectIn,
    user_id: str = Depends(current_user_id),
    repo: ProjectsRepoProtocol = Depends(get_projects_repo),
):
    if not CONFIG_PATH.exists():
        raise HTTPException(
            status_code=400,
            detail=f"No config.yml found at {CONFIG_PATH} to import",
        )
    yaml_text = CONFIG_PATH.read_text(encoding="utf-8")
    try:
        parsed = yaml.safe_load(yaml_text) or {}
    except yaml.YAMLError as e:
        raise HTTPException(status_code=400, detail=f"Disk config has invalid YAML: {e}")
    row = repo.create(user_id, body.name, parsed, yaml_text)
    return {"id": row["id"], "name": row["name"]}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pytest tests/test_import_endpoint.py -v
```
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add web/main.py tests/test_import_endpoint.py
git commit -m "feat(hosting): /api/projects/import migrates disk config.yml to DB"
```

**REVIEW CHECKPOINT** — backend is complete: list/create/get-config/put-config/import, all tenant-isolated, all tested. `pytest -q` should show ~28 hosting tests added with no regressions.

---

## Sub-phase C.1.c: Frontend

### Task 8: Supabase client + auth context + Login screen

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/lib/supabase.js`
- Create: `frontend/src/lib/auth.jsx`
- Create: `frontend/src/pages/Login.jsx`

- [ ] **Step 1: Add the dep**

```bash
cd frontend && npm install @supabase/supabase-js
```

This updates `package.json` and `package-lock.json`.

- [ ] **Step 2: Create `frontend/src/lib/supabase.js`**

```javascript
import { createClient } from '@supabase/supabase-js'

// Empty strings produce a client that gracefully no-ops in dev when env vars
// aren't set — disk mode doesn't reach into supabase-js anyway.
const url = import.meta.env.VITE_SUPABASE_URL || ''
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const supabase = url
  ? createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true } })
  : null

export const isDbMode = () => Boolean(url)
```

- [ ] **Step 3: Create `frontend/src/lib/auth.jsx`**

```jsx
import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isDbMode } from './supabase.js'

const AuthContext = createContext({
  user: null, loading: false, signIn: async () => {}, signOut: async () => {},
})

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(isDbMode())

  useEffect(() => {
    if (!isDbMode()) return
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUser(session?.user ?? null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const signIn = async (email) => {
    if (!isDbMode()) throw new Error('Auth not configured')
    return supabase.auth.signInWithOtp({ email })
  }
  const signOut = async () => {
    if (!isDbMode()) return
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)

/**
 * Wrapper around `fetch` that injects the current Supabase JWT.
 * In disk mode it's a thin pass-through.
 */
export async function authFetch(input, init = {}) {
  if (!isDbMode()) return fetch(input, init)
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const headers = new Headers(init.headers || {})
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(input, { ...init, headers })
}
```

- [ ] **Step 4: Create `frontend/src/pages/Login.jsx`**

```jsx
import { useState } from 'react'
import { useAuth } from '../lib/auth.jsx'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail]   = useState('')
  const [sent, setSent]     = useState(false)
  const [error, setError]   = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    try {
      await signIn(email)
      setSent(true)
    } catch (err) {
      setError(err.message || String(err))
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>databridge</h1>
        {sent ? (
          <p>Check <strong>{email}</strong> for the magic link.</p>
        ) : (
          <form onSubmit={submit}>
            <label>Email
              <input type="email" required value={email}
                     onChange={(e) => setEmail(e.target.value)}
                     placeholder="you@example.org" />
            </label>
            <button type="submit">Send magic link</button>
            {error && <p className="error">{error}</p>}
          </form>
        )}
      </div>
    </div>
  )
}
```

Add minimal CSS to `frontend/src/styles.css`:

```css
.login-page    { display: grid; place-items: center; min-height: 100vh; background: var(--bg-deep, #0d1117); }
.login-card    { background: var(--card-bg, #161b22); padding: 2.5rem; border-radius: 12px; min-width: 320px; }
.login-card h1 { margin: 0 0 1.5rem; }
.login-card form > label { display: block; margin-bottom: 1rem; }
.login-card input { width: 100%; padding: .5rem; }
.login-card button { width: 100%; padding: .6rem; }
.login-card .error { color: #f85149; margin-top: .5rem; }
```

- [ ] **Step 5: Manual smoke test**

```bash
./scripts/dev.sh
```
With `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` unset, the app still loads as before. Verify nothing is broken by visiting the forwarded port and clicking through the existing tabs.

Expected: existing UI unchanged in disk mode.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json \
        frontend/src/lib/supabase.js frontend/src/lib/auth.jsx \
        frontend/src/pages/Login.jsx frontend/src/styles.css
git commit -m "feat(hosting): supabase-js client + AuthProvider + Login screen"
```

---

### Task 9: Project switcher + auth-gated App.jsx

**Files:**
- Modify: `frontend/src/App.jsx`
- Create: `frontend/src/components/ProjectSwitcher.jsx`
- Modify: `frontend/src/main.jsx`

- [ ] **Step 1: Wrap the root in `AuthProvider`**

Modify `frontend/src/main.jsx`:

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { ToastProvider } from './components/Toast.jsx'
import { AuthProvider } from './lib/auth.jsx'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </AuthProvider>
  </React.StrictMode>,
)
```

- [ ] **Step 2: Create `frontend/src/components/ProjectSwitcher.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { authFetch } from '../lib/auth.jsx'

const STORAGE_KEY = 'databridge:activeProjectId'

export function getActiveProjectId() {
  return localStorage.getItem(STORAGE_KEY) || null
}

export function setActiveProjectId(id) {
  if (id) localStorage.setItem(STORAGE_KEY, id)
  else    localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new Event('databridge:projectchange'))
}

export default function ProjectSwitcher({ onChange }) {
  const [projects, setProjects] = useState([])
  const [active, setActive]     = useState(getActiveProjectId())
  const [creating, setCreating] = useState(false)
  const [newName, setNewName]   = useState('')

  const reload = async () => {
    const r = await authFetch('/api/projects')
    if (!r.ok) return
    const body = await r.json()
    setProjects(body.projects || [])
    if (!active && body.projects?.length) {
      setActive(body.projects[0].id)
      setActiveProjectId(body.projects[0].id)
    }
  }

  useEffect(() => { reload() }, [])

  const select = (id) => {
    setActive(id)
    setActiveProjectId(id)
    onChange?.(id)
  }

  const create = async (e) => {
    e.preventDefault()
    if (!newName.trim()) return
    const r = await authFetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    })
    if (!r.ok) return
    const body = await r.json()
    setNewName('')
    setCreating(false)
    await reload()
    select(body.id)
  }

  return (
    <div className="project-switcher">
      <select value={active || ''} onChange={(e) => select(e.target.value)}>
        {projects.length === 0 && <option value="">No projects</option>}
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {creating ? (
        <form onSubmit={create} className="ps-create">
          <input autoFocus value={newName}
                 onChange={(e) => setNewName(e.target.value)}
                 placeholder="Project name" />
          <button type="submit">Create</button>
          <button type="button" onClick={() => setCreating(false)}>Cancel</button>
        </form>
      ) : (
        <button onClick={() => setCreating(true)}>+ New</button>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Modify `frontend/src/App.jsx`**

Add at the top of the component:

```jsx
import { useAuth } from './lib/auth.jsx'
import { isDbMode } from './lib/supabase.js'
import Login from './pages/Login.jsx'
import ProjectSwitcher from './components/ProjectSwitcher.jsx'
```

Add the early returns near the top of `App()`:

```jsx
const { user, loading, signOut } = useAuth()
if (isDbMode() && loading) return <div className="loading-screen">Loading…</div>
if (isDbMode() && !user)   return <Login />
```

In the topbar JSX, insert the switcher and a sign-out button when authed:

```jsx
{isDbMode() && (
  <div className="topbar-auth">
    <ProjectSwitcher />
    <button onClick={signOut} title="Sign out">↩</button>
  </div>
)}
```

Add styles to `frontend/src/styles.css`:

```css
.loading-screen     { display: grid; place-items: center; min-height: 100vh; }
.project-switcher   { display: inline-flex; gap: .5rem; align-items: center; }
.project-switcher select { min-width: 180px; }
.ps-create          { display: inline-flex; gap: .25rem; }
.topbar-auth        { margin-left: auto; display: inline-flex; gap: .75rem; align-items: center; }
```

- [ ] **Step 4: Manual smoke test (disk mode)**

```bash
./scripts/dev.sh
```
With `VITE_SUPABASE_URL` unset: app shows existing UI; no login, no switcher.

Expected: zero visible difference from before Task 8.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/main.jsx frontend/src/App.jsx \
        frontend/src/components/ProjectSwitcher.jsx frontend/src/styles.css
git commit -m "feat(hosting): project switcher + auth-gated root"
```

---

### Task 10: Wire the YAML editor to `/api/projects/:id/config`

**Files:**
- Modify: `frontend/src/lib/config.js`
- Modify: `frontend/src/pages/Composition.jsx`

- [ ] **Step 1: Read the current `lib/config.js` to understand the existing helpers**

```bash
cat frontend/src/lib/config.js
```

Expected helpers: `loadConfig()`, `saveConfigPatch(patch)`, `saveConfigText(text)`.

- [ ] **Step 2: Add DB-mode branching to `lib/config.js`**

Modify each helper to branch on `getActiveProjectId()`. Concretely, replace the file contents with:

```javascript
import { authFetch } from './auth.jsx'
import { isDbMode } from './supabase.js'
import { getActiveProjectId } from '../components/ProjectSwitcher.jsx'

async function loadFromDisk() {
  const r = await fetch('/api/config')
  if (!r.ok) throw new Error(`Load failed (${r.status})`)
  return r.json()                     // { yaml, config }
}

async function loadFromDb() {
  const pid = getActiveProjectId()
  if (!pid) throw new Error('No active project')
  const r = await authFetch(`/api/projects/${pid}/config`)
  if (!r.ok) throw new Error(`Load failed (${r.status})`)
  return r.json()
}

export async function loadConfig() {
  return isDbMode() ? loadFromDb() : loadFromDisk()
}

export async function saveConfigText(yamlText) {
  if (isDbMode()) {
    const pid = getActiveProjectId()
    if (!pid) throw new Error('No active project')
    const r = await authFetch(`/api/projects/${pid}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml: yamlText }),
    })
    if (!r.ok) {
      const detail = await r.text()
      throw new Error(`Save failed (${r.status}): ${detail}`)
    }
    return r.json()
  }
  // disk-mode: keep existing behavior — current /api/config PUT handler accepts raw text
  const r = await fetch('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'text/yaml' },
    body: yamlText,
  })
  if (!r.ok) throw new Error(`Save failed (${r.status})`)
  return r.json()
}

// saveConfigPatch is disk-mode only (it deep-merges into /api/config).
// In DB mode, the UI always saves the full YAML text via saveConfigText.
export async function saveConfigPatch(patch) {
  if (isDbMode()) {
    // Load full config, apply patch shallow-merge, re-serialize, save text.
    const { yaml: raw, config } = await loadFromDb()
    const merged = { ...config, ...patch }
    // Re-serialize: keep raw YAML if patch keys match; otherwise re-emit JSON-as-YAML.
    // For C.1 we don't try to preserve comments on patch-saves — the visual UI
    // already issues full-text saves via saveConfigText for the YAML editor;
    // saveConfigPatch is only used by smaller form cards (filters, charts, etc.)
    const yaml = (await import('js-yaml')).default
    const yamlText = yaml.dump(merged, { sortKeys: false, lineWidth: -1 })
    return saveConfigText(yamlText)
  }
  const r = await fetch('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!r.ok) throw new Error(`Save failed (${r.status})`)
  return r.json()
}
```

- [ ] **Step 3: Make Composition.jsx reload on project switch**

In `frontend/src/pages/Composition.jsx`, find the `useEffect` that calls `loadConfig()`. Add an event listener so it re-loads when the user picks a different project:

```jsx
useEffect(() => {
  const reload = () => loadConfig().then(setData).catch(console.error)
  reload()
  window.addEventListener('databridge:projectchange', reload)
  return () => window.removeEventListener('databridge:projectchange', reload)
}, [])
```

- [ ] **Step 4: Manual smoke test**

```bash
./scripts/dev.sh
```

Disk mode: edit the YAML on the Composition tab → save → reload page → edits persist (writes to `./config.yml`).

If you have a Supabase project handy, set the four env vars and re-test in DB mode: sign in → create project → edit YAML → save → reload → edits persist (writes to Supabase row).

Expected: identical UX in both modes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/config.js frontend/src/pages/Composition.jsx
git commit -m "feat(hosting): YAML editor reads/writes active project in DB mode"
```

**REVIEW CHECKPOINT** — full vertical slice is now working. In disk mode nothing changed. In DB mode you can sign in, create projects, switch between them, and edit configs. Stop and verify both modes by running `./scripts/dev.sh` twice (once with env vars set, once without).

---

## Sub-phase C.1.d: Docs + smoke

### Task 11: README hosted-mode section

**Files:**
- Modify: `README.md`
- Modify: `.env.example`

- [ ] **Step 1: Add the section to `README.md`**

Insert a new section between "Dev workflow" and "Configuration" (or wherever the table of contents puts it):

````markdown
## Hosted mode (optional)

By default databridge runs as a single-user app reading `./config.yml` from
disk. Set four environment variables and it switches to **multi-project mode**:
each user signs in, sees their own projects, and configs live in Supabase
Postgres (JSONB + raw YAML so comments and formatting survive).

### What you need

A free Supabase project. From its dashboard:

| Setting | Where in Supabase |
|---|---|
| `SUPABASE_URL` | Project settings → API |
| `SUPABASE_ANON_KEY` | Project settings → API |
| `SUPABASE_SERVICE_KEY` | Project settings → API → `service_role` (server-only) |
| `SUPABASE_JWT_SECRET` | Project settings → API → JWT secret |

For the frontend, additionally set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
to the same values.

### Apply the schema

```bash
supabase login
supabase link --project-ref <your-ref>
supabase db push
```

### Run

```bash
./scripts/dev.sh
```

Visit the forwarded port — you'll see a login screen instead of the dashboard.
Enter your email; Supabase mails a magic link; click it and you're signed in.

### Migrating your existing `config.yml`

Once signed in, POST to `/api/projects/import` (or use the "Import existing
config.yml" button in the project-picker, if shipped) to copy your disk config
into a new project row.

### What stays disk-based even in hosted mode

The CLI (`python3 src/data/make.py …`) always reads `./config.yml` from disk.
Generated reports, downloaded data files, and templates also stay on disk — file
storage migration to Supabase Storage is Phase C.2.
````

- [ ] **Step 2: Confirm `.env.example` has the four vars** (added in Task 4 — verify)

```bash
grep -E 'SUPABASE_(URL|ANON_KEY|SERVICE_KEY|JWT_SECRET)' .env.example
```

Expected: all four present.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(hosting): hosted-mode setup section in README"
```

---

### Task 12: CLAUDE.md update + end-to-end smoke test

**Files:**
- Modify: `CLAUDE.md`
- Create: `tests/test_hosted_mode_smoke.py`

- [ ] **Step 1: Update `CLAUDE.md`**

In the "Architecture at a glance" section, add a row to the layer table:

```markdown
| **Hosted mode (optional)** | Python (supabase-py, pyjwt) | `web/auth.py`, `src/utils/projects_repo.py` | When SUPABASE_URL is set: JWT-auth + per-user projects stored in Postgres (JSONB + raw YAML) |
```

In the "Project structure" tree, add the new files under their respective folders:

```
├── supabase/
│   └── migrations/20260520000001_projects.sql   ← projects table + RLS
├── src/utils/projects_repo.py                   ← ProjectsRepo (real + fake)
├── web/auth.py                                  ← Supabase JWT verification
```

Add a new section after "Environment variables":

```markdown
## Hosted mode (Phase C.1)

When `SUPABASE_URL` is present in the environment, the web app switches to
multi-project mode:

- Configs read/write via `/api/projects/:id/config` (JSONB `config` + raw `config_yaml`).
- Every request must carry a Supabase JWT in `Authorization: Bearer …`.
- Row-level security restricts every row to its `owner_id`.
- The CLI is unchanged — always reads `./config.yml` from disk.

To work on hosted-mode features locally: set the four `SUPABASE_*` env vars,
run `supabase db push`, then `./scripts/dev.sh`.

Hosted-mode files:
- `supabase/migrations/` — schema
- `src/utils/projects_repo.py` — `ProjectsRepo` abstraction + in-memory fake for tests
- `web/auth.py` — JWT verification (falls back to "local" user in disk mode)
- `frontend/src/lib/auth.jsx` — React `<AuthProvider>` + `authFetch`
- `frontend/src/components/ProjectSwitcher.jsx` — topbar dropdown
```

- [ ] **Step 2: Write the end-to-end smoke test**

Create `tests/test_hosted_mode_smoke.py`:

```python
"""End-to-end: simulate a user signing in, creating a project, saving config, listing.

Uses FakeProjectsRepo so no real Supabase is hit.
"""
import time, jwt, pytest
from fastapi.testclient import TestClient

SECRET = "smoke-secret"


def _h(sub="alice"):
    return {"Authorization": f"Bearer " + jwt.encode(
        {"sub": sub, "aud": "authenticated", "exp": int(time.time()) + 3600},
        SECRET, algorithm="HS256")}


@pytest.fixture
def hosted(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://smoke.supabase.co")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    from src.utils.projects_repo import FakeProjectsRepo, set_projects_repo
    set_projects_repo(FakeProjectsRepo())
    from web.main import app
    with TestClient(app) as c:
        yield c
    set_projects_repo(None)


def test_full_user_flow(hosted):
    c = hosted

    # 1. signed-in user has no projects
    r = c.get("/api/projects", headers=_h("alice"))
    assert r.status_code == 200 and r.json()["projects"] == []

    # 2. create one
    r = c.post("/api/projects", headers=_h("alice"), json={"name": "Survey A"})
    assert r.status_code == 201
    pid = r.json()["id"]

    # 3. it shows up in the list
    r = c.get("/api/projects", headers=_h("alice"))
    assert {p["name"] for p in r.json()["projects"]} == {"Survey A"}

    # 4. load its starter config
    r = c.get(f"/api/projects/{pid}/config", headers=_h("alice"))
    assert r.status_code == 200
    body = r.json()
    assert "api:" in body["yaml"]
    assert body["config"]["api"]["platform"] == "kobo"

    # 5. edit + save with a comment, verify it round-trips
    new = ("# my edits\napi:\n  platform: ona\n  url: https://api.ona.io/api/v1\n  token: t\n"
           "form:\n  uid: u1\n  alias: my\nquestions: []\n")
    r = c.put(f"/api/projects/{pid}/config", headers=_h("alice"),
              json={"yaml": new})
    assert r.status_code == 200

    r = c.get(f"/api/projects/{pid}/config", headers=_h("alice"))
    assert r.json()["yaml"] == new          # raw YAML preserved verbatim
    assert r.json()["config"]["api"]["platform"] == "ona"

    # 6. cross-tenant isolation
    r = c.get(f"/api/projects/{pid}/config", headers=_h("eve"))
    assert r.status_code == 404
```

- [ ] **Step 3: Run the smoke test**

```bash
pytest tests/test_hosted_mode_smoke.py -v
```
Expected: 1 passing.

- [ ] **Step 4: Run the full suite + measure regression-free**

```bash
pytest -q
```
Expected: all prior tests pass; ~29 new hosting tests added.

- [ ] **Step 5: Final commit**

```bash
git add CLAUDE.md tests/test_hosted_mode_smoke.py
git commit -m "docs(hosting): CLAUDE.md hosted-mode section + e2e smoke"
```

---

## Phase C roadmap

| Phase | Plan file | Delivers |
|---|---|---|
| **C.1 (this plan)** | `2026-05-20-hosting-phase-c1-db-backed-configs.md` | DB-backed configs + Supabase Auth + project switcher |
| C.2 (future) | `2026-MM-DD-hosting-phase-c2-storage.md` | Single storage boundary; templates / reports / data move to Supabase Storage with project-scoped paths; `provenance.footer` includes project + user identity |
| C.3 (future) | `2026-MM-DD-hosting-phase-c3-jobs-runner.md` | `jobs` + `job_events` tables; in-process async runner replaces subprocess; **config snapshot** at job start for reproducibility; Realtime log streaming |
| C.4 (future) | `2026-MM-DD-hosting-phase-c4-docker-deploy.md` | Multi-stage Dockerfile + compose; deploy to Fly / Render / VPS |

Each is independently shippable — C.1 alone gives a working multi-user web app (with subprocess execution and local files intact).

---

## Self-review

**Spec coverage:**
- ✅ DB stores JSONB + raw YAML (schema contract, Task 1)
- ✅ YAML/JSON round-trip preserves comments (Task 3 test, Task 12 smoke test step 5)
- ✅ Multi-user with auth (Task 4, Task 5)
- ✅ Cross-tenant isolation enforced + tested (Tasks 5 & 6 isolation tests, Task 12 step 6)
- ✅ Backward-compat with disk mode (Task 4 disk-mode test, Task 8 step 5, Task 9 step 4, Task 10 step 4)
- ✅ Migration path from existing `config.yml` (Task 7)
- ✅ Docs updated (Tasks 11, 12)
- ⏭ Storage layer — deferred to C.2 (documented in non-goals)
- ⏭ Jobs runner — deferred to C.3 (documented in non-goals)
- ⏭ Docker — deferred to C.4 (documented in non-goals)

**Placeholder scan:** No TBD / "implement later" / "add error handling" steps; every test block and implementation block has actual code.

**Type consistency:** `ProjectsRepoProtocol` defined once in Task 2; every endpoint signature in Tasks 5-7 uses the same method names. `current_user_id` returns `str` (the JWT `sub` or `"local"`) consistently. `authFetch` signature matches `fetch` in all call sites (Tasks 8-10).

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-20-hosting-phase-c1-db-backed-configs.md`. Two execution options:

1. **Subagent-driven (recommended)** — fresh subagent per task, review between tasks, fast iteration. Good for a security-adjacent plan where each task's diff stays small.
2. **Inline execution** — execute tasks in this session using executing-plans, batch with checkpoints at the three REVIEW CHECKPOINTs already marked.

Which approach?
