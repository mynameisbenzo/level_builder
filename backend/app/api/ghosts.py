from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.api.levels import _verification_gate
from app.extensions import db
from app.models.level import Level
from app.models.user import User
from app.services import ghosts as ghost_service
from app.services.ghosts import GhostError

# Same url_prefix as levels_bp - these are just more /api/levels/<slug>/...
# routes, kept in their own file so levels.py doesn't grow further.
ghosts_bp = Blueprint("ghosts", __name__, url_prefix="/api/levels")


@ghosts_bp.errorhandler(GhostError)
def handle_ghost_error(error: GhostError):
    db.session.rollback()
    return jsonify({"error": error.message, "code": error.code}), error.status


def _live_level_or_404(slug: str) -> Level:
    level = Level.query.filter_by(slug=slug).first()
    if level is None or not level.is_published or level.is_deleted:
        raise GhostError("level_not_found", "level not found", 404)
    return level


@ghosts_bp.get("/<string:slug>/ghost")
def get_level_ghost(slug):
    """
    Public, unauthenticated - fetched alongside a level when it's played.
    `ghosts` has one entry per kind (`full`, `before`, `after`), each null
    until someone has cleared that stretch; a level without a checkpoint
    only ever has `full`. `ghost` is the `full` ghost again - what clients
    from before checkpoints existed read.
    """
    level = _live_level_or_404(slug)

    ghosts = ghost_service.get_ghosts(level.id)
    payload = {
        kind: ghost_service.ghost_to_dict(ghost) if ghost is not None else None
        for kind, ghost in ghosts.items()
    }
    return jsonify({"ghost": payload["full"], "ghosts": payload}), 200


@ghosts_bp.post("/<string:slug>/ghost")
@jwt_required()
def submit_level_ghost(slug):
    """
    Offers a just-cleared stretch as the level's ghost of that kind. Body:
    `duration_ms`, `frames` and optionally `kind` ("full" by default, or
    "before" / "after" for the two halves of a run through a checkpoint -
    see app/services/ghosts.py). Always 200 on a valid run: `is_record`
    says whether it became that kind's ghost, and `record` is the level's
    record afterwards (the fastest full route, or before + after pair) -
    what the result modal compares the player's time against.
    """
    user = User.query.filter_by(public_id=get_jwt_identity()).first()
    if user is None or user.is_deleted:
        raise GhostError("account_not_found", "account not found", 404)

    gate_error = _verification_gate(user)
    if gate_error is not None:
        message, status = gate_error
        raise GhostError("verification_required", message, status)

    level = _live_level_or_404(slug)
    payload = request.get_json(silent=True) or {}

    kind = payload.get("kind", "full")
    is_record, ghost = ghost_service.submit_run(
        user,
        level,
        payload.get("duration_ms"),
        payload.get("frames"),
        kind,
    )

    return (
        jsonify(
            {
                "is_record": is_record,
                "kind": kind,
                "record": ghost_service.level_record(level.id, ghost),
            }
        ),
        200,
    )