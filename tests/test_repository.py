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


# --- MNT-12: batch membership fetch — no N+1 role queries in /api/projects ---

def _pm_select_statements(statements):
    """Every captured SELECT that reads the project_memberships table."""
    return [
        s for s in statements
        if "SELECT" in s.upper() and "project_memberships" in s.lower()
    ]


def _member_of_foreign_projects(db, owner, member, n):
    """Create `n` projects OWNED BY `owner` and give `member` an explicit
    ProjectMembership row on each. `member` is NOT the owner of any of them,
    so their role must be resolved from the membership table (not the owner
    short-circuit in role_for)."""
    owner_org = repo.create_org(db, name="owner org", slug="owner-org", owner=owner)
    repo.add_membership(db, user=owner, org=owner_org, role="owner")
    projects = []
    roles = ("viewer", "editor", "admin")
    for i in range(n):
        p = repo.create_project(db, user=owner, name=f"P{i}", org_id=owner_org.id)
        role = roles[i % len(roles)]
        db.add(repo.ProjectMembership(user_id=member.id, project_id=p.id, role=role))
        projects.append((p, role))
    db.commit()
    return projects


def test_get_memberships_for_user_single_query(db):
    """AC: get_memberships_for_user(user_id, db) returns ALL of a user's
    ProjectMembership rows in ONE `SELECT ... WHERE user_id = :uid` query,
    and the returned map contains every project->role entry."""
    owner, _ = _user_with_org(db, "owner", "owner@y.io")
    member = repo.upsert_user(db, sub="member", email="member@y.io", name="M")
    n = 4
    seeded = _member_of_foreign_projects(db, owner, member, n)

    statements = _capture_statements(db)

    result = repo.get_memberships_for_user(member.id, db)

    pm_selects = _pm_select_statements(statements)
    assert len(pm_selects) == 1, (
        f"expected exactly 1 SELECT on project_memberships, got {len(pm_selects)}: "
        f"{pm_selects!r}"
    )
    for stmt in pm_selects:
        upper = stmt.upper()
        assert "WHERE" in upper and "USER_ID" in upper, (
            f"membership fetch must filter by user_id: {stmt!r}"
        )

    # The returned structure must let a caller look up role per project.
    for p, role in seeded:
        assert _role_from_map(result, p.id) == role, (
            f"membership map missing/incorrect role for project {p.id}"
        )


def _role_from_map(result, project_id):
    """Resolve a project's role from whatever mapping shape
    get_memberships_for_user returns (dict keyed by project_id, or an
    iterable of ProjectMembership rows)."""
    if isinstance(result, dict):
        val = result.get(project_id)
        if val is None:
            return None
        return getattr(val, "role", val)
    for row in result:
        if getattr(row, "project_id", None) == project_id:
            return row.role
    return None


@pytest.mark.parametrize("n", [1, 5])
def test_project_list_resolves_roles_without_per_project_query(db, n):
    """AC: resolving roles for a user's N projects issues exactly ONE query
    against project_memberships regardless of N (no N+1). Drives the same
    role-resolution path _project_dict uses for the /api/projects list."""
    from web.main import _project_dict

    owner, _ = _user_with_org(db, "owner", "owner@y.io")
    member = repo.upsert_user(db, sub="member", email="member@y.io", name="M")
    _member_of_foreign_projects(db, owner, member, n)

    projects = repo.list_projects_for_user(db, member)
    assert len(projects) == n

    statements = _capture_statements(db)

    dicts = [_project_dict(db, member, p) for p in projects]

    pm_selects = _pm_select_statements(statements)
    assert len(pm_selects) == 1, (
        f"building the project list for N={n} issued {len(pm_selects)} "
        f"project_memberships SELECTs (N+1); expected exactly 1: {pm_selects!r}"
    )

    # Sanity: roles were actually resolved (not all None).
    assert all(d["role"] is not None for d in dicts)
