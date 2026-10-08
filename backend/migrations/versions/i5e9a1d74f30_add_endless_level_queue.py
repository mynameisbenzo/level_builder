"""add endless_runs.level_queue: the run's shuffled list of levels to serve

Revision ID: i5e9a1d74f30
Revises: h4d8f0c63e29
Create Date: 2026-10-08 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'i5e9a1d74f30'
down_revision = 'h4d8f0c63e29'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('endless_runs', sa.Column('level_queue', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('endless_runs', 'level_queue')