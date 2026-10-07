from sqlalchemy.dialects.postgresql import JSONB

from app.extensions import db
from app.utils.time import utc_now

# The three kinds of ghost a level can hold (see app/services/ghosts.py):
#   full    spawn -> finish, for a run that never touched the checkpoint
#   before  spawn -> checkpoint (a level with a checkpoint only)
#   after   checkpoint -> finish (a level with a checkpoint only)
GHOST_KIND_FULL = "full"
GHOST_KIND_BEFORE = "before"
GHOST_KIND_AFTER = "after"
GHOST_KINDS = (GHOST_KIND_FULL, GHOST_KIND_BEFORE, GHOST_KIND_AFTER)


class LevelGhost(db.Model):
    """
    A ghost shown to everyone playing one published level: the fastest
    recorded clear of one stretch of it. At most one row per level AND
    kind (the unique constraint below) - a faster clear replaces the row's
    contents rather than adding a second one. A level without a checkpoint
    only ever has a `full` ghost; one with a checkpoint can also have a
    `before` and an `after` ghost, each with its own holder.

    A published level never changes, so its ghosts can never go stale:
    they only ever change hands when someone clears a stretch faster.
    """

    __tablename__ = "level_ghosts"
    __table_args__ = (db.UniqueConstraint("level_id", "kind", name="uq_level_ghosts_level_id_kind"),)

    id = db.Column(db.Integer, primary_key=True)
    level_id = db.Column(db.Integer, db.ForeignKey("levels.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)

    # 'full' | 'before' | 'after' - see GHOST_KINDS above.
    kind = db.Column(db.String(10), nullable=False, default=GHOST_KIND_FULL, server_default=GHOST_KIND_FULL)

    # Time spent actually playing (the client's run clock), in ms.
    duration_ms = db.Column(db.Integer, nullable=False)

    # [[x, y, state], ...] sampled every SAMPLE_INTERVAL_MS from the start
    # of the run - see app/services/ghosts.py for the format.
    frames = db.Column(db.JSON().with_variant(JSONB, "postgresql"), nullable=False)

    # When this run was set (replaced rows get a fresh value).
    set_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    user = db.relationship("User", foreign_keys=[user_id])
    level = db.relationship("Level", foreign_keys=[level_id])

    def __repr__(self):
        return f"<LevelGhost level_id={self.level_id} {self.kind} {self.duration_ms}ms>"