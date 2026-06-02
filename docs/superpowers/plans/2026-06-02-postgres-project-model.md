# Postgres Project Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a Postgres-backed users→orgs→projects data model (SQLAlchemy + Alembic), store each project's config as `jsonb` (source of truth), auto-provision users/orgs from Zitadel identity, and make the web backend serve the active project's config — while the existing file-based CLI keeps working via a `config.yml` mirror kept in sync on save/activate/run.

**Architecture:** A new `web/db/` package owns models, a lazy engine/session, a membership-scoped repository, provisioning, a config↔`config.yml` mirror bridge, and bootstrap (migrations + legacy import). `web/main.py` rewires `/api/config` to the active project and adds project/org endpoints; a FastAPI lifespan runs migrations + bootstrap. Because the existing 30+ endpoints read `config.yml` from disk, that file is retained as a **materialized mirror of the active project** (DB is durable source of truth) — re-written whenever config is saved, a project is activated, or a run starts (under the existing single-flight lock). This is the documented interim until Slice 3's per-job hydration.

**Tech Stack:** SQLAlchemy 2.0 (installed), Alembic, psycopg2 (Postgres) / sqlite (tests), FastAPI, React.

Spec: [docs/superpowers/specs/2026-06-02-postgres-project-model-design.md](../specs/2026-06-02-postgres-project-model-design.md)

---

## File Structure

- **Create** `web/db/__init__.py` — package marker.
- **Create** `web/db/models.py` — `Base`, `User`, `Org`, `Membership`, `Project` (UUID PKs via SQLAlchemy `Uuid`).
- **Create** `web/db/session.py` — lazy `get_engine()`/`SessionLocal` from `DATABASE_URL`, `get_db()` dependency, `init_schema()`, `reset_engine()`.
- **Create** `web/db/repository.py` — membership-scoped CRUD (no FastAPI imports).
- **Create** `web/db/provision.py` — `ensure_user(db, claims)`, `ensure_dev_user(db)`.
- **Create** `web/db/bridge.py` — `materialize_config(project, path)`, `mirror_active(db, user)`.
- **Create** `web/db/bootstrap.py` — `run_migrations()`, `import_legacy_config(db)`, `init_db()`.
- **Create** `alembic.ini`, `migrations/env.py`, `migrations/script.py.mako`, `migrations/versions/<rev>_initial.py`.
- **Modify** `web/main.py` — lifespan; rewrite `get_config`/`save_config`; project/org endpoints; bridge at run-time.
- **Modify** `web/auth.py` — call `ensure_user` in `/auth/callback`.
- **Modify** `requirements.txt`, `.env.example`, `tests/conftest.py`.
- **Modify** `frontend/src/App.jsx`, **Create** `frontend/src/lib/projects.js` — real project switcher.
- **Create** `tests/test_db_models.py`, `tests/test_repository.py`, `tests/test_provision.py`, `tests/test_bridge.py`, `tests/test_projects_api.py`, `tests/test_config_db_api.py`.

**Naming contract (used across tasks):** Models `User/Org/Membership/Project`; `User.zitadel_sub`, `User.active_project_id`; `Project.config` (dict), `Project.config_version` (int). Repository: `get_user_by_sub`, `upsert_user`, `create_org`, `add_membership`, `list_projects_for_user`, `get_project_for_user`, `create_project`, `set_active_project`, `update_project_config`. Provision: `ensure_user`, `ensure_dev_user`. Bridge: `materialize_config`, `mirror_active`. Session: `get_engine`, `SessionLocal`, `get_db`, `init_schema`, `reset_engine`.

---

## Task 1: Dependencies and env

**Files:** Modify `requirements.txt`, `.env.example`

- [ ] **Step 1: Uncomment/add deps**

In `requirements.txt`, change the commented DB block so these are active (uncomment `sqlalchemy` and `psycopg2-binary`, add `alembic`):

```
sqlalchemy>=2.0.0
psycopg2-binary>=2.9.0
alembic>=1.13.0
```

(Leave `pymysql`/`supabase` commented as-is.)

- [ ] **Step 2: Install**

Run: `pip install -r requirements.txt`
Expected: installs `alembic` (sqlalchemy already present); no errors.

- [ ] **Step 3: Add `DATABASE_URL` to `.env.example`**

After the `APP_BASE_URL=...` line, add:

```
# App database (Postgres). Required. Example local Postgres:
#   docker run --rm -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=databridge -p 5432:5432 postgres:16
DATABASE_URL=postgresql+psycopg2://postgres:dev@localhost:5432/databridge
```

- [ ] **Step 4: Commit**

```bash
git add requirements.txt .env.example
git commit -m "chore(db): add SQLAlchemy/psycopg2/alembic deps and DATABASE_URL"
```

---

## Task 2: ORM models

**Files:** Create `web/db/__init__.py`, `web/db/models.py`; Test `tests/test_db_models.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_db_models.py`:

```python
from sqlalchemy import create_engine, inspect
from web.db.models import Base, User, Org, Membership, Project


def test_metadata_creates_all_tables_on_sqlite():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    names = set(inspect(engine).get_table_names())
    assert {"users", "orgs", "memberships", "projects"} <= names


def test_project_has_config_and_version_columns():
    cols = {c.name for c in Project.__table__.columns}
    assert {"id", "org_id", "name", "slug", "config", "config_version"} <= cols


def test_user_has_sub_and_active_project():
    cols = {c.name for c in User.__table__.columns}
    assert {"id", "zitadel_sub", "email", "name", "active_project_id"} <= cols
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_db_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'web.db'`.

- [ ] **Step 3: Implement**

Create `web/db/__init__.py` (empty).

Create `web/db/models.py`:

```python
"""SQLAlchemy ORM models for the multi-tenant app state (users/orgs/projects)."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import (JSON, Integer, String, DateTime, ForeignKey,
                        UniqueConstraint, Uuid)
from sqlalchemy.orm import DeclarativeBase, mapped_column, Mapped, relationship


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    zitadel_sub: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(320), default="")
    name: Mapped[str] = mapped_column(String(255), default="")
    active_project_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("projects.id", use_alter=True, name="fk_user_active_project"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Org(Base):
    __tablename__ = "orgs"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("user_id", "org_id", name="uq_membership_user_org"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False, index=True)
    org_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("orgs.id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="member")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("org_id", "slug", name="uq_project_org_slug"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("orgs.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False)
    config: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    config_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_db_models.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add web/db/__init__.py web/db/models.py tests/test_db_models.py
git commit -m "feat(db): users/orgs/memberships/projects ORM models"
```

---

## Task 3: Engine, session, schema helpers

**Files:** Create `web/db/session.py`; Test `tests/test_session.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_session.py`:

```python
import os
from web.db import session as dbs
from web.db.models import User


def test_engine_and_init_schema_roundtrip(tmp_path, monkeypatch):
    db_file = tmp_path / "t.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_file}")
    dbs.reset_engine()
    dbs.init_schema()
    with dbs.SessionLocal() as s:
        s.add(User(zitadel_sub="abc", email="a@b.io", name="A"))
        s.commit()
        got = s.query(User).filter_by(zitadel_sub="abc").one()
        assert got.email == "a@b.io"
    dbs.reset_engine()


def test_get_db_yields_and_closes(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'u.db'}")
    dbs.reset_engine()
    dbs.init_schema()
    gen = dbs.get_db()
    db = next(gen)
    try:
        assert db.query(User).count() == 0
    finally:
        gen.close()
    dbs.reset_engine()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_session.py -v`
Expected: FAIL — `AttributeError: module 'web.db.session' has no attribute 'reset_engine'`.

- [ ] **Step 3: Implement**

Create `web/db/session.py`:

```python
"""Lazy SQLAlchemy engine + session, configured from DATABASE_URL at first use."""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from web.db.models import Base

_engine = None
_SessionLocal = None


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set. Point it at Postgres (or sqlite for tests).")
    return url


def get_engine():
    global _engine, _SessionLocal
    if _engine is None:
        url = _database_url()
        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        _engine = create_engine(url, future=True, connect_args=connect_args)
        _SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False, class_=Session)
    return _engine


def reset_engine() -> None:
    """Dispose the engine so the next call re-reads DATABASE_URL (used by tests)."""
    global _engine, _SessionLocal
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionLocal = None


def SessionLocal() -> Session:
    get_engine()
    return _SessionLocal()


def init_schema() -> None:
    """Create all tables directly (used by tests and as a fallback). Idempotent."""
    Base.metadata.create_all(get_engine())


def get_db():
    """FastAPI dependency: yield a session, always close it."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_session.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add web/db/session.py tests/test_session.py
git commit -m "feat(db): lazy engine/session + schema helpers"
```

---

## Task 4: Repository (membership-scoped CRUD)

**Files:** Create `web/db/repository.py`; Test `tests/test_repository.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_repository.py`:

```python
import pytest
from web.db import session as dbs
from web.db import repository as repo


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'r.db'}")
    dbs.reset_engine(); dbs.init_schema()
    s = dbs.SessionLocal()
    yield s
    s.close(); dbs.reset_engine()


def _user_with_org(db, sub, email):
    u = repo.upsert_user(db, sub=sub, email=email, name=email)
    org = repo.create_org(db, name=f"{email} org", slug=email.split("@")[0], owner=u)
    repo.add_membership(db, user=u, org=org, role="owner")
    return u, org


def test_upsert_user_is_idempotent(db):
    u1 = repo.upsert_user(db, sub="s1", email="x@y.io", name="X")
    u2 = repo.upsert_user(db, sub="s1", email="x2@y.io", name="X2")
    assert u1.id == u2.id
    assert u2.email == "x2@y.io"            # updated on re-login
    assert db.query(repo.User).count() == 1


def test_create_and_list_projects_scoped_to_membership(db):
    ua, orga = _user_with_org(db, "sa", "a@y.io")
    ub, orgb = _user_with_org(db, "sb", "b@y.io")
    pa = repo.create_project(db, user=ua, name="A proj", org_id=orga.id)
    repo.create_project(db, user=ub, name="B proj", org_id=orgb.id)
    a_projects = repo.list_projects_for_user(db, ua)
    assert [p.id for p in a_projects] == [pa.id]   # A cannot see B's project


def test_get_project_for_user_denies_non_member(db):
    ua, orga = _user_with_org(db, "sa", "a@y.io")
    ub, orgb = _user_with_org(db, "sb", "b@y.io")
    pb = repo.create_project(db, user=ub, name="B proj", org_id=orgb.id)
    assert repo.get_project_for_user(db, ua, pb.id) is None
    assert repo.get_project_for_user(db, ub, pb.id).id == pb.id


def test_update_project_config_bumps_version_and_checks_stale(db):
    ua, orga = _user_with_org(db, "sa", "a@y.io")
    p = repo.create_project(db, user=ua, name="A", org_id=orga.id)
    assert p.config_version == 1
    repo.update_project_config(db, p, {"api": {}, "form": {}}, expected_version=1)
    assert p.config_version == 2
    with pytest.raises(repo.StaleConfigError):
        repo.update_project_config(db, p, {"x": 1}, expected_version=1)   # stale


def test_set_active_project_member_only(db):
    ua, orga = _user_with_org(db, "sa", "a@y.io")
    ub, orgb = _user_with_org(db, "sb", "b@y.io")
    pb = repo.create_project(db, user=ub, name="B", org_id=orgb.id)
    with pytest.raises(repo.AccessError):
        repo.set_active_project(db, ua, pb.id)       # not a member
    pa = repo.create_project(db, user=ua, name="A", org_id=orga.id)
    repo.set_active_project(db, ua, pa.id)
    assert ua.active_project_id == pa.id
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_repository.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'web.db.repository'`.

- [ ] **Step 3: Implement**

Create `web/db/repository.py`:

```python
"""Membership-scoped CRUD over the app-state models. No FastAPI imports."""
import re
import uuid
from typing import Optional, List

from sqlalchemy import select
from sqlalchemy.orm import Session

from web.db.models import User, Org, Membership, Project


class AccessError(Exception):
    """Raised when a user acts on an org/project they're not a member of."""


class StaleConfigError(Exception):
    """Raised when update_project_config is called with a stale expected_version."""


def _slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s or "item"


def get_user_by_sub(db: Session, sub: str) -> Optional[User]:
    return db.scalar(select(User).where(User.zitadel_sub == sub))


def upsert_user(db: Session, sub: str, email: str, name: str) -> User:
    u = get_user_by_sub(db, sub)
    if u is None:
        u = User(zitadel_sub=sub, email=email or "", name=name or "")
        db.add(u)
    else:
        u.email = email or u.email
        u.name = name or u.name
    db.commit()
    db.refresh(u)
    return u


def _unique_org_slug(db: Session, base: str) -> str:
    slug, n = _slugify(base), 1
    while db.scalar(select(Org).where(Org.slug == slug)) is not None:
        n += 1
        slug = f"{_slugify(base)}-{n}"
    return slug


def create_org(db: Session, name: str, slug: str, owner: User) -> Org:
    org = Org(name=name, slug=_unique_org_slug(db, slug), created_by=owner.id)
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


def add_membership(db: Session, user: User, org: Org, role: str = "member") -> Membership:
    m = Membership(user_id=user.id, org_id=org.id, role=role)
    db.add(m)
    db.commit()
    return m


def _user_org_ids(db: Session, user: User) -> List[uuid.UUID]:
    return list(db.scalars(select(Membership.org_id).where(Membership.user_id == user.id)))


def list_projects_for_user(db: Session, user: User) -> List[Project]:
    org_ids = _user_org_ids(db, user)
    if not org_ids:
        return []
    return list(db.scalars(select(Project).where(Project.org_id.in_(org_ids)).order_by(Project.created_at)))


def get_project_for_user(db: Session, user: User, project_id) -> Optional[Project]:
    p = db.get(Project, project_id)
    if p is None or p.org_id not in _user_org_ids(db, user):
        return None
    return p


def _unique_project_slug(db: Session, org_id, base: str) -> str:
    slug, n = _slugify(base), 1
    while db.scalar(select(Project).where(Project.org_id == org_id, Project.slug == slug)) is not None:
        n += 1
        slug = f"{_slugify(base)}-{n}"
    return slug


def create_project(db: Session, user: User, name: str, org_id=None, config: dict = None) -> Project:
    if org_id is None:
        ids = _user_org_ids(db, user)
        if not ids:
            raise AccessError("user has no org")
        org_id = ids[0]
    elif org_id not in _user_org_ids(db, user):
        raise AccessError("not a member of target org")
    p = Project(org_id=org_id, name=name, slug=_unique_project_slug(db, org_id, name),
                config=config or {}, config_version=1)
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def update_project_config(db: Session, project: Project, config: dict, expected_version: Optional[int] = None) -> Project:
    if expected_version is not None and expected_version != project.config_version:
        raise StaleConfigError(f"expected {expected_version}, have {project.config_version}")
    project.config = config
    project.config_version += 1
    db.commit()
    db.refresh(project)
    return project


def set_active_project(db: Session, user: User, project_id) -> User:
    if get_project_for_user(db, user, project_id) is None:
        raise AccessError("not a member of the project's org")
    user.active_project_id = project_id
    db.commit()
    db.refresh(user)
    return user
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_repository.py -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add web/db/repository.py tests/test_repository.py
git commit -m "feat(db): membership-scoped repository CRUD"
```

---

## Task 5: Provisioning

**Files:** Create `web/db/provision.py`; Test `tests/test_provision.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_provision.py`:

```python
import pytest
from web.db import session as dbs
from web.db import provision, repository as repo


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'p.db'}")
    dbs.reset_engine(); dbs.init_schema()
    s = dbs.SessionLocal()
    yield s
    s.close(); dbs.reset_engine()


def test_ensure_user_creates_user_org_membership(db):
    u = provision.ensure_user(db, {"sub": "s1", "email": "joe@x.io", "name": "Joe"})
    assert u.zitadel_sub == "s1"
    orgs = repo._user_org_ids(db, u)
    assert len(orgs) == 1                      # one personal org
    assert db.query(repo.Membership).filter_by(user_id=u.id, role="owner").count() == 1


def test_ensure_user_idempotent(db):
    provision.ensure_user(db, {"sub": "s1", "email": "joe@x.io", "name": "Joe"})
    provision.ensure_user(db, {"sub": "s1", "email": "joe@x.io", "name": "Joe"})
    assert db.query(repo.User).count() == 1
    assert db.query(repo.Org).count() == 1
    assert db.query(repo.Membership).count() == 1


def test_ensure_dev_user(db):
    u = provision.ensure_dev_user(db)
    assert u.zitadel_sub == "dev-local"
    assert len(repo._user_org_ids(db, u)) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_provision.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'web.db.provision'`.

- [ ] **Step 3: Implement**

Create `web/db/provision.py`:

```python
"""First-login provisioning: upsert user + personal org + owner membership."""
from sqlalchemy.orm import Session

from web.db import repository as repo

DEV_CLAIMS = {"sub": "dev-local", "email": "dev@localhost", "name": "Local Dev"}


def ensure_user(db: Session, claims: dict) -> repo.User:
    """Idempotent: upsert the user; if they have no org, create a personal one."""
    user = repo.upsert_user(db, sub=claims["sub"],
                            email=claims.get("email", ""), name=claims.get("name", ""))
    if not repo._user_org_ids(db, user):
        base = (claims.get("email", "") or claims["sub"]).split("@")[0]
        org = repo.create_org(db, name=f"{base} (personal)", slug=base, owner=user)
        repo.add_membership(db, user=user, org=org, role="owner")
    return user


def ensure_dev_user(db: Session) -> repo.User:
    return ensure_user(db, DEV_CLAIMS)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_provision.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add web/db/provision.py tests/test_provision.py
git commit -m "feat(db): user/org auto-provisioning"
```

---

## Task 6: Config mirror bridge

**Files:** Create `web/db/bridge.py`; Test `tests/test_bridge.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_bridge.py`:

```python
import pytest
import yaml
from web.db import session as dbs
from web.db import provision, repository as repo, bridge


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'b.db'}")
    dbs.reset_engine(); dbs.init_schema()
    s = dbs.SessionLocal()
    yield s
    s.close(); dbs.reset_engine()


def test_materialize_config_writes_yaml(tmp_path, db):
    u = provision.ensure_user(db, {"sub": "s1", "email": "a@x.io", "name": "A"})
    cfg = {"api": {"platform": "kobo"}, "form": {"alias": "demo"}}
    p = repo.create_project(db, user=u, name="Demo", config=cfg)
    out = tmp_path / "config.yml"
    bridge.materialize_config(p, path=out)
    assert yaml.safe_load(out.read_text()) == cfg


def test_mirror_active_uses_active_project(tmp_path, db):
    u = provision.ensure_user(db, {"sub": "s1", "email": "a@x.io", "name": "A"})
    p = repo.create_project(db, user=u, name="Demo", config={"api": {}, "form": {}})
    repo.set_active_project(db, u, p.id)
    out = tmp_path / "config.yml"
    assert bridge.mirror_active(db, u, path=out) is True
    assert out.exists()


def test_mirror_active_no_active_project_returns_false(tmp_path, db):
    u = provision.ensure_user(db, {"sub": "s2", "email": "b@x.io", "name": "B"})
    out = tmp_path / "config.yml"
    assert bridge.mirror_active(db, u, path=out) is False
    assert not out.exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_bridge.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'web.db.bridge'`.

- [ ] **Step 3: Implement**

Create `web/db/bridge.py`:

```python
"""Materialize a project's config (jsonb) to config.yml so the file-based CLI and
the existing config-reading endpoints keep working. Interim until Slice 3 hydration."""
from pathlib import Path
from sqlalchemy.orm import Session

from src.utils.config import write_config, CONFIG_PATH
from web.db import repository as repo
from web.db.models import Project, User


def materialize_config(project: Project, path: Path = CONFIG_PATH) -> None:
    write_config(project.config or {}, Path(path))


def mirror_active(db: Session, user: User, path: Path = CONFIG_PATH) -> bool:
    """Write the user's active project's config to `path`. Returns False if the user
    has no active project (file left untouched)."""
    if user.active_project_id is None:
        return False
    project = repo.get_project_for_user(db, user, user.active_project_id)
    if project is None:
        return False
    materialize_config(project, path)
    return True
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_bridge.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add web/db/bridge.py tests/test_bridge.py
git commit -m "feat(db): config.yml mirror bridge"
```

---

## Task 7: Bootstrap (migrations + legacy import) and Alembic

**Files:** Create `web/db/bootstrap.py`, `alembic.ini`, `migrations/env.py`, `migrations/script.py.mako`, `migrations/versions/0001_initial.py`; Test `tests/test_bootstrap.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_bootstrap.py`:

```python
import pytest
import yaml
from web.db import session as dbs
from web.db import bootstrap, provision, repository as repo


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'boot.db'}")
    dbs.reset_engine(); dbs.init_schema()
    s = dbs.SessionLocal()
    yield s
    s.close(); dbs.reset_engine()


def test_import_legacy_config_idempotent(tmp_path, db):
    u = provision.ensure_dev_user(db)
    cfg_path = tmp_path / "config.yml"
    cfg_path.write_text(yaml.safe_dump({"api": {"platform": "kobo"}, "form": {"alias": "leg"},
                                        "report": {"title": "Legacy Report"}}))
    p1 = bootstrap.import_legacy_config(db, owner=u, config_path=cfg_path)
    p2 = bootstrap.import_legacy_config(db, owner=u, config_path=cfg_path)
    assert p1.id == p2.id                       # idempotent
    assert db.query(repo.Project).count() == 1
    assert u.active_project_id == p1.id          # set active


def test_import_legacy_config_missing_file_returns_none(tmp_path, db):
    u = provision.ensure_dev_user(db)
    assert bootstrap.import_legacy_config(db, owner=u, config_path=tmp_path / "nope.yml") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_bootstrap.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'web.db.bootstrap'`.

- [ ] **Step 3: Implement bootstrap**

Create `web/db/bootstrap.py`:

```python
"""DB bootstrap: run migrations (prod) / create schema (tests), and import the legacy
single config.yml into a project exactly once."""
import logging
import os
from pathlib import Path

import yaml
from sqlalchemy.orm import Session

from src.utils.config import CONFIG_PATH
from web.db import session as dbs
from web.db import repository as repo
from web.db.models import User

log = logging.getLogger("databridge.db.bootstrap")

LEGACY_SLUG = "legacy-import"


def run_migrations() -> None:
    """Upgrade to head via Alembic, unless DATABRIDGE_SKIP_MIGRATIONS=1 (tests/dev sqlite),
    in which case create the schema directly."""
    if os.environ.get("DATABRIDGE_SKIP_MIGRATIONS") == "1":
        dbs.init_schema()
        return
    from alembic.config import Config
    from alembic import command
    root = Path(__file__).resolve().parent.parent.parent
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "migrations"))
    command.upgrade(cfg, "head")


def import_legacy_config(db: Session, owner: User, config_path: Path = CONFIG_PATH):
    """Create a project from the legacy config.yml once (tracked by LEGACY_SLUG in the
    owner's first org). Returns the project, or None if the file is absent."""
    config_path = Path(config_path)
    org_ids = repo._user_org_ids(db, owner)
    if not org_ids:
        return None
    org_id = org_ids[0]
    existing = db.query(repo.Project).filter_by(org_id=org_id, slug=LEGACY_SLUG).one_or_none()
    if existing is not None:
        return existing
    if not config_path.exists():
        return None
    cfg = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    name = (cfg.get("report", {}) or {}).get("title") or (cfg.get("form", {}) or {}).get("alias") or "Imported project"
    p = repo.Project(org_id=org_id, name=name, slug=LEGACY_SLUG, config=cfg, config_version=1)
    db.add(p)
    db.commit()
    db.refresh(p)
    if owner.active_project_id is None:
        owner.active_project_id = p.id
        db.commit()
    return p


def init_db() -> None:
    """Startup entry point: migrate, then ensure the dev user + legacy import when auth
    is disabled (dev). For real auth, provisioning happens at /auth/callback."""
    from web import auth
    from web.db import provision
    run_migrations()
    if not auth.auth_enabled():
        with dbs.SessionLocal() as db:
            dev = provision.ensure_dev_user(db)
            import_legacy_config(db, owner=dev)
```

- [ ] **Step 4: Run the bootstrap test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_bootstrap.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Scaffold Alembic (prod migrations)**

Create `alembic.ini` (minimal):

```ini
[alembic]
script_location = migrations
[loggers]
keys = root
[handlers]
keys = console
[formatters]
keys = generic
[logger_root]
level = WARN
handlers = console
qualname =
[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic
[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
```

Create `migrations/script.py.mako`:

```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
"""
from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}


def upgrade():
    ${upgrades if upgrades else "pass"}


def downgrade():
    ${downgrades if downgrades else "pass"}
```

Create `migrations/env.py`:

```python
import os
from logging.config import fileConfig
from alembic import context
from sqlalchemy import create_engine
from web.db.models import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)
target_metadata = Base.metadata


def run_migrations_online():
    url = os.environ["DATABASE_URL"]
    engine = create_engine(url, future=True)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
```

- [ ] **Step 6: Autogenerate the initial migration against a scratch Postgres/sqlite**

If a local Postgres is available, point `DATABASE_URL` at an empty scratch DB; otherwise use a temp sqlite. Run:

```bash
DATABASE_URL="sqlite:////tmp/alembic_scratch.db" PYTHONPATH=. alembic revision --autogenerate -m "initial" --rev-id 0001
```

Verify a file `migrations/versions/0001_initial.py` is created containing `op.create_table("users"...)`, `"orgs"`, `"memberships"`, `"projects"`. Then verify upgrade/downgrade:

```bash
rm -f /tmp/alembic_up.db
DATABASE_URL="sqlite:////tmp/alembic_up.db" PYTHONPATH=. alembic upgrade head
DATABASE_URL="sqlite:////tmp/alembic_up.db" PYTHONPATH=. alembic downgrade base
```

Expected: both succeed with no errors. (Commit the generated `0001_initial.py` as-is.)

- [ ] **Step 7: Commit**

```bash
git add web/db/bootstrap.py alembic.ini migrations/ tests/test_bootstrap.py
git commit -m "feat(db): bootstrap (migrations + legacy import) and Alembic scaffold"
```

---

## Task 8: Test harness integration (keep the suite green)

**Files:** Modify `tests/conftest.py`

This is the linchpin: existing tests build `TestClient(web.main.app)`. Once `web.main` imports the DB and adds a lifespan, the suite needs a DB. Provide a session-wide SQLite DB + schema + provisioned dev user, and skip Alembic in tests.

- [ ] **Step 1: Add the DB fixture to conftest**

In `tests/conftest.py`, add (after the existing imports):

```python
import os as _os


@pytest.fixture(scope="session", autouse=True)
def _app_database(tmp_path_factory):
    """Session-wide SQLite app DB so the FastAPI app (and its lifespan) work in tests.
    Real Postgres + Alembic are used only outside tests."""
    db_path = tmp_path_factory.mktemp("appdb") / "app.db"
    _os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    _os.environ["DATABRIDGE_SKIP_MIGRATIONS"] = "1"
    from web.db import session as dbs
    dbs.reset_engine()
    dbs.init_schema()
    yield
    dbs.reset_engine()
```

- [ ] **Step 2: Run the full suite (pre-wiring baseline)**

Run: `PYTHONPATH=. pytest tests/ -q`
Expected: PASS — at this point `web/main.py` is unchanged, so this just confirms the fixture and new db tests coexist with the existing suite. Record the passing count.

- [ ] **Step 3: Commit**

```bash
git add tests/conftest.py
git commit -m "test(db): session-wide SQLite app DB fixture"
```

---

## Task 9: Wire startup lifespan + provisioning into the app

**Files:** Modify `web/main.py`, `web/auth.py`; Test `tests/test_startup_db.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_startup_db.py`:

```python
from fastapi.testclient import TestClient


def test_app_startup_provisions_dev_user_and_imports_legacy():
    # auth disabled in tests -> lifespan should ensure the dev user exists.
    from web.main import app
    from web.db import session as dbs, repository as repo
    with TestClient(app):                      # triggers lifespan
        with dbs.SessionLocal() as db:
            assert repo.get_user_by_sub(db, "dev-local") is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_startup_db.py -v`
Expected: FAIL — dev user not provisioned (no lifespan yet).

- [ ] **Step 3: Add the lifespan to `web/main.py`**

At the top imports of `web/main.py`, add:

```python
from contextlib import asynccontextmanager
from web.db import bootstrap as db_bootstrap
```

Replace the `app = FastAPI(title="databridge-cli", docs_url=None, redoc_url=None)` line with a lifespan-bound app:

```python
@asynccontextmanager
async def _lifespan(app):
    db_bootstrap.init_db()
    yield

app = FastAPI(title="databridge-cli", docs_url=None, redoc_url=None, lifespan=_lifespan)
```

(Keep the existing `auth.register_auth(app)` call immediately after.)

- [ ] **Step 4: Provision real users at login**

In `web/auth.py`, in the `/auth/callback` handler, after `claims = await exchange_token(request)` and before building the cookie, add:

```python
        import asyncio
        from web.db import session as _dbs, provision as _prov
        def _do_provision():
            with _dbs.SessionLocal() as db:
                _prov.ensure_user(db, claims)
        await asyncio.to_thread(_do_provision)
```

- [ ] **Step 5: Run the startup test + full suite**

Run: `PYTHONPATH=. pytest tests/test_startup_db.py -v`
Expected: PASS.
Run: `PYTHONPATH=. pytest tests/ -q`
Expected: PASS (full suite green; the lifespan provisions the dev user and imports the local `config.yml` if present).

- [ ] **Step 6: Commit**

```bash
git add web/main.py web/auth.py tests/test_startup_db.py
git commit -m "feat(db): startup lifespan (migrate+bootstrap) and login provisioning"
```

---

## Task 10: Rewrite /api/config to the active project (+ mirror)

**Files:** Modify `web/main.py`; Test `tests/test_config_db_api.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_config_db_api.py`:

```python
import yaml
from fastapi.testclient import TestClient


def _client():
    from web.main import app
    return TestClient(app)


def test_get_config_returns_active_project_yaml():
    with _client() as c:                       # lifespan provisions dev user + legacy import
        r = c.get("/api/config")
        assert r.status_code == 200
        body = r.json()
        # dev user has an active project (legacy import if config.yml present, else empty)
        assert "content" in body and "exists" in body


def test_post_config_persists_to_active_project():
    with _client() as c:
        new_cfg = {"api": {"platform": "kobo", "url": "http://x", "token": "t"},
                   "form": {"uid": "U", "alias": "demo"}, "filters": ["Age > 0"]}
        r = c.post("/api/config", json={"content": yaml.safe_dump(new_cfg)})
        assert r.status_code == 200
        # read back
        got = yaml.safe_load(c.get("/api/config").json()["content"])
        assert got["form"]["alias"] == "demo"
        assert got["filters"] == ["Age > 0"]


def test_post_invalid_yaml_400():
    with _client() as c:
        r = c.post("/api/config", json={"content": "key: : : ["})
        assert r.status_code == 400
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_config_db_api.py -v`
Expected: FAIL — current `get_config`/`save_config` use the file, not the active project (read-back of `alias=demo` won't reflect DB; or the active project content differs).

- [ ] **Step 3: Implement**

In `web/main.py`, add a helper near the top (after `app`/auth wiring):

```python
from fastapi import Depends, Request
from sqlalchemy.orm import Session
from web.db import session as db_session, repository as db_repo, provision as db_provision
from web.db import bridge as db_bridge


def _current_user(request: Request, db: Session):
    claims = getattr(request.state, "user", None) or {}
    sub = claims.get("sub")
    user = db_repo.get_user_by_sub(db, sub) if sub else None
    if user is None and sub:
        user = db_provision.ensure_user(db, claims)
    return user


def _active_project(request: Request, db: Session):
    user = _current_user(request, db)
    if user is None or user.active_project_id is None:
        return user, None
    return user, db_repo.get_project_for_user(db, user, user.active_project_id)
```

Replace the existing `get_config` and `save_config` handlers (lines ~56-74) with DB-backed sync versions:

```python
@app.get("/api/config")
def get_config(request: Request, db: Session = Depends(db_session.get_db)):
    _user, project = _active_project(request, db)
    if project is None:
        return {"content": "", "exists": False}
    content = yaml.safe_dump(project.config or {}, allow_unicode=True,
                             default_flow_style=False, sort_keys=False)
    return {"content": content, "exists": True, "version": project.config_version}


@app.post("/api/config")
def save_config(payload: ConfigPayload, request: Request, db: Session = Depends(db_session.get_db)):
    try:
        parsed = yaml.safe_load(payload.content) or {}
    except yaml.YAMLError as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")
    user, project = _active_project(request, db)
    if project is None:
        raise HTTPException(status_code=400, detail="No active project")
    try:
        db_repo.update_project_config(db, project, parsed, expected_version=getattr(payload, "version", None))
    except db_repo.StaleConfigError:
        raise HTTPException(status_code=409, detail="Config changed since you loaded it; reload and retry.")
    db_bridge.materialize_config(project)           # keep config.yml mirror in sync
    return {"ok": True, "saved_at": datetime.now().isoformat(), "version": project.config_version}
```

Add an optional `version` field to `ConfigPayload` (find `class ConfigPayload(BaseModel):` and extend it):

```python
class ConfigPayload(BaseModel):
    content: str
    version: Optional[int] = None
```

- [ ] **Step 4: Run the config-api test + full suite**

Run: `PYTHONPATH=. pytest tests/test_config_db_api.py -v`
Expected: PASS.
Run: `PYTHONPATH=. pytest tests/ -q`
Expected: PASS. If a pre-existing test asserted file-only `/api/config` behavior, update it to the DB-backed contract (the response now also carries `version`; content reflects the active project). Note any such fix in the commit.

- [ ] **Step 5: Commit**

```bash
git add web/main.py tests/test_config_db_api.py
git commit -m "feat(api): /api/config reads/writes the active project (+config.yml mirror)"
```

---

## Task 11: Project/org endpoints + activate mirror + run-time bridge

**Files:** Modify `web/main.py`; Test `tests/test_projects_api.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_projects_api.py`:

```python
import yaml
from fastapi.testclient import TestClient


def _client():
    from web.main import app
    return TestClient(app)


def test_list_projects_includes_active():
    with _client() as c:
        r = c.get("/api/projects")
        assert r.status_code == 200
        body = r.json()
        assert "projects" in body and "active_id" in body


def test_create_and_activate_project_switches_config():
    with _client() as c:
        r = c.post("/api/projects", json={"name": "Second"})
        assert r.status_code == 200
        pid = r.json()["id"]
        # seed the new project's config then activate it
        c.post("/api/projects/" + pid + "/activate")
        cfg = {"api": {"platform": "kobo", "url": "u", "token": "t"},
               "form": {"uid": "U", "alias": "second"}}
        c.post("/api/config", json={"content": yaml.safe_dump(cfg)})
        # now active config reflects the second project
        got = yaml.safe_load(c.get("/api/config").json()["content"])
        assert got["form"]["alias"] == "second"
        assert c.get("/api/projects").json()["active_id"] == pid


def test_activate_unknown_project_404():
    with _client() as c:
        import uuid
        r = c.post("/api/projects/" + str(uuid.uuid4()) + "/activate")
        assert r.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_projects_api.py -v`
Expected: FAIL — `/api/projects` 404 (routes don't exist).

- [ ] **Step 3: Implement the endpoints**

In `web/main.py`, add:

```python
class NewProjectPayload(BaseModel):
    name: str
    org_id: Optional[str] = None


@app.get("/api/projects")
def list_projects(request: Request, db: Session = Depends(db_session.get_db)):
    user = _current_user(request, db)
    if user is None:
        return {"projects": [], "active_id": None}
    projects = db_repo.list_projects_for_user(db, user)
    return {
        "active_id": str(user.active_project_id) if user.active_project_id else None,
        "projects": [{"id": str(p.id), "name": p.name, "slug": p.slug, "org_id": str(p.org_id)}
                     for p in projects],
    }


@app.post("/api/projects")
def create_project(payload: NewProjectPayload, request: Request, db: Session = Depends(db_session.get_db)):
    user = _current_user(request, db)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    import uuid as _uuid
    org_id = _uuid.UUID(payload.org_id) if payload.org_id else None
    try:
        p = db_repo.create_project(db, user=user, name=payload.name, org_id=org_id)
    except db_repo.AccessError:
        raise HTTPException(status_code=403, detail="Not a member of that org")
    return {"id": str(p.id), "name": p.name, "slug": p.slug}


@app.post("/api/projects/{project_id}/activate")
def activate_project(project_id: str, request: Request, db: Session = Depends(db_session.get_db)):
    import uuid as _uuid
    user = _current_user(request, db)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        db_repo.set_active_project(db, user, _uuid.UUID(project_id))
    except (db_repo.AccessError, ValueError):
        raise HTTPException(status_code=404, detail="Project not found")
    db_bridge.mirror_active(db, user)                # refresh config.yml mirror to new project
    return {"ok": True, "active_id": project_id}
```

- [ ] **Step 4: Add the run-time bridge (mirror before each run)**

The spawned CLI subprocess reads `config.yml`, so before a run we mirror the caller's active
project to that file. Two edits in `web/main.py`'s `run_command`:

(a) Add `request: Request` to the handler signature so we can resolve the caller. Change:
```python
@app.post("/api/run/{command}")
async def run_command(command: str, payload: RunPayload):
```
to:
```python
@app.post("/api/run/{command}")
async def run_command(command: str, payload: RunPayload, request: Request):
```

(b) Immediately AFTER the single-flight reservation line `_running_command = command  # reserve synchronously (atomic: no await before return)`, add:
```python
    with db_session.SessionLocal() as _db:
        _user = _current_user(request, _db)
        if _user is not None:
            db_bridge.mirror_active(_db, _user)
```
This runs inside the single-flight critical section (no `await` between the reservation and
here), so the shared `config.yml` is written under the lock — no contention with a concurrent run.

- [ ] **Step 5: Run the projects-api test + full suite**

Run: `PYTHONPATH=. pytest tests/test_projects_api.py -v`
Expected: PASS.
Run: `PYTHONPATH=. pytest tests/ -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/main.py tests/test_projects_api.py
git commit -m "feat(api): project list/create/activate + run-time config.yml bridge"
```

---

## Task 12: Frontend project switcher

**Files:** Create `frontend/src/lib/projects.js`; Modify `frontend/src/App.jsx`

Verified by `npm run build` (no JS test harness). The hardcoded `PROJECT` becomes a real switcher.

- [ ] **Step 1: Create the projects lib**

Create `frontend/src/lib/projects.js`:

```js
// Project list + active project, backed by /api/projects.
export async function listProjects() {
  try {
    const res = await fetch('/api/projects');
    if (!res.ok) return { projects: [], active_id: null };
    return await res.json();
  } catch {
    return { projects: [], active_id: null };
  }
}

export async function activateProject(id) {
  const res = await fetch(`/api/projects/${id}/activate`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to activate project');
  return res.json();
}

export async function createProject(name) {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('Failed to create project');
  return res.json();
}
```

- [ ] **Step 2: Wire the switcher into App.jsx**

In `frontend/src/App.jsx`, add the import after `import { fetchMe } from './lib/auth.js';`:

```js
import { listProjects, activateProject, createProject } from './lib/projects.js';
```

Inside `App()`, near the other state hooks, add:

```js
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [projMenuOpen, setProjMenuOpen] = useState(false);
  useEffect(() => {
    listProjects().then(({ projects, active_id }) => {
      setProjects(projects); setActiveProjectId(active_id);
    });
  }, []);
  const activeProject = projects.find(p => p.id === activeProjectId) || null;

  const switchProject = async (id) => {
    await activateProject(id);
    setActiveProjectId(id);
    setProjMenuOpen(false);
    window.dispatchEvent(new CustomEvent('databridge:data-changed', { detail: { project: id } }));
  };
  const addProject = async () => {
    const name = window.prompt('New project name?');
    if (!name) return;
    const { id } = await createProject(name);
    const { projects } = await listProjects();
    setProjects(projects);
    await switchProject(id);
  };
```

Replace the static project-switcher `<button>` block (the one rendering `PROJECT.avatar`/`PROJECT.name`/`PROJECT.slug`) with a dropdown driven by real data:

```jsx
          <div style={{ position: 'relative' }}>
            <button className="project-switcher" title="Switch project" type="button"
                    onClick={() => setProjMenuOpen(o => !o)}>
              <span className="project-switcher__avatar">
                {(activeProject?.name || '?').slice(0, 2).toUpperCase()}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
                <span className="project-switcher__name">{activeProject?.name || 'No project'}</span>
                <span className="project-switcher__slug">{activeProject?.slug || ''}</span>
              </span>
              <span className="project-switcher__chev">▾</span>
            </button>
            {projMenuOpen && (
              <div className="project-menu">
                {projects.map(p => (
                  <div key={p.id}
                       className={`project-menu__item ${p.id === activeProjectId ? 'active' : ''}`}
                       onClick={() => switchProject(p.id)}>
                    {p.name}
                  </div>
                ))}
                <div className="project-menu__item project-menu__add" onClick={addProject}>+ New project</div>
              </div>
            )}
          </div>
```

You may remove the now-unused `const PROJECT = ...` line.

- [ ] **Step 3: Add minimal styles**

In `frontend/src/styles.css`, append:

```css
.project-menu {
  position: absolute; top: 110%; right: 0; z-index: 50;
  background: var(--surface, #fff); border: 1px solid var(--border, #e5e7eb);
  border-radius: 8px; box-shadow: 0 6px 24px rgba(0,0,0,.12); min-width: 200px; padding: 4px;
}
.project-menu__item { padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; }
.project-menu__item:hover { background: var(--hover, #f3f4f6); }
.project-menu__item.active { font-weight: 600; }
.project-menu__add { border-top: 1px solid var(--border, #e5e7eb); color: var(--accent, #2563eb); margin-top: 4px; }
```

- [ ] **Step 4: Build**

Run: `cd frontend && npm run build`
Expected: clean build, no errors.

- [ ] **Step 5: Commit**

```bash
cd /workspaces/databridge-cli
git add frontend/src/lib/projects.js frontend/src/App.jsx frontend/src/styles.css
git commit -m "feat(ui): real project switcher backed by /api/projects"
```

---

## Task 13: Docs

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1: Document the DB + project model**

In `CLAUDE.md`, add a short subsection under the architecture area noting: app state (users/orgs/projects) now lives in Postgres via `web/db/`; config is `jsonb` on the project, mirrored to `config.yml` for the CLI; `DATABASE_URL` is required (with the local-Postgres `docker run` one-liner); migrations via Alembic (`alembic upgrade head`), auto-run at startup; tests use SQLite. Keep it to ~10 lines, matching the file's style.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: Postgres project model + DATABASE_URL setup"
```

---

## Self-Review notes

- **Spec coverage:** schema/5 tables (T2) · SQLAlchemy+Alembic (T1,T3,T7) · jsonb config + version (T2,T4,T10) · provisioning personal org (T5,T9) · Postgres-required + DATABASE_URL (T1,T13) · config↔YAML editing contract + 409 (T10) · run-time bridge under single-flight (T11) · project list/create/activate + switcher (T11,T12) · bootstrap legacy import (T7,T9) · membership scoping (T4) · SQLite tests (T8 + all) · session/run metadata explicitly deferred (not implemented — matches spec non-goal). All spec sections map to a task.
- **Mirror refinement:** the spec's "run-time bridge" is implemented as a mirror kept in sync on **save (T10), activate (T11), and run (T11)** so the ~30 existing `config.yml` read-sites in `web/main.py` need no changes — consistent with the spec's "single shared config.yml is process-wide" interim and its risk notes.
- **Test-suite safety:** T8 lands the SQLite app-DB fixture *before* T9 wires the lifespan, so the existing 412 tests keep a working DB; T9/T10/T11 each re-run the full suite.
- **Naming consistency:** repository/provision/bridge/session symbol names match across T3–T11 and the helpers added in `web/main.py` (`_current_user`, `_active_project`).
- **Known residual (documented in spec):** the `config.yml` mirror is process-wide, so concurrent *runs* for different active projects are not supported until Slice 3's per-job hydration; editing is per-user/per-project and safe.
