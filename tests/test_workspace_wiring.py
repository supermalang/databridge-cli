import uuid
from fastapi.testclient import TestClient


def _client():
    from web.main import app
    return TestClient(app)


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


def test_activate_pulls_workspace_into_reports_dir(tmp_path, monkeypatch):
    with _client() as c:
        pid = _make_project_with_report(c, "WS-A", "ra.docx")
        r = c.post(f"/api/projects/{pid}/activate")     # re-activate -> fresh pull
        assert r.status_code == 200
        import web.main as wm
        assert (wm.REPORTS_DIR / "ra.docx").exists()


def test_activate_swaps_mirror_between_projects(monkeypatch):
    with _client() as c:
        import web.main as wm
        pid_a = _make_project_with_report(c, "WS-1", "a_only.docx")
        pid_b = _make_project_with_report(c, "WS-2", "b_only.docx")
        c.post(f"/api/projects/{pid_a}/activate")
        assert (wm.REPORTS_DIR / "a_only.docx").exists()
        assert not (wm.REPORTS_DIR / "b_only.docx").exists()
        c.post(f"/api/projects/{pid_b}/activate")
        assert (wm.REPORTS_DIR / "b_only.docx").exists()
        assert not (wm.REPORTS_DIR / "a_only.docx").exists()
