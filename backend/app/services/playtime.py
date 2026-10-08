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
from datetime import timedelta
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models.level import Level
from app.models.level_playtime import LevelPlaytime
from app.models.level_record import LevelRecord
from app.models.user import User
from app.utils.time import utc_now

# The browser sends a heartbeat about this often while the player is playing.
HEARTBEAT_INTERVAL_MS = 5000
# Slack on top of one interval for timers that fire a little late.
HEARTBEAT_TOLERANCE_MS = 2000
# The most a single heartbeat can ever add.
MAX_HEARTBEAT_MS = HEARTBEAT_INTERVAL_MS + HEARTBEAT_TOLERANCE_MS

# A win with less total playtime than this isn't a real clear (the same
# floor the ghosts use for a run's duration) and can't set the record.
MIN_RECORD_MS = 200
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
        # The very first report: the time it describes happened before the
        # row existed, so the row is dated back by that much (at most one
        # heartbeat's worth) - otherwise a quick win, reported in a single
        # call, would count as no time at all.
        credit = min(elapsed_ms, MAX_HEARTBEAT_MS)
        started = now - timedelta(milliseconds=credit)
        row = LevelPlaytime(
            level_id=level.id,
            user_id=user.id,
            total_ms=0,
            created_at=started,
            last_heartbeat_at=started,
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

def record_to_dict(record: LevelRecord) -> dict:
    return {"username": record.user.username, "total_ms": record.total_ms}


def get_record(level_id: int) -> LevelRecord | None:
    """
    The level's record, or None. A record whose holder has since deleted
    their account is treated as absent - the next win then takes it.
    """
    record = LevelRecord.query.filter_by(level_id=level_id).first()
    if record is None or record.user.is_deleted:
        return None
    return record


def best_times_for_levels(level_ids: list[int]) -> dict[int, int]:
    """
    {level_id: record total in ms} for every level in a list response, in
    one query rather than one per level. A level nobody has beaten (or
    whose record holder deleted their account) simply isn't a key.
    """
    if not level_ids:
        return {}

    rows = (
        db.session.query(LevelRecord.level_id, LevelRecord.total_ms)
        .join(User, User.id == LevelRecord.user_id)
        .filter(LevelRecord.level_id.in_(level_ids))
        .filter(User.is_deleted.is_(False))
        .all()
    )
    return {level_id: total_ms for level_id, total_ms in rows}


def submit_win(user: User, level: Level, elapsed_ms, now=None) -> tuple[int, bool, LevelRecord | None]:
    """
    The player beat the level. `elapsed_ms` is the play time since their
    last heartbeat (the same number a heartbeat carries, clamped the same
    way). Adds it, takes the player's total and clears their running row so
    the next try starts at zero, then offers the total as the level's
    record. Returns (total_ms, is_record, record): `record` is whoever
    holds the record afterwards. A tie keeps the existing record - it only
    changes hands for a strictly faster total. Commits.
    """
    apply_heartbeat(user, level, elapsed_ms, now=now)
    total_ms = finish_playtime(user, level)

    if total_ms < MIN_RECORD_MS:
        db.session.commit()
        return total_ms, False, get_record(level.id)

    existing = LevelRecord.query.filter_by(level_id=level.id).with_for_update().first()
    is_record = False
    if existing is None:
        db.session.add(LevelRecord(level_id=level.id, user_id=user.id, total_ms=total_ms))
        is_record = True
    elif existing.user.is_deleted or total_ms < existing.total_ms:
        existing.user_id = user.id
        existing.total_ms = total_ms
        existing.set_at = utc_now()
        is_record = True

    try:
        db.session.commit()
    except IntegrityError:
        # Two first wins landed at once; the other one got there first.
        db.session.rollback()
        return total_ms, False, get_record(level.id)

    return total_ms, is_record, get_record(level.id)