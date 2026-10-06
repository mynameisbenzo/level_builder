from sqlalchemy.dialects.postgresql import JSONB

from app.extensions import db
from app.utils.time import utc_now


class LevelGhost(db.Model):
    """
    The single ghost shown to everyone playing one specific published
    version of a level: the fastest recorded clear of it. At most one row
    per version (the unique constraint below) - a faster clear replaces
    the row's contents rather than adding a second one.

    Tied to a LevelVersion, not the Level: republishing changes the
    layout, and a ghost recorded against the old layout would run
    through walls in the new one. A new version simply starts with no
    ghost.
    """

    __tablename__ = "level_ghosts"
    __table_args__ = (
        db.UniqueConstraint("level_version_id", name="uq_level_ghosts_level_version_id"),
    )

    id = db.Column(db.Integer, primary_key=True)
    level_version_id = db.Column(db.Integer, db.ForeignKey("level_versions.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)

    # Time spent actually playing (the client's run clock), in ms.
    duration_ms = db.Column(db.Integer, nullable=False)

    # [[x, y, state], ...] sampled every SAMPLE_INTERVAL_MS from the start
    # of the run - see app/services/ghosts.py for the format.
    frames = db.Column(db.JSON().with_variant(JSONB, "postgresql"), nullable=False)

    # When this run was set (replaced rows get a fresh value).
    set_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    user = db.relationship("User", foreign_keys=[user_id])
    level_version = db.relationship("LevelVersion", foreign_keys=[level_version_id])

    def __repr__(self):
        return f"<LevelGhost version_id={self.level_version_id} {self.duration_ms}ms>"