from app.extensions import db
from app.utils.time import utc_now


class LevelPlaytime(db.Model):
    """
    A player's running total of time actually spent playing one published
    level - the number the level's record is measured in (see
    app/services/playtime.py).

    It lives on the server, not in the browser, so reloading or leaving
    the page can't reset it. One row per (user, level): created by the
    first heartbeat, grown by every later one, and deleted when the player
    wins (the total goes into the record and the next try starts at zero).
    A row that is never finished simply stays, so a player can come back to
    the level later and carry on.
    """

    __tablename__ = "level_playtimes"
    __table_args__ = (
        db.UniqueConstraint("level_id", "user_id", name="uq_level_playtimes_level_id_user_id"),
    )

    id = db.Column(db.Integer, primary_key=True)
    level_id = db.Column(db.Integer, db.ForeignKey("levels.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)

    # Milliseconds of play. Never above MAX_PLAYTIME_MS and never above the
    # real time since created_at - see apply_heartbeat.
    total_ms = db.Column(db.Integer, nullable=False, default=0)

    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    last_heartbeat_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    level = db.relationship("Level", foreign_keys=[level_id])
    user = db.relationship("User", foreign_keys=[user_id])

    def __repr__(self):
        return f"<LevelPlaytime level_id={self.level_id} user_id={self.user_id} {self.total_ms}ms>"