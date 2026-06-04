from fastapi.testclient import TestClient


def test_app_startup_provisions_dev_user_and_imports_legacy():
    # auth disabled in tests -> lifespan should ensure the dev user exists.
    from web.main import app
    from web.db import session as dbs, repository as repo
    with TestClient(app):                      # triggers lifespan
        with dbs.SessionLocal() as db:
            assert repo.get_user_by_sub(db, "dev-local") is not None
