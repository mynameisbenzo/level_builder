from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models.endless import (
    EndlessLifeLoss,
    EndlessLifeLossReason,
    EndlessRun,
    EndlessRunEndReason,
    EndlessRunLevel,
    EndlessRunLevelOutcome,
    RUN_MODE_ENDLESS,
    RUN_MODE_SCOREBOARD,
    RUN_MODES,
)
from app.models.level import Level
from app.models.play_attempt import PLAY_ATTEMPT_SOURCE_ENDLESS
from app.services.difficulty import record_attempt_completion, record_attempt_start
from app.models.user import User
from app.services.tiers import is_paid_account  # noqa: F401 - also used as endless_service.is_paid_account

# ── Rules ───────────────────────────────────────────────────────────────

# Free accounts: a fixed number of lives per run, drawn from a daily pool.
FREE_LIVES_PER_RUN = 10
FREE_DAILY_POOL = 50

# Paid accounts: no daily pool, just a per-run amount they can choose.
PAID_DEFAULT_LIVES = 100
PAID_MIN_LIVES = 1
PAID_MAX_LIVES = 100

# The daily pool resets every POOL_WINDOW, counted from the user's own
# created_at (plain UTC arithmetic - see get_pool_window).
POOL_WINDOW = timedelta(hours=24)

# A run untouched for this long is lazily closed the next time anything
# loads it. Matches POOL_WINDOW on purpose: an attempt abandoned that
# long ago is necessarily in an earlier pool window, so it costs nothing.
ENDLESS_RUN_IDLE_EXPIRY = timedelta(hours=24)

# An attempt that was last seen alive less than this long after it began
# isn't charged when it turns out to have been abandoned - covers an
# accidental close or crash right after a level loads. Deliberately
# short: a long one would let players quit just before dying and never
# lose a life. See resolve_pending_attempt.
ATTEMPT_GRACE_PERIOD = timedelta(seconds=30)

# The difficulty labels a run can filter on, matched against
# Level.difficulty_label_cached. NOTE: nothing populates that column yet
# (the PlayAttempt model and auto-labeling are still open tasks), so
# until they exist every category has zero levels and only "any"
# (difficulty=None) is usable. The future labeler must write exactly
# these strings.
ENDLESS_DIFFICULTIES = ("easy", "normal", "hard", "very_hard", "tas")


# Scoreboard mode: every run has the same fixed lives (so scores are
# comparable), drawn from the same daily pool as endless mode. Only levels
# with a difficulty label are served. In the Any category a clear is worth
# its level's difficulty; in a single-difficulty category every clear is 1.
SCOREBOARD_LIVES = 5
SCOREBOARD_POINTS = {"easy": 1, "normal": 2, "hard": 3, "very_hard": 4, "tas": 5}


class EndlessError(Exception):
    """
    Raised for any rule violation. `code` is a stable machine-readable
    string the frontend can branch on; `extra` is merged into the JSON
    error body (e.g. the pool's reset time, or the existing active run).
    """

    def __init__(self, code: str, message: str, status: int, extra: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.extra = extra or {}


# ── Accounts & the daily pool ───────────────────────────────────────────


def get_pool_window(user: User, now: datetime) -> tuple[datetime, datetime]:
    """
    The current 24-hour pool window as (start, end), a rolling sequence
    of windows anchored at the user's created_at. Plain UTC arithmetic,
    so there is no per-user timezone handling anywhere.
    """
    anchor = user.created_at or now
    elapsed = max(now - anchor, timedelta(0))
    windows_elapsed = elapsed // POOL_WINDOW
    start = anchor + windows_elapsed * POOL_WINDOW
    return start, start + POOL_WINDOW


def get_pool_state(user: User, now: datetime) -> dict | None:
    """The user's daily-pool standing, or None for paid accounts (no pool)."""
    if is_paid_account(user):
        return None

    start, end = get_pool_window(user, now)
    used = (
        EndlessLifeLoss.query.filter(EndlessLifeLoss.user_id == user.id)
        .filter(EndlessLifeLoss.created_at >= start)
        .filter(EndlessLifeLoss.created_at < end)
        .count()
    )
    return {
        "daily_limit": FREE_DAILY_POOL,
        "remaining": max(0, FREE_DAILY_POOL - used),
        "resets_at": end,
    }


def _starting_lives_for(user: User, requested, now: datetime, mode: str = RUN_MODE_ENDLESS) -> int:
    if mode == RUN_MODE_SCOREBOARD:
        if requested is not None:
            raise EndlessError(
                "fixed_lives", f"scoreboard runs always have {SCOREBOARD_LIVES} lives", 400
            )
        if not is_paid_account(user):
            # A short run would score unfairly low, so a free account needs
            # the whole run's lives left in today's pool.
            pool = get_pool_state(user, now)
            if pool["remaining"] < SCOREBOARD_LIVES:
                raise EndlessError(
                    "daily_pool_too_low",
                    f"a scoreboard run needs {SCOREBOARD_LIVES} lives and you have "
                    f"{pool['remaining']} left today",
                    429,
                    {"pool": _serialize_pool(pool)},
                )
        return SCOREBOARD_LIVES

    if is_paid_account(user):
        if requested is None:
            return PAID_DEFAULT_LIVES
        if isinstance(requested, bool) or not isinstance(requested, int):
            raise EndlessError("invalid_lives", "starting_lives must be a whole number", 400)
        if not PAID_MIN_LIVES <= requested <= PAID_MAX_LIVES:
            raise EndlessError(
                "invalid_lives",
                f"starting_lives must be between {PAID_MIN_LIVES} and {PAID_MAX_LIVES}",
                400,
            )
        return requested

    if requested is not None:
        raise EndlessError(
            "paid_only", "choosing your starting lives is only available on paid accounts", 403
        )

    pool = get_pool_state(user, now)
    if pool["remaining"] <= 0:
        raise EndlessError(
            "daily_pool_exhausted",
            "you've used all your endless lives for today",
            429,
            {"pool": _serialize_pool(pool)},
        )
    return min(FREE_LIVES_PER_RUN, pool["remaining"])


def _serialize_pool(pool: dict | None) -> dict | None:
    if pool is None:
        return None
    return {
        "daily_limit": pool["daily_limit"],
        "remaining": pool["remaining"],
        "resets_at": pool["resets_at"].isoformat(),
    }


def serialize_pool(user: User, now: datetime) -> dict | None:
    return _serialize_pool(get_pool_state(user, now))


# ── Picking levels ──────────────────────────────────────────────────────


def _eligible_levels_query():
    """Every live level: published and not deleted."""
    return Level.query.filter(Level.published_at.isnot(None)).filter(Level.is_deleted.is_(False))


def _levels_for(mode: str, difficulty: str | None):
    """
    The levels a run of this mode and difficulty choice can serve. A
    scoreboard run only serves levels that already have a difficulty label.
    """
    query = _eligible_levels_query()
    if mode == RUN_MODE_SCOREBOARD:
        query = query.filter(Level.difficulty_label_cached.isnot(None))
    if difficulty is not None:
        query = query.filter(Level.difficulty_label_cached == difficulty)
    return query


def count_eligible_levels(mode: str = RUN_MODE_ENDLESS) -> dict:
    """
    {"any": N, "easy": n, ...} - how many levels each difficulty choice
    could serve in the given mode. The picker greys out a choice whose
    count is 0.
    """
    counts = {"any": _levels_for(mode, None).count()}
    for difficulty in ENDLESS_DIFFICULTIES:
        counts[difficulty] = _levels_for(mode, difficulty).count()
    return counts


def random_published_levels(difficulty: str | None, count: int) -> list[Level]:
    """
    Up to `count` distinct published levels in random order, for a race's
    level vote. Unlike endless and scoreboard runs, a race draws from every
    published level, labeled or not: no label means it only turns up under
    "any". `difficulty` None means any.
    """
    from sqlalchemy import func

    query = _levels_for(RUN_MODE_ENDLESS, difficulty)
    return query.order_by(func.random()).limit(count).all()


# How many level ids a run's shuffled list holds at most. A random sample
# of the eligible pool, so a big pool doesn't mean a big list.
LEVEL_QUEUE_SIZE = 100


def _category_levels_query(run: EndlessRun):
    """The eligible levels for this run's difficulty choice."""
    return _levels_for(run.mode, run.difficulty)


def _points_for(run: EndlessRun, level: Level) -> int | None:
    """What clearing `level` is worth in `run` (None outside scoreboard mode)."""
    if run.mode != RUN_MODE_SCOREBOARD:
        return None
    if run.difficulty is not None:
        return 1
    return SCOREBOARD_POINTS.get(level.difficulty_label_cached, 1)


def _build_level_queue(run: EndlessRun, last_level_id: int | None) -> list[int]:
    """
    A fresh shuffled list of eligible level ids (a random sample of up to
    LEVEL_QUEUE_SIZE). If the level just served would come first, it's
    moved to the back, so the seam between two lists can't repeat it.
    """
    ids = [
        row[0]
        for row in _category_levels_query(run)
        .with_entities(Level.id)
        .order_by(func.random())
        .limit(LEVEL_QUEUE_SIZE)
        .all()
    ]
    if len(ids) > 1 and ids[0] == last_level_id:
        ids.append(ids.pop(0))
    return ids


def _next_level_from_queue(run: EndlessRun, last_level_id: int | None) -> Level | None:
    """
    Takes the next level off the run's shuffled list, rebuilding the list
    when it's empty. Ids that are no longer eligible (unpublished, deleted,
    or relabeled out of this category since the list was built) are
    skipped. Returns None if nothing is eligible.
    """
    queue = list(run.level_queue or [])
    rebuilt = False
    while True:
        if not queue:
            if rebuilt:
                run.level_queue = []
                return None
            queue = _build_level_queue(run, last_level_id)
            rebuilt = True
            if not queue:
                run.level_queue = []
                return None

        level_id = queue.pop(0)
        level = _category_levels_query(run).filter(Level.id == level_id).first()
        if level is not None:
            # A new list object, so the JSON column registers the change.
            run.level_queue = queue
            return level


def _serve_next_level(run: EndlessRun, now: datetime) -> EndlessRunLevel | None:
    """
    Serves the next level from the run's shuffled list and records it as
    the run's new current level (a user can be served their own level; a
    level can come up again, but only after the rest of the list). Returns
    None if nothing is eligible.
    """
    last_level_id = (
        db.session.query(EndlessRunLevel.level_id)
        .filter(EndlessRunLevel.run_id == run.id)
        .order_by(EndlessRunLevel.position.desc())
        .limit(1)
        .scalar()
    )
    level = _next_level_from_queue(run, last_level_id)
    if level is None:
        return None

    last_position = (
        db.session.query(func.max(EndlessRunLevel.position)).filter(EndlessRunLevel.run_id == run.id).scalar()
    )
    entry = EndlessRunLevel(
        run_id=run.id,
        level_id=level.id,
        position=(last_position or 0) + 1,
        outcome=EndlessRunLevelOutcome.ACTIVE,
        points=_points_for(run, level),
        served_at=now,
    )
    db.session.add(entry)
    db.session.flush()
    return entry


def current_entry(run: EndlessRun) -> EndlessRunLevel | None:
    """The run's current level: the one still ACTIVE."""
    return (
        EndlessRunLevel.query.filter_by(run_id=run.id, outcome=EndlessRunLevelOutcome.ACTIVE)
        .order_by(EndlessRunLevel.position.desc())
        .first()
    )


# ── Ending runs & losing lives ──────────────────────────────────────────


def _end_run(run: EndlessRun, reason: EndlessRunEndReason, now: datetime) -> None:
    if not run.is_active:
        return

    entry = current_entry(run)
    if entry is not None:
        entry.outcome = (
            EndlessRunLevelOutcome.FAILED
            if reason == EndlessRunEndReason.OUT_OF_LIVES
            else EndlessRunLevelOutcome.ABANDONED
        )
        entry.attempt_started_at = None
        entry.attempt_last_seen_at = None
        entry.resolved_at = now

    run.is_active = False
    run.end_reason = reason
    run.ended_at = now
    run.last_activity_at = now


def _lose_life(run: EndlessRun, entry: EndlessRunLevel, reason: EndlessLifeLossReason, now: datetime) -> None:
    """
    Charges one life: against the run, and in the ledger the daily pool
    is counted from. Ends the run if that was the last one.
    """
    run.lives_remaining -= 1
    if reason == EndlessLifeLossReason.SKIP:
        run.skips += 1
    else:
        run.deaths += 1
        entry.deaths += 1

    db.session.add(EndlessLifeLoss(user_id=run.user_id, run_id=run.id, reason=reason, created_at=now))
    run.last_activity_at = now

    if run.lives_remaining <= 0:
        run.lives_remaining = 0
        _end_run(run, EndlessRunEndReason.OUT_OF_LIVES, now)


def resolve_pending_attempt(run: EndlessRun, user: User, now: datetime) -> bool:
    """
    If the run's current level has an attempt that began but was never
    resolved (tab closed, crash, lost connection), settles it now as a
    death - at the moment the player next comes back, so there is no
    background job. Returns True if a life was charged.

    Two exceptions, both free:
    - Grace: the client heartbeats while a level is being played (see
      record_heartbeat), so `attempt_last_seen_at` is roughly when the
      player left. An attempt last seen under ATTEMPT_GRACE_PERIOD after
      it began is treated as an accidental close. No heartbeat at all
      does NOT qualify - otherwise a client that simply never sent any
      could quit before every death for free.
    - Earlier pool window (free accounts only): if the pool has already
      reset since the attempt began, the missed death costs nothing, same
      as any normal reset.
    """
    entry = current_entry(run)
    if entry is None or entry.attempt_started_at is None:
        return False

    started = entry.attempt_started_at
    last_seen = entry.attempt_last_seen_at
    entry.attempt_started_at = None
    entry.attempt_last_seen_at = None

    if last_seen is not None and last_seen - started < ATTEMPT_GRACE_PERIOD:
        return False

    if not is_paid_account(user):
        window_start, _ = get_pool_window(user, now)
        if started < window_start:
            return False

    _lose_life(run, entry, EndlessLifeLossReason.ABANDONED, now)
    return True


def get_active_run(user: User, now: datetime, resolve_pending: bool = True) -> EndlessRun | None:
    """
    The user's active run, or None. Lazily does the bookkeeping that has
    no other trigger, and commits it:
    - a run idle past ENDLESS_RUN_IDLE_EXPIRY is closed as expired (and
      reads as no run);
    - unless resolve_pending is False, an abandoned in-progress attempt
      is settled (see resolve_pending_attempt) - which can itself end the
      run, in which case this also returns None.

    resolve_pending must be False when the caller is about to report on
    that very attempt (death / clear / skip), or it would be charged as
    abandoned before the report is read.
    """
    run = EndlessRun.query.filter_by(user_id=user.id, is_active=True).first()
    if run is None:
        return None

    if now - run.last_activity_at > ENDLESS_RUN_IDLE_EXPIRY:
        _end_run(run, EndlessRunEndReason.EXPIRED, now)
        db.session.commit()
        return None

    if resolve_pending:
        resolve_pending_attempt(run, user, now)
        db.session.commit()

    return run if run.is_active else None


# ── Run lifecycle ───────────────────────────────────────────────────────


def start_run(
    user: User,
    difficulty: str | None,
    requested_lives,
    replace: bool,
    now: datetime,
    mode: str = RUN_MODE_ENDLESS,
) -> EndlessRun:
    """
    Starts a run (endless or scoreboard) and serves its first level. If the user already has an
    active run, that is an error unless `replace` is true, in which case
    the old run is forfeited first ("start over") - including charging
    its abandoned attempt, so starting over can't dodge a life loss.
    Either everything happens or nothing does: a failure after the old
    run was forfeited (e.g. the daily pool turns out to be empty) rolls
    the forfeit back too.
    """
    if mode not in RUN_MODES:
        raise EndlessError("invalid_mode", f"mode must be one of: {', '.join(RUN_MODES)}", 400)

    if difficulty is not None and difficulty not in ENDLESS_DIFFICULTIES:
        raise EndlessError(
            "invalid_difficulty",
            f"difficulty must be one of: {', '.join(ENDLESS_DIFFICULTIES)} (or omitted for any)",
            400,
        )

    if _levels_for(mode, difficulty).first() is None:
        raise EndlessError("no_levels_available", "there are no levels available for that choice", 409)

    existing = get_active_run(user, now, resolve_pending=False)
    if existing is not None and not replace:
        raise EndlessError(
            "active_run_exists",
            "you already have an endless run in progress",
            409,
            {"active_run_exists": True},
        )

    try:
        if existing is not None:
            resolve_pending_attempt(existing, user, now)
            _end_run(existing, EndlessRunEndReason.FORFEITED, now)
            db.session.flush()

        lives = _starting_lives_for(user, requested_lives, now, mode)

        run = EndlessRun(
            user_id=user.id,
            mode=mode,
            difficulty=difficulty,
            starting_lives=lives,
            lives_remaining=lives,
            started_at=now,
            last_activity_at=now,
        )
        db.session.add(run)
        db.session.flush()

        if _serve_next_level(run, now) is None:
            raise EndlessError("no_levels_available", "there are no levels available for that choice", 409)

        db.session.commit()
    except EndlessError:
        db.session.rollback()
        raise
    except IntegrityError:
        # The partial unique index caught two simultaneous "start run"
        # requests - same race handling as the other endpoints.
        db.session.rollback()
        raise EndlessError(
            "active_run_exists", "you already have an endless run in progress", 409, {"active_run_exists": True}
        )

    return run


def _count_play_for_level(level: Level, user: User) -> None:
    """
    Endless attempts count toward a level's play count like direct
    plays do - everyone, a creator served their own level included. The
    separate per-endless record lives on EndlessRunLevel.
    """
    level.play_count += 1
    # Every endless try is a registered player's attempt, so it feeds
    # the level's clear rate / difficulty label too.
    record_attempt_start(level, user, PLAY_ATTEMPT_SOURCE_ENDLESS)


def _count_completion_for_level(level: Level, user: User) -> None:
    level.completion_count += 1
    record_attempt_completion(level, user, PLAY_ATTEMPT_SOURCE_ENDLESS)


def begin_attempt(run: EndlessRun, user: User, now: datetime) -> bool:
    """
    The client has actually loaded the level and play is starting (not
    merely shown the interstitial). Returns False if settling a previous,
    never-reported attempt just ended the run.
    """
    entry = current_entry(run)
    if entry is None:
        raise EndlessError("no_current_level", "this run has no level in progress", 409)

    if entry.attempt_started_at is not None:
        # A new attempt began without the last one ever being reported.
        resolve_pending_attempt(run, user, now)
        if not run.is_active:
            return False

    entry.attempts += 1
    entry.attempt_started_at = now
    entry.attempt_last_seen_at = None
    run.last_activity_at = now
    _count_play_for_level(entry.level, user)
    return True


def record_heartbeat(run: EndlessRun, now: datetime) -> None:
    """
    Sent every few seconds while a level is being played. The only way
    the server can tell roughly when a player who vanished actually left
    - see resolve_pending_attempt's grace rule.
    """
    entry = current_entry(run)
    if entry is None or entry.attempt_started_at is None:
        raise EndlessError("no_attempt_in_progress", "no attempt is in progress", 409)

    entry.attempt_last_seen_at = now
    run.last_activity_at = now


def _require_pending_attempt(run: EndlessRun) -> EndlessRunLevel:
    entry = current_entry(run)
    if entry is None or entry.attempt_started_at is None:
        raise EndlessError("no_attempt_in_progress", "no attempt is in progress", 409)
    return entry


def report_death(run: EndlessRun, now: datetime) -> None:
    entry = _require_pending_attempt(run)
    entry.attempt_started_at = None
    entry.attempt_last_seen_at = None
    _lose_life(run, entry, EndlessLifeLossReason.DEATH, now)


def report_clear(run: EndlessRun, user: User, now: datetime) -> EndlessRunLevel | None:
    """Records the clear and serves the next level (None if none is available)."""
    entry = _require_pending_attempt(run)
    entry.attempt_started_at = None
    entry.attempt_last_seen_at = None
    entry.outcome = EndlessRunLevelOutcome.CLEARED
    entry.resolved_at = now
    run.levels_cleared += 1
    if run.mode == RUN_MODE_SCOREBOARD:
        run.score += entry.points or 0
    run.last_activity_at = now
    _count_completion_for_level(entry.level, user)

    return _serve_next_level(run, now)


def skip_level(run: EndlessRun, now: datetime) -> EndlessRunLevel | None:
    """
    Skips the current level at the cost of a life. Allowed whether or
    not an attempt is in progress; an in-progress one is simply replaced
    by the skip (it is not additionally charged as a death). If that was
    the last life the run ends and there is no next level.
    """
    entry = current_entry(run)
    if entry is None:
        raise EndlessError("no_current_level", "this run has no level in progress", 409)

    entry.attempt_started_at = None
    entry.attempt_last_seen_at = None
    entry.outcome = EndlessRunLevelOutcome.SKIPPED
    entry.resolved_at = now
    _lose_life(run, entry, EndlessLifeLossReason.SKIP, now)

    if not run.is_active:
        return None
    return _serve_next_level(run, now)


def forfeit_run(run: EndlessRun, user: User, now: datetime) -> None:
    """The player quit. An in-progress attempt is settled like any abandoned one."""
    resolve_pending_attempt(run, user, now)
    _end_run(run, EndlessRunEndReason.FORFEITED, now)