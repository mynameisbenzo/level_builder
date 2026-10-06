from app.extensions import db
from app.utils.time import utc_now

# Where an attempt came from. Stored as plain strings (not a DB enum) so
# adding a source later needs no migration.
PLAY_ATTEMPT_SOURCE_DIRECT = "direct"
PLAY_ATTEMPT_SOURCE_ENDLESS = "endless"


class PlayAttempt(db.Model):
    """
    One real playthrough attempt of a published level by a REGISTERED
    user - the source of truth for a level's clear rate, and so for its
    difficulty label (see app/services/difficulty.py).

    Only a logged-in player other than the level's owner ever gets a row:
    anonymous plays and the creator's own plays are deliberately not
    recorded here. (Level.play_count / completion_count still count
    anonymous plays - they're the numbers shown on level cards - but they
    are a different thing from this table.)

    Every try is its own row, so a level cleared on the 5th try is five
    attempts and one completion. completed_at is null for an attempt that
    ended in a death, a quit, or was simply abandoned.
    """

    __tablename__ = "play_attempts"

    id = db.Column(db.Integer, primary_key=True)
    level_id = db.Column(db.Integer, db.ForeignKey("levels.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    source = db.Column(db.String(10), nullable=False, default=PLAY_ATTEMPT_SOURCE_DIRECT)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    completed_at = db.Column(db.DateTime, nullable=True)

    level = db.relationship("Level", foreign_keys=[level_id])
    user = db.relationship("User", foreign_keys=[user_id])