from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.api.levels import _verification_gate
from app.extensions import db
from app.models.level import Level
from app.models.user import User
from app.services import playtime as playtime_service
from app.services.playtime import PlaytimeError

# Same url_prefix as levels_bp - these are just more /api/levels/<slug>/...
# routes, kept in their own file so levels.py doesn't grow further.
playtime_bp = Blueprint("playtime", __name__, url_prefix="/api/levels")


@playtime_bp.errorhandler(PlaytimeError)
def handle_playtime_error(error: PlaytimeError):
    db.session.rollback()
    return jsonify({"error": error.message, "code": error.code}), error.status


@playtime_bp.post("/<string:slug>/playtime")
@jwt_required()
def post_level_playtime(slug):
    """
    A playtime heartbeat from the player's browser. Body: `elapsed_ms`, the
    play time since its previous heartbeat. The server clamps it (see
    app/services/playtime.py) and answers with the player's running total
    for this level.
    """
    user = User.query.filter_by(public_id=get_jwt_identity()).first()
    if user is None or user.is_deleted:
        raise PlaytimeError("account_not_found", "account not found", 404)

    gate_error = _verification_gate(user)
    if gate_error is not None:
        message, status = gate_error
        raise PlaytimeError("verification_required", message, status)

    level = Level.query.filter_by(slug=slug).first()
    if level is None or not level.is_published or level.is_deleted:
        raise PlaytimeError("level_not_found", "level not found", 404)

    payload = request.get_json(silent=True) or {}
    row = playtime_service.apply_heartbeat(user, level, payload.get("elapsed_ms"))

    return (
        jsonify(
            {
                "total_ms": row.total_ms,
                "at_ceiling": row.total_ms >= playtime_service.MAX_PLAYTIME_MS,
            }
        ),
        200,
    )