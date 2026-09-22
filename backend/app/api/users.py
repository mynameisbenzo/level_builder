from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.extensions import db
from app.models.email_verification import EmailVerificationToken, generate_verification_token
from app.models.user import User, UserRole
from app.schemas.user import user_to_full_dict, user_to_public_dict
from app.services.email import send_verification_email

users_bp = Blueprint("users", __name__, url_prefix="/api/users")


def _clean_str(value) -> str | None:
    """Trims a string field from a JSON payload; treats blank as absent."""
    if value is None:
        return None
    stripped = str(value).strip()
    return stripped or None


@users_bp.post("")
def create_user():
    """
    Creates a user directly from the given fields. This is NOT the real
    signup flow (magic-link email verification, Twitch OAuth) - those
    still need actual external service integration (see README). This
    endpoint exists so the User model has a real, testable way to get
    rows into the database right now, and so the rest of the CRUD
    surface below has something to exercise against.
    """
    payload = request.get_json(silent=True) or {}
    username = _clean_str(payload.get("username"))
    email = _clean_str(payload.get("email"))
    twitch_id = _clean_str(payload.get("twitch_id"))
    twitch_display_name = _clean_str(payload.get("twitch_display_name"))

    if not username:
        return jsonify({"error": "username is required"}), 400
    if not email and not twitch_id:
        return jsonify({"error": "at least one of email or twitch_id is required"}), 400

    if User.query.filter_by(username=username).first() is not None:
        return jsonify({"error": "username is already taken"}), 409
    if email and User.query.filter_by(email=email).first() is not None:
        return jsonify({"error": "email is already registered"}), 409
    if twitch_id and User.query.filter_by(twitch_id=twitch_id).first() is not None:
        return jsonify({"error": "twitch account is already linked to another user"}), 409

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
    db.session.commit()

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
    token_value = _clean_str(payload.get("token"))

    if not token_value:
        return jsonify({"error": "token is required"}), 400

    verification_token = EmailVerificationToken.query.filter_by(token=token_value).first()
    if verification_token is None:
        return jsonify({"error": "invalid token"}), 404
    if not verification_token.is_valid():
        return jsonify({"error": "token has expired or already been used"}), 410

    user = verification_token.user
    user.email_verified_at = datetime.now(timezone.utc)
    verification_token.used_at = datetime.now(timezone.utc)
    db.session.commit()

    return jsonify(user_to_full_dict(user)), 200


@users_bp.get("/<int:user_id>")
def get_user_by_id(user_id):
    """Public profile lookup - intentionally not behind auth. Respects
    hide_email/hide_twitch via user_to_public_dict either way."""
    user = db.session.get(User, user_id)
    if user is None or user.is_deleted:
        return jsonify({"error": "user not found"}), 404
    return jsonify(user_to_public_dict(user)), 200


@users_bp.get("/by-username/<string:username>")
def get_user_by_username(username):
    """Same as get_user_by_id, by username instead - also intentionally public."""
    user = User.query.filter_by(username=username).first()
    if user is None or user.is_deleted:
        return jsonify({"error": "user not found"}), 404
    return jsonify(user_to_public_dict(user)), 200


@users_bp.patch("/<int:user_id>")
@jwt_required()
def update_user(user_id):
    """
    Partial update of username/hide_email/hide_twitch. Self-only - the
    JWT's identity must match the target user. Deliberately no
    dev/moderator bypass here: editing someone else's profile fields
    isn't a moderation action the design ever specified (suspending an
    abusive account is the actual tool for that, via a separate,
    not-yet-built endpoint) - conflating the two here would grant a
    broader power than was ever actually designed.
    """
    if get_jwt_identity() != str(user_id):
        return jsonify({"error": "you can only update your own account"}), 403

    user = db.session.get(User, user_id)
    if user is None or user.is_deleted:
        return jsonify({"error": "user not found"}), 404

    payload = request.get_json(silent=True) or {}

    if "username" in payload:
        new_username = _clean_str(payload["username"])
        if not new_username:
            return jsonify({"error": "username cannot be empty"}), 400
        existing = User.query.filter_by(username=new_username).first()
        if existing is not None and existing.id != user.id:
            return jsonify({"error": "username is already taken"}), 409
        user.username = new_username

    if "hide_email" in payload:
        user.hide_email = bool(payload["hide_email"])

    if "hide_twitch" in payload:
        user.hide_twitch = bool(payload["hide_twitch"])

    db.session.commit()
    return jsonify(user_to_full_dict(user)), 200


@users_bp.delete("/<int:user_id>")
@jwt_required()
def delete_user(user_id):
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
    if get_jwt_identity() != str(user_id):
        return jsonify({"error": "you can only delete your own account"}), 403

    user = db.session.get(User, user_id)
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