"""API tests for the bulk "delete all reports" endpoint (XTF-12).

These exercise a NEW endpoint the Reports page calls — ``DELETE /api/reports``
(bulk, no filename) — which deletes every ``.docx`` in ``REPORTS_DIR`` and is
gated on the editor role exactly like the existing single-file delete
(``DELETE /api/reports/{filename}``).

Conventions mirror ``tests/test_template_api.py`` / ``tests/test_read_authz.py``:
- a synchronous ``TestClient`` over the FastAPI app;
- auth disabled by default (the dev user owns everything → editor gate passes),
  so the happy-path / no-op tests just need an active project;
- ``REPORTS_DIR`` is redirected at an isolated ``tmp_path`` so the repo's real
  ``reports/`` directory is never touched;
- the viewer-403 case follows ``test_read_authz.py``: auth is enabled and a
  session cookie is minted for a user who only holds the ``viewer`` role on
  their active project.

Every assertion is derived from the XTF-12 acceptance criteria:
- ``DELETE /api/reports`` deletes ALL ``.docx`` and returns ``{ok, deleted: N}``;
- deleting an empty reports dir is a non-error no-op (``deleted: 0``);
- the endpoint enforces editor RBAC (a viewer gets 403, files untouched).
"""
import time
import uuid

import pytest
from fastapi.testclient import TestClient

import web.main as wm
from web import auth
from web.db import session as dbs, repository as repo


# --------------------------------------------------------------------------- #
# Helpers / fixtures
# --------------------------------------------------------------------------- #
@pytest.fixture
def reports_dir(tmp_path, monkeypatch):
    """Redirect REPORTS_DIR at an isolated tmp dir so tests never touch repo/reports."""
    d = tmp_path / "reports"
    d.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(wm, "REPORTS_DIR", d)
    return d


def _seed_docx(directory, *names):
    """Drop minimal .docx files into REPORTS_DIR (contents irrelevant — the
    endpoint deletes by glob('*.docx'))."""
    paths = []
    for n in names:
        p = directory / n
        p.write_bytes(b"PK")  # any bytes — they just need to exist as .docx
        paths.append(p)
    return paths


@pytest.fixture
def client():
    return TestClient(wm.app)


@pytest.fixture
def dev_active_project():
    """Guarantee the dev user (auth disabled) has a real active project so the
    `_require("editor")` gate resolves an active project rather than 400ing.

    Mirrors the fixture in tests/test_template_api.py; restores the prior
    active_project_id afterwards so later tests aren't perturbed.
    """
    with wm.db_session.SessionLocal() as db:
        dev = wm.db_repo.get_user_by_sub(db, "dev-local")
        if dev is None:
            dev = wm.db_provision.ensure_dev_user(db)
        prev = dev.active_project_id
        if dev.active_project_id is None:
            projects = wm.db_repo.list_projects_for_user(db, dev)
            if not projects:
                from web.db import bootstrap as _bootstrap
                proj = _bootstrap.import_legacy_config(db, owner=dev)
                if proj is None:
                    proj = wm.db_repo.create_project(db, user=dev, name="Test active project")
                projects = [proj]
            wm.db_repo.set_active_project(db, dev, projects[0].id)
        active_id = dev.active_project_id
    yield active_id
    with wm.db_session.SessionLocal() as db:
        dev = wm.db_repo.get_user_by_sub(db, "dev-local")
        if dev is not None:
            dev.active_project_id = prev
            db.commit()


# --------------------------------------------------------------------------- #
# AC: DELETE /api/reports removes all .docx and returns {ok, deleted: N}
# --------------------------------------------------------------------------- #
def test_delete_all_reports_removes_files(reports_dir, client, dev_active_project):
    """Two .docx in REPORTS_DIR → DELETE /api/reports returns 200 {ok, deleted:2}
    and the directory is empty afterwards.

    AC: "DELETE /api/reports deletes all .docx files in REPORTS_DIR and returns a
    count (e.g. {ok: true, deleted: N})."
    """
    _seed_docx(reports_dir, "report_a.docx", "report_b.docx")

    resp = client.request("DELETE", "/api/reports")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body == {"ok": True, "deleted": 2}
    # All .docx removed.
    assert list(reports_dir.glob("*.docx")) == []


# --------------------------------------------------------------------------- #
# AC: empty reports dir is a non-error no-op (deleted: 0)
# --------------------------------------------------------------------------- #
def test_delete_all_reports_empty_noop(reports_dir, client, dev_active_project):
    """No reports present → DELETE /api/reports returns 200 {ok, deleted:0}, no error.

    AC: "deleting an empty reports dir is a non-error no-op (deleted: 0)."
    """
    assert list(reports_dir.glob("*.docx")) == []

    resp = client.request("DELETE", "/api/reports")

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": True, "deleted": 0}


# --------------------------------------------------------------------------- #
# AC: editor/admin RBAC — a viewer gets 403, files untouched
# --------------------------------------------------------------------------- #
@pytest.fixture
def viewer_client(monkeypatch):
    """An auth-enabled client whose session belongs to a user holding only the
    `viewer` role on their active project — mirrors tests/test_read_authz.py.

    Yields (client, project_id) so the test can verify the files survive.
    """
    monkeypatch.setenv("OIDC_ISSUER", "https://z.example")
    monkeypatch.setenv("OIDC_CLIENT_ID", "cid")
    monkeypatch.setenv("OIDC_CLIENT_SECRET", "secret")
    monkeypatch.setenv("SESSION_SECRET", "s3cr3t-for-tests")
    auth._oauth = None

    sub = f"viewer-{uuid.uuid4()}"
    email = f"{sub}@x.io"
    with dbs.SessionLocal() as db:
        # An owner who actually owns the project (admin), and our viewer.
        owner = repo.upsert_user(db, sub=f"owner-{uuid.uuid4()}",
                                 email=f"owner-{uuid.uuid4()}@x.io", name="Owner")
        org = repo.create_org(db, name=f"vorg-{uuid.uuid4().hex[:6]}",
                              slug=f"vorg-{uuid.uuid4().hex[:6]}", owner=owner)
        repo.add_membership(db, user=owner, org=org, role="owner")
        proj = repo.create_project(db, user=owner, name="Viewer-gated project", org_id=org.id)

        viewer = repo.upsert_user(db, sub=sub, email=email, name="Viewer")
        db.add(repo.ProjectMembership(user_id=viewer.id, project_id=proj.id, role="viewer"))
        db.commit()
        repo.set_active_project(db, viewer, proj.id)
        proj_id = str(proj.id)

    token = auth.session_codec().encode({
        "sub": sub, "email": email, "name": "Viewer",
        "sess_exp": time.time() + 3600, "access_exp": time.time() + 3600,
        "refresh_token": "rt",
    })
    with TestClient(wm.app) as c:
        c.cookies.set(auth.SESSION_COOKIE, token)
        yield c, proj_id
    auth._oauth = None


def test_delete_all_reports_rbac(reports_dir, viewer_client):
    """A viewer caller is refused with 403 and the report files are untouched.

    AC: "The endpoint enforces editor/admin RBAC via _require(request, 'editor')
    (a viewer gets 403), matching the single-file delete."
    """
    client, _proj_id = viewer_client
    _seed_docx(reports_dir, "keep_a.docx", "keep_b.docx")

    resp = client.request("DELETE", "/api/reports")

    assert resp.status_code == 403, resp.text
    # Files must survive the refused delete.
    assert sorted(p.name for p in reports_dir.glob("*.docx")) == ["keep_a.docx", "keep_b.docx"]
