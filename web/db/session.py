"""Lazy SQLAlchemy engine + session, configured from DATABASE_URL at first use."""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from web.db.models import Base

_engine = None
_SessionLocal = None


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set. Point it at Postgres (or sqlite for tests).")
    return url


def get_engine():
    global _engine, _SessionLocal
    if _engine is None:
        url = _database_url()
        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        _engine = create_engine(url, future=True, connect_args=connect_args)
        _SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False, class_=Session)
    return _engine


def reset_engine() -> None:
    """Dispose the engine so the next call re-reads DATABASE_URL (used by tests)."""
    global _engine, _SessionLocal
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionLocal = None


def SessionLocal() -> Session:
    get_engine()
    return _SessionLocal()


def init_schema() -> None:
    """Create all tables directly (used by tests and as a fallback). Idempotent."""
    Base.metadata.create_all(get_engine())


def get_db():
    """FastAPI dependency: yield a session, always close it."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
