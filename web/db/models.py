"""SQLAlchemy ORM models for the multi-tenant app state (users/orgs/projects)."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import (JSON, Boolean, Integer, String, DateTime, ForeignKey,
                        UniqueConstraint, Uuid)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, mapped_column, Mapped


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    zitadel_sub: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(320), default="")
    name: Mapped[str] = mapped_column(String(255), default="")
    active_project_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("projects.id", use_alter=True, name="fk_user_active_project"), nullable=True)
    is_superadmin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Org(Base):
    __tablename__ = "orgs"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("user_id", "org_id", name="uq_membership_user_org"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False, index=True)
    org_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("orgs.id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="member")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("org_id", "slug", name="uq_project_org_slug"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("orgs.id"), nullable=False, index=True)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False)
    config: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=False, default=dict)
    config_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # Fingerprint of the AI config last verified via /api/ai/test (provider+model+base_url+
    # resolved key). The AI guard treats the project as "verified" when this matches the
    # current saved config; an AI-call failure clears it, re-locking the AI buttons.
    ai_verified_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Project metadata edited in the project form: description, tags (list[str]),
    # language, color, icon. Kept separate from `config` (which mirrors config.yml).
    meta: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=False, default=dict)
    # Soft-archive timestamp; NULL ⇒ active. Archived projects are hidden from the
    # default switcher view but recoverable.
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class ProjectMembership(Base):
    """Per-project role assignment — the authority for project access.
    role ∈ {viewer, editor, admin}. The project's owner_id is an implicit admin
    that other admins cannot remove/demote."""
    __tablename__ = "project_memberships"
    __table_args__ = (UniqueConstraint("user_id", "project_id", name="uq_pmember_user_project"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False, index=True)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("projects.id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="viewer")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Invitation(Base):
    """A pending project invite, keyed by email. Consumed on the invitee's first login
    (matched by email) → creates a ProjectMembership. status ∈ {pending, accepted, revoked}."""
    __tablename__ = "invitations"
    __table_args__ = (UniqueConstraint("project_id", "email", name="uq_invite_project_email"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("projects.id"), nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="viewer")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    invited_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"), nullable=True)
    zitadel_user_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
