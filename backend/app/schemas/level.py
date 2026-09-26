def level_to_dict(level) -> dict:
    """
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
        "draft_content": level.draft_content,
        "draft_beaten_at": level.draft_beaten_at.isoformat() if level.draft_beaten_at else None,
        "created_at": level.created_at.isoformat() if level.created_at else None,
    }