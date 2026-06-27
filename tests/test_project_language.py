"""PLANG-1 — Project language is set once at creation and drives the AI output
language (backend + config mirroring).

Tests are derived strictly from the card's Acceptance criteria:
  - language accepted at creation, stored in project.meta.language
  - language immutable after creation (PATCH does not change it; update_project preserves)
  - materialize_config sets ai.language from project.meta.language, overriding stale value
  - legacy project (no meta.language) -> existing ai.language, else "English"
  - per-project isolation: one project's language never leaks into another's config
"""
import uuid

import pytest
import yaml
from fastapi.testclient import TestClient

from web.db import session as dbs
from web.db import provision, repository as repo, bridge


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'plang.db'}")
    dbs.reset_engine()
    dbs.init_schema()
    s = dbs.SessionLocal()
    yield s
    s.close()
    dbs.reset_engine()


@pytest.fixture(autouse=True)
def _isolated_base(tmp_path, monkeypatch):
    """Activating a project pulls workspace into BASE_DIR; redirect to temp."""
    import web.main as wm
    monkeypatch.setattr(wm, "BASE_DIR", tmp_path)
    for sub in ("data/processed", "reports", "templates"):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)
    return tmp_path


def _client():
    from web.main import app
    return TestClient(app)


# ---------------------------------------------------------------------------
# AC 1: language accepted at creation, stored in project.meta.language
# ---------------------------------------------------------------------------
def test_create_persists_language(db):
    u = provision.ensure_user(db, {"sub": "s1", "email": "a@x.io", "name": "A"})
    p = repo.create_project(db, user=u, name="Demo", meta={"language": "French"})
    assert p.meta.get("language") == "French"


# ---------------------------------------------------------------------------
# AC 2: language immutable after creation
# ---------------------------------------------------------------------------
def test_language_immutable_on_patch():
    with _client() as c:
        pid = c.post("/api/projects", json={"name": "Imm", "language": "French"}).json()["id"]
        # attempt to change the language post-creation
        c.patch(f"/api/projects/{pid}", json={"language": "Spanish"})
        proj = [p for p in c.get("/api/projects").json()["projects"] if p["id"] == pid][0]
        assert proj["language"] == "French"


def test_update_project_preserves_existing_language(db):
    u = provision.ensure_user(db, {"sub": "s2", "email": "b@x.io", "name": "B"})
    p = repo.create_project(db, user=u, name="Demo", meta={"language": "French"})
    # update_project called with a meta that tries to overwrite language
    repo.update_project(db, p, meta={"language": "Spanish", "description": "d"})
    db.refresh(p)
    assert p.meta.get("language") == "French"


# ---------------------------------------------------------------------------
# AC 3: materialize_config injects project language, overriding stale ai.language
# ---------------------------------------------------------------------------
def test_materialize_injects_project_language(tmp_path, db):
    u = provision.ensure_user(db, {"sub": "s3", "email": "c@x.io", "name": "C"})
    cfg = {"api": {}, "form": {}, "ai": {"provider": "openai", "language": "English"}}
    p = repo.create_project(db, user=u, name="Demo", config=cfg, meta={"language": "French"})
    out = tmp_path / "config.yml"
    bridge.materialize_config(p, path=out)
    materialized = yaml.safe_load(out.read_text())
    assert materialized["ai"]["language"] == "French"


# ---------------------------------------------------------------------------
# AC 4: legacy fallback — no meta.language -> existing ai.language, else "English"
# ---------------------------------------------------------------------------
def test_legacy_default(tmp_path, db):
    """No meta.language + no ai.language -> deterministic "English" default."""
    u = provision.ensure_user(db, {"sub": "s5", "email": "e@x.io", "name": "E"})
    cfg = {"api": {}, "form": {}}  # no ai section, no meta.language
    p = repo.create_project(db, user=u, name="Legacy2", config=cfg, meta={})
    out = tmp_path / "config.yml"
    bridge.materialize_config(p, path=out)
    materialized = yaml.safe_load(out.read_text())
    assert materialized.get("ai", {}).get("language") == "English"


def test_legacy_default_keeps_existing_ai_language(tmp_path, db):
    u = provision.ensure_user(db, {"sub": "s4", "email": "d@x.io", "name": "D"})
    cfg = {"api": {}, "form": {}, "ai": {"provider": "openai", "language": "Portuguese"}}
    p = repo.create_project(db, user=u, name="Legacy", config=cfg, meta={})
    out = tmp_path / "config.yml"
    bridge.materialize_config(p, path=out)
    materialized = yaml.safe_load(out.read_text())
    assert materialized["ai"]["language"] == "Portuguese"


# ---------------------------------------------------------------------------
# AC 5: per-project isolation
# ---------------------------------------------------------------------------
def test_per_project_isolation(tmp_path, db):
    u = provision.ensure_user(db, {"sub": "s6", "email": "f@x.io", "name": "F"})
    p_fr = repo.create_project(db, user=u, name="FR",
                               config={"api": {}, "form": {}, "ai": {"language": "X"}},
                               meta={"language": "French"})
    p_es = repo.create_project(db, user=u, name="ES",
                               config={"api": {}, "form": {}, "ai": {"language": "Y"}},
                               meta={"language": "Spanish"})
    out_fr = tmp_path / "fr.yml"
    out_es = tmp_path / "es.yml"
    bridge.materialize_config(p_fr, path=out_fr)
    bridge.materialize_config(p_es, path=out_es)
    fr = yaml.safe_load(out_fr.read_text())
    es = yaml.safe_load(out_es.read_text())
    assert fr["ai"]["language"] == "French"
    assert es["ai"]["language"] == "Spanish"
