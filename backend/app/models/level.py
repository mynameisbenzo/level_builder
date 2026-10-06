import enum

from sqlalchemy.dialects.postgresql import JSONB

from app.extensions import db
from app.utils.slugs import generate_slug
from app.utils.time import utc_now


class LevelVisibilityState(enum.Enum):
    DRAFT = "draft"
    # No longer entered by anything: a published level is final, so there
    # is no "published, being re-edited" state to demote into. Kept in
    # the enum because removing a value from a Postgres enum type is a
    # painful migration for no benefit.
    TESTING = "testing"
    PUBLISHED = "published"
    # Distinct from DRAFT - a level that was live and got deliberately
    # taken down still went through publishing once; collapsing it back
    # to DRAFT would lose that history for no real benefit.
    UNPUBLISHED = "unpublished"


class Level(db.Model):
    """
    One level, end to end: ownership, lifecycle, content, and lineage.

    Publishing is FINAL. While a level is a draft its content can be
    saved freely; the moment it is published (beaten, then POST
    /api/levels/<slug>/publish) its content, title and thumbnail are
    frozen for good. There are no versions - anyone who wants a variation
    remixes the level, which creates a brand-new, separate level. That
    keeps everything measured against a level (plays, completions,
    ratings, the ghost, its difficulty) about exactly one layout.
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

    # Set exactly once, by POST /api/levels/<slug>/publish, and never
    # cleared - not even by a soft delete. "Has this level ever been
    # published" is `published_at IS NOT NULL`; a published level can
    # never be edited, renamed, or re-published.
    published_at = db.Column(db.DateTime, nullable=True)

    # Remix lineage: the level this one was copied from. (There is no
    # remix endpoint yet.) Levels are immutable once published, so a
    # plain level reference is already an exact snapshot - no version to
    # pin.
    remixed_from_level_id = db.Column(db.Integer, db.ForeignKey("levels.id"), nullable=True)

    # The level's content. Freely overwritten by every PATCH
    # /api/levels/<slug> while the level is a draft; frozen at publish.
    # The name is historical - it is also the published, played content.
    # The actual level data (tiles, spawn, win condition, placed objects,
    # etc.) - JSONB on Postgres for indexing/querying, falling back to
    # generic JSON on other dialects (e.g. SQLite in tests) via
    # with_variant. Deliberately not a rigid relational schema, since
    # the editor's own data shape can keep evolving without forcing a
    # migration every time it does.
    draft_content = db.Column(db.JSON().with_variant(JSONB, "postgresql"), nullable=True)

    # Set only by POST /api/levels/<slug>/beat, the moment a real
    # test-playthrough of the CURRENT draft_content reaches the win
    # condition - this is what actually gates publishing. Every save
    # (PATCH) that changes content clears this back to null, so there is
    # no path by which a beat recorded against one state of the draft can
    # ever be used to publish a since-edited one. After publishing it is
    # simply the timestamp of the beat the publish was based on.
    draft_beaten_at = db.Column(db.DateTime, nullable=True)

    # Owner-initiated, terminal removal - distinct from visibility_state
    # alone. DELETE /api/levels/<slug> is the only thing that ever sets
    # this, and only for an already-published level (a never-published
    # draft is hard-deleted instead - see that endpoint). No restore
    # action exists; this stays True forever once set. Still counts
    # toward MAX_PUBLISHED_TOTAL in publish_level - deleting a level
    # doesn't free its slot, since it already consumed its one-time
    # contribution to that lifetime cap, same as any other published
    # level.
    is_deleted = db.Column(db.Boolean, nullable=False, default=False)

    # Simple lifetime counters, incremented by the public play/complete
    # endpoints (POST /api/levels/<slug>/play and .../complete) - every
    # visit to /play/[slug] records a play the moment it loads (and
    # again on every explicit "Play Again"), and a completion is
    # recorded the moment LEVEL_BEATEN_EVENT fires. These are about
    # real, public playthroughs of a published level, and never move for
    # the owner's own test plays in the editor. Because a published
    # level never changes, they describe exactly one layout.
    play_count = db.Column(db.Integer, nullable=False, default=0)
    completion_count = db.Column(db.Integer, nullable=False, default=0)

    # Difficulty label (easy / normal / hard / very_hard / tas), derived
    # from the level's clear rate over its PlayAttempt rows and refreshed
    # by app/services/difficulty.py whenever an attempt starts or
    # completes. Null until the level has MIN_ATTEMPTS_FOR_LABEL
    # attempts from registered players. Endless mode filters on it.
    difficulty_label_cached = db.Column(db.String(20), nullable=True)

    # A screenshot of the level's initial state in play mode, captured
    # client-side at the moment it was published (see
    # captureLevelThumbnail.ts and publish_level) and uploaded to
    # whichever S3-compatible bucket THUMBNAIL_S3_BUCKET names (see
    # app/services/thumbnails.py). Nullable - not every environment has
    # thumbnail storage configured, and a failed upload must never
    # block the publish itself, so a level can legitimately have none.
    thumbnail_url = db.Column(db.String(500), nullable=True)

    created_at = db.Column(db.DateTime, default=utc_now)

    owner = db.relationship("User", foreign_keys=[owner_id])
    remixed_from_level = db.relationship("Level", remote_side=[id], foreign_keys=[remixed_from_level_id])

    @property
    def is_published(self) -> bool:
        return self.published_at is not None

    def __repr__(self):
        return f"<Level {self.slug} '{self.title}'>"