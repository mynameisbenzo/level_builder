def user_to_public_dict(user) -> dict:
    """
    Public-facing representation of a user - what anyone is allowed to
    see, not just the account owner. Respects hide_email/hide_twitch;
    username is always shown, since it's the public identity by design.
    """
    data = {
        "id": user.id,
        "username": user.username,
        "role": user.role.value,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }
    if not user.hide_email and user.email:
        data["email"] = user.email
    if not user.hide_twitch and user.twitch_display_name:
        data["twitch_display_name"] = user.twitch_display_name
    return data


def user_to_full_dict(user) -> dict:
    """
    Everything, including fields that should only ever be visible to the
    account owner themselves (raw email/twitch_id regardless of privacy
    flags, verification/suspension state). There is no real auth/session
    middleware yet (see README Accounts TODOs), so nothing currently
    checks "is this actually the account owner asking" before calling
    this - every endpoint using it today is a temporary, unauthenticated
    stand-in, not a finished, access-controlled one.
    """
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "email_verified_at": user.email_verified_at.isoformat() if user.email_verified_at else None,
        "twitch_id": user.twitch_id,
        "twitch_display_name": user.twitch_display_name,
        "role": user.role.value,
        "hide_email": user.hide_email,
        "hide_twitch": user.hide_twitch,
        "is_suspended": user.is_suspended,
        "is_deleted": user.is_deleted,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }