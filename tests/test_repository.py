import pytest
from unittest.mock import MagicMock
from sqlalchemy import event

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


# --- MNT-13: apply_superadmin_emails must not full-table-scan ---------------

def _capture_statements(db):
    """Attach a listener on the underlying engine that records every SQL
    statement text emitted for the lifetime of this session's connection."""
    statements = []
    engine = db.get_bind()

    def _before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", _before_cursor_execute)
    return statements


def test_apply_superadmin_emails_filtered_query(db):
    """AC: apply_superadmin_emails issues a SELECT ... WHERE ... on email,
    not an unfiltered full-table scan of users."""
    _user_with_org(db, "sa", "a@y.io")
    _user_with_org(db, "sb", "b@y.io")
    _user_with_org(db, "sc", "c@y.io")

    statements = _capture_statements(db)

    n = repo.apply_superadmin_emails(db, ["b@y.io"])

    assert n == 1

    select_user_statements = [
        s for s in statements
        if "SELECT" in s.upper() and "users" in s.lower()
    ]
    assert select_user_statements, "expected a SELECT against the users table"

    # Every SELECT touching the users table must filter by email (WHERE ... email ...).
    for stmt in select_user_statements:
        upper = stmt.upper()
        assert "WHERE" in upper, (
            f"apply_superadmin_emails issued an unfiltered SELECT on users: {stmt!r}"
        )
        assert "EMAIL" in upper, (
            f"apply_superadmin_emails' WHERE clause does not reference email: {stmt!r}"
        )

    # Confirm the filtered user actually got flagged and others did not.
    b = db.query(repo.User).filter_by(email="b@y.io").one()
    a = db.query(repo.User).filter_by(email="a@y.io").one()
    c = db.query(repo.User).filter_by(email="c@y.io").one()
    assert b.is_superadmin is True
    assert a.is_superadmin is False
    assert c.is_superadmin is False


def test_apply_superadmin_emails_empty_noop(db, monkeypatch):
    """AC: when SUPERADMIN_EMAILS is empty, apply_superadmin_emails issues
    no DB query at all (no db.scalars call)."""
    scalars_mock = MagicMock(wraps=db.scalars)
    monkeypatch.setattr(db, "scalars", scalars_mock)

    n = repo.apply_superadmin_emails(db, [])

    assert n == 0
    scalars_mock.assert_not_called()
