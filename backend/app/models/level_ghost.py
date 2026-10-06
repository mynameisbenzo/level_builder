from sqlalchemy.dialects.postgresql import JSONB

from app.extensions import db
from app.utils.time import utc_now


class LevelGhost(db.Model):
    """
    The single ghost shown to everyone playing one published level: the
    fastest recorded clear of it. At most one row per level (the unique
    constraint below) - a faster clear replaces the row's contents rather
    than adding a second one.

    A published level never changes, so its ghost can never go stale: it
    only ever changes hands when someone clears the level faster.
    """

    __tablename__ = "level_ghosts"
    __table_args__ = (db.UniqueConstraint("level_id", name="uq_level_ghosts_level_id"),)

    id = db.Column(db.Integer, primary_key=True)
    level_id = db.Column(db.Integer, db.ForeignKey("levels.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)

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
        return f"<LevelGhost level_id={self.level_id} {self.duration_ms}ms>"