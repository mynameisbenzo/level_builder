from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import create_access_token
from sqlalchemy import func, or_

from app.extensions import db
from app.models.login_link_request import (
    MAX_REQUESTS_PER_WINDOW,
    RATE_LIMIT_WINDOW,
    LoginLinkRequest,
)
from app.models.login_token import LoginToken, generate_login_token
from app.models.user import User
from app.schemas.user import user_to_full_dict
from app.services.email import send_login_link_email

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

    window_start = datetime.now(timezone.utc) - RATE_LIMIT_WINDOW
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


@auth_bp.post("/login")
def login():
    """Consumes a login token and issues a JWT in exchange."""
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

    login_token.used_at = datetime.now(timezone.utc)
    db.session.commit()

    access_token = create_access_token(identity=str(user.id))

    return jsonify({"access_token": access_token, "user": user_to_full_dict(user)}), 200