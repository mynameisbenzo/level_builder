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

    # The mutable, freely-overwritten in-progress editing state - what
    # every PATCH /api/levels/<slug> save writes to. Deliberately
    # separate from the immutable LevelVersion rows below: saving is
    # meant to be cheap and constant (every keystroke-adjacent action
    # while building, potentially many times a session), while a
    # LevelVersion is a permanent, published snapshot that should only
    # ever be created once something real has actually happened to this
    # content (see draft_beaten_at and POST /api/levels/<slug>/publish).
    draft_content = db.Column(db.JSON().with_variant(JSONB, "postgresql"), nullable=True)

    # Set only by POST /api/levels/<slug>/beat, the moment a real
    # test-playthrough of the CURRENT draft_content reaches the win
    # condition - this is what actually gates publishing. Every save
    # (PATCH) clears this back to null unconditionally, even if the
    # save didn't change anything meaningful - so there is no path by
    # which a beat recorded against one version of the draft can ever
    # be used to publish a since-edited one. A level has to be beaten
    # again, against whatever the draft currently is, every single time.
    draft_beaten_at = db.Column(db.DateTime, nullable=True)

    # Owner-initiated, terminal removal - distinct from visibility_state
    # alone: a level demoted to TESTING mid-edit or explicitly set to
    # UNPUBLISHED some other way isn't necessarily "deleted" in the
    # sense the creator meant to be done with it. DELETE
    # /api/levels/<slug> is the only thing that ever sets this, and only
    # for an already-published level (a never-published draft is hard-
    # deleted instead - see that endpoint). No restore action exists;
    # this stays True forever once set. Still counts toward
    # MAX_PUBLISHED_TOTAL in publish_level - deleting a level doesn't
    # free its slot, since it already consumed its one-time contribution
    # to that lifetime cap, same as any other published level.
    is_deleted = db.Column(db.Boolean, nullable=False, default=False)

    # Simple lifetime counters, incremented by the public play/complete
    # endpoints (POST /api/levels/<slug>/play and .../complete) - every
    # visit to /play/[slug] records a play the moment it loads (and
    # again on every explicit "Play Again"), and a completion is
    # recorded the moment LEVEL_BEATEN_EVENT fires. Deliberately NOT
    # the same thing as the editor's own draft_beaten_at/PlayAttempt-
    # flavored aspirations on LevelVersion below (clear_rate_cached) -
    # those are about the creator's own test-play loop while building;
    # these are about real, public playthroughs of a published level,
    # and never move for the owner's own test plays in the editor.
    play_count = db.Column(db.Integer, nullable=False, default=0)
    completion_count = db.Column(db.Integer, nullable=False, default=0)

    # Denormalized copy of latest_published_version.thumbnail_url,
    # purely so a level list (level_to_summary_dict) can show a
    # thumbnail without joining to LevelVersion for every row - same
    # reasoning as remixed_from_level_id above. Kept in sync by
    # publish_level; never set anywhere else, and never cleared back to
    # None by a publish whose own thumbnail upload happened to fail
    # (see that endpoint) - a stale-but-real thumbnail beats none at
    # all for an already-published level.
    thumbnail_url = db.Column(db.String(500), nullable=True)

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

    # A screenshot of this exact version's initial state in play mode,
    # captured client-side at the moment it was published (see
    # captureLevelThumbnail.ts and publish_level) and uploaded to
    # whichever S3-compatible bucket THUMBNAIL_S3_BUCKET names (see
    # app/services/thumbnails.py). Nullable - not every environment has
    # thumbnail storage configured, and a failed upload must never
    # block the publish itself, so a version can legitimately have none.
    thumbnail_url = db.Column(db.String(500), nullable=True)

    created_at = db.Column(db.DateTime, default=utc_now)

    level = db.relationship("Level", back_populates="versions", foreign_keys=[level_id])

    def __repr__(self):
        return f"<LevelVersion level_id={self.level_id} v{self.version_number}>"