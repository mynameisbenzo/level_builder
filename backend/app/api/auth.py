from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models.login_link_request import (
    MAX_REQUESTS_PER_WINDOW,
    RATE_LIMIT_WINDOW,
    LoginLinkRequest,
)
from app.models.login_token import LoginToken, generate_login_token
from app.models.refresh_token import RefreshToken
from app.models.twitch_signup_token import TwitchSignupToken
from app.models.user import User
from app.schemas.user import user_to_full_dict
from app.services.email import send_login_link_email
from app.services.twitch import TwitchAuthError, exchange_code_for_token, get_twitch_identity
from app.services.users import clean_str, create_user_row
from app.utils.time import utc_now

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")

# Identical regardless of whether the identifier actually matches an
# account - the whole point is that this response can never be used to
# tell the two cases apart.
GENERIC_REQUEST_MESSAGE = "If an account exists for that username or email, a login link has been sent."


@auth_bp.post("/request-login-link")
def request_login_link():
    """
    Accepts either a username or an email as the identifier - either
    works, both use the same magic-link mechanism. Enumeration-safe:
    the response is identical whether or not the identifier matches a
    real account. Rate-limited by the raw identifier string itself
    (not by a matched user), so the limit applies identically to real
    and made-up identifiers alike - that's what keeps the rate limit
    itself from leaking account existence too.
    """
    payload = request.get_json(silent=True) or {}
    raw_identifier = (payload.get("identifier") or "").strip()

    if not raw_identifier:
        return jsonify({"error": "identifier is required"}), 400

    identifier = raw_identifier.lower()

    window_start = utc_now() - RATE_LIMIT_WINDOW
    recent_request_count = LoginLinkRequest.query.filter(
        LoginLinkRequest.identifier == identifier,
        LoginLinkRequest.requested_at >= window_start,
    ).count()

    if recent_request_count >= MAX_REQUESTS_PER_WINDOW:
        return (
            jsonify(
                {"error": "Too many login link requests for this account. Please try again tomorrow."}
            ),
            429,
        )

    db.session.add(LoginLinkRequest(identifier=identifier))

    user = User.query.filter(
        or_(func.lower(User.username) == identifier, func.lower(User.email) == identifier)
    ).first()

    response_body = {"message": GENERIC_REQUEST_MESSAGE}

    # Suspended/deleted accounts don't get a link sent, but the response
    # stays identical either way - this shouldn't leak suspension status
    # any more than it leaks plain account existence.
    if user is not None and not user.is_deleted and not user.is_suspended:
        token_value = generate_login_token()
        db.session.add(LoginToken(user_id=user.id, token=token_value))

        if user.email:
            send_login_link_email(user.email, token_value)

        # Dev-only convenience, same pattern as email verification -
        # never included outside debug mode, since in production this
        # would hand out a working login token in an API response. Note
        # this field's mere presence does reveal account existence in
        # debug mode specifically - an accepted tradeoff for local
        # testability, not something that ever reaches production.
        if current_app.debug:
            response_body["dev_login_token"] = token_value

    db.session.commit()

    return jsonify(response_body), 200


def _issue_token_pair(user: User) -> dict:
    """
    Shared by /login and /refresh - both end with the same thing: a
    fresh access token plus a fresh refresh token for this user.
    """
    refresh_token = RefreshToken(user_id=user.id)
    db.session.add(refresh_token)
    db.session.commit()

    # public_id, not the raw internal id - a JWT's payload is
    # base64-encoded, not encrypted, so anyone holding the token can
    # decode and read its claims even without the signing key. Using
    # the real PK here would leak it regardless of what API responses
    # do or don't expose. See User.public_id's docstring.
    access_token = create_access_token(identity=user.public_id)

    return {"access_token": access_token, "refresh_token": refresh_token.token}


@auth_bp.post("/login")
def login():
    """Consumes a login token and issues an access token + refresh token pair."""
    payload = request.get_json(silent=True) or {}
    token_value = (payload.get("token") or "").strip()

    if not token_value:
        return jsonify({"error": "token is required"}), 400

    login_token = LoginToken.query.filter_by(token=token_value).first()
    if login_token is None:
        return jsonify({"error": "invalid token"}), 404
    if not login_token.is_valid():
        return jsonify({"error": "token has expired or already been used"}), 410

    user = login_token.user
    # Defense in depth: the account could have been suspended/deleted
    # between the link being requested and it being clicked.
    if user.is_deleted or user.is_suspended:
        return jsonify({"error": "this account is no longer accessible"}), 403

    login_token.used_at = utc_now()
    db.session.commit()

    token_pair = _issue_token_pair(user)

    return jsonify({**token_pair, "user": user_to_full_dict(user)}), 200


@auth_bp.post("/refresh")
def refresh():
    """
    Exchanges a still-valid refresh token for a new access token - and,
    since refresh tokens rotate on every use, a new refresh token too.
    The caller must replace its stored refresh token with the new one
    from this response; the one it sent is revoked immediately and
    won't work again.
    """
    payload = request.get_json(silent=True) or {}
    token_value = (payload.get("refresh_token") or "").strip()

    if not token_value:
        return jsonify({"error": "refresh_token is required"}), 400

    refresh_token = RefreshToken.query.filter_by(token=token_value).first()
    if refresh_token is None:
        return jsonify({"error": "invalid refresh token"}), 404

    # Already rotated away, but presented again - a legitimate client
    # would have discarded this the moment it received its replacement,
    # so this is a real signal of theft/replay, not ordinary expiry.
    # Checked separately from is_valid() specifically so this case can
    # be told apart from plain expiry below. Response: revoke every
    # other still-active refresh token for this user too, so a
    # compromised token can't keep minting sessions even if the
    # attacker got in before this was ever caught.
    if refresh_token.revoked_at is not None:
        RefreshToken.query.filter_by(user_id=refresh_token.user_id, revoked_at=None).update(
            {"revoked_at": utc_now()}
        )
        db.session.commit()
        return jsonify({"error": "this session has been invalidated - please log in again"}), 401

    if not refresh_token.is_valid():
        return jsonify({"error": "refresh token has expired"}), 410

    user = refresh_token.user
    if user.is_deleted or user.is_suspended:
        return jsonify({"error": "this account is no longer accessible"}), 403

    refresh_token.revoked_at = utc_now()
    db.session.commit()

    token_pair = _issue_token_pair(user)

    return jsonify(token_pair), 200


@auth_bp.post("/logout")
def logout():
    """
    Revokes a refresh token server-side, so a copy that leaked
    somewhere (another tab, a stolen device) can't keep minting new
    access tokens after the person believes they've logged out.
    Deliberately doesn't require a valid access token/JWT - logging out
    should still work even if the access token has already expired.
    """
    payload = request.get_json(silent=True) or {}
    token_value = (payload.get("refresh_token") or "").strip()

    if not token_value:
        return jsonify({"error": "refresh_token is required"}), 400

    refresh_token = RefreshToken.query.filter_by(token=token_value).first()
    if refresh_token is not None and refresh_token.revoked_at is None:
        refresh_token.revoked_at = utc_now()
        db.session.commit()

    # Same response whether the token existed, was already revoked, or
    # never did - logout shouldn't leak whether a given refresh token
    # was ever valid, same enumeration-safety principle as the rest of
    # this auth system.
    return "", 204


@auth_bp.post("/twitch/callback")
def twitch_callback():
    """
    The one point where the real Twitch OAuth exchange actually
    happens - exchanges the authorization code Twitch's redirect handed
    the frontend for a real, verified twitch_id/display_name straight
    from Twitch's own API (never anything the client itself claims).

    An existing account with that twitch_id logs straight in, same
    access+refresh pair as any other login. A twitch_id never seen
    before is a new signup - rather than create an account right here
    (its username would have to be auto-assigned, and Twitch handles
    can easily collide with an existing username on this side), this
    issues a TwitchSignupToken and asks the frontend to collect a
    username via /twitch/finish-signup instead. See that token's own
    docstring for why the raw twitch_id can't just be round-tripped
    through the client directly.
    """
    payload = request.get_json(silent=True) or {}
    code = (payload.get("code") or "").strip()
    redirect_uri = (payload.get("redirect_uri") or "").strip()

    if not code or not redirect_uri:
        return jsonify({"error": "code and redirect_uri are required"}), 400

    try:
        twitch_access_token = exchange_code_for_token(code, redirect_uri)
        twitch_id, twitch_display_name = get_twitch_identity(twitch_access_token)
    except TwitchAuthError as exc:
        # The details (network failure, a stale/reused code, an
        # unexpected response shape) are useful for diagnosing a real
        # problem, but aren't anything the frontend should surface
        # verbatim to the person - they just need to know to try again.
        current_app.logger.warning("Twitch OAuth exchange failed: %s", exc)
        return jsonify({"error": "could not verify your Twitch account, please try again"}), 502

    user = User.query.filter_by(twitch_id=twitch_id).first()

    if user is not None:
        # Defense in depth, same as /login: the account could have been
        # suspended/deleted since this twitch_id was first linked.
        if user.is_deleted or user.is_suspended:
            return jsonify({"error": "this account is no longer accessible"}), 403

        token_pair = _issue_token_pair(user)
        return jsonify({**token_pair, "user": user_to_full_dict(user)}), 200

    # New Twitch identity - bridge to the username-selection step
    # rather than creating an account with no chosen username.
    signup_token = TwitchSignupToken(twitch_id=twitch_id, twitch_display_name=twitch_display_name)
    db.session.add(signup_token)
    db.session.commit()

    return (
        jsonify(
            {
                "needs_username": True,
                "signup_token": signup_token.token,
                "suggested_username": twitch_display_name,
            }
        ),
        200,
    )


@auth_bp.post("/twitch/finish-signup")
def twitch_finish_signup():
    """
    Completes a new Twitch signup - consumes the signup_token from
    /twitch/callback (proof that a real Twitch identity was genuinely
    verified) plus the username the person chose, creates the account,
    and logs them straight in with a normal access+refresh pair, same
    as any other signup. The twitch_id/twitch_display_name come only
    from the token, never from the request body - the client only ever
    gets to choose the username here.
    """
    payload = request.get_json(silent=True) or {}
    signup_token_value = (payload.get("signup_token") or "").strip()
    username = clean_str(payload.get("username"))

    if not signup_token_value:
        return jsonify({"error": "signup_token is required"}), 400
    if not username:
        return jsonify({"error": "username is required"}), 400

    signup_token = TwitchSignupToken.query.filter_by(token=signup_token_value).first()
    if signup_token is None:
        return jsonify({"error": "invalid signup token"}), 404
    if not signup_token.is_valid():
        return jsonify({"error": "signup token has expired or already been used"}), 410

    user, error = create_user_row(
        username,
        twitch_id=signup_token.twitch_id,
        twitch_display_name=signup_token.twitch_display_name,
    )
    if error is not None:
        message, status = error
        return jsonify({"error": message}), status

    signup_token.used_at = utc_now()
    db.session.commit()

    token_pair = _issue_token_pair(user)

    return jsonify({**token_pair, "user": user_to_full_dict(user)}), 200


@auth_bp.post("/twitch/link")
@jwt_required()
def twitch_link():
    """
    Links a Twitch identity to the currently authenticated account.
    Unlike /twitch/callback, this never creates a new account and never
    logs anyone in - it only ever attaches twitch_id/twitch_display_name
    to whichever account the caller's own JWT already represents.
    There's no "find an existing account for this twitch_id" branch
    here at all: if that identity already belongs to someone else,
    that's a conflict to report, not something to log into instead.
    """
    payload = request.get_json(silent=True) or {}
    code = (payload.get("code") or "").strip()
    redirect_uri = (payload.get("redirect_uri") or "").strip()

    if not code or not redirect_uri:
        return jsonify({"error": "code and redirect_uri are required"}), 400

    user = User.query.filter_by(public_id=get_jwt_identity()).first()
    if user is None or user.is_deleted:
        return jsonify({"error": "account not found"}), 404

    if user.twitch_id is not None:
        return jsonify({"error": "your account already has a linked Twitch account"}), 409

    try:
        twitch_access_token = exchange_code_for_token(code, redirect_uri)
        twitch_id, twitch_display_name = get_twitch_identity(twitch_access_token)
    except TwitchAuthError as exc:
        current_app.logger.warning("Twitch OAuth exchange failed during link: %s", exc)
        return jsonify({"error": "could not verify your Twitch account, please try again"}), 502

    if User.query.filter_by(twitch_id=twitch_id).first() is not None:
        return jsonify({"error": "this Twitch account is already linked to another user"}), 409

    user.twitch_id = twitch_id
    user.twitch_display_name = twitch_display_name
    try:
        db.session.commit()
    except IntegrityError:
        # Same race-condition reasoning as create_user_row - a second
        # link request for this exact twitch_id landing in the gap
        # between the check above and this commit. Only the database's
        # own unique constraint is actually race-proof.
        db.session.rollback()
        return jsonify({"error": "this Twitch account is already linked to another user"}), 409

    return jsonify(user_to_full_dict(user)), 200