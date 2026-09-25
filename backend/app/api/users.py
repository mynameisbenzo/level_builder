from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models.email_verification import EmailVerificationToken, generate_verification_token
from app.models.user import User
from app.schemas.user import user_to_full_dict, user_to_public_dict
from app.services.email import send_verification_email
from app.services.users import clean_str, create_user_row, username_is_taken
from app.utils.time import utc_now

users_bp = Blueprint("users", __name__, url_prefix="/api/users")


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
    contain, once a real provider exists) and marks the owning user's
    email as verified.
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
    user.email_verified_at = utc_now()
    verification_token.used_at = utc_now()
    db.session.commit()

    return jsonify(user_to_full_dict(user)), 200


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