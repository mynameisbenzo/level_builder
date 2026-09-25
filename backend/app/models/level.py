import enum

from sqlalchemy.dialects.postgresql import JSONB

from app.extensions import db
from app.utils.slugs import generate_slug
from app.utils.time import utc_now


class LevelVisibilityState(enum.Enum):
    DRAFT = "draft"
    TESTING = "testing"
    PUBLISHED = "published"
    # Distinct from DRAFT - a level that was live and got deliberately
    # taken down still went through publishing once; collapsing it back
    # to DRAFT would lose that history for no real benefit.
    UNPUBLISHED = "unpublished"


class Level(db.Model):
    """
    The persistent identity of a level across all its versions - what a
    share link/slug points at. Content itself lives on LevelVersion;
    this row tracks ownership, current lifecycle state, and lineage.
    """

    __tablename__ = "levels"

    id = db.Column(db.Integer, primary_key=True)
    owner_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    title = db.Column(db.String(120), nullable=False)
    # Public share-URL identifier - see app/utils/slugs.py for the format
    # and why the raw id above never gets exposed in its place.
    slug = db.Column(db.String(19), unique=True, nullable=False, default=generate_slug)

    visibility_state = db.Column(
        db.Enum(LevelVisibilityState, name="level_visibility_state"),
        nullable=False,
        default=LevelVisibilityState.DRAFT,
    )

    # Points at whichever LevelVersion is currently the public, playable
    # one. Set when a version is first published; stays pointing at the
    # same (still-live) version through an edit-triggered demotion back
    # to testing, since the last published version stays visible to
    # everyone else while a replacement is being worked on. Cleared
    # entirely (set to NULL) by a direct unpublish action - that's what
    # actually distinguishes "unpublish" from "demoted mid-edit" at the
    # data level. Both leave visibility_state != PUBLISHED, but only
    # unpublish clears this pointer.
    #
    # use_alter=True breaks the circular dependency with level_versions
    # (which itself FKs back to levels.id) - without it, neither table
    # could be created first since each would reference a table that
    # doesn't exist yet. This defers the FK to a separate ALTER TABLE
    # after both tables exist.
    latest_published_version_id = db.Column(
        db.Integer,
        db.ForeignKey(
            "level_versions.id",
            use_alter=True,
            name="fk_levels_latest_published_version_id",
        ),
        nullable=True,
    )

    # Remix lineage. Points at the SPECIFIC version that was copied (a
    # frozen snapshot), not the level generically - so credit stays
    # accurate even if the parent keeps changing after the fork.
    remixed_from_version_id = db.Column(
        db.Integer,
        db.ForeignKey(
            "level_versions.id",
            use_alter=True,
            name="fk_levels_remixed_from_version_id",
        ),
        nullable=True,
    )
    # Denormalized copy of remixed_from_version.level_id, purely so "all
    # remixes of level X" doesn't need to join through level_versions
    # first. Self-referential FK, no circularity issue since it's within
    # the same table.
    remixed_from_level_id = db.Column(db.Integer, db.ForeignKey("levels.id"), nullable=True)

    created_at = db.Column(db.DateTime, default=utc_now)

    owner = db.relationship("User", foreign_keys=[owner_id])
    latest_published_version = db.relationship(
        "LevelVersion", foreign_keys=[latest_published_version_id], post_update=True
    )
    remixed_from_version = db.relationship(
        "LevelVersion", foreign_keys=[remixed_from_version_id], post_update=True
    )
    remixed_from_level = db.relationship("Level", remote_side=[id], foreign_keys=[remixed_from_level_id])
    versions = db.relationship(
        "LevelVersion",
        back_populates="level",
        foreign_keys="LevelVersion.level_id",
        order_by="LevelVersion.version_number",
    )

    def __repr__(self):
        return f"<Level {self.slug} '{self.title}'>"


class LevelVersion(db.Model):
    """
    One immutable snapshot of a level's content. A new row is only ever
    created once an edit actually gets re-beaten and re-published - an
    abandoned edit that never finishes never becomes a version at all.
    """

    __tablename__ = "level_versions"
    __table_args__ = (
        db.UniqueConstraint(
            "level_id", "version_number", name="uq_level_versions_level_id_version_number"
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    level_id = db.Column(db.Integer, db.ForeignKey("levels.id"), nullable=False)
    version_number = db.Column(db.Integer, nullable=False)

    # The actual level data (tiles, spawn, win condition, placed
    # objects, etc.) - JSONB on Postgres for indexing/querying, falling
    # back to generic JSON on other dialects (e.g. SQLite in tests) via
    # with_variant. Deliberately not a rigid relational schema, since
    # the editor's own data shape can keep evolving without forcing a
    # migration every time it does.
    content = db.Column(db.JSON().with_variant(JSONB, "postgresql"), nullable=False)

    # Set the moment the creator successfully reaches the win condition
    # on this exact version, from a real playthrough - this is the gate
    # that lets testing become published in the first place.
    beaten_at = db.Column(db.DateTime, nullable=True)

    # Denormalized from PlayAttempt for fast reads on level lists;
    # PlayAttempt rows are the source of truth, these are just a cache.
    clear_rate_cached = db.Column(db.Float, nullable=True)
    difficulty_label_cached = db.Column(db.String(20), nullable=True)

    created_at = db.Column(db.DateTime, default=utc_now)

    level = db.relationship("Level", back_populates="versions", foreign_keys=[level_id])

    def __repr__(self):
        return f"<LevelVersion level_id={self.level_id} v{self.version_number}>"