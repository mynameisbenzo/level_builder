from app.extensions import db
from app.utils.time import utc_now


class LevelRating(db.Model):
    """
    One row per (level, user) - a thumbs-up or thumbs-down given from
    the result modal shown after a public playthrough ends (see POST
    /api/levels/<slug>/rate), win or death. is_like carries which one:
    True for a like, False for a dislike - there's no third "neutral"
    state, only the two, matching the modal's two buttons.

    The unique constraint below is what makes rating idempotent and
    switchable: rating the same level twice from the same account
    updates this one row (upsert) rather than creating a second one,
    so someone can change their mind from a dislike to a like without
    ending up counted as both, and can't inflate either count by
    repeat-clicking or refreshing. Deliberately tied to a real account
    for the same reason - an unauthenticated endpoint could increment
    a bare counter with no way to dedupe at all.
    """

    __tablename__ = "level_ratings"

    id = db.Column(db.Integer, primary_key=True)
    level_id = db.Column(db.Integer, db.ForeignKey("levels.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    is_like = db.Column(db.Boolean, nullable=False)
    created_at = db.Column(db.DateTime, default=utc_now)
    # Set alongside is_like on every write (including the very first),
    # not just on a later change - lets a future "most recently rated"
    # query exist without having to fall back to created_at for rows
    # that were never actually updated.
    updated_at = db.Column(db.DateTime, default=utc_now, onupdate=utc_now)

    level = db.relationship("Level", foreign_keys=[level_id])
    user = db.relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        db.UniqueConstraint("level_id", "user_id", name="uq_level_ratings_level_id_user_id"),
    )