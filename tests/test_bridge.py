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
