import os
from web.db import session as dbs
from web.db.models import User


def test_engine_and_init_schema_roundtrip(tmp_path, monkeypatch):
    db_file = tmp_path / "t.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_file}")
    dbs.reset_engine()
    dbs.init_schema()
    with dbs.SessionLocal() as s:
        s.add(User(zitadel_sub="abc", email="a@b.io", name="A"))
        s.commit()
        got = s.query(User).filter_by(zitadel_sub="abc").one()
        assert got.email == "a@b.io"
    dbs.reset_engine()


def test_get_db_yields_and_closes(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'u.db'}")
    dbs.reset_engine()
    dbs.init_schema()
    gen = dbs.get_db()
    db = next(gen)
    try:
        assert db.query(User).count() == 0
    finally:
        gen.close()
    dbs.reset_engine()
