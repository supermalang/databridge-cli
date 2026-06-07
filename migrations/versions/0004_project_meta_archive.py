"""project metadata (meta json) + soft-archive timestamp

Revision ID: 0004
Revises: 0003
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('projects', sa.Column(
        'meta',
        sa.JSON().with_variant(postgresql.JSONB(), 'postgresql'),
        nullable=False,
        server_default='{}'))
    op.add_column('projects', sa.Column(
        'archived_at', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column('projects', 'archived_at')
    op.drop_column('projects', 'meta')
