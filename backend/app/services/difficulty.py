"""
Difficulty labels, derived from a level's clear rate.

A level's clear rate is completions / attempts over its PlayAttempt rows
(registered players only, the creator included - see app/models/play_attempt.py).
Because a published level never changes, those numbers always describe
exactly one layout.

The label is cached on Level.difficulty_label_cached and recomputed
whenever an attempt starts or completes, so endless mode can filter on
it with a plain column lookup.
"""

from sqlalchemy import func

from app.extensions import db
from app.models.level import Level
from app.models.play_attempt import (
    PLAY_ATTEMPT_SOURCE_DIRECT,
    PlayAttempt,
)
from app.utils.time import utc_now

# A level needs at least this many registered-user attempts before it is
# labeled at all - a clear rate over two tries says nothing.
MIN_ATTEMPTS_FOR_LABEL = 10

# Same values as ENDLESS_DIFFICULTIES in app/services/endless.py (a test
# keeps the two in sync).
DIFFICULTY_LABELS = ("easy", "normal", "hard", "very_hard", "tas")

# (minimum clear rate, label), checked top-down. A boundary value belongs
# to the EASIER label: exactly 50% is easy, exactly 25% is normal, and so
# on; anything under 1% is "tas".
_THRESHOLDS = (
    (0.50, "easy"),
    (0.25, "normal"),
    (0.05, "hard"),
    (0.01, "very_hard"),
)


def label_for_clear_rate(clear_rate: float) -> str:
    for minimum, label in _THRESHOLDS:
        if clear_rate >= minimum:
            return label
    return "tas"


def compute_difficulty_label(attempts: int, completions: int) -> str | None:
    """None until the level has enough attempts to say anything."""
    if attempts < MIN_ATTEMPTS_FOR_LABEL:
        return None
    return label_for_clear_rate(completions / attempts)


def recompute_level_difficulty(level: Level) -> None:
    """
    Recounts the level's attempts and refreshes difficulty_label_cached.
    Doesn't commit - callers are mid-request and commit once themselves.
    """
    attempts, completions = (
        db.session.query(func.count(PlayAttempt.id), func.count(PlayAttempt.completed_at))
        .filter(PlayAttempt.level_id == level.id)
        .one()
    )
    level.difficulty_label_cached = compute_difficulty_label(attempts, completions)


def record_attempt_start(level: Level, user, source: str = PLAY_ATTEMPT_SOURCE_DIRECT) -> None:
    """
    A registered player (the level's creator included) began a try at the
    level. Callers have already excluded anonymous plays.
    """
    db.session.add(PlayAttempt(level_id=level.id, user_id=user.id, source=source))
    db.session.flush()
    recompute_level_difficulty(level)


def record_attempt_completion(level: Level, user, source: str = PLAY_ATTEMPT_SOURCE_DIRECT) -> None:
    """
    The same player cleared the level: closes their most recent open
    attempt. If there is none (a completion arriving without its start -
    the endpoints don't enforce ordering), a completed attempt is recorded
    so the clear still counts as a try.
    """
    now = utc_now()
    open_attempt = (
        PlayAttempt.query.filter_by(
            level_id=level.id, user_id=user.id, source=source, completed_at=None
        )
        .order_by(PlayAttempt.id.desc())
        .first()
    )
    if open_attempt is not None:
        open_attempt.completed_at = now
    else:
        db.session.add(
            PlayAttempt(level_id=level.id, user_id=user.id, source=source, completed_at=now)
        )
    db.session.flush()
    recompute_level_difficulty(level)