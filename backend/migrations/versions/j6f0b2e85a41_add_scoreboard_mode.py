"""add scoreboard mode to endless runs

endless_runs.mode ('endless' | 'scoreboard'), endless_runs.score, and
endless_run_levels.points (what a clear was worth when the level was
served). Existing runs are endless runs with a score of 0.

Revision ID: j6f0b2e85a41
Revises: i5e9a1d74f30
Create Date: 2026-10-08 14:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'j6f0b2e85a41'
down_revision = 'i5e9a1d74f30'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('endless_runs', sa.Column('mode', sa.String(length=20), server_default='endless', nullable=False))
    op.add_column('endless_runs', sa.Column('score', sa.Integer(), server_default='0', nullable=False))
    op.add_column('endless_run_levels', sa.Column('points', sa.Integer(), nullable=True))


def downgrade():
    op.drop_column('endless_run_levels', 'points')
    op.drop_column('endless_runs', 'score')
    op.drop_column('endless_runs', 'mode')