"""Materialize a project's config (jsonb) to config.yml so the file-based CLI and
the existing config-reading endpoints keep working. Interim until Slice 3 hydration."""
from pathlib import Path
from sqlalchemy.orm import Session

from src.utils.config import write_config, CONFIG_PATH
from web.db import repository as repo
from web.db.models import Project, User


def _inject_project_language(project: Project, cfg: dict) -> dict:
    """Set cfg["ai"]["language"] from the project language (single source of truth).

    A project's `meta.language` (set once at creation, immutable) overrides any
    value previously stored in `ai.language`. Legacy projects with no
    `meta.language` keep their existing `ai.language`, else default to "English"."""
    meta = project.meta or {}
    project_language = meta.get("language")
    ai = dict(cfg.get("ai") or {})
    if project_language:
        ai["language"] = project_language
    elif "language" not in ai:
        ai["language"] = "English"
    cfg["ai"] = ai
    return cfg


def materialize_config(project: Project, path: Path = CONFIG_PATH) -> None:
    cfg = dict(project.config or {})
    cfg = _inject_project_language(project, cfg)
    write_config(cfg, Path(path))


def mirror_active(db: Session, user: User, path: Path = CONFIG_PATH) -> bool:
    """Write the user's active project's config to `path`. Returns False if the user
    has no active project (file left untouched)."""
    if user.active_project_id is None:
        return False
    project = repo.get_project_for_user(db, user, user.active_project_id)
    if project is None:
        return False
    materialize_config(project, path)
    return True
