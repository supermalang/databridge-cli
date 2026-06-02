"""DB bootstrap: run migrations (prod) / create schema (tests), and import the legacy
single config.yml into a project exactly once."""
import logging
import os
from pathlib import Path

import yaml
from sqlalchemy.orm import Session

from src.utils.config import CONFIG_PATH
from web.db import session as dbs
from web.db import repository as repo
from web.db.models import User

log = logging.getLogger("databridge.db.bootstrap")

LEGACY_SLUG = "legacy-import"


def run_migrations() -> None:
    """Upgrade to head via Alembic, unless DATABRIDGE_SKIP_MIGRATIONS=1 (tests/dev sqlite),
    in which case create the schema directly."""
    if os.environ.get("DATABRIDGE_SKIP_MIGRATIONS") == "1":
        dbs.init_schema()
        return
    from alembic.config import Config
    from alembic import command
    root = Path(__file__).resolve().parent.parent.parent
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "migrations"))
    command.upgrade(cfg, "head")


def import_legacy_config(db: Session, owner: User, config_path: Path = CONFIG_PATH):
    """Create a project from the legacy config.yml once (tracked by LEGACY_SLUG in the
    owner's first org). Returns the project, or None if the file is absent."""
    config_path = Path(config_path)
    org_ids = repo._user_org_ids(db, owner)
    if not org_ids:
        return None
    org_id = org_ids[0]
    existing = db.query(repo.Project).filter_by(org_id=org_id, slug=LEGACY_SLUG).one_or_none()
    if existing is not None:
        return existing
    if not config_path.exists():
        return None
    cfg = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    name = (cfg.get("report", {}) or {}).get("title") or (cfg.get("form", {}) or {}).get("alias") or "Imported project"
    p = repo.Project(org_id=org_id, name=name, slug=LEGACY_SLUG, config=cfg, config_version=1)
    db.add(p)
    db.commit()
    db.refresh(p)
    if owner.active_project_id is None:
        owner.active_project_id = p.id
        db.commit()
    return p


def init_db() -> None:
    """Startup entry point: migrate, then ensure the dev user + legacy import when auth
    is disabled (dev). For real auth, provisioning happens at /auth/callback."""
    from web import auth
    from web.db import provision
    run_migrations()
    if not auth.auth_enabled():
        with dbs.SessionLocal() as db:
            dev = provision.ensure_dev_user(db)
            import_legacy_config(db, owner=dev)
