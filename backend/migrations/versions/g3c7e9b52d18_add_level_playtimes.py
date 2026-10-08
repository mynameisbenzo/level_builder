"""add level_playtimes: a player's running total of time spent on a level

One row per (user, level), kept on the server so reloading or leaving the
page can't reset it. Grown by playtime heartbeats and deleted when the
player wins. See app/services/playtime.py.

Revision ID: g3c7e9b52d18
Revises: f2b6d8a41c07
Create Date: 2026-10-07 17:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'g3c7e9b52d18'
down_revision = 'f2b6d8a41c07'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('level_playtimes',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('level_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('total_ms', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('last_heartbeat_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['level_id'], ['levels.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('level_id', 'user_id', name='uq_level_playtimes_level_id_user_id')
    )
    with op.batch_alter_table('level_playtimes', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_level_playtimes_user_id'), ['user_id'], unique=False)


def downgrade():
    with op.batch_alter_table('level_playtimes', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_level_playtimes_user_id'))

    op.drop_table('level_playtimes')