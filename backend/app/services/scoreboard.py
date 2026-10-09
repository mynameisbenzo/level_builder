"""
The scoreboard's high-score list: every finished scoreboard run, best first.

One row per RUN, not per player - a player's several good runs can each
appear, arcade-style. A run counts once it has ended (out of lives,
forfeited, or expired); one still in progress isn't listed. Each
difficulty choice (Any, Easy, ... TAS!?!?) is its own board. Runs that
scored nothing, and runs by deleted or suspended accounts, are left off.

Equal scores share a rank (1, 1, 3, ...). No tiebreak decides between
them; the one that finished first is simply listed first so the order is
stable.
"""

from sqlalchemy import func

from app.extensions import db
from app.models.endless import RUN_MODE_SCOREBOARD, EndlessRun
from app.models.user import User
from app.services.endless import ENDLESS_DIFFICULTIES, EndlessError

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 100


def _board_query(difficulty: str | None):
    query = (
        db.session.query(EndlessRun, User)
        .join(User, User.id == EndlessRun.user_id)
        .filter(EndlessRun.mode == RUN_MODE_SCOREBOARD)
        .filter(EndlessRun.is_active.is_(False))
        .filter(EndlessRun.score > 0)
        .filter(User.is_deleted.is_(False))
        .filter(User.is_suspended.is_(False))
    )
    if difficulty is None:
        return query.filter(EndlessRun.difficulty.is_(None))
    return query.filter(EndlessRun.difficulty == difficulty)


def _parse_int(value, name: str, default: int, minimum: int, maximum: int | None = None) -> int:
    if value is None:
        return default
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise EndlessError(f"invalid_{name}", f"{name} must be a whole number", 400)
    if number < minimum or (maximum is not None and number > maximum):
        bound = f"between {minimum} and {maximum}" if maximum is not None else f"{minimum} or more"
        raise EndlessError(f"invalid_{name}", f"{name} must be {bound}", 400)
    return number


def get_scoreboard(difficulty, limit=None, offset=None, viewer: User | None = None) -> dict:
    """
    One page of a difficulty's board: {"difficulty", "total", "entries": [...]}.
    `difficulty` is one of ENDLESS_DIFFICULTIES, or None / "any" for the Any
    board. `viewer`, if given, flags that account's own runs (`is_you`).
    """
    if difficulty == "any":
        difficulty = None
    if difficulty is not None and difficulty not in ENDLESS_DIFFICULTIES:
        raise EndlessError(
            "invalid_difficulty",
            f"difficulty must be one of: {', '.join(ENDLESS_DIFFICULTIES)} (or any)",
            400,
        )

    page_size = _parse_int(limit, "limit", DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE)
    start = _parse_int(offset, "offset", 0, 0)

    query = _board_query(difficulty)
    total = query.count()
    # RANK() gives tied scores the same rank (1, 1, 3, ...). It's worked
    # out over the whole board before the page is cut, so page two keeps
    # counting from where page one left off.
    rows = (
        query.add_columns(func.rank().over(order_by=EndlessRun.score.desc()).label("rank"))
        .order_by(EndlessRun.score.desc(), EndlessRun.ended_at.asc(), EndlessRun.id.asc())
        .offset(start)
        .limit(page_size)
        .all()
    )

    entries = []
    for run, user, rank in rows:
        entries.append(
            {
                "rank": rank,
                "username": user.username,
                "score": run.score,
                "levels_cleared": run.levels_cleared,
                "ended_at": run.ended_at.isoformat() if run.ended_at else None,
                "is_you": viewer is not None and user.id == viewer.id,
            }
        )

    return {"difficulty": difficulty or "any", "total": total, "entries": entries}