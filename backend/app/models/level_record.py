from app.extensions import db
from app.utils.time import utc_now


class LevelRecord(db.Model):
    """
    The level's record: the least total playtime anyone has needed to beat
    it (see app/services/playtime.py). One row per level - a strictly
    faster win replaces the row's contents rather than adding a second one.

    The time counts everything the player spent on the level across all
    their tries since their last win, deaths included, so it isn't one
    clean run. It has its own holder, separate from the ghosts: the ghost is
    the fastest clean stretch you can race, the record is the fastest total.
    """

    __tablename__ = "level_records"
    __table_args__ = (db.UniqueConstraint("level_id", name="uq_level_records_level_id"),)

    id = db.Column(db.Integer, primary_key=True)
    level_id = db.Column(db.Integer, db.ForeignKey("levels.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)

    # Total playtime in ms (see LevelPlaytime).
    total_ms = db.Column(db.Integer, nullable=False)

    # When this record was set (a replaced row gets a fresh value).
    set_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    user = db.relationship("User", foreign_keys=[user_id])
    level = db.relationship("Level", foreign_keys=[level_id])

    def __repr__(self):
        return f"<LevelRecord level_id={self.level_id} user_id={self.user_id} {self.total_ms}ms>"