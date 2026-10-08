"""
Total playtime: how long a player has really spent playing a level.

The browser measures its own play clock (it starts at the player's first
control and pauses whenever they can't move, including while the tab is
hidden) and reports it in small chunks - a heartbeat about every 5
seconds. The server keeps the running total, one row per (user, level), so
reloading or leaving the page can't reset it.

The server never takes the browser's word for how much time passed.
Every heartbeat adds the SMALLEST of:
  * what the browser says it played since its last heartbeat,
  * the real time that has passed since the previous heartbeat, and
  * one heartbeat interval plus a small tolerance,
so a flood of requests can't add time faster than the real clock, and a
long gap (a closed laptop, say) adds one heartbeat's worth at most. On top
of that the total is capped by the real time since the row was created, and
by a ceiling of 99:59.999 - past it, no more time is added.
"""

from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models.level import Level
from app.models.level_playtime import LevelPlaytime
from app.models.user import User
from app.utils.time import utc_now

# The browser sends a heartbeat about this often while the player is playing.
HEARTBEAT_INTERVAL_MS = 5000
# Slack on top of one interval for timers that fire a little late.
HEARTBEAT_TOLERANCE_MS = 2000
# The most a single heartbeat can ever add.
MAX_HEARTBEAT_MS = HEARTBEAT_INTERVAL_MS + HEARTBEAT_TOLERANCE_MS

# 99 minutes 59.999 seconds - the display ceiling the total stops at.
MAX_PLAYTIME_MS = 99 * 60 * 1000 + 59 * 1000 + 999


class PlaytimeError(Exception):
    def __init__(self, code: str, message: str, status: int):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def _is_whole_number(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _ms_between(earlier, later) -> int:
    return max(0, int((later - earlier).total_seconds() * 1000))


def _get_row(user: User, level: Level, for_update: bool = False) -> LevelPlaytime | None:
    query = LevelPlaytime.query.filter_by(level_id=level.id, user_id=user.id)
    if for_update:
        query = query.with_for_update()
    return query.first()


def get_total_ms(user: User, level: Level) -> int:
    """The player's running total for this level (0 if they have none)."""
    row = _get_row(user, level)
    return row.total_ms if row is not None else 0


def apply_heartbeat(user: User, level: Level, elapsed_ms, now=None) -> LevelPlaytime:
    """
    Adds a heartbeat to the player's total and returns the row. `elapsed_ms`
    is what the browser claims it played since its last heartbeat; it is
    clamped as described in the module docstring. Commits.
    """
    if not _is_whole_number(elapsed_ms) or elapsed_ms < 0:
        raise PlaytimeError("invalid_playtime", "elapsed_ms must be a whole number, 0 or more", 400)

    now = now or utc_now()

    row = _get_row(user, level, for_update=True)
    if row is None:
        row = LevelPlaytime(
            level_id=level.id,
            user_id=user.id,
            total_ms=0,
            created_at=now,
            last_heartbeat_at=now,
        )
        db.session.add(row)
        try:
            db.session.flush()
        except IntegrityError:
            # A parallel first heartbeat created it a moment ago.
            db.session.rollback()
            row = _get_row(user, level, for_update=True)
            if row is None:
                raise

    added = min(elapsed_ms, _ms_between(row.last_heartbeat_at, now), MAX_HEARTBEAT_MS)
    ceiling = min(MAX_PLAYTIME_MS, _ms_between(row.created_at, now))
    # Never goes down, even if a clamp would land below what's already there.
    row.total_ms = max(row.total_ms, min(row.total_ms + added, ceiling))
    row.last_heartbeat_at = now

    db.session.commit()
    return row


def finish_playtime(user: User, level: Level) -> int:
    """
    The player won: returns their total and deletes the row, so the next
    try starts from zero. Doesn't commit - the caller is mid-request and
    commits once itself.
    """
    row = _get_row(user, level, for_update=True)
    if row is None:
        return 0
    total = row.total_ms
    db.session.delete(row)
    return total