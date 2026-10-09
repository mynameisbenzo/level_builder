import time
from datetime import timedelta

import jwt
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.api.levels import _verification_gate
from app.models.user import User
from app.services import endless as endless_service
from app.services.tiers import is_paid_account

race_bp = Blueprint("race", __name__, url_prefix="/api/race")

# Long enough to open a socket, short enough that a leaked ticket is
# useless almost at once. The Worker only checks it when a socket (or a
# room creation) starts, so it never needs renewing mid-race.
TICKET_LIFETIME = timedelta(minutes=2)
TICKET_AUDIENCE = "race"
# What the race Worker signs when it calls this server (not a player).
INTERNAL_AUDIENCE = "race-internal"
CANDIDATE_MAX = 4


@race_bp.post("/ticket")
@jwt_required()
def post_race_ticket():
    """
    Hands a signed-in account a short-lived ticket for the race server:
    who they are and whether they may host (paid). The race server trusts
    only this ticket, never anything the browser says about itself.
    """
    secret = current_app.config.get("RACE_TICKET_SECRET", "")
    if not secret:
        return jsonify({"error": "races are not set up", "code": "races_unavailable"}), 503

    user = User.query.filter_by(public_id=get_jwt_identity()).first()
    if user is None or user.is_deleted:
        return jsonify({"error": "account not found", "code": "account_not_found"}), 404

    gate_error = _verification_gate(user)
    if gate_error is not None:
        message, status = gate_error
        return jsonify({"error": message, "code": "verification_required"}), status

    # time.time(), not utc_now(): that one is a naive datetime, whose
    # .timestamp() would be read as local time and skew iat/exp.
    now = int(time.time())
    ticket = jwt.encode(
        {
            "sub": user.public_id,
            "username": user.username,
            "paid": is_paid_account(user),
            "aud": TICKET_AUDIENCE,
            "iat": now,
            "exp": now + int(TICKET_LIFETIME.total_seconds()),
        },
        secret,
        algorithm="HS256",
    )
    return jsonify({"ticket": ticket, "expires_in": int(TICKET_LIFETIME.total_seconds())}), 200



@race_bp.post("/candidates")
def post_race_candidates():
    """
    The race Worker asks for the levels a room's vote will offer. Not a
    browser route: it needs the Worker's own signed token (same shared
    secret as the tickets, a different audience), so a player's ticket
    or login token can't call it.

    Body: {"category": "any" | easy | normal | hard | very_hard | tas,
    "count": 1-4}. Every published level is eligible, labeled or not; a
    named category only draws levels carrying that label.
    """
    secret = current_app.config.get("RACE_TICKET_SECRET", "")
    if not secret:
        return jsonify({"error": "races are not set up", "code": "races_unavailable"}), 503

    header = request.headers.get("Authorization", "")
    token = header[7:] if header.lower().startswith("bearer ") else ""
    try:
        jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience=INTERNAL_AUDIENCE,
            options={"require": ["exp", "aud"]},
        )
    except jwt.PyJWTError:
        return jsonify({"error": "unauthorized", "code": "unauthorized"}), 401

    body = request.get_json(silent=True) or {}
    category = body.get("category", "any")
    if category != "any" and category not in endless_service.ENDLESS_DIFFICULTIES:
        return jsonify({"error": "unknown category", "code": "bad_category"}), 400

    count = body.get("count", CANDIDATE_MAX)
    if isinstance(count, bool) or not isinstance(count, int):
        count = CANDIDATE_MAX
    count = max(1, min(CANDIDATE_MAX, count))

    levels = endless_service.random_published_levels(None if category == "any" else category, count)
    return (
        jsonify(
            {
                "levels": [
                    {
                        "slug": level.slug,
                        "title": level.title,
                        "owner_username": level.owner.username,
                        "difficulty": level.difficulty_label_cached,
                        "thumbnail_url": level.thumbnail_url,
                    }
                    for level in levels
                ]
            }
        ),
        200,
    )