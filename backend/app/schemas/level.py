def level_to_dict(level) -> dict:
    """
    has_been_published is what tells the editor whether a level still
    needs its one-time name (see publish_level in app/api/levels.py) -
    derived from latest_published_version_id, which assumes nothing
    ever clears that pointer. An explicit "unpublish" action doesn't
    exist yet; if one is added, it must not be allowed to make a named
    level look unnamed again.

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
        "has_been_published": level.latest_published_version_id is not None,
        "is_deleted": level.is_deleted,
        "draft_content": level.draft_content,
        "draft_beaten_at": level.draft_beaten_at.isoformat() if level.draft_beaten_at else None,
        "created_at": level.created_at.isoformat() if level.created_at else None,
    }


def level_to_summary_dict(level) -> dict:
    """
    A lighter-weight serialization for list views - deliberately omits
    draft_content entirely, since a list of many levels (an owner's own
    full list, or a creator's public list of published levels) doesn't
    need each one's full content blob just to show a title and status.
    Safe to use for both an owner's own private list (drafts/testing
    included) and a public "levels by this creator" list (published
    only) - it carries nothing that needs hiding from a stranger in
    either case, since it's just id/title/visibility_state/timestamps.
    """
    return {
        "id": level.slug,
        "title": level.title,
        "visibility_state": level.visibility_state.value,
        "has_been_published": level.latest_published_version_id is not None,
        "is_deleted": level.is_deleted,
        "draft_beaten_at": level.draft_beaten_at.isoformat() if level.draft_beaten_at else None,
        "created_at": level.created_at.isoformat() if level.created_at else None,
    }