import enum

from app.extensions import db
from app.utils.time import utc_now


class EndlessRunEndReason(enum.Enum):
    # Lives hit zero - the normal "game over".
    OUT_OF_LIVES = "out_of_lives"
    # The player quit, or started a new run while this one was still
    # active ("start over").
    FORFEITED = "forfeited"
    # Sat idle past ENDLESS_RUN_IDLE_EXPIRY (see app/services/endless.py)
    # and was lazily closed the next time anything touched it.
    EXPIRED = "expired"


class EndlessRunLevelOutcome(enum.Enum):
    # The run's current level - served, not yet cleared or skipped.
    ACTIVE = "active"
    CLEARED = "cleared"
    SKIPPED = "skipped"
    # The run ran out of lives while on this level.
    FAILED = "failed"
    # The run was forfeited or expired while on this level.
    ABANDONED = "abandoned"


class EndlessLifeLossReason(enum.Enum):
    DEATH = "death"
    SKIP = "skip"
    # An attempt that was begun but never reported, resolved as a death
    # when the player next came back (see resolve_pending_attempt).
    ABANDONED = "abandoned"


class EndlessRun(db.Model):
    """
    One endless-mode run. The server owns all of this - lives, the level
    sequence, outcomes - so a refresh can't reset lives and the client
    can't edit them.

    At most ONE active run per user, enforced by the partial unique
    index below rather than only in application code, so two racing
    "start run" requests can't both succeed.
    """

    __tablename__ = "endless_runs"
    __table_args__ = (
        db.Index(
            "uq_endless_runs_one_active_per_user",
            "user_id",
            unique=True,
            postgresql_where=db.text("is_active"),
            sqlite_where=db.text("is_active"),
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)

    # NULL means "any difficulty" (truly random). Otherwise one of
    # ENDLESS_DIFFICULTIES in app/services/endless.py.
    difficulty = db.Column(db.String(20), nullable=True)

    # The shuffled list of level ids still to be served in this run (see
    # _serve_next_level in app/services/endless.py): each level served is
    # removed, and the list is rebuilt and reshuffled when it empties, so
    # a level can't come up twice in a row unless it's the only one
    # available. NULL until the first level is served.
    level_queue = db.Column(db.JSON, nullable=True)

    starting_lives = db.Column(db.Integer, nullable=False)
    lives_remaining = db.Column(db.Integer, nullable=False)
    levels_cleared = db.Column(db.Integer, nullable=False, default=0)
    deaths = db.Column(db.Integer, nullable=False, default=0)
    skips = db.Column(db.Integer, nullable=False, default=0)

    is_active = db.Column(db.Boolean, nullable=False, default=True)
    end_reason = db.Column(db.Enum(EndlessRunEndReason, name="endless_run_end_reason"), nullable=True)

    started_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    # Bumped by every action on the run; what the 24-hour idle expiry
    # is measured from.
    last_activity_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    ended_at = db.Column(db.DateTime, nullable=True)

    user = db.relationship("User", foreign_keys=[user_id])
    levels = db.relationship(
        "EndlessRunLevel",
        back_populates="run",
        order_by="EndlessRunLevel.position",
    )

    def __repr__(self):
        return f"<EndlessRun user_id={self.user_id} lives={self.lives_remaining}>"


class EndlessRunLevel(db.Model):
    """
    One level served within a run. Records the order, how it ended, and
    how many tries it took - this is the per-level endless metric, kept
    separate from the level's own direct-play counters.
    """

    __tablename__ = "endless_run_levels"
    __table_args__ = (
        db.UniqueConstraint("run_id", "position", name="uq_endless_run_levels_run_id_position"),
    )

    id = db.Column(db.Integer, primary_key=True)
    run_id = db.Column(db.Integer, db.ForeignKey("endless_runs.id"), nullable=False, index=True)
    level_id = db.Column(db.Integer, db.ForeignKey("levels.id"), nullable=False, index=True)
    # 1-based order within the run.
    position = db.Column(db.Integer, nullable=False)

    outcome = db.Column(
        db.Enum(EndlessRunLevelOutcome, name="endless_run_level_outcome"),
        nullable=False,
        default=EndlessRunLevelOutcome.ACTIVE,
    )
    # Every try counts, same as direct play: a level cleared on the 5th
    # try is attempts=5, deaths=4.
    attempts = db.Column(db.Integer, nullable=False, default=0)
    deaths = db.Column(db.Integer, nullable=False, default=0)

    # Set when the client says an attempt has actually begun (level
    # loaded), cleared when that attempt is resolved (death/clear/skip).
    # Non-null on an active run's current level means "an attempt is in
    # progress" - if the player never reports back, that is what gets
    # resolved as a death on their next return.
    attempt_started_at = db.Column(db.DateTime, nullable=True)
    # Bumped by the client's heartbeat while the attempt is being played
    # - the only way the server can tell roughly when a player who then
    # vanished actually left (see resolve_pending_attempt's grace rule).
    attempt_last_seen_at = db.Column(db.DateTime, nullable=True)

    served_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    resolved_at = db.Column(db.DateTime, nullable=True)

    run = db.relationship("EndlessRun", back_populates="levels")
    level = db.relationship("Level", foreign_keys=[level_id])


class EndlessLifeLoss(db.Model):
    """
    A ledger of every life a user has lost across all their runs. The
    free-account daily pool is just "count of rows in the current
    24-hour window" - no counter to reset, no background job, and every
    deduction is auditable.
    """

    __tablename__ = "endless_life_losses"
    __table_args__ = (db.Index("ix_endless_life_losses_user_id_created_at", "user_id", "created_at"),)

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    run_id = db.Column(db.Integer, db.ForeignKey("endless_runs.id"), nullable=False)
    reason = db.Column(db.Enum(EndlessLifeLossReason, name="endless_life_loss_reason"), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)