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
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import web.main as wm
from web import auth
from web.db import session as dbs, repository as repo
from web.storage import factory
from web.storage.base import Storage, storage_key
from web.storage.local import LocalStorage


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


# =========================================================================== #
# XTF-20 — Reports listing shows STORAGE build-time, with local-mtime fallback
# =========================================================================== #
#
# Assumed contract for the implementer (do NOT implement here — tests only):
#
#   Storage.last_modified(key) -> datetime
#       Returns the last-modified time of the stored object identified by `key`.
#       Raises KeyError when no object exists for the key (mirrors get_bytes /
#       get_file). Implemented on BOTH the local and S3 backends and declared on
#       the Storage ABC.
#
#   GET /api/reports — for each local report `.docx`, resolve its storage key via
#       storage_key(org_id, project_id, "reports", name) on the active project's
#       backend.  When the storage object exists, the response's `modified` field
#       is sourced from Storage.last_modified(key) (the push/build time); when no
#       storage object exists (pure-local mode), it FALLS BACK to the local file
#       mtime — without error.  The response shape is unchanged:
#       {"files": [{"name", "size_kb", "modified"}]} with `modified` formatted
#       "%Y-%m-%d %H:%M".
#
# The S3 backend's LastModified is a tz-aware datetime and the local file mtime is
# an epoch float; a datetime return keeps the two backends uniform and `modified`
# formatting identical (datetime.fromtimestamp(...) and a datetime both .strftime
# the same way). These tests assert on the RENDERED `modified` string so they hold
# whether the accessor returns a datetime or an epoch float, as long as the SOURCE
# of the timestamp is the storage object.
# --------------------------------------------------------------------------- #


@pytest.fixture
def dev_org_project_ids():
    """The active dev project's (org_id, project_id) as strings — the same values
    `_active_project` resolves inside the endpoint, used to build the report's
    storage key with storage_key(...)."""
    with wm.db_session.SessionLocal() as db:
        dev = wm.db_repo.get_user_by_sub(db, "dev-local")
        proj = wm.db_repo.get_project_for_user(db, dev, dev.active_project_id)
        return str(proj.org_id), str(proj.id)


class _SpyStorage(LocalStorage):
    """A LocalStorage whose `last_modified` returns a caller-injected, KNOWN time
    for keys present in `_stamps`, so a test can make the storage last-modified
    differ from the local report file's reset mtime. For keys not in `_stamps`,
    behaves as 'no object' (KeyError) so the fallback path is exercised."""

    def __init__(self, base_dir):
        super().__init__(base_dir)
        self._stamps = {}

    def stamp(self, key, when: datetime) -> None:
        # Materialize the object so exists()/list() see it, then record its time.
        self.put_bytes(key, b"PK")
        self._stamps[key] = when

    def last_modified(self, key):  # contract under test
        if key not in self._stamps:
            raise KeyError(key)
        return self._stamps[key]


@pytest.fixture
def spy_storage(tmp_path, monkeypatch):
    """Install a spy storage backend as the process-wide singleton so both
    `web.storage.factory.get_storage` and `workspace.get_storage` resolve to it."""
    store = _SpyStorage(tmp_path / "minio")
    monkeypatch.setattr(factory, "_storage", store, raising=False)
    yield store
    factory.reset_storage()


def test_list_reports_uses_storage_modified(
    reports_dir, client, dev_active_project, dev_org_project_ids, spy_storage
):
    """The listing's `modified` is the STORAGE object's last-modified (build/push
    time), NOT the report file's reset local mtime.

    AC: "GET /api/reports returns, for each report, a `modified` timestamp sourced
    from the storage object's last-modified, not the reset local mtime."
    """
    org_id, project_id = dev_org_project_ids
    name = "kobo_report_20260615.docx"
    _seed_docx(reports_dir, name)

    # Local file mtime = "today" (what S3 download_file would reset it to).
    local_when = datetime(2026, 6, 19, 12, 7)
    os.utime(reports_dir / name,
             (local_when.timestamp(), local_when.timestamp()))

    # Storage object's last-modified = the real build time, days earlier & distinct.
    storage_when = datetime(2026, 6, 15, 9, 30)
    spy_storage.stamp(storage_key(org_id, project_id, "reports", name), storage_when)

    resp = client.get("/api/reports")
    assert resp.status_code == 200, resp.text
    files = {f["name"]: f for f in resp.json()["files"]}
    assert name in files, files

    got = files[name]["modified"]
    assert got == storage_when.strftime("%Y-%m-%d %H:%M"), (
        f"expected storage last-modified {storage_when:%Y-%m-%d %H:%M}, got {got!r}")
    assert got != local_when.strftime("%Y-%m-%d %H:%M"), (
        "listing returned the reset LOCAL mtime, not the storage last-modified")


def test_list_reports_local_fallback(
    reports_dir, client, dev_active_project, dev_org_project_ids, spy_storage
):
    """When NO storage object exists for a report (pure-local / not-yet-pushed),
    the listing falls back to the local file mtime — without erroring.

    AC: "When no storage object exists for a file (pure-local mode), the listing
    falls back to local mtime without erroring."

    NOTE (red-first): this is a fallback/regression guard. The current endpoint
    already returns local mtime unconditionally, so it passes today. It goes RED
    only if the implementation of the storage-sourced timestamp mishandles a
    missing object (e.g. lets last_modified's KeyError surface as a 500, or stops
    listing the file). It pins the contract that the new code path degrades to the
    local mtime when no storage object exists.
    """
    name = "local_only_20260601.docx"
    _seed_docx(reports_dir, name)
    # No spy_storage.stamp(...) for this key → last_modified(key) raises KeyError.

    local_when = datetime(2026, 6, 1, 8, 15)
    os.utime(reports_dir / name,
             (local_when.timestamp(), local_when.timestamp()))

    resp = client.get("/api/reports")
    assert resp.status_code == 200, resp.text
    files = {f["name"]: f for f in resp.json()["files"]}
    assert name in files, files
    assert files[name]["modified"] == local_when.strftime("%Y-%m-%d %H:%M")


def test_storage_last_modified_implemented(tmp_path):
    """`last_modified(key)` exists on the Storage ABC and on the local + S3
    backends, and returns the stored object's last-modified time.

    AC: "A Storage.last_modified(key) accessor exists on the abstraction and the
    local + S3 backends and returns the object's last-modified time."
    """
    # Declared on the abstraction.
    assert hasattr(Storage, "last_modified"), \
        "Storage ABC is missing a last_modified accessor"

    # ---- local backend: returns the stored object's mtime ----
    local = LocalStorage(tmp_path / "store")
    key = "orgs/o1/projects/p1/reports/r1.docx"
    before = time.time()
    local.put_bytes(key, b"PK")
    after = time.time()

    lm = local.last_modified(key)
    epoch = lm.timestamp() if isinstance(lm, datetime) else float(lm)
    # The object's last-modified is the moment it was written (allow small slack).
    assert before - 2 <= epoch <= after + 2, (
        f"local last_modified {epoch} not within write window "
        f"[{before}, {after}]")

    # ---- S3 backend: surfaces the object's LastModified ----
    s3_when = datetime(2026, 6, 15, 9, 30, tzinfo=timezone.utc)

    class _FakeS3Client:
        def head_object(self, Bucket, Key):
            return {"LastModified": s3_when, "ContentLength": 2}

    from web.storage.s3 import S3Storage
    s3 = S3Storage(_FakeS3Client(), "bucket")
    s3_lm = s3.last_modified("orgs/o1/projects/p1/reports/r1.docx")
    s3_epoch = s3_lm.timestamp() if isinstance(s3_lm, datetime) else float(s3_lm)
    assert abs(s3_epoch - s3_when.timestamp()) < 1, (
        f"S3 last_modified {s3_lm!r} did not reflect the object's LastModified "
        f"{s3_when!r}")
