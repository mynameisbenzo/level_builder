def level_to_dict(level) -> dict:
    """
    has_been_published is what tells the editor whether a level is
    still a draft that needs its one-time name (see publish_level in
    app/api/levels.py) - derived from published_at, which is set once
    at publish and never cleared. A published level is final: its
    content, title and thumbnail can't change.

    Every field here is only ever shown to the level's own owner right
    now - every /api/levels endpoint in this first pass is an
    authenticated, owner-only action (no public "view/play someone
    else's level" endpoint exists yet), so there's no separate
    public/private variant to distinguish yet the way user schemas need
    one for hide_email/hide_twitch.
    """
    return {
        "id": level.slug,
        "title": level.title,
        "visibility_state": level.visibility_state.value,
        "has_been_published": level.is_published,
        "is_deleted": level.is_deleted,
        "draft_content": level.draft_content,
        "draft_beaten_at": level.draft_beaten_at.isoformat() if level.draft_beaten_at else None,
        "created_at": level.created_at.isoformat() if level.created_at else None,
        "thumbnail_url": level.thumbnail_url,
    }


def level_to_summary_dict(
    level, rating_counts: dict | None = None, best_times: dict | None = None
) -> dict:
    """
    A lighter-weight serialization for list views - deliberately omits
    draft_content entirely, since a list of many levels (an owner's own
    full list, or a creator's public list of published levels) doesn't
    need each one's full content blob just to show a title and status.
    Safe to use for both an owner's own private list (drafts/testing
    included) and a public "levels by this creator" list (published
    only) - it carries nothing that needs hiding from a stranger in
    either case, since it's just id/title/visibility_state/timestamps
    plus the aggregate play/completion/like/dislike metrics below.

    rating_counts is an optional {level.id: (like_count, dislike_count)}
    map, built once by the caller for every level in the list (see
    list_my_levels/list_levels_by_user) rather than queried here one
    level at a time - LevelRating has no aggregate columns of its own
    (see that model), so counting is always a GROUP BY over its rows,
    and doing that per-level here would mean N extra queries for a list
    of N levels. Missing from the map (a level nobody has rated yet)
    defaults to (0, 0).

    best_times is the same idea for the fastest recorded clear: an
    optional {level_id: duration_ms} map (see
    ghosts.best_times_for_levels) built once per list. A level nobody
    has cleared is simply absent, and gets null.
    """
    likes, dislikes = (rating_counts or {}).get(level.id, (0, 0))

    return {
        "id": level.slug,
        "title": level.title,
        "visibility_state": level.visibility_state.value,
        "has_been_published": level.is_published,
        "is_deleted": level.is_deleted,
        "draft_beaten_at": level.draft_beaten_at.isoformat() if level.draft_beaten_at else None,
        "created_at": level.created_at.isoformat() if level.created_at else None,
        "play_count": level.play_count,
        "completion_count": level.completion_count,
        # null (not 0) with zero plays - "0% completion rate" and "no
        # one has played this yet" are different facts, and collapsing
        # them would make a brand-new level look identically bad to one
        # plenty of people have played and failed.
        "completion_rate": (level.completion_count / level.play_count) if level.play_count > 0 else None,
        "like_count": likes,
        "dislike_count": dislikes,
        "thumbnail_url": level.thumbnail_url,
        # The fastest recorded clear of the level, in ms - null if it's
        # never been cleared (or isn't published).
        "best_time_ms": (best_times or {}).get(level.id),
    }