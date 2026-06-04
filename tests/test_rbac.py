"""Per-project RBAC: role resolution, gate ranking, owner/superadmin guards,
and invite consumption. These are repository-level unit tests against the
session-wide sqlite app DB from conftest (no HTTP / no auth needed)."""
import uuid

import pytest

from web.db import session as dbs, repository as repo


def _mk_user(db, email):
    """A fresh user with a unique sub + the given email."""
    return repo.upsert_user(db, sub=f"sub-{uuid.uuid4()}", email=email, name=email.split("@")[0])


def _mk_project(db, owner, name=None):
    """Owner gets a personal org + a project they own (admin)."""
    name = name or f"proj-{uuid.uuid4().hex[:8]}"
    org = repo.create_org(db, name=f"{name}-org", slug=f"{name}-org", owner=owner)
    repo.add_membership(db, user=owner, org=org, role="owner")
    return repo.create_project(db, user=owner, name=name, org_id=org.id)


# --- role_for / ranking -----------------------------------------------------

def test_owner_is_admin_and_member_roles_resolve():
    with dbs.SessionLocal() as db:
        owner = _mk_user(db, f"owner-{uuid.uuid4()}@x.test")
        proj = _mk_project(db, owner)
        viewer = _mk_user(db, f"v-{uuid.uuid4()}@x.test")
        db.add(repo.ProjectMembership(user_id=viewer.id, project_id=proj.id, role="viewer"))
        db.commit()
        stranger = _mk_user(db, f"s-{uuid.uuid4()}@x.test")

        assert repo.role_for(db, owner, proj) == "admin"      # owner short-circuits to admin
        assert repo.role_for(db, viewer, proj) == "viewer"
        assert repo.role_for(db, stranger, proj) is None      # no access


def test_superadmin_outranks_everything():
    with dbs.SessionLocal() as db:
        owner = _mk_user(db, f"o-{uuid.uuid4()}@x.test")
        proj = _mk_project(db, owner)
        su = _mk_user(db, f"su-{uuid.uuid4()}@x.test")
        su.is_superadmin = True
        db.commit()
        assert repo.role_for(db, su, proj) == "superadmin"
        assert repo.get_project_for_user(db, su, proj.id) is not None  # sees any project


@pytest.mark.parametrize("role,minimum,ok", [
    ("viewer", "viewer", True), ("viewer", "editor", False),
    ("editor", "editor", True), ("editor", "admin", False),
    ("admin", "editor", True), ("admin", "admin", True),
    ("superadmin", "admin", True), (None, "viewer", False),
])
def test_role_at_least(role, minimum, ok):
    assert repo.role_at_least(role, minimum) is ok


# --- owner protection (#6) --------------------------------------------------

def test_owner_cannot_be_removed_or_demoted_by_another_admin():
    with dbs.SessionLocal() as db:
        owner = _mk_user(db, f"o-{uuid.uuid4()}@x.test")
        proj = _mk_project(db, owner)
        admin2 = _mk_user(db, f"a2-{uuid.uuid4()}@x.test")
        db.add(repo.ProjectMembership(user_id=admin2.id, project_id=proj.id, role="admin"))
        db.commit()

        with pytest.raises(repo.AccessError):
            repo.set_member_role(db, proj, owner.id, "viewer", actor_role="admin")
        with pytest.raises(repo.AccessError):
            repo.remove_member(db, proj, owner.id, actor_role="admin")
        # a superadmin actor may
        repo.remove_member(db, proj, owner.id, actor_role="superadmin")


# --- superadmin protection (#10) --------------------------------------------

def test_superadmin_cannot_revoke_another_superadmin_but_can_self_demote():
    with dbs.SessionLocal() as db:
        a = _mk_user(db, f"a-{uuid.uuid4()}@x.test"); a.is_superadmin = True
        b = _mk_user(db, f"b-{uuid.uuid4()}@x.test"); b.is_superadmin = True
        db.commit()
        with pytest.raises(repo.AccessError):
            repo.set_superadmin(db, actor=a, target=b, value=False)
        # self-demotion allowed
        repo.set_superadmin(db, actor=a, target=a, value=False)
        assert a.is_superadmin is False
        # granting is allowed
        c = _mk_user(db, f"c-{uuid.uuid4()}@x.test")
        repo.set_superadmin(db, actor=b, target=c, value=True)
        assert c.is_superadmin is True


# --- invitation consumption -------------------------------------------------

def test_consume_invitations_attaches_membership():
    with dbs.SessionLocal() as db:
        owner = _mk_user(db, f"o-{uuid.uuid4()}@x.test")
        proj = _mk_project(db, owner)
        email = f"invitee-{uuid.uuid4()}@x.test"
        repo.get_or_create_invitation(db, proj, email, "editor", invited_by=owner)

        invitee = _mk_user(db, email)
        n = repo.consume_invitations_for(db, invitee)
        assert n == 1
        assert repo.role_for(db, invitee, proj) == "editor"
        # idempotent: a second login consumes nothing new
        assert repo.consume_invitations_for(db, invitee) == 0


def test_invite_rejects_unknown_role():
    with dbs.SessionLocal() as db:
        owner = _mk_user(db, f"o-{uuid.uuid4()}@x.test")
        proj = _mk_project(db, owner)
        with pytest.raises(repo.AccessError):
            repo.get_or_create_invitation(db, proj, "x@y.test", "superuser", invited_by=owner)


# --- HTTP wiring (dev user is auto-provisioned as owner/admin) ---------------

@pytest.fixture
def _isolated_base(tmp_path, monkeypatch):
    import web.main as wm
    monkeypatch.setattr(wm, "BASE_DIR", tmp_path)
    for sub in ("data/processed", "reports", "templates"):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)
    return tmp_path


def _client():
    from fastapi.testclient import TestClient
    from web.main import app
    return TestClient(app)


def test_projects_endpoint_exposes_role_and_owner(_isolated_base):
    with _client() as c:
        r = c.post("/api/projects", json={"name": "RoleProj"})
        assert r.status_code == 200
        body = c.get("/api/projects").json()
        assert "is_superadmin" in body
        mine = [p for p in body["projects"] if p["name"] == "RoleProj"][0]
        assert mine["role"] == "admin" and mine["is_owner"] is True


def test_delete_project_then_gone(_isolated_base):
    with _client() as c:
        pid = c.post("/api/projects", json={"name": "ToDelete"}).json()["id"]
        assert c.delete(f"/api/projects/{pid}").status_code == 200
        ids = [p["id"] for p in c.get("/api/projects").json()["projects"]]
        assert pid not in ids


def test_members_endpoint_lists_owner(_isolated_base):
    with _client() as c:
        pid = c.post("/api/projects", json={"name": "WithMembers"}).json()["id"]
        c.post(f"/api/projects/{pid}/activate")
        r = c.get(f"/api/projects/{pid}/members")
        assert r.status_code == 200
        body = r.json()
        assert body["my_role"] == "admin"
        assert any(m["is_owner"] for m in body["members"])
