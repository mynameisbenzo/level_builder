"""
Ghost runs: the fastest clear of each published level, replayed as a
translucent character for everyone who plays it afterwards.

FRAME FORMAT (shared with frontend/src/lib/game/ghost.ts - keep in sync):
a run is a list of samples, one every SAMPLE_INTERVAL_MS from the start
of play, each `[x, y, state]` of whole numbers:
  x, y   the player sprite's world position (rounded)
  state  colorIndex * 8 + poseIndex * 2 + facingLeft
         colorIndex: position in PLAYER_COLORS (beige, green, pink, purple, yellow)
         poseIndex:  0 idle, 1 walk, 2 jump, 3 duck
         facingLeft: 1 if the sprite is flipped to face left

WHAT THE CHECKS ARE (AND AREN'T): this server doesn't simulate the
game, so it can't prove a run was really played. It rejects malformed
runs, impossible durations, a start nowhere near the spawn, and any step
between two samples bigger than the physics allows (a teleport). A
determined cheater can still craft a plausible-looking path. Real
verification would need deterministic server-side replay.
"""

from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models.level import Level
from app.models.level_ghost import LevelGhost
from app.models.user import User
from app.services.level_content import WORLD_HEIGHT, WORLD_WIDTH
from app.utils.time import utc_now

SAMPLE_INTERVAL_MS = 50
MIN_DURATION_MS = 200
MAX_DURATION_MS = 10 * 60 * 1000

_PLAYER_COLOR_COUNT = 5
_STATES_PER_COLOR = 8
MAX_STATE = _PLAYER_COLOR_COUNT * _STATES_PER_COLOR - 1

# Per-sample (50ms) movement caps, generous on purpose: the fastest
# horizontal speed is ~612px/s (~31px per sample) and a fall from the top
# of the world reaches ~1800px/s (~90px per sample), so these are roughly
# 3x headroom. A false rejection loses a legitimate record, which is much
# worse than letting through a fast-but-impossible one.
MAX_STEP_X = 100
MAX_STEP_Y = 250
# How far the first sample may be from the level's spawn point.
SPAWN_TOLERANCE_PX = 64
# The recorder takes a sample every 50ms of play plus one final sample at
# the exact moment of the clear, so the count is duration/50 + 1 or +2.
FRAME_COUNT_SLACK = 3

_Y_MIN = -300
_Y_MAX = WORLD_HEIGHT + 300


class GhostError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def _is_whole_number(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def validate_run(content: dict, duration_ms, frames) -> None:
    """Raises GhostError(invalid_ghost) if the run can't be a real clear of this content."""

    def bad(message: str):
        raise GhostError("invalid_ghost", message)

    if not _is_whole_number(duration_ms):
        bad("duration_ms must be a whole number")
    if not MIN_DURATION_MS <= duration_ms <= MAX_DURATION_MS:
        bad(f"duration_ms must be between {MIN_DURATION_MS} and {MAX_DURATION_MS}")

    if not isinstance(frames, list):
        bad("frames must be a list")

    expected = duration_ms // SAMPLE_INTERVAL_MS + 1
    if not expected - FRAME_COUNT_SLACK <= len(frames) <= expected + FRAME_COUNT_SLACK:
        bad("frames don't match the run's duration")

    previous = None
    for sample in frames:
        if not isinstance(sample, list) or len(sample) != 3:
            bad("every frame must be [x, y, state]")
        if not all(_is_whole_number(part) for part in sample):
            bad("frame values must be whole numbers")

        x, y, state = sample
        if not 0 <= x <= WORLD_WIDTH or not _Y_MIN <= y <= _Y_MAX:
            bad("a frame is outside the level")
        if not 0 <= state <= MAX_STATE:
            bad("a frame has an invalid state")

        if previous is not None:
            if abs(x - previous[0]) > MAX_STEP_X or abs(y - previous[1]) > MAX_STEP_Y:
                bad("the run moves faster than the game allows")
        previous = sample

    spawn = (content or {}).get("spawnPosition") or {}
    spawn_x, spawn_y = spawn.get("x"), spawn.get("y")
    if isinstance(spawn_x, (int, float)) and isinstance(spawn_y, (int, float)):
        first_x, first_y = frames[0][0], frames[0][1]
        if abs(first_x - spawn_x) > SPAWN_TOLERANCE_PX or abs(first_y - spawn_y) > SPAWN_TOLERANCE_PX:
            bad("the run doesn't start at the level's spawn point")


def get_ghost(level_id: int) -> LevelGhost | None:
    """
    The ghost for a level, or None. A ghost whose holder has since
    deleted their account is treated as absent - the next clear then
    simply becomes the new ghost.
    """
    ghost = LevelGhost.query.filter_by(level_id=level_id).first()
    if ghost is None or ghost.user.is_deleted:
        return None
    return ghost


def best_times_for_levels(level_ids: list[int]) -> dict[int, int]:
    """
    {level_id: fastest clear in ms} for every level in a list response,
    in one query rather than one per level. A level nobody has cleared
    (or whose ghost holder deleted their account, matching get_ghost)
    simply isn't a key.
    """
    if not level_ids:
        return {}

    rows = (
        db.session.query(LevelGhost.level_id, LevelGhost.duration_ms)
        .join(User, User.id == LevelGhost.user_id)
        .filter(LevelGhost.level_id.in_(level_ids))
        .filter(User.is_deleted.is_(False))
        .all()
    )
    return {level_id: duration_ms for level_id, duration_ms in rows}


def ghost_to_dict(ghost: LevelGhost) -> dict:
    return {
        "username": ghost.user.username,
        "duration_ms": ghost.duration_ms,
        "sample_interval_ms": SAMPLE_INTERVAL_MS,
        "frames": ghost.frames,
    }


def record_summary(ghost: LevelGhost) -> dict:
    """Just who holds the record and how fast - no frames."""
    return {"username": ghost.user.username, "duration_ms": ghost.duration_ms}


def submit_run(user: User, level: Level, duration_ms, frames) -> tuple[bool, LevelGhost]:
    """
    Offers a clear to be the level's ghost. Returns (is_record, ghost):
    `ghost` is whichever ghost stands afterwards (the new one if it was a
    record, otherwise the existing, faster-or-equal one). A tie keeps the
    existing ghost - the record only changes hands for a strictly faster time.
    """
    validate_run(level.draft_content, duration_ms, frames)

    for _attempt in range(2):
        existing = (
            LevelGhost.query.filter_by(level_id=level.id).with_for_update().first()
        )

        if existing is not None and not existing.user.is_deleted and existing.duration_ms <= duration_ms:
            return False, existing

        if existing is None:
            ghost = LevelGhost(
                level_id=level.id,
                user_id=user.id,
                duration_ms=duration_ms,
                frames=frames,
            )
            db.session.add(ghost)
        else:
            ghost = existing
            ghost.user_id = user.id
            ghost.duration_ms = duration_ms
            ghost.frames = frames
            ghost.set_at = utc_now()

        try:
            db.session.commit()
        except IntegrityError:
            # Two first-ever clears raced to insert; the loser re-reads
            # and competes against the winner's row.
            db.session.rollback()
            continue
        return True, ghost

    existing = LevelGhost.query.filter_by(level_id=level.id).first()
    return False, existing