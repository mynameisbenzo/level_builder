"""add endless mode tables

Revision ID: a3f1c7d29b40
Revises: 8ff7c4e70250
Create Date: 2026-10-05 15:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a3f1c7d29b40'
down_revision = '8ff7c4e70250'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('endless_runs',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('difficulty', sa.String(length=20), nullable=True),
    sa.Column('starting_lives', sa.Integer(), nullable=False),
    sa.Column('lives_remaining', sa.Integer(), nullable=False),
    sa.Column('levels_cleared', sa.Integer(), nullable=False),
    sa.Column('deaths', sa.Integer(), nullable=False),
    sa.Column('skips', sa.Integer(), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('end_reason', sa.Enum('OUT_OF_LIVES', 'FORFEITED', 'EXPIRED', name='endless_run_end_reason'), nullable=True),
    sa.Column('started_at', sa.DateTime(), nullable=False),
    sa.Column('last_activity_at', sa.DateTime(), nullable=False),
    sa.Column('ended_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('endless_runs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_endless_runs_user_id'), ['user_id'], unique=False)
        # At most one active run per user, enforced by the database
        # itself rather than only in application code.
        batch_op.create_index(
            'uq_endless_runs_one_active_per_user',
            ['user_id'],
            unique=True,
            postgresql_where=sa.text('is_active'),
            sqlite_where=sa.text('is_active'),
        )

    op.create_table('endless_run_levels',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('run_id', sa.Integer(), nullable=False),
    sa.Column('level_id', sa.Integer(), nullable=False),
    sa.Column('level_version_id', sa.Integer(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('outcome', sa.Enum('ACTIVE', 'CLEARED', 'SKIPPED', 'FAILED', 'ABANDONED', name='endless_run_level_outcome'), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('deaths', sa.Integer(), nullable=False),
    sa.Column('attempt_started_at', sa.DateTime(), nullable=True),
    sa.Column('attempt_last_seen_at', sa.DateTime(), nullable=True),
    sa.Column('served_at', sa.DateTime(), nullable=False),
    sa.Column('resolved_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['level_id'], ['levels.id'], ),
    sa.ForeignKeyConstraint(['level_version_id'], ['level_versions.id'], ),
    sa.ForeignKeyConstraint(['run_id'], ['endless_runs.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('run_id', 'position', name='uq_endless_run_levels_run_id_position')
    )
    with op.batch_alter_table('endless_run_levels', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_endless_run_levels_level_id'), ['level_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_endless_run_levels_run_id'), ['run_id'], unique=False)

    op.create_table('endless_life_losses',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('run_id', sa.Integer(), nullable=False),
    sa.Column('reason', sa.Enum('DEATH', 'SKIP', 'ABANDONED', name='endless_life_loss_reason'), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['run_id'], ['endless_runs.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('endless_life_losses', schema=None) as batch_op:
        batch_op.create_index('ix_endless_life_losses_user_id_created_at', ['user_id', 'created_at'], unique=False)


def downgrade():
    with op.batch_alter_table('endless_life_losses', schema=None) as batch_op:
        batch_op.drop_index('ix_endless_life_losses_user_id_created_at')
    op.drop_table('endless_life_losses')

    with op.batch_alter_table('endless_run_levels', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_endless_run_levels_run_id'))
        batch_op.drop_index(batch_op.f('ix_endless_run_levels_level_id'))
    op.drop_table('endless_run_levels')

    with op.batch_alter_table('endless_runs', schema=None) as batch_op:
        batch_op.drop_index('uq_endless_runs_one_active_per_user')
        batch_op.drop_index(batch_op.f('ix_endless_runs_user_id'))
    op.drop_table('endless_runs')

    # op.drop_table() leaves the ENUM types behind on Postgres (see the
    # initial schema's downgrade) - dropped explicitly so a downgrade
    # really returns the database to its pre-migration state.
    sa.Enum(name='endless_life_loss_reason').drop(op.get_bind(), checkfirst=False)
    sa.Enum(name='endless_run_level_outcome').drop(op.get_bind(), checkfirst=False)
    sa.Enum(name='endless_run_end_reason').drop(op.get_bind(), checkfirst=False)