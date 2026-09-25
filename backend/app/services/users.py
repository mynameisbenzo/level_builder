from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models.user import User, UserRole


def clean_str(value) -> str | None:
    """Trims a string field from a JSON payload; treats blank as absent."""
    if value is None:
        return None
    stripped = str(value).strip()
    return stripped or None


def username_is_taken(username: str, exclude_user_id: int | None = None) -> bool:
    """
    Broken out on its own so the exact instant this check runs is
    controllable in a test - the real reason it exists is to make the
    race window in create_user_row below (an identical concurrent
    request slipping in between this check and the commit)
    deterministically testable via monkeypatch, rather than relying on
    real, flaky concurrency.
    """
    existing = User.query.filter_by(username=username).first()
    if existing is None:
        return False
    if exclude_user_id is not None and existing.id == exclude_user_id:
        return False
    return True


def create_user_row(
    username: str,
    email: str | None = None,
    twitch_id: str | None = None,
    twitch_display_name: str | None = None,
) -> tuple[User | None, tuple[str, int] | None]:
    """
    The actual row-creation core, shared by POST /api/users (direct
    email/Twitch-ID signup) and the Twitch OAuth finish-signup step -
    both ultimately just need "create a User with this auth identity
    attached, respecting the owner-role bootstrap rule and the same
    race-condition handling". Returns (user, None) on success, or
    (None, (message, status)) on failure - callers turn the latter into
    their own jsonify() response, since what the response looks like
    otherwise differs between callers.
    """
    if username_is_taken(username):
        return None, ("username is already taken", 409)
    if email and User.query.filter_by(email=email).first() is not None:
        return None, ("email is already registered", 409)
    if twitch_id and User.query.filter_by(twitch_id=twitch_id).first() is not None:
        return None, ("twitch account is already linked to another user", 409)

    # The very first account ever created becomes Owner automatically -
    # checking "does an Owner already exist" rather than "is this row
    # count zero" is a more direct match for the actual rule (there
    # must be exactly one bootstrap admin), and stays correct even in
    # edge cases like the original Owner account later being deleted.
    role = UserRole.OWNER if User.query.filter_by(role=UserRole.OWNER).first() is None else UserRole.USER

    user = User(
        username=username,
        email=email,
        twitch_id=twitch_id,
        twitch_display_name=twitch_display_name,
        role=role,
    )
    db.session.add(user)
    try:
        db.session.commit()
    except IntegrityError:
        # The checks above are the common case, but they're not
        # race-proof by themselves - only the database's own unique
        # constraints (username/email/twitch_id) actually are. A
        # second signup for the same value landing in the narrow
        # window between this request's check and its commit would
        # otherwise surface as a raw, unhandled 500 instead of the
        # same clean, specific error the pre-checks above already give
        # for the non-race case. Re-checking here (post-rollback, so
        # these queries see the committed state) says which field
        # actually collided, rather than a single generic message.
        db.session.rollback()
        if username_is_taken(username):
            return None, ("username is already taken", 409)
        if email and User.query.filter_by(email=email).first() is not None:
            return None, ("email is already registered", 409)
        if twitch_id and User.query.filter_by(twitch_id=twitch_id).first() is not None:
            return None, ("twitch account is already linked to another user", 409)
        # Shouldn't normally be reachable - some other constraint
        # violation. Still fails closed with a clean error rather than
        # leaking the raw database exception.
        return None, ("could not create account, please try again", 409)

    return user, None