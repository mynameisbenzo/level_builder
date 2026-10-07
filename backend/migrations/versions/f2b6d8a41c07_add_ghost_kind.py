"""add ghost kind: a level can hold a full, a before and an after ghost

A level with a checkpoint keeps up to three ghosts (spawn -> finish for a
run that skips the checkpoint, spawn -> checkpoint, and checkpoint ->
finish), each with its own holder. Every existing ghost is a full one, so
the new column defaults to 'full' and nothing is rewritten. The unique
constraint widens from (level_id) to (level_id, kind).

Revision ID: f2b6d8a41c07
Revises: e7a3b9d14f62
Create Date: 2026-10-06 18:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f2b6d8a41c07'
down_revision = 'e7a3b9d14f62'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('level_ghosts', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('kind', sa.String(length=10), server_default='full', nullable=False)
        )
        batch_op.drop_constraint('uq_level_ghosts_level_id', type_='unique')
        batch_op.create_unique_constraint('uq_level_ghosts_level_id_kind', ['level_id', 'kind'])


def downgrade():
    # Only the full ghost fits the old one-per-level shape.
    op.execute("DELETE FROM level_ghosts WHERE kind <> 'full'")
    with op.batch_alter_table('level_ghosts', schema=None) as batch_op:
        batch_op.drop_constraint('uq_level_ghosts_level_id_kind', type_='unique')
        batch_op.create_unique_constraint('uq_level_ghosts_level_id', ['level_id'])
        batch_op.drop_column('kind')