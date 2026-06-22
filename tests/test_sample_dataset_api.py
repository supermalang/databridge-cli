"""API tests for the no-credentials sample-dataset path (PUX-5).

These exercise a NEW endpoint the Sources "Try with sample data" affordance calls
— ``POST /api/sample-data`` — which loads a BUNDLED sample dataset into the
caller's ACTIVE project workspace so the downstream stages (Questions /
Composition / Reports) have real columns + rows to work with, WITHOUT requiring a
Kobo/Ona token or an AI key. It is gated on the editor role exactly like the other
mutating endpoints (``_require(request, "editor")``).

Conventions mirror ``tests/test_reports_api.py`` / ``tests/test_template_api.py`` /
``tests/test_read_authz.py``:
- a synchronous ``TestClient`` over the FastAPI app;
- auth disabled by default (the dev user owns everything → editor gate passes), so
  the happy-path tests just need an active project;
- ``BASE_DIR`` / ``CONFIG_PATH`` / ``DATA_DIR`` are redirected at an isolated
  ``tmp_path`` (and the process chdir'd there) so the endpoint's cwd-first config
  resolution + ``data/processed`` mirror land in the temp workspace and the repo's
  real files are never touched;
- the viewer-403 case follows ``test_reports_api.py``: auth is enabled and a
  session cookie is minted for a user who only holds the ``viewer`` role on their
  active project.

Every assertion is derived from the PUX-5 acceptance criteria + Unit-tests block:
- (1) ``test_load_sample_dataset_populates_workspace``: POST as an editor →
  materializes bundled sample questions (into config) + submissions (into
  ``data/processed``) with NO token / AI key configured.
- (2) ``test_load_sample_dataset_rbac``: a viewer caller gets 403 and nothing is
  written.
- (3) ``test_load_sample_dataset_idempotent``: invoking it twice leaves a single
  coherent sample set (no duplication / no error).

CONTRACT (for the implementer — tests only; do NOT implement here):
- Route + method:   ``POST /api/sample-data``
- RBAC:             editor-gated via ``require_role(request, db, "editor")`` /
                    ``_require(request, "editor")`` — scoped to the caller's
                    ACTIVE project (a viewer → 403, nothing written).
- No credentials:   loading the sample requires NO ``api.token`` and NO ``ai`` key.
- What it writes:   the bundled sample's ``questions`` into the active project's
                    config (mirrored to ``config.yml``), and the sample
                    submissions into ``data/processed/`` as a CSV/JSON/XLSX file
                    the downstream stages already read.
- Bundled asset:    a small fixture questions + submissions set shipped with the
                    app (proposed location ``src/data/sample/``). This test does
                    NOT create it; the implementer ships it.
- Idempotency:      a second POST leaves a single coherent sample set — questions
                    are not duplicated and no error is raised.
"""
import os
import time
import uuid

import pytest
import yaml
from fastapi.testclient import TestClient

import web.main as wm
from web import auth
from web.db import session as dbs, repository as repo


SAMPLE_ENDPOINT = "/api/sample-data"

# Data files the downstream stages read out of the materialized data/processed mirror
# (matches /api/state's has_data scan in web.main.get_state).
DATA_SUFFIXES = {".csv", ".json", ".xlsx"}


# --------------------------------------------------------------------------- #
# Helpers / fixtures
# --------------------------------------------------------------------------- #
@pytest.fixture
def workspace(tmp_path, monkeypatch):
    """Redirect the BASE_DIR file mirror at an isolated tmp dir and chdir into it.

    The endpoint resolves config cwd-first (``_config_path()``) and materializes
    downloaded data into ``DATA_DIR`` (``BASE_DIR/data/processed``). Pointing all
    three at tmp_path — and chdir'ing so the cwd-first ``config.yml`` lands here —
    lets the test read exactly what the endpoint wrote without touching repo files.

    Seeds a credential-free ``config.yml`` (no api.token, no ai key) so the test
    can prove the sample path does NOT depend on credentials.
    """
    base = tmp_path
    data_dir = base / "data" / "processed"
    data_dir.mkdir(parents=True, exist_ok=True)
    (base / "reports").mkdir(parents=True, exist_ok=True)
    (base / "templates").mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(wm, "BASE_DIR", base)
    monkeypatch.setattr(wm, "CONFIG_PATH", base / "config.yml")
    monkeypatch.setattr(wm, "DATA_DIR", data_dir)
    monkeypatch.chdir(base)

    # Credential-free starting config: no api.token, no ai section.
    (base / "config.yml").write_text(
        yaml.safe_dump({
            "form": {"uid": "SAMPLE", "alias": "sample"},
            "export": {"format": "csv", "output_dir": "data/processed"},
        }),
        encoding="utf-8",
    )
    return base


def _data_files(base):
    """Files the downstream stages would read out of data/processed."""
    d = base / "data" / "processed"
    if not d.exists():
        return []
    return [p for p in d.iterdir() if p.is_file() and p.suffix.lower() in DATA_SUFFIXES]


def _load_questions(base):
    """Questions currently written into the workspace config.yml (empty if none)."""
    cfg_path = base / "config.yml"
    if not cfg_path.exists():
        return []
    cfg = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
    return cfg.get("questions") or []


@pytest.fixture
def client():
    return TestClient(wm.app)


@pytest.fixture
def dev_active_project():
    """Guarantee the dev user (auth disabled) has a real active project so the
    editor gate resolves an active project rather than 400ing.

    Mirrors tests/test_reports_api.py; restores the prior active_project_id after.
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
# AC: invoking it loads the bundled sample dataset into the active project so the
# downstream stages have real columns + rows — with NO token / AI key required.
# --------------------------------------------------------------------------- #
def test_load_sample_dataset_populates_workspace(workspace, client, dev_active_project):
    """POST /api/sample-data as an editor → bundled sample questions + submissions
    materialized into the active project's workspace; no credentials configured.

    AC: "Invoking it loads the bundled sample dataset into the active project so
    the downstream stages (Questions/Composition/Reports) have real columns + rows
    to work with" and "does NOT require a Kobo/Ona token or an AI key to start".
    """
    # Precondition: a credential-free workspace with no questions + no downloaded data.
    assert _load_questions(workspace) == [], "starting workspace must have no questions"
    assert _data_files(workspace) == [], "starting workspace must have no downloaded data"
    start_cfg = yaml.safe_load((workspace / "config.yml").read_text(encoding="utf-8")) or {}
    assert not (start_cfg.get("api") or {}).get("token"), "test must start with NO api token"
    assert not start_cfg.get("ai"), "test must start with NO ai key configured"

    resp = client.post(SAMPLE_ENDPOINT)

    assert resp.status_code == 200, resp.text

    # Questions: the bundled sample's questions are now in the config — real columns.
    questions = _load_questions(workspace)
    assert len(questions) > 0, "sample load must populate config questions (downstream columns)"
    # Each question is a real column the downstream stages reference (has an
    # export_label / column name), not an empty stub.
    assert all(
        (q.get("export_label") or q.get("kobo_key") or q.get("label"))
        for q in questions
    ), "every sample question must carry a usable column name"

    # Submissions: a real data file landed in data/processed — real rows.
    data_files = _data_files(workspace)
    assert len(data_files) >= 1, (
        "sample load must materialize submissions into data/processed so the "
        "downstream stages have rows to work with"
    )
    assert any(p.stat().st_size > 0 for p in data_files), "the sample data file must be non-empty"

    # No credentials were introduced by the sample path.
    end_cfg = yaml.safe_load((workspace / "config.yml").read_text(encoding="utf-8")) or {}
    assert not (end_cfg.get("api") or {}).get("token"), "sample path must not require/add an api token"
    ai = end_cfg.get("ai") or {}
    assert not ai.get("api_key"), "sample path must not require/add an AI key"


# --------------------------------------------------------------------------- #
# AC: the new endpoint is RBAC-consistent (editor-gated) — a viewer gets 403 and
# nothing is written.
# --------------------------------------------------------------------------- #
@pytest.fixture
def viewer_client(monkeypatch):
    """An auth-enabled client whose session belongs to a user holding only the
    `viewer` role on their active project — mirrors tests/test_reports_api.py.

    Yields the client; the caller verifies the workspace is untouched.
    """
    monkeypatch.setenv("OIDC_ISSUER", "https://z.example")
    monkeypatch.setenv("OIDC_CLIENT_ID", "cid")
    monkeypatch.setenv("OIDC_CLIENT_SECRET", "secret")
    monkeypatch.setenv("SESSION_SECRET", "s3cr3t-for-tests")
    auth._oauth = None

    sub = f"viewer-{uuid.uuid4()}"
    email = f"{sub}@x.io"
    with dbs.SessionLocal() as db:
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

    token = auth.session_codec().encode({
        "sub": sub, "email": email, "name": "Viewer",
        "sess_exp": time.time() + 3600, "access_exp": time.time() + 3600,
        "refresh_token": "rt",
    })
    with TestClient(wm.app) as c:
        c.cookies.set(auth.SESSION_COOKIE, token)
        yield c
    auth._oauth = None


def test_load_sample_dataset_rbac(workspace, viewer_client):
    """A viewer caller is refused with 403 and nothing is written to the workspace.

    AC: "The new web endpoint is RBAC-consistent with the other mutating endpoints
    (editor-gated ...)" / Unit test (2): "a viewer caller gets 403 and nothing is
    written."
    """
    assert _load_questions(workspace) == []
    assert _data_files(workspace) == []

    resp = viewer_client.post(SAMPLE_ENDPOINT)

    assert resp.status_code == 403, resp.text
    # Nothing materialized: no questions added, no data file written.
    assert _load_questions(workspace) == [], "a refused sample load must not write questions"
    assert _data_files(workspace) == [], "a refused sample load must not write data files"


# --------------------------------------------------------------------------- #
# AC: idempotent — invoking it twice leaves a single coherent sample set (no
# duplication / no error).
# --------------------------------------------------------------------------- #
def test_load_sample_dataset_idempotent(workspace, client, dev_active_project):
    """Two POSTs leave a single coherent sample set — questions not duplicated, no
    error, and the data mirror is not multiplied.

    AC / Unit test (3): "invoking it twice leaves a single coherent sample set
    (no duplication / no error)."
    """
    first = client.post(SAMPLE_ENDPOINT)
    assert first.status_code == 200, first.text
    q_after_first = _load_questions(workspace)
    files_after_first = sorted(p.name for p in _data_files(workspace))
    assert len(q_after_first) > 0, "first load must populate questions"
    assert len(files_after_first) >= 1, "first load must materialize a data file"

    second = client.post(SAMPLE_ENDPOINT)
    assert second.status_code == 200, second.text  # second invocation is NOT an error

    q_after_second = _load_questions(workspace)
    files_after_second = sorted(p.name for p in _data_files(workspace))

    # No duplication: the question set is identical (same count), not doubled.
    assert len(q_after_second) == len(q_after_first), (
        "a second sample load must not duplicate questions "
        f"(had {len(q_after_first)}, now {len(q_after_second)})"
    )
    # Coherent single set: no duplicate column names introduced.
    col_names = [
        (q.get("export_label") or q.get("kobo_key") or q.get("label"))
        for q in q_after_second
    ]
    assert len(col_names) == len(set(col_names)), "the sample question set must have no duplicate columns"

    # The data mirror is a single coherent sample set, not multiplied per invocation.
    assert files_after_second == files_after_first, (
        "a second sample load must not multiply the data files in data/processed "
        f"(had {files_after_first}, now {files_after_second})"
    )
