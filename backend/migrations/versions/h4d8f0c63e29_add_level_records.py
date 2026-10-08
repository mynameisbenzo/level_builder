"""add level_records: the fastest total playtime for each level

One row per level, with its own holder (separate from the ghosts). A
strictly faster win replaces the row. See app/services/playtime.py.

Revision ID: h4d8f0c63e29
Revises: g3c7e9b52d18
Create Date: 2026-10-07 18:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'h4d8f0c63e29'
down_revision = 'g3c7e9b52d18'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('level_records',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('level_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('total_ms', sa.Integer(), nullable=False),
    sa.Column('set_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['level_id'], ['levels.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('level_id', name='uq_level_records_level_id')
    )
    with op.batch_alter_table('level_records', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_level_records_user_id'), ['user_id'], unique=False)


def downgrade():
    with op.batch_alter_table('level_records', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_level_records_user_id'))

    op.drop_table('level_records')