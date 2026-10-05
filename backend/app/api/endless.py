from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.api.levels import _verification_gate
from app.extensions import db
from app.models.user import User
from app.schemas.endless import run_to_dict
from app.services import endless as endless_service
from app.services.endless import EndlessError
from app.utils.time import utc_now

endless_bp = Blueprint("endless", __name__, url_prefix="/api/endless")


@endless_bp.errorhandler(EndlessError)
def handle_endless_error(error: EndlessError):
    # Anything half-done is discarded - the service commits its own
    # lazy bookkeeping (expiry, settling an abandoned attempt) before it
    # can raise, so a rollback here never undoes that.
    db.session.rollback()
    body = {"error": error.message, "code": error.code}
    body.update(error.extra)
    return jsonify(body), error.status


def _get_user() -> User:
    """
    The caller, or an EndlessError. Endless mode is accounts-only (the
    frontend sends non-users to sign up, but this is the real gate) and
    uses the same verified-email-or-Twitch requirement as level actions,
    so a pile of throwaway unverified accounts can't each claim a fresh
    daily pool.
    """
    user = User.query.filter_by(public_id=get_jwt_identity()).first()
    if user is None or user.is_deleted:
        raise EndlessError("account_not_found", "account not found", 404)

    gate_error = _verification_gate(user)
    if gate_error is not None:
        message, status = gate_error
        raise EndlessError("verification_required", message, status)

    return user


def _require_active_run(user: User, now, resolve_pending: bool):
    run = endless_service.get_active_run(user, now, resolve_pending=resolve_pending)
    if run is None:
        raise EndlessError("no_active_run", "you have no endless run in progress", 404)
    return run


def _run_response(run, user: User, now, status: int = 200):
    return jsonify({"run": run_to_dict(run, endless_service.serialize_pool(user, now))}), status


@endless_bp.get("/status")
@jwt_required()
def get_status():
    """
    Everything the endless entry screen needs in one call: how many
    levels each difficulty choice could serve (the picker greys out any
    with none), the caller's lives rules and daily pool, and their
    active run if they have one to resume.
    """
    user = _get_user()
    now = utc_now()

    run = endless_service.get_active_run(user, now)
    is_paid = endless_service.is_paid_account(user)

    if is_paid:
        lives = {
            "adjustable": True,
            "default": endless_service.PAID_DEFAULT_LIVES,
            "min": endless_service.PAID_MIN_LIVES,
            "max": endless_service.PAID_MAX_LIVES,
        }
    else:
        lives = {
            "adjustable": False,
            "default": endless_service.FREE_LIVES_PER_RUN,
            "min": endless_service.FREE_LIVES_PER_RUN,
            "max": endless_service.FREE_LIVES_PER_RUN,
        }

    pool = endless_service.serialize_pool(user, now)
    return (
        jsonify(
            {
                "is_paid": is_paid,
                "lives": lives,
                "pool": pool,
                "difficulties": endless_service.count_eligible_levels(),
                "active_run": run_to_dict(run, pool) if run is not None else None,
            }
        ),
        200,
    )


@endless_bp.post("/runs")
@jwt_required()
def start_run():
    """
    Body (all optional): `difficulty` (one of ENDLESS_DIFFICULTIES; omit
    or null for any), `starting_lives` (paid accounts only, 1-100),
    `replace` (true to forfeit an already-active run and start this one
    instead - without it, an existing active run is a 409 the frontend
    turns into "resume or start over").
    """
    user = _get_user()
    now = utc_now()
    payload = request.get_json(silent=True) or {}

    replace = payload.get("replace", False)
    if not isinstance(replace, bool):
        raise EndlessError("invalid_replace", "replace must be true or false", 400)

    difficulty = payload.get("difficulty")
    if difficulty == "any":
        difficulty = None

    try:
        run = endless_service.start_run(user, difficulty, payload.get("starting_lives"), replace, now)
    except EndlessError as error:
        if error.code == "active_run_exists":
            existing = endless_service.get_active_run(user, now, resolve_pending=False)
            if existing is not None:
                error.extra["active_run"] = run_to_dict(existing, endless_service.serialize_pool(user, now))
        raise

    return _run_response(run, user, now, 201)


@endless_bp.post("/runs/current/begin")
@jwt_required()
def begin_attempt():
    """
    The level has loaded and play is starting. Not sent when the
    interstitial is merely shown - an attempt only exists (and an
    abandoned one only costs a life) from here on. The response's
    run.is_active can be false if settling an earlier never-reported
    attempt just used up the last life.
    """
    user = _get_user()
    now = utc_now()
    run = _require_active_run(user, now, resolve_pending=False)

    endless_service.begin_attempt(run, user, now)
    db.session.commit()
    return _run_response(run, user, now)


@endless_bp.post("/runs/current/heartbeat")
@jwt_required()
def heartbeat():
    """Sent every ~10 seconds while a level is being played; see record_heartbeat."""
    user = _get_user()
    now = utc_now()
    run = _require_active_run(user, now, resolve_pending=False)

    endless_service.record_heartbeat(run, now)
    db.session.commit()
    return jsonify({"ok": True}), 200


@endless_bp.post("/runs/current/death")
@jwt_required()
def report_death():
    """
    The player died. Costs a life. If it was the last one the run ends
    (run.is_active false, end_reason "out_of_lives") and run.pool carries
    the daily-pool standing, including when it refreshes, for the
    game-over screen.
    """
    user = _get_user()
    now = utc_now()
    run = _require_active_run(user, now, resolve_pending=False)

    endless_service.report_death(run, now)
    db.session.commit()
    return _run_response(run, user, now)


@endless_bp.post("/runs/current/clear")
@jwt_required()
def report_clear():
    """
    The player cleared the level. The response is the run already moved
    on to its next level (run.current_level), or - if nothing is
    available to serve - still active with current_level null.
    """
    user = _get_user()
    now = utc_now()
    run = _require_active_run(user, now, resolve_pending=False)

    endless_service.report_clear(run, user, now)
    db.session.commit()
    return _run_response(run, user, now)


@endless_bp.post("/runs/current/skip")
@jwt_required()
def skip_level():
    """Skips the current level, at the cost of a life."""
    user = _get_user()
    now = utc_now()
    run = _require_active_run(user, now, resolve_pending=False)

    endless_service.skip_level(run, now)
    db.session.commit()
    return _run_response(run, user, now)


@endless_bp.post("/runs/current/quit")
@jwt_required()
def quit_run():
    """Forfeits the active run."""
    user = _get_user()
    now = utc_now()
    run = _require_active_run(user, now, resolve_pending=False)

    endless_service.forfeit_run(run, user, now)
    db.session.commit()
    return _run_response(run, user, now)