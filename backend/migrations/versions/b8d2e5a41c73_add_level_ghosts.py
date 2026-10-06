"""add level ghosts

Revision ID: b8d2e5a41c73
Revises: a3f1c7d29b40
Create Date: 2026-10-05 16:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'b8d2e5a41c73'
down_revision = 'a3f1c7d29b40'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('level_ghosts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('level_version_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('duration_ms', sa.Integer(), nullable=False),
    sa.Column('frames', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('set_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['level_version_id'], ['level_versions.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('level_version_id', name='uq_level_ghosts_level_version_id')
    )
    with op.batch_alter_table('level_ghosts', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_level_ghosts_user_id'), ['user_id'], unique=False)


def downgrade():
    with op.batch_alter_table('level_ghosts', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_level_ghosts_user_id'))
    op.drop_table('level_ghosts')