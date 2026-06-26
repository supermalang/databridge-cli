"""UX-5 — Member rows fall back to a raw UUID.

Acceptance criteria (docs/ROADMAP.md, UX-5):
  (a) Members show email/name, never a UUID.
  (b) A "you" tag marks the current user.

The card's Files include "the members endpoint" with the note "populate email/name
server-side". These tests pin the BACKEND half of the contract that makes AC(a)
satisfiable in the UI: GET /api/projects/{id}/members must return, for EVERY member,
a non-empty human-readable identifier (email and/or name) — never only a `user_id`
(a UUID) for the panel to fall back on.

Today `web/db/repository.list_members` returns each member's `email` and `name`
verbatim from the User row, both of which default to "" in the model. A member whose
email AND name are both empty therefore arrives at the panel with only `user_id`,
which `ProjectMembersPanel.jsx` renders as a raw UUID (`m.email || m.name || m.user_id`).

So the RED test below seeds exactly that member (empty email + empty name) and asserts
the endpoint still surfaces a non-empty human identifier for it. That fails on the
current code, proving the endpoint must be changed to populate email/name server-side.

Pattern mirrors tests/test_rbac.py: repository helpers for setup + the dev-user
TestClient for the HTTP surface (the dev user is auto-provisioned as owner/admin, so
editor/admin can view the roster).
"""
import re
import uuid

import pytest

from web.db import session as dbs, repository as repo

UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)


def _human_label(member: dict) -> str:
    """The identifier the panel would show: email, else name (never user_id)."""
    return (member.get("email") or "").strip() or (member.get("name") or "").strip()


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


def _add_member(project_id: str, *, email: str, name: str, role: str = "viewer") -> str:
    """Create a fresh user (with the given email/name) and add them to the project.
    Returns the new member's user_id."""
    import uuid as _uuid
    with dbs.SessionLocal() as db:
        u = repo.upsert_user(db, sub=f"sub-{_uuid.uuid4()}", email=email, name=name)
        proj = repo.get_project(db, _uuid.UUID(project_id)) if hasattr(repo, "get_project") else None
        if proj is None:
            from web.db.models import Project
            proj = db.get(Project, _uuid.UUID(project_id))
        db.add(repo.ProjectMembership(user_id=u.id, project_id=proj.id, role=role))
        db.commit()
        return str(u.id)


# --- AC(a): every member has a human-readable identifier, never just a UUID ----

def test_member_without_email_or_name_still_has_human_identifier(_isolated_base):
    """RED today: a member whose email AND name are empty is returned with both
    fields blank, so the panel falls back to the raw user_id UUID.

    The endpoint must populate a human-readable identifier server-side for EVERY
    member (e.g. derive a label from email/sub), so no row is identifier-less."""
    with _client() as c:
        pid = c.post("/api/projects", json={"name": "Identity"}).json()["id"]
        c.post(f"/api/projects/{pid}/activate")
        # A member with no email and no name — the exact gap the card calls out.
        blank_uid = _add_member(pid, email="", name="", role="viewer")

        body = c.get(f"/api/projects/{pid}/members").json()
        member = next(m for m in body["members"] if m["user_id"] == blank_uid)

        label = _human_label(member)
        assert label, (
            "every member must carry a non-empty human-readable identifier "
            "(email or name) so the panel never falls back to the raw user_id; "
            f"got email={member.get('email')!r} name={member.get('name')!r}"
        )
        assert not UUID_RE.fullmatch(label), (
            "the human identifier must not itself be a raw UUID"
        )


def test_every_member_row_exposes_email_or_name(_isolated_base):
    """AC(a), roster-wide: no member in the payload may be identifier-less.
    The owner (dev user) has an email; the seeded blank user does not — RED until
    the endpoint guarantees a label for all rows."""
    with _client() as c:
        pid = c.post("/api/projects", json={"name": "Roster"}).json()["id"]
        c.post(f"/api/projects/{pid}/activate")
        _add_member(pid, email="", name="", role="editor")

        members = c.get(f"/api/projects/{pid}/members").json()["members"]
        assert len(members) >= 2
        identifier_less = [m for m in members if not _human_label(m)]
        assert identifier_less == [], (
            "no member may lack a human-readable identifier (email/name); "
            f"these rows would render as a raw UUID: "
            f"{[m['user_id'] for m in identifier_less]}"
        )


# --- regression: a member WITH an email/name is surfaced verbatim --------------

def test_member_with_email_is_surfaced(_isolated_base):
    """Members who do have an email are returned with it (regression guard so the
    fix doesn't drop real identifiers)."""
    with _client() as c:
        pid = c.post("/api/projects", json={"name": "Named"}).json()["id"]
        c.post(f"/api/projects/{pid}/activate")
        email = f"member-{uuid.uuid4().hex[:8]}@example.test"
        uid = _add_member(pid, email=email, name="", role="viewer")

        members = c.get(f"/api/projects/{pid}/members").json()["members"]
        member = next(m for m in members if m["user_id"] == uid)
        assert _human_label(member) == email
