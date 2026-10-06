"""add play_attempts: the source of truth for a level's clear rate

One row per real playthrough attempt of a published level by a registered
(non-owner) player. Feeds Level.difficulty_label_cached - see
app/services/difficulty.py.

No backfill: attempts made before this table existed were never recorded
per user, so existing levels start with no label and earn one as new
attempts come in.

Revision ID: e7a3b9d14f62
Revises: c4e9f1a62d85
Create Date: 2026-10-06 11:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e7a3b9d14f62'
down_revision = 'c4e9f1a62d85'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('play_attempts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('level_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('source', sa.String(length=10), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('completed_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['level_id'], ['levels.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('play_attempts', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_play_attempts_level_id'), ['level_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_play_attempts_user_id'), ['user_id'], unique=False)


def downgrade():
    with op.batch_alter_table('play_attempts', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_play_attempts_user_id'))
        batch_op.drop_index(batch_op.f('ix_play_attempts_level_id'))

    op.drop_table('play_attempts')