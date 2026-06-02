import uuid
import pytest
from fastapi.testclient import TestClient


def _client():
    from web.main import app
    return TestClient(app)


@pytest.fixture
def isolated_base(tmp_path, monkeypatch):
    """Redirect the app's working-dir root to a temp dir so activate/run workspace
    operations (which clear/write data/processed, reports, templates) never touch the
    real repo dirs. The handlers pass base=BASE_DIR (a module global) to the workspace
    helpers, so patching wm.BASE_DIR fully isolates them."""
    import web.main as wm
    monkeypatch.setattr(wm, "BASE_DIR", tmp_path)
    for sub in ("data/processed", "reports", "templates"):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)
    return tmp_path


def _make_project_with_report(c, name, report_name):
    """Create a project, activate it, and push a report into its Minio prefix."""
    import web.main as wm
    from web.storage import factory
    from web.storage.base import storage_key
    pid = c.post("/api/projects", json={"name": name}).json()["id"]
    c.post(f"/api/projects/{pid}/activate")
    with wm.db_session.SessionLocal() as db:
        proj = db.get(wm.db_repo.Project, uuid.UUID(pid))
        org_id = str(proj.org_id)
    store = factory.get_storage()
    store.put_bytes(storage_key(org_id, pid, "reports", report_name), b"DOCX")
    return pid


def test_activate_pulls_workspace_into_reports_dir(isolated_base):
    with _client() as c:
        pid = _make_project_with_report(c, "WS-A", "ra.docx")
        r = c.post(f"/api/projects/{pid}/activate")     # re-activate -> fresh pull
        assert r.status_code == 200
        assert (isolated_base / "reports" / "ra.docx").exists()


def test_activate_swaps_mirror_between_projects(isolated_base):
    with _client() as c:
        pid_a = _make_project_with_report(c, "WS-1", "a_only.docx")
        pid_b = _make_project_with_report(c, "WS-2", "b_only.docx")
        c.post(f"/api/projects/{pid_a}/activate")
        assert (isolated_base / "reports" / "a_only.docx").exists()
        assert not (isolated_base / "reports" / "b_only.docx").exists()
        c.post(f"/api/projects/{pid_b}/activate")
        assert (isolated_base / "reports" / "b_only.docx").exists()
        assert not (isolated_base / "reports" / "a_only.docx").exists()
