from app.models.endless import EndlessRun
from app.services.endless import current_entry

# What the editor's own default starting character is (see
# default_level_content) - used only if a published version's content
# somehow lacks the field.
_FALLBACK_PLAYER_COLOR = "green"


def current_level_to_dict(entry) -> dict | None:
    """
    The level a run is currently on, shaped for the interstitial screen
    (level name, creator, and the character shown beside the lives
    counter) plus enough to load it: the slug is what the existing
    public GET /api/levels/<slug>/play serves content for.
    """
    if entry is None:
        return None

    content = entry.level_version.content or {}
    return {
        "slug": entry.level.slug,
        "title": entry.level.title,
        "owner_username": entry.level.owner.username,
        "player_starting_color": content.get("playerStartingColor", _FALLBACK_PLAYER_COLOR),
        "position": entry.position,
        "attempts": entry.attempts,
        "attempt_in_progress": entry.attempt_started_at is not None,
    }


def run_to_dict(run: EndlessRun, pool: dict | None) -> dict:
    """
    `pool` is the already-serialized daily-pool standing (or None for a
    paid account) - passed in so the game-over screen can show the
    refresh time straight from the same response that ended the run.
    No internal ids are exposed: a user only ever has one active run and
    addresses it as "current".
    """
    return {
        "difficulty": run.difficulty,
        "is_active": run.is_active,
        "end_reason": run.end_reason.value if run.end_reason else None,
        "starting_lives": run.starting_lives,
        "lives_remaining": run.lives_remaining,
        "levels_cleared": run.levels_cleared,
        "deaths": run.deaths,
        "skips": run.skips,
        "current_level": current_level_to_dict(current_entry(run)) if run.is_active else None,
        "pool": pool,
    }