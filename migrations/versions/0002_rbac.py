"""per-project rbac: project_memberships, invitations, project owner, superadmin

Revision ID: 0002
Revises: 0001
"""
import uuid as _uuid
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade():
    # --- schema additions ---
    op.add_column('users', sa.Column('is_superadmin', sa.Boolean(), nullable=False,
                                     server_default=sa.false()))
    op.add_column('projects', sa.Column('owner_id', sa.Uuid(), nullable=True))
    op.create_foreign_key('fk_project_owner', 'projects', 'users', ['owner_id'], ['id'])

    op.create_table('project_memberships',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('project_id', sa.Uuid(), nullable=False),
        sa.Column('role', sa.String(length=32), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'project_id', name='uq_pmember_user_project'),
    )
    op.create_index(op.f('ix_project_memberships_project_id'), 'project_memberships', ['project_id'])
    op.create_index(op.f('ix_project_memberships_user_id'), 'project_memberships', ['user_id'])

    op.create_table('invitations',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('project_id', sa.Uuid(), nullable=False),
        sa.Column('email', sa.String(length=320), nullable=False),
        sa.Column('role', sa.String(length=32), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('invited_by', sa.Uuid(), nullable=True),
        sa.Column('zitadel_user_id', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
        sa.ForeignKeyConstraint(['invited_by'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'email', name='uq_invite_project_email'),
    )
    op.create_index(op.f('ix_invitations_email'), 'invitations', ['email'])
    op.create_index(op.f('ix_invitations_project_id'), 'invitations', ['project_id'])

    # --- backfill: every existing project gets an owner + per-project memberships ---
    # Map each project to its org's members: org creator/owner -> admin, others -> editor.
    conn = op.get_bind()
    now = datetime.now(timezone.utc)
    projects = conn.execute(sa.text("SELECT id, org_id FROM projects")).fetchall()
    for pid, org_id in projects:
        created_by = conn.execute(
            sa.text("SELECT created_by FROM orgs WHERE id = :o"), {"o": org_id}).scalar()
        if created_by is not None:
            conn.execute(sa.text("UPDATE projects SET owner_id = :u WHERE id = :p"),
                         {"u": created_by, "p": pid})
        members = conn.execute(
            sa.text("SELECT user_id, role FROM memberships WHERE org_id = :o"),
            {"o": org_id}).fetchall()
        for user_id, role in members:
            is_owner = (created_by is not None and user_id == created_by) or role == "owner"
            conn.execute(
                sa.text("INSERT INTO project_memberships "
                        "(id, user_id, project_id, role, created_at) "
                        "VALUES (:id, :u, :p, :r, :t)"),
                {"id": _uuid.uuid4(), "u": user_id, "p": pid,
                 "r": "admin" if is_owner else "editor", "t": now})


def downgrade():
    op.drop_index(op.f('ix_invitations_project_id'), table_name='invitations')
    op.drop_index(op.f('ix_invitations_email'), table_name='invitations')
    op.drop_table('invitations')
    op.drop_index(op.f('ix_project_memberships_user_id'), table_name='project_memberships')
    op.drop_index(op.f('ix_project_memberships_project_id'), table_name='project_memberships')
    op.drop_table('project_memberships')
    op.drop_constraint('fk_project_owner', 'projects', type_='foreignkey')
    op.drop_column('projects', 'owner_id')
    op.drop_column('users', 'is_superadmin')
