from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.extensions import db
from app.models.level import Level, LevelVersion, LevelVisibilityState
from app.models.user import User
from app.schemas.level import level_to_dict, level_to_summary_dict
from app.services.level_content import default_level_content, validate_level_content
from app.utils.time import utc_now

levels_bp = Blueprint("levels", __name__, url_prefix="/api/levels")

# Mirrors the Level.title column (db.String(120)) - SQLite (used in
# tests) doesn't enforce string lengths, but Postgres does, and would
# turn an over-long title into an unhandled 500 rather than a clean
# 400 unless it's checked here first.
MAX_TITLE_LENGTH = 120


def _title_length_error(title: str) -> str | None:
    if len(title) > MAX_TITLE_LENGTH:
        return f"title cannot be longer than {MAX_TITLE_LENGTH} characters"
    return None


def _get_owned_level(slug: str) -> tuple[Level | None, tuple[str, int] | None]:
    """
    Shared by every owner-only level action below - looks the level up
    by slug and confirms the caller's own JWT identity matches its
    owner. Returns (level, None) on success, or (None, (message,
    status)) on failure, same pattern as app/services/users.py's
    create_user_row.

    A non-owner gets the same 404 whether the slug doesn't exist at all
    or belongs to someone else - never a 403 - so a request can't be
    used to enumerate which draft/unpublished level slugs are real.
    Published levels are meant to be publicly knowable by design once a
    real "view a published level" endpoint exists, but nothing here
    is that endpoint yet, so this stays uniformly strict for now.
    """
    level = Level.query.filter_by(slug=slug).first()
    if level is None:
        return None, ("level not found", 404)

    owner = level.owner
    if owner is None or get_jwt_identity() != owner.public_id:
        return None, ("level not found", 404)

    return level, None


@levels_bp.post("")
@jwt_required()
def create_level():
    """Creates a new level, owned by the caller, with content already
    in a valid, immediately-saveable default state (see
    default_level_content) rather than starting as null."""
    payload = request.get_json(silent=True) or {}
    title = (payload.get("title") or "").strip()

    if not title:
        return jsonify({"error": "title is required"}), 400
    length_error = _title_length_error(title)
    if length_error:
        return jsonify({"error": length_error}), 400

    user = User.query.filter_by(public_id=get_jwt_identity()).first()
    if user is None or user.is_deleted:
        return jsonify({"error": "account not found"}), 404

    level = Level(owner_id=user.id, title=title, draft_content=default_level_content())
    db.session.add(level)
    db.session.commit()

    return jsonify(level_to_dict(level)), 201


@levels_bp.get("")
@jwt_required()
def list_my_levels():
    """
    Every level the caller owns - drafts and testing included, since
    this is the owner-only view (contrast with the public
    by-user/<username> endpoint below, which only ever shows published
    levels). Newest first. No pagination yet - genuinely unnecessary at
    today's scale (one person's own levels), though the eventual public
    "levels by this creator" listing (see README's Discover/browsing
    section) will need real pagination once it exists. Using the same
    lean level_to_summary_dict there too when it's built keeps this
    endpoint's shape ready for that without needing a breaking change.
    """
    user = User.query.filter_by(public_id=get_jwt_identity()).first()
    if user is None or user.is_deleted:
        return jsonify({"error": "account not found"}), 404

    levels = Level.query.filter_by(owner_id=user.id).order_by(Level.created_at.desc()).all()

    return jsonify([level_to_summary_dict(level) for level in levels]), 200


@levels_bp.get("/<string:slug>")
@jwt_required()
def get_level(slug):
    """Fetches a level's current state, including its draft content -
    how the editor resumes a level the creator already started."""
    level, error = _get_owned_level(slug)
    if error is not None:
        message, status = error
        return jsonify({"error": message}), status

    return jsonify(level_to_dict(level)), 200


@levels_bp.patch("/<string:slug>")
@jwt_required()
def save_level(slug):
    """
    Saves the editor's current in-progress content. Cheap and
    unconditional compared to publishing - no beat requirement, no new
    LevelVersion row, just overwrites draft_content in place. Every
    save clears draft_beaten_at, even if the content given is identical
    to what was already there - a previous beat confirmation should
    never be trusted to still apply to content that's just been
    resaved, since there's no cheap way to know whether "identical" is
    actually true rather than just claimed.
    """
    level, error = _get_owned_level(slug)
    if error is not None:
        message, status = error
        return jsonify({"error": message}), status

    payload = request.get_json(silent=True) or {}

    # A level's name is set exactly once, at first publish (see
    # publish_level), and locked from then on - so saving isn't a way to
    # rename anything, not even a never-published draft. Rejected
    # outright, before anything else in the request takes effect, rather
    # than silently ignored, so a client still sending one finds out.
    if "title" in payload:
        return jsonify({"error": "a level's name is set when it's first published"}), 400

    if "content" in payload:
        content = payload["content"]
        is_valid, content_error = validate_level_content(content)
        if not is_valid:
            return jsonify({"error": content_error}), 400

        level.draft_content = content
        level.draft_beaten_at = None

        if level.visibility_state == LevelVisibilityState.PUBLISHED:
            # The already-published version stays live for everyone
            # else exactly as it was - only this level's own lifecycle
            # state demotes, not the LevelVersion row or the pointer to
            # it (see Level.latest_published_version_id's docstring).
            level.visibility_state = LevelVisibilityState.TESTING

    db.session.commit()
    return jsonify(level_to_dict(level)), 200


@levels_bp.post("/<string:slug>/beat")
@jwt_required()
def beat_level(slug):
    """
    Records that a real test-playthrough of the CURRENT draft_content
    just reached the win condition - called by the client the moment
    Play mode detects that, not something the creator explicitly
    triggers themselves. This is the one and only thing that can make
    draft_beaten_at non-null; see save_level for why every save clears
    it straight back out.
    """
    level, error = _get_owned_level(slug)
    if error is not None:
        message, status = error
        return jsonify({"error": message}), status

    if level.draft_content is None:
        return jsonify({"error": "level has no content to beat yet"}), 400

    level.draft_beaten_at = utc_now()
    db.session.commit()

    return jsonify(level_to_dict(level)), 200


@levels_bp.post("/<string:slug>/publish")
@jwt_required()
def publish_level(slug):
    """
    Turns the current, already-beaten draft into a real, permanent,
    immutable LevelVersion - the one point in this whole flow where a
    row actually gets created in level_versions rather than just
    overwriting Level's own mutable fields.

    This is also the one place a level gets its name. The first publish
    requires a "title" (there's no unnamed published level - and since
    names are locked afterward, an unnamed one would stay that way), and
    every later publish must NOT send one: a published level's name
    can't be changed. Reported names being changed by a moderator,
    developer, or the creator on request is a deliberate future
    exception, meant to be its own explicit action rather than a side
    door through here (see README, Phase 4 - Moderation).

    The title is applied in the same transaction as the publish itself,
    and only once every other check has passed, so a publish that fails
    (not beaten yet, invalid content) never sets the name as a side
    effect.
    """
    level, error = _get_owned_level(slug)
    if error is not None:
        message, status = error
        return jsonify({"error": message}), status

    payload = request.get_json(silent=True) or {}
    is_first_publish = level.latest_published_version_id is None

    new_title = None
    if "title" in payload:
        if not is_first_publish:
            return jsonify({"error": "a published level's name can't be changed"}), 409
        new_title = (payload.get("title") or "").strip()
        if not new_title:
            return jsonify({"error": "title cannot be empty"}), 400
        length_error = _title_length_error(new_title)
        if length_error:
            return jsonify({"error": length_error}), 400
    elif is_first_publish:
        return jsonify({"error": "a name is required to publish a level for the first time"}), 400

    if level.draft_beaten_at is None:
        return jsonify({"error": "level must be beaten before it can be published"}), 409

    # Re-validated here too, not just trusted from whenever it was last
    # saved - this endpoint shouldn't assume nothing could have made
    # draft_content invalid between then and now.
    is_valid, content_error = validate_level_content(level.draft_content)
    if not is_valid:
        return jsonify({"error": f"draft content is no longer valid: {content_error}"}), 409

    latest_version = (
        LevelVersion.query.filter_by(level_id=level.id)
        .order_by(LevelVersion.version_number.desc())
        .first()
    )
    next_version_number = (latest_version.version_number + 1) if latest_version else 1

    version = LevelVersion(
        level_id=level.id,
        version_number=next_version_number,
        content=level.draft_content,
        beaten_at=level.draft_beaten_at,
    )
    db.session.add(version)
    # Need version.id actually assigned (via a real INSERT) before it
    # can be pointed at below - flush does that without committing the
    # transaction yet, so the whole publish still succeeds or fails
    # together as one unit.
    db.session.flush()

    level.latest_published_version_id = version.id
    level.visibility_state = LevelVisibilityState.PUBLISHED
    if new_title is not None:
        level.title = new_title

    db.session.commit()

    return jsonify(level_to_dict(level)), 200


@levels_bp.get("/<string:slug>/play")
def get_level_for_play(slug):
    """
    Public, unauthenticated - what /play/[slug] loads. Unlike every
    other endpoint in this file, this deliberately serves the
    PUBLISHED LevelVersion's frozen content, never draft_content - a
    level's draft could be mid-edit, invalid, or simply not what's
    actually live, and nothing here should let a stranger see or play
    an owner's in-progress work. A level with nothing published yet
    (still draft/testing, or a real slug that just doesn't exist) gets
    the same 404 either way - not confirming which case it is, same
    enumeration-safety reasoning as the owner-only endpoints above,
    even though the stakes are lower here since a slug is meant to be
    publicly shareable once something is actually live under it.
    """
    level = Level.query.filter_by(slug=slug).first()
    if level is None or level.latest_published_version_id is None:
        return jsonify({"error": "level not found"}), 404

    version = db.session.get(LevelVersion, level.latest_published_version_id)

    return (
        jsonify(
            {
                "id": level.slug,
                "title": level.title,
                "content": version.content,
            }
        ),
        200,
    )


@levels_bp.get("/by-user/<string:username>")
def list_levels_by_user(username):
    """
    Public, unauthenticated - what a user's public profile page shows:
    only that creator's genuinely PUBLISHED levels, never their drafts
    or in-progress testing work, regardless of who's asking (including
    the creator themselves looking at their own public page - that's a
    deliberately different view from their own /api/levels, which shows
    everything). Keyed off latest_published_version_id being set, same
    reasoning as GET /<slug>/play: a level demoted back to testing by a
    post-publish edit still counts as published here too, since its
    last published version is still live for everyone.

    An unknown username returns an empty list rather than a 404 - a
    username that doesn't exist and a real user with zero published
    levels look identical from here, which is the right behavior for a
    public listing (nothing here needs to distinguish those two cases
    the way an owner-only endpoint would).
    """
    user = User.query.filter_by(username=username).first()
    if user is None or user.is_deleted:
        return jsonify([]), 200

    levels = (
        Level.query.filter_by(owner_id=user.id)
        .filter(Level.latest_published_version_id.isnot(None))
        .order_by(Level.created_at.desc())
        .all()
    )

    return jsonify([level_to_summary_dict(level) for level in levels]), 200