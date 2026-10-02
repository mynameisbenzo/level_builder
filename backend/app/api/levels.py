from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models.level import Level, LevelVersion, LevelVisibilityState
from app.models.level_rating import LevelRating
from app.models.user import User
from app.schemas.level import level_to_dict, level_to_summary_dict
from app.services.level_content import default_level_content, validate_level_content
from app.services.thumbnails import ThumbnailError, upload_level_thumbnail
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


# Modeled on Mario Maker's course limit, split into two separate
# budgets rather than one pool (see README, "Level limits per user"):
#
# - MAX_DRAFT_LEVELS caps never-published, in-progress work. Cheap to
#   create and abandon, so it's kept tight - this is "how many
#   works-in-progress can you juggle at once," not a lifetime count.
#   Publishing a draft moves it out of this bucket entirely (see
#   MAX_PUBLISHED_TOTAL below), freeing the slot for a new one.
#
# - MAX_PUBLISHED_TOTAL caps what's actually been shipped: every level
#   that's ever been published, PLUS every LevelVersion row across
#   those levels, counted additively (a level published once
#   contributes 1 for itself + 1 for its one version = 2; republished
#   three times total, 1 + 3 = 4). Counting versions is what actually
#   makes this a cap - editing a published level and republishing it
#   creates a new version rather than overwriting the old one (by
#   design - see the versioning/difficulty-label work in the README),
#   so without counting versions too, "publish, tweak, republish"
#   would be an unlimited supply of effectively new levels through one
#   never-refilled slot.
MAX_DRAFT_LEVELS = 5
MAX_PUBLISHED_TOTAL = 100


def _verification_gate(user: User) -> tuple[str, int] | None:
    """
    Level actions (create/list/get/save/beat/publish - everything below
    that calls this) require the caller to be either email-verified or
    Twitch-linked; a user with neither is treated as if they had no
    account at all for these specifically. Twitch-linked users get full
    access regardless of email_verified_at, even if they also have an
    unverified email on the account.

    Deliberately NOT applied to:
    - Account actions (PATCH/DELETE /api/users/<id>) - an unverified
      user can still edit or delete their own account.
    - The public endpoints below (get_level_for_play,
      list_levels_by_user) - a level that's already published stays
      visible to everyone regardless of the creator's current
      verification status, since that status isn't permanent (e.g. an
      email change clears email_verified_at until reconfirmed) and
      shouldn't retroactively hide content that's already live.

    Returns None if the caller may proceed, or (message, status) to
    return as-is if not.
    """
    if user.email_verified_at is not None or user.twitch_id is not None:
        return None
    return (
        "verify your email (or link a Twitch account) before you can create, edit, or publish levels",
        403,
    )


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


def _rating_counts_for(level_ids: list[int]) -> dict[int, tuple[int, int]]:
    """
    One batched GROUP BY for every level in a list response, rather
    than a per-level query - see level_to_summary_dict's rating_counts
    param for why. Returns {level_id: (like_count, dislike_count)};
    a level_id with no rows at all (nobody has rated it yet) simply
    isn't a key, and level_to_summary_dict's own (0, 0) default covers
    that.
    """
    if not level_ids:
        return {}

    rows = (
        db.session.query(LevelRating.level_id, LevelRating.is_like, func.count(LevelRating.id))
        .filter(LevelRating.level_id.in_(level_ids))
        .group_by(LevelRating.level_id, LevelRating.is_like)
        .all()
    )

    counts: dict[int, tuple[int, int]] = {}
    for level_id, is_like, count in rows:
        likes, dislikes = counts.get(level_id, (0, 0))
        if is_like:
            likes = count
        else:
            dislikes = count
        counts[level_id] = (likes, dislikes)
    return counts


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

    gate_error = _verification_gate(user)
    if gate_error is not None:
        message, status = gate_error
        return jsonify({"error": message}), status

    draft_count = (
        Level.query.filter_by(owner_id=user.id).filter(Level.latest_published_version_id.is_(None)).count()
    )
    if draft_count >= MAX_DRAFT_LEVELS:
        return (
            jsonify(
                {
                    "error": (
                        f"you already have {MAX_DRAFT_LEVELS} unpublished drafts - "
                        "publish one or delete one before starting another"
                    )
                }
            ),
            409,
        )

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

    gate_error = _verification_gate(user)
    if gate_error is not None:
        message, status = gate_error
        return jsonify({"error": message}), status

    levels = Level.query.filter_by(owner_id=user.id).order_by(Level.created_at.desc()).all()
    rating_counts = _rating_counts_for([level.id for level in levels])

    return jsonify([level_to_summary_dict(level, rating_counts) for level in levels]), 200


@levels_bp.get("/<string:slug>")
@jwt_required()
def get_level(slug):
    """Fetches a level's current state, including its draft content -
    how the editor resumes a level the creator already started."""
    level, error = _get_owned_level(slug)
    if error is not None:
        message, status = error
        return jsonify({"error": message}), status

    gate_error = _verification_gate(level.owner)
    if gate_error is not None:
        message, status = gate_error
        return jsonify({"error": message}), status

    return jsonify(level_to_dict(level)), 200


@levels_bp.patch("/<string:slug>")
@jwt_required()
def save_level(slug):
    """
    Saves the editor's current in-progress content. Cheap and
    unconditional compared to publishing - no beat requirement, no new
    LevelVersion row, just overwrites draft_content in place.

    A save whose content is exactly equal to what's already stored is
    treated as a no-op: draft_beaten_at and visibility_state are left
    untouched. This is what makes "save the draft, then publish" safe
    (see /edit/[slug]'s Publish flow, which now always saves first to
    pick up any live edits made since the last explicit Save) - without
    this exception, that save-before-publish step would itself clear
    the very beat confirmation the publish is about to check, even when
    nothing had actually changed. Genuinely different content still
    clears the beat exactly as before - a previous beat confirmation
    must never be trusted to still apply to content that's actually
    changed, and the comparison below is a direct equality check against
    what the server itself has stored, not something trusted from the
    client's own claim.
    """
    level, error = _get_owned_level(slug)
    if error is not None:
        message, status = error
        return jsonify({"error": message}), status

    gate_error = _verification_gate(level.owner)
    if gate_error is not None:
        message, status = gate_error
        return jsonify({"error": message}), status

    payload = request.get_json(silent=True) or {}

    # A level's name is set exactly once, at first publish (see
    # publish_level), and locked from then on - so saving isn't a way to
    # rename anything, not even a never-published draft. Rejected
    # outright, before anything else in the request takes effect, rather
    # than silently ignored, so a client still sending one finds out.
    if "title" in payload:
        return jsonify({"error": "a level's name is set when it's first published"}), 400

    if level.is_deleted:
        return jsonify({"error": "this level has been deleted and can no longer be edited"}), 409

    if "content" in payload:
        content = payload["content"]
        is_valid, content_error = validate_level_content(content)
        if not is_valid:
            return jsonify({"error": content_error}), 400

        if content != level.draft_content:
            level.draft_content = content
            level.draft_beaten_at = None

            if level.visibility_state == LevelVisibilityState.PUBLISHED:
                # The already-published version stays live for everyone
                # else exactly as it was - only this level's own
                # lifecycle state demotes, not the LevelVersion row or
                # the pointer to it (see
                # Level.latest_published_version_id's docstring).
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

    gate_error = _verification_gate(level.owner)
    if gate_error is not None:
        message, status = gate_error
        return jsonify({"error": message}), status

    if level.is_deleted:
        return jsonify({"error": "this level has been deleted and can no longer be played or edited"}), 409

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

    gate_error = _verification_gate(level.owner)
    if gate_error is not None:
        message, status = gate_error
        return jsonify({"error": message}), status

    if level.is_deleted:
        return jsonify({"error": "this level has been deleted and can no longer be published"}), 409

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

    # A publish whose content is identical to what's already live plays
    # out no differently from the version already published - rejected
    # unconditionally, not just near the cap, since a redundant
    # identical version is never worth keeping as permanent history.
    # Only meaningful on a republish; a first publish has nothing yet
    # to compare against.
    if not is_first_publish and level.latest_published_version is not None:
        if level.draft_content == level.latest_published_version.content:
            return (
                jsonify({"error": "this content is identical to what's already published - nothing to publish"}),
                409,
            )

    # The cap: this level's own contribution (1, whether it's newly
    # published by this call or already was) plus every LevelVersion
    # row the user owns across all their levels, plus the one this
    # publish is about to create.
    already_published_levels = (
        Level.query.filter_by(owner_id=level.owner_id)
        .filter(Level.latest_published_version_id.isnot(None))
        .count()
    )
    levels_after_this_publish = already_published_levels if not is_first_publish else already_published_levels + 1
    existing_version_count = (
        db.session.query(LevelVersion)
        .join(Level, LevelVersion.level_id == Level.id)
        .filter(Level.owner_id == level.owner_id)
        .count()
    )
    projected_total = levels_after_this_publish + existing_version_count + 1
    if projected_total > MAX_PUBLISHED_TOTAL:
        return (
            jsonify(
                {
                    "error": (
                        f"you've reached the {MAX_PUBLISHED_TOTAL}-level publish limit "
                        "(published levels plus all their versions)"
                    )
                }
            ),
            409,
        )

    latest_version = (
        LevelVersion.query.filter_by(level_id=level.id)
        .order_by(LevelVersion.version_number.desc())
        .first()
    )
    next_version_number = (latest_version.version_number + 1) if latest_version else 1

    # Best-effort, client-captured screenshot of this version's initial
    # state in play mode (see captureLevelThumbnail.ts on the
    # frontend) - a `data:image/png;base64,...` string, same shape
    # canvas.toDataURL()/Phaser's renderer.snapshot() always produce.
    # Deliberately never lets a bad/missing thumbnail, or storage not
    # being configured at all, block an otherwise-valid publish - a
    # level without one just has nothing to show yet, same as before
    # this feature existed.
    thumbnail_url = None
    thumbnail_data_url = payload.get("thumbnail")
    if thumbnail_data_url:
        try:
            thumbnail_url = upload_level_thumbnail(
                thumbnail_data_url, level_id=level.id, version_number=next_version_number
            )
        except ThumbnailError as exc:
            current_app.logger.warning("level thumbnail upload failed for level %s: %s", level.id, exc)

    version = LevelVersion(
        level_id=level.id,
        version_number=next_version_number,
        content=level.draft_content,
        beaten_at=level.draft_beaten_at,
        thumbnail_url=thumbnail_url,
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
    # Only overwritten when this publish actually produced a new one -
    # a failed upload on a republish must never erase an existing,
    # still-valid thumbnail from an earlier version (see Level.
    # thumbnail_url's own docstring).
    if thumbnail_url is not None:
        level.thumbnail_url = thumbnail_url

    db.session.commit()

    return jsonify(level_to_dict(level)), 200


@levels_bp.delete("/<string:slug>")
@jwt_required()
def delete_level(slug):
    """
    One action that means two different things depending on the
    level's state, rather than two separate endpoints - from the
    owner's point of view it's the same intent ("I'm done with this")
    either way:

    - Never published (still just a draft): hard-deleted outright. The
      row and its history (there is none - nothing publishes without
      going through LevelVersion, which a draft never has) are gone for
      good. This is what actually frees a MAX_DRAFT_LEVELS slot.

    - Already published at least once: soft-deleted instead - is_deleted
      is set, visibility_state moves to UNPUBLISHED, and the row plus
      every LevelVersion snapshot stay in the database untouched. This
      is deliberately NOT the same as save_level's demotion-to-TESTING
      on an edit (that's a normal, reversible mid-progress state); this
      is the owner saying they're done with it, permanently - there is
      no restore action. It still counts toward MAX_PUBLISHED_TOTAL
      forever: deleting a level doesn't refund its one-time contribution
      to that lifetime cap, any more than never having played a game you
      bought refunds its price.

    Idempotency: deleting an already-soft-deleted level is rejected
    (409) rather than silently succeeding again - there's nothing left
    to do, and a client relying on this as a signal that its delete
    action actually did something shouldn't get a false one.
    """
    level, error = _get_owned_level(slug)
    if error is not None:
        message, status = error
        return jsonify({"error": message}), status

    if level.is_deleted:
        return jsonify({"error": "this level has already been deleted"}), 409

    if level.latest_published_version_id is None:
        db.session.delete(level)
        db.session.commit()
        return "", 204

    level.is_deleted = True
    level.visibility_state = LevelVisibilityState.UNPUBLISHED
    db.session.commit()

    return "", 204


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
    if level is None or level.latest_published_version_id is None or level.is_deleted:
        return jsonify({"error": "level not found"}), 404

    version = db.session.get(LevelVersion, level.latest_published_version_id)

    return (
        jsonify(
            {
                "id": level.slug,
                "title": level.title,
                "content": version.content,
                # The result modal's "Leave" action (see
                # /play/[slug]/+page.svelte) routes back to the owner's
                # public profile - it needs this to build that link, and
                # has no other way to learn who owns a level it's only
                # ever seen a slug for.
                "owner_username": level.owner.username,
            }
        ),
        200,
    )


def _is_requester_the_owner(level) -> bool:
    """
    True only when the request carries a valid access token belonging
    to this level's own owner - used by record_level_play/
    record_level_complete to keep a creator play-testing their own
    published level from inflating its own play/completion counts.
    Both callers use @jwt_required(optional=True), so get_jwt_identity()
    is simply None for an anonymous request (no token, or a bad/expired
    one) rather than raising - which is exactly the common case here,
    since most plays are anonymous.
    """
    identity = get_jwt_identity()
    if identity is None:
        return False

    user = User.query.filter_by(public_id=identity).first()
    return user is not None and user.id == level.owner_id


@levels_bp.post("/<string:slug>/play")
@jwt_required(optional=True)
def record_level_play(slug):
    """
    Same lookup rules as get_level_for_play (only a live, non-deleted,
    published level can record anything, and an unknown/unpublished/
    deleted slug gets the same 404 either way). Called by /play/[slug]
    once its initial load succeeds, and again on every "Play Again" -
    each is a genuine, separate attempt at the level, not just a page
    view. Deliberately a distinct request from GET .../play (which only
    ever serves content) rather than folded into it, so a client can
    re-record a play on replay without needing to re-fetch content it
    already has.

    Optionally authenticated (unlike every @jwt_required() endpoint
    above, a missing/invalid token here isn't rejected - most plays are
    anonymous) purely so a logged-in creator play-testing their own
    published level from /u/[username] doesn't inflate their own play
    count every time - see _is_requester_the_owner. Anyone else,
    anonymous or logged in, still counts, and there's still no
    per-viewer dedup for them: a play count is meant to reflect how
    many times a level has actually been attempted, including the same
    non-owner replaying it repeatedly, not a distinct-people tally.
    """
    level = Level.query.filter_by(slug=slug).first()
    if level is None or level.latest_published_version_id is None or level.is_deleted:
        return jsonify({"error": "level not found"}), 404

    if not _is_requester_the_owner(level):
        level.play_count += 1
        db.session.commit()

    return jsonify({"play_count": level.play_count}), 200


@levels_bp.post("/<string:slug>/complete")
@jwt_required(optional=True)
def record_level_complete(slug):
    """
    Same lookup rules as record_level_play, including the same
    optional-auth owner exclusion (see _is_requester_the_owner) - a
    creator beating their own published level from /u/[username]
    shouldn't inflate their own completion count any more than their
    own play count. Called the moment LEVEL_BEATEN_EVENT fires during a
    real public playthrough (/play/[slug]) - never from the editor's
    own test-play loop, which reaches its own win condition through
    PlatformerScene but reports it via POST .../beat instead, against
    draft_content, not a published version. A completion here always
    implies at least one play was already recorded for the same
    attempt (record_level_play fires on load, before the player can
    possibly reach the win condition), but this endpoint doesn't
    re-derive or enforce that ordering itself - the two counters are
    independent increments, not a state machine, so a request that
    arrives out of order (or is retried) never leaves either counter
    looking corrupted.
    """
    level = Level.query.filter_by(slug=slug).first()
    if level is None or level.latest_published_version_id is None or level.is_deleted:
        return jsonify({"error": "level not found"}), 404

    if not _is_requester_the_owner(level):
        level.completion_count += 1
        db.session.commit()

    return jsonify({"completion_count": level.completion_count}), 200


@levels_bp.post("/<string:slug>/rate")
@jwt_required()
def rate_level(slug):
    """
    Records a thumbs-up or thumbs-down from the authenticated caller -
    shown from the result modal after a public playthrough ends (win or
    death), never from the editor's own test-play flow. Same lookup
    rules as get_level_for_play: only a level that's actually live and
    not deleted can be rated, and an unknown/unpublished/deleted slug
    gets the same 404 either way.

    Idempotent AND switchable per (level, user): rating the same level
    again - even with the opposite value - updates this one row rather
    than creating a second one or erroring, so the frontend never has
    to track whether this is someone's first rating or a changed mind
    before sending it. A no-op re-send of the same value is likewise
    harmless.
    """
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload.get("is_like"), bool):
        return jsonify({"error": "is_like (true or false) is required"}), 400
    is_like = payload["is_like"]

    level = Level.query.filter_by(slug=slug).first()
    if level is None or level.latest_published_version_id is None or level.is_deleted:
        return jsonify({"error": "level not found"}), 404

    user = User.query.filter_by(public_id=get_jwt_identity()).first()
    if user is None or user.is_deleted:
        return jsonify({"error": "account not found"}), 404

    rating = LevelRating.query.filter_by(level_id=level.id, user_id=user.id).first()
    if rating is None:
        rating = LevelRating(level_id=level.id, user_id=user.id, is_like=is_like)
        db.session.add(rating)
    else:
        rating.is_like = is_like

    try:
        db.session.commit()
    except IntegrityError:
        # Same race as create_user_row/update_user - two concurrent
        # first-time ratings from the same person landing at once. The
        # unique constraint is what actually prevents the duplicate
        # row; this just keeps that race from surfacing as a 500. The
        # loser of the race simply doesn't get its value recorded here
        # - a negligible loss for a rating, not worth a full retry.
        db.session.rollback()

    return jsonify({"is_like": is_like}), 200


@levels_bp.get("/<string:slug>/rating")
@jwt_required()
def get_own_rating(slug):
    """
    Returns the authenticated caller's own existing rating for this
    level, if any - what the result modal reads on open so a returning
    rater sees their previous like/dislike already highlighted instead
    of both buttons looking unset. Same lookup rules as rate_level: an
    unknown/unpublished/deleted slug gets a 404, not a hint about which
    case it is. `is_like: null` (never a 404) means the level itself is
    fine but this caller simply hasn't rated it yet - the modal treats
    that exactly like "no selection yet", not an error.
    """
    level = Level.query.filter_by(slug=slug).first()
    if level is None or level.latest_published_version_id is None or level.is_deleted:
        return jsonify({"error": "level not found"}), 404

    user = User.query.filter_by(public_id=get_jwt_identity()).first()
    if user is None or user.is_deleted:
        return jsonify({"error": "account not found"}), 404

    rating = LevelRating.query.filter_by(level_id=level.id, user_id=user.id).first()

    return jsonify({"is_like": rating.is_like if rating else None}), 200


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
        .filter(Level.is_deleted.is_(False))
        .order_by(Level.created_at.desc())
        .all()
    )
    rating_counts = _rating_counts_for([level.id for level in levels])

    return jsonify([level_to_summary_dict(level, rating_counts) for level in levels]), 200