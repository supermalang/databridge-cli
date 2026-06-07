"""Membership-scoped CRUD over the app-state models. No FastAPI imports."""
import re
import uuid
from datetime import datetime, timezone
from typing import Optional, List

from sqlalchemy import select
from sqlalchemy.orm import Session

from web.db.models import User, Org, Membership, Project, ProjectMembership, Invitation


class AccessError(Exception):
    """Raised when a user acts on an org/project they're not a member of, or
    attempts a role transition they're not allowed to make."""


class StaleConfigError(Exception):
    """Raised when update_project_config is called with a stale expected_version."""


# Per-project role ranking. superadmin is global and outranks everything.
ROLE_RANK = {"viewer": 1, "editor": 2, "admin": 3, "superadmin": 4}
ASSIGNABLE_ROLES = ("viewer", "editor", "admin")


def role_for(db: Session, user: User, project: Project) -> Optional[str]:
    """The caller's effective role on a project, or None if no access.
    superadmin → 'superadmin'; the project owner → at least 'admin'; otherwise the
    ProjectMembership role."""
    if user is None:
        return None
    if getattr(user, "is_superadmin", False):
        return "superadmin"
    if project.owner_id is not None and project.owner_id == user.id:
        return "admin"
    pm = db.scalar(select(ProjectMembership).where(
        ProjectMembership.user_id == user.id, ProjectMembership.project_id == project.id))
    return pm.role if pm else None


def role_at_least(role: Optional[str], minimum: str) -> bool:
    """True when `role` meets/exceeds `minimum` in the rank order."""
    if role is None:
        return False
    return ROLE_RANK.get(role, 0) >= ROLE_RANK.get(minimum, 99)


def _slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s or "item"


def get_user_by_sub(db: Session, sub: str) -> Optional[User]:
    return db.scalar(select(User).where(User.zitadel_sub == sub))


def get_user_by_email(db: Session, email: str) -> Optional[User]:
    if not email:
        return None
    return db.scalar(select(User).where(User.email == email.lower()))


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
    """Projects the user can access — superadmins see all; everyone else sees the
    projects they hold a ProjectMembership on (plus any they own)."""
    if getattr(user, "is_superadmin", False):
        return list(db.scalars(select(Project).order_by(Project.created_at)))
    pids = set(db.scalars(select(ProjectMembership.project_id).where(
        ProjectMembership.user_id == user.id)))
    pids.update(db.scalars(select(Project.id).where(Project.owner_id == user.id)))
    if not pids:
        return []
    return list(db.scalars(select(Project).where(Project.id.in_(pids)).order_by(Project.created_at)))


def get_project_for_user(db: Session, user: User, project_id) -> Optional[Project]:
    p = db.get(Project, project_id)
    if p is None:
        return None
    return p if role_for(db, user, p) is not None else None


def _unique_project_slug(db: Session, org_id, base: str) -> str:
    slug, n = _slugify(base), 1
    while db.scalar(select(Project).where(Project.org_id == org_id, Project.slug == slug)) is not None:
        n += 1
        slug = f"{_slugify(base)}-{n}"
    return slug


def create_project(db: Session, user: User, name: str, org_id=None, config: dict = None,
                   meta: dict = None) -> Project:
    if org_id is None:
        ids = _user_org_ids(db, user)
        if not ids:
            raise AccessError("user has no org")
        org_id = ids[0]
    elif org_id not in _user_org_ids(db, user):
        raise AccessError("not a member of target org")
    p = Project(org_id=org_id, owner_id=user.id, name=name,
                slug=_unique_project_slug(db, org_id, name),
                config=config or {}, meta=meta or {}, config_version=1)
    db.add(p)
    db.commit()
    db.refresh(p)
    # The creator is the owner and an admin member of their own project.
    db.add(ProjectMembership(user_id=user.id, project_id=p.id, role="admin"))
    db.commit()
    return p


def update_project(db: Session, project: Project, *, name: str = None, meta: dict = None) -> Project:
    """Partial update of a project's name and/or metadata. `meta` keys are MERGED
    into the existing meta (pass an explicit value to overwrite a single key).

    PRECONDITION: callers MUST first obtain `project` via `get_project_for_user`
    and check the caller's role — this function performs no access check."""
    if name is not None:
        project.name = name
    if meta is not None:
        merged = dict(project.meta or {})
        merged.update(meta)
        project.meta = merged
    db.commit()
    db.refresh(project)
    return project


def archive_project(db: Session, project: Project, archived: bool) -> Project:
    """Soft-archive (set archived_at) or restore (clear it). No access check —
    caller must gate."""
    project.archived_at = datetime.now(timezone.utc) if archived else None
    db.commit()
    db.refresh(project)
    return project


def update_project_config(db: Session, project: Project, config: dict, expected_version: Optional[int] = None) -> Project:
    """Update a project's config (optimistic concurrency via expected_version).

    PRECONDITION: callers MUST first obtain `project` via `get_project_for_user`
    so the membership/tenant check is enforced — this function performs no access
    check of its own (it takes a Project, not a user)."""
    if expected_version is not None and expected_version != project.config_version:
        raise StaleConfigError(f"expected {expected_version}, have {project.config_version}")
    project.config = config
    project.config_version += 1
    db.commit()
    db.refresh(project)
    return project


def set_ai_verified(db: Session, project: Project, fingerprint: Optional[str]) -> None:
    """Persist (or clear, with None) the AI-config fingerprint verified for a project."""
    project.ai_verified_fingerprint = fingerprint
    db.commit()


def set_active_project(db: Session, user: User, project_id) -> User:
    if get_project_for_user(db, user, project_id) is None:
        raise AccessError("not a member of the project's org")
    user.active_project_id = project_id
    db.commit()
    db.refresh(user)
    return user


# --- project deletion -------------------------------------------------------

def delete_project(db: Session, project: Project) -> None:
    """Delete a project and its memberships/invitations. Clears it from any user's
    active_project_id first to avoid the FK. (Object-storage cleanup is the caller's job.)"""
    db.query(User).filter(User.active_project_id == project.id).update(
        {User.active_project_id: None}, synchronize_session=False)
    db.query(ProjectMembership).filter(ProjectMembership.project_id == project.id).delete(
        synchronize_session=False)
    db.query(Invitation).filter(Invitation.project_id == project.id).delete(
        synchronize_session=False)
    db.delete(project)
    db.commit()


# --- project membership management -----------------------------------------

def list_members(db: Session, project: Project) -> List[dict]:
    """All members of a project: {user_id, email, name, role, is_owner}."""
    rows = db.execute(
        select(ProjectMembership, User)
        .join(User, User.id == ProjectMembership.user_id)
        .where(ProjectMembership.project_id == project.id)
        .order_by(User.email)
    ).all()
    out = []
    for pm, u in rows:
        out.append({"user_id": str(u.id), "email": u.email, "name": u.name,
                    "role": pm.role, "is_owner": project.owner_id == u.id,
                    "is_superadmin": bool(u.is_superadmin)})
    return out


def set_member_role(db: Session, project: Project, target_user_id, new_role: str,
                    actor_role: str) -> None:
    """Change a member's role. Guards: role must be assignable; only the owner or a
    superadmin may modify the owner's row (#6)."""
    if new_role not in ASSIGNABLE_ROLES:
        raise AccessError(f"invalid role: {new_role}")
    target_user_id = _as_uuid(target_user_id)
    if project.owner_id == target_user_id and actor_role != "superadmin":
        raise AccessError("the project owner's role cannot be changed by another admin")
    pm = db.scalar(select(ProjectMembership).where(
        ProjectMembership.user_id == target_user_id,
        ProjectMembership.project_id == project.id))
    if pm is None:
        raise AccessError("not a member of this project")
    pm.role = new_role
    db.commit()


def remove_member(db: Session, project: Project, target_user_id, actor_role: str) -> None:
    """Remove a member. The owner can only be removed by a superadmin (#6)."""
    target_user_id = _as_uuid(target_user_id)
    if project.owner_id == target_user_id and actor_role != "superadmin":
        raise AccessError("the project owner cannot be removed by another admin")
    db.query(ProjectMembership).filter(
        ProjectMembership.user_id == target_user_id,
        ProjectMembership.project_id == project.id).delete(synchronize_session=False)
    # If the removed user had this as their active project, clear it.
    db.query(User).filter(User.id == target_user_id,
                          User.active_project_id == project.id).update(
        {User.active_project_id: None}, synchronize_session=False)
    db.commit()


# --- superadmin management --------------------------------------------------

def set_superadmin(db: Session, actor: User, target: User, value: bool) -> None:
    """Grant/revoke global superadmin. A superadmin cannot revoke ANOTHER
    superadmin (#10); self-demotion is allowed."""
    if not value and target.is_superadmin and target.id != actor.id:
        raise AccessError("a superadmin cannot revoke another superadmin")
    target.is_superadmin = bool(value)
    db.commit()


def apply_superadmin_emails(db: Session, emails: List[str]) -> int:
    """Set is_superadmin=True for any existing user whose email is in `emails`
    (case-insensitive). Returns the count updated. Used by the env-var bootstrap."""
    wanted = {e.strip().lower() for e in emails if e.strip()}
    if not wanted:
        return 0
    n = 0
    for u in db.scalars(select(User)):
        if u.email and u.email.lower() in wanted and not u.is_superadmin:
            u.is_superadmin = True
            n += 1
    if n:
        db.commit()
    return n


# --- invitations ------------------------------------------------------------

def get_or_create_invitation(db: Session, project: Project, email: str, role: str,
                             invited_by: User, zitadel_user_id: Optional[str] = None) -> Invitation:
    """Upsert a pending invite for (project, email)."""
    if role not in ASSIGNABLE_ROLES:
        raise AccessError(f"invalid role: {role}")
    email = (email or "").strip().lower()
    inv = db.scalar(select(Invitation).where(
        Invitation.project_id == project.id, Invitation.email == email))
    if inv is None:
        inv = Invitation(project_id=project.id, email=email, role=role,
                         status="pending", invited_by=invited_by.id,
                         zitadel_user_id=zitadel_user_id)
        db.add(inv)
    else:
        inv.role = role
        inv.status = "pending"
        inv.invited_by = invited_by.id
        if zitadel_user_id:
            inv.zitadel_user_id = zitadel_user_id
        inv.accepted_at = None
    db.commit()
    db.refresh(inv)
    return inv


def list_invitations(db: Session, project: Project, status: str = "pending") -> List[Invitation]:
    return list(db.scalars(select(Invitation).where(
        Invitation.project_id == project.id, Invitation.status == status)
        .order_by(Invitation.created_at)))


def revoke_invitation(db: Session, project: Project, email: str) -> None:
    email = (email or "").strip().lower()
    db.query(Invitation).filter(
        Invitation.project_id == project.id, Invitation.email == email,
        Invitation.status == "pending").update({Invitation.status: "revoked"},
                                               synchronize_session=False)
    db.commit()


def consume_invitations_for(db: Session, user: User) -> int:
    """On login: turn the user's pending invites (matched by email) into
    ProjectMemberships. Returns how many were accepted. Idempotent."""
    if not user.email:
        return 0
    invites = db.scalars(select(Invitation).where(
        Invitation.email == user.email.lower(), Invitation.status == "pending")).all()
    n = 0
    for inv in invites:
        existing = db.scalar(select(ProjectMembership).where(
            ProjectMembership.user_id == user.id,
            ProjectMembership.project_id == inv.project_id))
        if existing is None:
            db.add(ProjectMembership(user_id=user.id, project_id=inv.project_id, role=inv.role))
        else:
            existing.role = inv.role
        inv.status = "accepted"
        inv.accepted_at = datetime.now(timezone.utc)
        n += 1
    if n:
        db.commit()
    return n


def _as_uuid(value):
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))
