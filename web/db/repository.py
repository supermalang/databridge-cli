"""Membership-scoped CRUD over the app-state models. No FastAPI imports."""
import re
import uuid
from typing import Optional, List

from sqlalchemy import select
from sqlalchemy.orm import Session

from web.db.models import User, Org, Membership, Project


class AccessError(Exception):
    """Raised when a user acts on an org/project they're not a member of."""


class StaleConfigError(Exception):
    """Raised when update_project_config is called with a stale expected_version."""


def _slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s or "item"


def get_user_by_sub(db: Session, sub: str) -> Optional[User]:
    return db.scalar(select(User).where(User.zitadel_sub == sub))


def upsert_user(db: Session, sub: str, email: str, name: str) -> User:
    u = get_user_by_sub(db, sub)
    if u is None:
        u = User(zitadel_sub=sub, email=email or "", name=name or "")
        db.add(u)
    else:
        u.email = email or u.email
        u.name = name or u.name
    db.commit()
    db.refresh(u)
    return u


def _unique_org_slug(db: Session, base: str) -> str:
    slug, n = _slugify(base), 1
    while db.scalar(select(Org).where(Org.slug == slug)) is not None:
        n += 1
        slug = f"{_slugify(base)}-{n}"
    return slug


def create_org(db: Session, name: str, slug: str, owner: User) -> Org:
    org = Org(name=name, slug=_unique_org_slug(db, slug), created_by=owner.id)
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


def add_membership(db: Session, user: User, org: Org, role: str = "member") -> Membership:
    m = Membership(user_id=user.id, org_id=org.id, role=role)
    db.add(m)
    db.commit()
    return m


def _user_org_ids(db: Session, user: User) -> List[uuid.UUID]:
    return list(db.scalars(select(Membership.org_id).where(Membership.user_id == user.id)))


def list_projects_for_user(db: Session, user: User) -> List[Project]:
    org_ids = _user_org_ids(db, user)
    if not org_ids:
        return []
    return list(db.scalars(select(Project).where(Project.org_id.in_(org_ids)).order_by(Project.created_at)))


def get_project_for_user(db: Session, user: User, project_id) -> Optional[Project]:
    p = db.get(Project, project_id)
    if p is None or p.org_id not in _user_org_ids(db, user):
        return None
    return p


def _unique_project_slug(db: Session, org_id, base: str) -> str:
    slug, n = _slugify(base), 1
    while db.scalar(select(Project).where(Project.org_id == org_id, Project.slug == slug)) is not None:
        n += 1
        slug = f"{_slugify(base)}-{n}"
    return slug


def create_project(db: Session, user: User, name: str, org_id=None, config: dict = None) -> Project:
    if org_id is None:
        ids = _user_org_ids(db, user)
        if not ids:
            raise AccessError("user has no org")
        org_id = ids[0]
    elif org_id not in _user_org_ids(db, user):
        raise AccessError("not a member of target org")
    p = Project(org_id=org_id, name=name, slug=_unique_project_slug(db, org_id, name),
                config=config or {}, config_version=1)
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def update_project_config(db: Session, project: Project, config: dict, expected_version: Optional[int] = None) -> Project:
    if expected_version is not None and expected_version != project.config_version:
        raise StaleConfigError(f"expected {expected_version}, have {project.config_version}")
    project.config = config
    project.config_version += 1
    db.commit()
    db.refresh(project)
    return project


def set_active_project(db: Session, user: User, project_id) -> User:
    if get_project_for_user(db, user, project_id) is None:
        raise AccessError("not a member of the project's org")
    user.active_project_id = project_id
    db.commit()
    db.refresh(user)
    return user
