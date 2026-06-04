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
    assert p1.id == p2.id
    assert db.query(repo.Project).count() == 1
    assert u.active_project_id == p1.id


def test_import_legacy_config_missing_file_returns_none(tmp_path, db):
    u = provision.ensure_dev_user(db)
    assert bootstrap.import_legacy_config(db, owner=u, config_path=tmp_path / "nope.yml") is None
