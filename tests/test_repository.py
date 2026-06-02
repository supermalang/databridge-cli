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
    assert u2.email == "x2@y.io"
    assert db.query(repo.User).count() == 1


def test_create_and_list_projects_scoped_to_membership(db):
    ua, orga = _user_with_org(db, "sa", "a@y.io")
    ub, orgb = _user_with_org(db, "sb", "b@y.io")
    pa = repo.create_project(db, user=ua, name="A proj", org_id=orga.id)
    repo.create_project(db, user=ub, name="B proj", org_id=orgb.id)
    a_projects = repo.list_projects_for_user(db, ua)
    assert [p.id for p in a_projects] == [pa.id]


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
        repo.update_project_config(db, p, {"x": 1}, expected_version=1)


def test_set_active_project_member_only(db):
    ua, orga = _user_with_org(db, "sa", "a@y.io")
    ub, orgb = _user_with_org(db, "sb", "b@y.io")
    pb = repo.create_project(db, user=ub, name="B", org_id=orgb.id)
    with pytest.raises(repo.AccessError):
        repo.set_active_project(db, ua, pb.id)
    pa = repo.create_project(db, user=ua, name="A", org_id=orga.id)
    repo.set_active_project(db, ua, pa.id)
    assert ua.active_project_id == pa.id
