"""AI-connection verification is persisted per project and re-locks when an AI call fails."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

import web.main as wm
from web.db import session as s, repository as repo
from web.db.models import Project

AI = {"provider": "openai", "model": "gpt-4o", "api_key": "sk-test-key"}


@pytest.fixture
def _isolated_base(tmp_path, monkeypatch):
    monkeypatch.setattr(wm, "BASE_DIR", tmp_path)
    for sub in ("data/processed", "reports", "templates"):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)
    return tmp_path


def _set_project_ai(verified: bool):
    """Put an AI config on the active (dev) project; optionally mark it verified."""
    with s.SessionLocal() as db:
        p = db.scalar(select(Project))
        p.config = {**(p.config or {}), "ai": AI}
        db.commit()
        fp = wm._ai_fingerprint_for(AI)
        repo.set_ai_verified(db, p, fp if verified else None)
        return fp


def test_status_persists_in_db_and_invalidate_endpoint(_isolated_base):
    with TestClient(wm.app) as c:           # lifespan provisions the dev user + project
        _set_project_ai(verified=False)
        assert c.get("/api/ai/status").json() == {"configured": True, "verified": False}

        _set_project_ai(verified=True)       # a successful test would persist this fingerprint
        assert c.get("/api/ai/status").json()["verified"] is True   # read back from the DB

        assert c.post("/api/ai/invalidate").json()["ok"] is True
        assert c.get("/api/ai/status").json()["verified"] is False


def test_changing_ai_config_relocks(_isolated_base):
    with TestClient(wm.app) as c:
        _set_project_ai(verified=True)
        assert c.get("/api/ai/status").json()["verified"] is True
        # Change the saved key → stored fingerprint no longer matches → unverified.
        with s.SessionLocal() as db:
            p = db.scalar(select(Project))
            p.config = {**p.config, "ai": {**AI, "api_key": "sk-different"}}
            db.commit()
        assert c.get("/api/ai/status").json()["verified"] is False


def test_failed_ai_suggest_relocks(_isolated_base, monkeypatch):
    monkeypatch.setattr(wm, "load_config", lambda *a, **k: {"ai": AI, "questions": []})
    import src.reports.ai_pii_suggester as pii_mod

    def _boom(cfg):
        raise RuntimeError("401 invalid api key")
    monkeypatch.setattr(pii_mod, "suggest_pii", _boom)

    with TestClient(wm.app) as c:
        _set_project_ai(verified=True)
        assert c.get("/api/ai/status").json()["verified"] is True
        r = c.post("/api/questions/suggest-pii")
        assert r.status_code == 500                                   # AI call failed
        assert c.get("/api/ai/status").json()["verified"] is False     # re-locked in the DB
