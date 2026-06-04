import yaml
import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _isolated_base(tmp_path, monkeypatch):
    """Activate pulls the project's workspace from Minio into BASE_DIR's mirror dirs
    (clearing top-level files first). Redirect BASE_DIR to a temp dir so this test
    never clears the real repo data/processed, reports, templates dirs."""
    import web.main as wm
    monkeypatch.setattr(wm, "BASE_DIR", tmp_path)
    for sub in ("data/processed", "reports", "templates"):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)
    return tmp_path


def _client():
    from web.main import app
    return TestClient(app)


def test_question_edits_survive_rematerialization():
    with _client() as c:
        # establish a known config on the active project
        base = {"api": {"platform": "kobo", "url": "u", "token": "t"},
                "form": {"uid": "U", "alias": "demo"},
                "questions": [{"kobo_key": "q1", "export_label": "Q1"}]}
        assert c.post("/api/config", json={"content": yaml.safe_dump(base)}).status_code == 200
        # edit questions via the dedicated endpoint
        edited = [{"kobo_key": "q1", "export_label": "RENAMED"}]
        assert c.post("/api/questions", json={"questions": edited}).status_code == 200
        # force a re-materialization of config.yml FROM the DB (activate the same project)
        active_id = c.get("/api/projects").json()["active_id"]
        c.post(f"/api/projects/{active_id}/activate")
        # the edit must have been persisted to the DB, so it survives
        got = yaml.safe_load(c.get("/api/config").json()["content"])
        assert got["questions"][0]["export_label"] == "RENAMED"
