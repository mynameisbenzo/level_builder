"""remove level versions: publishing is final

A published level is now immutable and there are no versions. Content,
thumbnail and difficulty move onto `levels`; ghosts and endless-run rows
point at the level instead of a version.

Data handling (a level with several versions collapses to its latest):
- each published level takes its content, beaten_at, thumbnail and
  difficulty from the version `latest_published_version_id` points at;
- a published level that an edit had demoted to TESTING is PUBLISHED again,
  and any unpublished edit sitting in draft_content is discarded in favour
  of the published content (the edit was never live);
- a ghost on the latest version is kept (re-pointed at its level); ghosts
  on older versions are dropped;
- endless_run_levels already had level_id, so its level_version_id column
  is simply dropped.

Revision ID: c4e9f1a62d85
Revises: b8d2e5a41c73
Create Date: 2026-10-05 19:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'c4e9f1a62d85'
down_revision = 'b8d2e5a41c73'
branch_labels = None
depends_on = None


def upgrade():
    # 1. New columns on levels.
    with op.batch_alter_table('levels', schema=None) as batch_op:
        batch_op.add_column(sa.Column('published_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('difficulty_label_cached', sa.String(length=20), nullable=True))

    # 2. Pull each published level's live version up onto the level.
    op.execute("""
        UPDATE levels SET
            draft_content = (
                SELECT v.content FROM level_versions v WHERE v.id = levels.latest_published_version_id
            ),
            draft_beaten_at = (
                SELECT v.beaten_at FROM level_versions v WHERE v.id = levels.latest_published_version_id
            ),
            published_at = COALESCE(
                (SELECT v.created_at FROM level_versions v WHERE v.id = levels.latest_published_version_id),
                levels.created_at,
                CURRENT_TIMESTAMP
            ),
            difficulty_label_cached = (
                SELECT v.difficulty_label_cached FROM level_versions v
                WHERE v.id = levels.latest_published_version_id
            ),
            thumbnail_url = COALESCE(
                levels.thumbnail_url,
                (SELECT v.thumbnail_url FROM level_versions v WHERE v.id = levels.latest_published_version_id)
            ),
            visibility_state = CASE
                WHEN levels.is_deleted THEN levels.visibility_state
                ELSE 'PUBLISHED'
            END
        WHERE latest_published_version_id IS NOT NULL
    """)

    # Remix lineage pointed at a specific version; the level it belongs to
    # is all that's kept. (No remix endpoint exists yet, so this should
    # touch nothing - it's here so no lineage could ever be lost.)
    op.execute("""
        UPDATE levels SET remixed_from_level_id = (
            SELECT v.level_id FROM level_versions v WHERE v.id = levels.remixed_from_version_id
        )
        WHERE remixed_from_version_id IS NOT NULL AND remixed_from_level_id IS NULL
    """)

    # 3. Ghosts: re-point at the level. Only a ghost on the level's CURRENT
    # version survives (it matches the content the level now has).
    with op.batch_alter_table('level_ghosts', schema=None) as batch_op:
        batch_op.add_column(sa.Column('level_id', sa.Integer(), nullable=True))

    op.execute("""
        UPDATE level_ghosts SET level_id = (
            SELECT l.id FROM levels l WHERE l.latest_published_version_id = level_ghosts.level_version_id
        )
    """)
    op.execute("DELETE FROM level_ghosts WHERE level_id IS NULL")

    with op.batch_alter_table('level_ghosts', schema=None) as batch_op:
        batch_op.alter_column('level_id', existing_type=sa.Integer(), nullable=False)
        batch_op.create_foreign_key('fk_level_ghosts_level_id', 'levels', ['level_id'], ['id'])
        batch_op.create_unique_constraint('uq_level_ghosts_level_id', ['level_id'])
        # Dropping the column also drops its foreign key and its unique
        # constraint.
        batch_op.drop_column('level_version_id')

    # 4. Endless run levels already carry level_id.
    with op.batch_alter_table('endless_run_levels', schema=None) as batch_op:
        batch_op.drop_column('level_version_id')

    # 5. Drop the version pointers (the circular FKs first), then the table.
    op.drop_constraint('fk_levels_remixed_from_version_id', 'levels', type_='foreignkey')
    op.drop_constraint('fk_levels_latest_published_version_id', 'levels', type_='foreignkey')
    with op.batch_alter_table('levels', schema=None) as batch_op:
        batch_op.drop_column('remixed_from_version_id')
        batch_op.drop_column('latest_published_version_id')

    op.drop_table('level_versions')


def downgrade():
    # Best effort. Version history can't come back (it was collapsed), so
    # every published level is restored with exactly one version, v1.
    op.create_table('level_versions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('level_id', sa.Integer(), nullable=False),
    sa.Column('version_number', sa.Integer(), nullable=False),
    sa.Column('content', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('beaten_at', sa.DateTime(), nullable=True),
    sa.Column('clear_rate_cached', sa.Float(), nullable=True),
    sa.Column('difficulty_label_cached', sa.String(length=20), nullable=True),
    sa.Column('thumbnail_url', sa.String(length=500), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['level_id'], ['levels.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('level_id', 'version_number', name='uq_level_versions_level_id_version_number')
    )

    op.execute("""
        INSERT INTO level_versions
            (level_id, version_number, content, beaten_at, difficulty_label_cached, thumbnail_url, created_at)
        SELECT id, 1, draft_content, draft_beaten_at, difficulty_label_cached, thumbnail_url, published_at
        FROM levels
        WHERE published_at IS NOT NULL AND draft_content IS NOT NULL
    """)

    with op.batch_alter_table('levels', schema=None) as batch_op:
        batch_op.add_column(sa.Column('latest_published_version_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('remixed_from_version_id', sa.Integer(), nullable=True))

    op.execute("""
        UPDATE levels SET latest_published_version_id = (
            SELECT v.id FROM level_versions v WHERE v.level_id = levels.id AND v.version_number = 1
        )
        WHERE published_at IS NOT NULL
    """)

    op.create_foreign_key(
        'fk_levels_latest_published_version_id',
        'levels', 'level_versions',
        ['latest_published_version_id'], ['id'],
    )
    op.create_foreign_key(
        'fk_levels_remixed_from_version_id',
        'levels', 'level_versions',
        ['remixed_from_version_id'], ['id'],
    )

    # Endless run levels and ghosts get their version back.
    with op.batch_alter_table('endless_run_levels', schema=None) as batch_op:
        batch_op.add_column(sa.Column('level_version_id', sa.Integer(), nullable=True))
    op.execute("""
        UPDATE endless_run_levels SET level_version_id = (
            SELECT v.id FROM level_versions v
            WHERE v.level_id = endless_run_levels.level_id AND v.version_number = 1
        )
    """)
    with op.batch_alter_table('endless_run_levels', schema=None) as batch_op:
        batch_op.alter_column('level_version_id', existing_type=sa.Integer(), nullable=False)
        batch_op.create_foreign_key(
            'endless_run_levels_level_version_id_fkey', 'level_versions', ['level_version_id'], ['id']
        )

    with op.batch_alter_table('level_ghosts', schema=None) as batch_op:
        batch_op.add_column(sa.Column('level_version_id', sa.Integer(), nullable=True))
    op.execute("""
        UPDATE level_ghosts SET level_version_id = (
            SELECT v.id FROM level_versions v
            WHERE v.level_id = level_ghosts.level_id AND v.version_number = 1
        )
    """)
    with op.batch_alter_table('level_ghosts', schema=None) as batch_op:
        batch_op.alter_column('level_version_id', existing_type=sa.Integer(), nullable=False)
        batch_op.create_foreign_key(
            'level_ghosts_level_version_id_fkey', 'level_versions', ['level_version_id'], ['id']
        )
        batch_op.create_unique_constraint('uq_level_ghosts_level_version_id', ['level_version_id'])
        batch_op.drop_constraint('uq_level_ghosts_level_id', type_='unique')
        batch_op.drop_constraint('fk_level_ghosts_level_id', type_='foreignkey')
        batch_op.drop_column('level_id')

    with op.batch_alter_table('levels', schema=None) as batch_op:
        batch_op.drop_column('difficulty_label_cached')
        batch_op.drop_column('published_at')