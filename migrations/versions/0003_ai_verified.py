"""persist AI-connection verification per project

Revision ID: 0003
Revises: 0002
"""
from alembic import op
import sqlalchemy as sa


revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('projects', sa.Column('ai_verified_fingerprint', sa.String(length=64), nullable=True))


def downgrade():
    op.drop_column('projects', 'ai_verified_fingerprint')
