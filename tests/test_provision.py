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
    assert len(orgs) == 1
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
