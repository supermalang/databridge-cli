"""Materialize a project's config (jsonb) to config.yml so the file-based CLI and
the existing config-reading endpoints keep working. Interim until Slice 3 hydration."""
from pathlib import Path
from sqlalchemy.orm import Session

from src.utils.config import write_config, CONFIG_PATH
from web.db import repository as repo
from web.db.models import Project, User


def materialize_config(project: Project, path: Path = CONFIG_PATH) -> None:
    write_config(project.config or {}, Path(path))


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
