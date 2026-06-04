import pytest
from web.db import session as dbs
from web.db import bootstrap, provision, repository as repo
from web.storage import factory


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'bw.db'}")
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.setenv("STORAGE_LOCAL_DIR", str(tmp_path / "minio"))
    dbs.reset_engine(); dbs.init_schema(); factory.reset_storage()
    s = dbs.SessionLocal()
    yield s
    s.close(); dbs.reset_engine(); factory.reset_storage()


def test_import_legacy_workspace_pushes_once(tmp_path, db):
    u = provision.ensure_dev_user(db)
    org_id = str(repo._user_org_ids(db, u)[0])
    base = tmp_path / "repo"
    (base / "reports").mkdir(parents=True)
    (base / "reports" / "legacy.docx").write_bytes(b"OLD")
    (base / "data" / "processed").mkdir(parents=True)
    (base / "templates").mkdir()
    proj = repo.create_project(db, user=u, name="Legacy", org_id=repo._user_org_ids(db, u)[0])

    n1 = bootstrap.import_legacy_workspace(db, proj, base=base)
    assert n1 == 1
    store = factory.get_storage()
    assert any("legacy.docx" in k for k in store.list(f"orgs/{org_id}/projects/{proj.id}/"))
    n2 = bootstrap.import_legacy_workspace(db, proj, base=base)   # idempotent
    assert n2 == 0
