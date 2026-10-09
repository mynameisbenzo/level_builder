import time
from datetime import timedelta

import jwt
from flask import Blueprint, current_app, jsonify
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.api.levels import _verification_gate
from app.models.user import User
from app.services.tiers import is_paid_account

race_bp = Blueprint("race", __name__, url_prefix="/api/race")

# Long enough to open a socket, short enough that a leaked ticket is
# useless almost at once. The Worker only checks it when a socket (or a
# room creation) starts, so it never needs renewing mid-race.
TICKET_LIFETIME = timedelta(minutes=2)
TICKET_AUDIENCE = "race"


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