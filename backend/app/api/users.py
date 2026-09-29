from datetime import timedelta

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models.email_verification import EmailVerificationToken, generate_verification_token
from app.models.user import User
from app.schemas.user import user_to_full_dict, user_to_public_dict
from app.services.email import send_verification_email
from app.services.tokens import issue_token_pair
from app.services.users import clean_str, create_user_row, username_is_taken
from app.utils.time import utc_now

users_bp = Blueprint("users", __name__, url_prefix="/api/users")

# Unlike LoginLinkRequest's rate limit (app/models/login_link_request.py),
# this doesn't need its own tracking table - EmailVerificationToken rows
# already carry a created_at, and this endpoint is authenticated (the
# caller can only ever resend to their own account), so there's no
# enumeration concern requiring a limit keyed off a raw, possibly-fake
# identifier the way the login-link one is. Counting this account's own
# recent token rows is enough. A shorter window than the login-link
# limit's one-per-day, since someone waiting on a lost/expired
# verification email is actively blocked from using the product right
# now, not just trying to log in again later.
MAX_RESEND_REQUESTS_PER_WINDOW = 3
RESEND_RATE_LIMIT_WINDOW = timedelta(hours=1)


@users_bp.post("")
def create_user():
    """
    Creates a user directly from the given fields. This is NOT the real
    email signup flow (magic-link verification) or Twitch OAuth (see
    app/api/auth.py's twitch routes for that) - this endpoint exists so
    the User model has a real, testable way to get rows into the
    database, and so the rest of the CRUD surface below has something
    to exercise against.
    """
    payload = request.get_json(silent=True) or {}
    username = clean_str(payload.get("username"))
    email = clean_str(payload.get("email"))
    twitch_id = clean_str(payload.get("twitch_id"))
    twitch_display_name = clean_str(payload.get("twitch_display_name"))

    if not username:
        return jsonify({"error": "username is required"}), 400
    if not email and not twitch_id:
        return jsonify({"error": "at least one of email or twitch_id is required"}), 400

    user, error = create_user_row(
        username, email=email, twitch_id=twitch_id, twitch_display_name=twitch_display_name
    )
    if error is not None:
        message, status = error
        return jsonify({"error": message}), status

    response_body = user_to_full_dict(user)

    # Twitch-only signup has nothing to verify - Twitch's own OAuth
    # already confirms the account is real. Only email signup needs
    # this step.
    if email:
        token_value = generate_verification_token()
        verification_token = EmailVerificationToken(user_id=user.id, token=token_value)
        db.session.add(verification_token)
        db.session.commit()

        send_verification_email(email, token_value)

        # Dev-only convenience: with no real email provider wired up,
        # this is how the token can actually be tested end-to-end
        # locally. Never included outside debug mode - in production
        # this would hand out a working auth token in an API response.
        if current_app.debug:
            response_body["dev_verification_token"] = token_value

    return jsonify(response_body), 201


@users_bp.post("/verify-email")
def verify_email():
    """
    Consumes a verification token (from the link a real email would
    contain, once a real provider exists), marks the owning user's
    email as verified, and logs them in - clicking a genuine
    verification link proves the same thing a login-link click does
    (control of the account's email), so this is now a valid way to
    establish a session too, not just a separate step someone has to
    additionally go through via /login afterward.
    """
    payload = request.get_json(silent=True) or {}
    token_value = clean_str(payload.get("token"))

    if not token_value:
        return jsonify({"error": "token is required"}), 400

    verification_token = EmailVerificationToken.query.filter_by(token=token_value).first()
    if verification_token is None:
        return jsonify({"error": "invalid token"}), 404
    if not verification_token.is_valid():
        return jsonify({"error": "token has expired or already been used"}), 410

    user = verification_token.user
    # Defense in depth, same as every other real login moment
    # (/login, /refresh, /auth/twitch/callback): the account could have
    # been suspended/deleted in the time between signing up and
    # clicking the link.
    if user.is_deleted or user.is_suspended:
        return jsonify({"error": "this account is no longer accessible"}), 403

    user.email_verified_at = utc_now()
    verification_token.used_at = utc_now()
    db.session.commit()

    token_pair = issue_token_pair(user)

    return jsonify({**token_pair, "user": user_to_full_dict(user)}), 200


@users_bp.post("/resend-verification-email")
@jwt_required()
def resend_verification_email():
    """
    Issues a fresh EmailVerificationToken and re-sends the verification
    email - for when the original one never arrived, expired (24-hour
    lifetime), or got lost. Authenticated and self-only by construction
    (there's no target user in the request at all, only the caller's own
    JWT identity), unlike the enumeration-safe /request-login-link,
    which has to accept an arbitrary identifier from someone who isn't
    logged in yet.

    Deliberately does NOT invalidate any still-outstanding tokens from
    an earlier request - multiple valid tokens for the same account can
    coexist harmlessly, since verify-email only ever consumes the one
    it's given; an older email/link still sitting unread in an inbox
    keeps working right up until whichever token gets used first.
    """
    user = User.query.filter_by(public_id=get_jwt_identity()).first()
    if user is None or user.is_deleted:
        return jsonify({"error": "account not found"}), 404

    if not user.email:
        return jsonify({"error": "this account has no email address to verify"}), 400

    if user.email_verified_at is not None:
        return jsonify({"error": "this email is already verified"}), 409

    window_start = utc_now() - RESEND_RATE_LIMIT_WINDOW
    recent_request_count = EmailVerificationToken.query.filter(
        EmailVerificationToken.user_id == user.id,
        EmailVerificationToken.created_at >= window_start,
    ).count()
    if recent_request_count >= MAX_RESEND_REQUESTS_PER_WINDOW:
        return (
            jsonify({"error": "too many verification emails requested - please try again later"}),
            429,
        )

    token_value = generate_verification_token()
    verification_token = EmailVerificationToken(user_id=user.id, token=token_value)
    db.session.add(verification_token)
    db.session.commit()

    send_verification_email(user.email, token_value)

    response_body = {"message": "Verification email sent."}
    # Same dev-only convenience as create_user's own first send - see
    # that endpoint's comment for why this is debug-only.
    if current_app.debug:
        response_body["dev_verification_token"] = token_value

    return jsonify(response_body), 200


@users_bp.get("/<string:public_id>")
def get_user_by_public_id(public_id):
    """Public profile lookup, by the external public_id - intentionally
    not behind auth. Respects hide_email/hide_twitch via
    user_to_public_dict either way."""
    user = User.query.filter_by(public_id=public_id).first()
    if user is None or user.is_deleted:
        return jsonify({"error": "user not found"}), 404
    return jsonify(user_to_public_dict(user)), 200


@users_bp.get("/by-username/<string:username>")
def get_user_by_username(username):
    """Same as get_user_by_public_id, by username instead - also intentionally public."""
    user = User.query.filter_by(username=username).first()
    if user is None or user.is_deleted:
        return jsonify({"error": "user not found"}), 404
    return jsonify(user_to_public_dict(user)), 200


@users_bp.patch("/<string:public_id>")
@jwt_required()
def update_user(public_id):
    """
    Partial update of username/hide_email/hide_twitch. Self-only - the
    JWT's identity (itself the user's public_id, not the raw internal
    id - see User.public_id) must match the target public_id.
    Deliberately no dev/moderator bypass here: editing someone else's
    profile fields isn't a moderation action the design ever specified
    (suspending an abusive account is the actual tool for that, via a
    separate, not-yet-built endpoint) - conflating the two here would
    grant a broader power than was ever actually designed.
    """
    if get_jwt_identity() != public_id:
        return jsonify({"error": "you can only update your own account"}), 403

    user = User.query.filter_by(public_id=public_id).first()
    if user is None or user.is_deleted:
        return jsonify({"error": "user not found"}), 404

    payload = request.get_json(silent=True) or {}

    if "username" in payload:
        new_username = clean_str(payload["username"])
        if not new_username:
            return jsonify({"error": "username cannot be empty"}), 400
        if username_is_taken(new_username, exclude_user_id=user.id):
            return jsonify({"error": "username is already taken"}), 409
        user.username = new_username

    if "hide_email" in payload:
        user.hide_email = bool(payload["hide_email"])

    if "hide_twitch" in payload:
        user.hide_twitch = bool(payload["hide_twitch"])

    try:
        db.session.commit()
    except IntegrityError:
        # Same race as create_user_row - a concurrent request claiming
        # the same username between the check above and this commit.
        # See that function's comment for the full reasoning.
        db.session.rollback()
        return jsonify({"error": "username is already taken"}), 409

    return jsonify(user_to_full_dict(user)), 200


@users_bp.delete("/<string:public_id>")
@jwt_required()
def delete_user(public_id):
    """
    Soft-delete: the row stays (so FKs from levels/etc. never dangle),
    but becomes an anonymized "deleted user" placeholder - email/
    twitch_id cleared to scrub PII, username replaced with a
    deterministic placeholder. Not reversible through this endpoint.

    Self-only - a user deleting their own account. This is
    deliberately not the same action as a moderator suspending/banning
    someone else's account (a separate, not-yet-built endpoint) - the
    two have different meanings and shouldn't share one code path.
    """
    if get_jwt_identity() != public_id:
        return jsonify({"error": "you can only delete your own account"}), 403

    user = User.query.filter_by(public_id=public_id).first()
    if user is None or user.is_deleted:
        return jsonify({"error": "user not found"}), 404

    user.is_deleted = True
    user.username = f"deleted_user_{user.id}"
    user.email = None
    user.email_verified_at = None
    user.twitch_id = None
    user.twitch_display_name = None
    db.session.commit()

    return "", 204