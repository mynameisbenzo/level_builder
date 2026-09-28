"""
Validates a level's content payload against the same rules the editor
itself is built around - the editor already stops a well-behaved client
from producing anything invalid, but this endpoint has to independently
re-check everything anyway, since nothing here can trust that a request
actually came from the real editor UI rather than a direct API call.

The constants below mirror frontend/src/lib/game/camera.ts,
gridSnap.ts, groundTiling.ts, playerColor.ts, and keys.ts - there is no
shared source of truth across the Python/TypeScript boundary in this
project, so these have to be kept in sync by hand. If the frontend's
world size, grid size, or any enum of valid styles/colors ever changes,
these need to change too, or validation here will silently drift out of
step with what the editor actually allows someone to build.
"""

GRID_SIZE = 32
VIEWPORT_WIDTH = 800
VIEWPORT_HEIGHT = 600
WORLD_COLUMNS = 30
WORLD_ROWS = 3
WORLD_WIDTH = VIEWPORT_WIDTH * WORLD_COLUMNS
WORLD_HEIGHT = VIEWPORT_HEIGHT * WORLD_ROWS

GROUND_TILE_STYLES = {"grass", "dirt", "sand", "snow", "stone", "purple"}
PLAYER_COLORS = {"beige", "green", "pink", "purple", "yellow"}
KEY_COLORS = {"blue", "green", "red", "yellow"}
CAMERA_MODES = {"follow", "quadrant"}

# Ground tiles get a much larger budget than everything else below
# because they're the one object type placeable via click-and-drag
# (paints one tile per grid cell crossed) rather than a single click
# per object - a single full-width drag across the level can already
# place several hundred tiles in one gesture, so this needs real
# headroom above that baseline or it would feel like an arbitrary wall
# hit mid-drag rather than a considered budget.
MAX_GROUND_TILES = 4000
MAX_CHARACTER_SWAP_OBJECTS = 40
MAX_DOORS = 4
MAX_KEYS = 16


def default_level_content() -> dict:
    """
    What a brand-new level's draft_content starts as - mirrors the
    editor's own defaults (playerState.ts's DEFAULT_PLAYER_POSITION,
    camera.ts's DEFAULT_CAMERA_MODE, playerColor.ts's
    DEFAULT_PLAYER_COLOR) so a freshly created level is immediately in
    a valid, already-saveable state rather than starting as null and
    needing special-casing anywhere that expects real content.
    A fresh dict every call - callers mutate this freely (e.g. setting
    it as a new Level's draft_content), so a single shared instance
    would let one level's edits leak into another's default.
    """
    return {
        "spawnPosition": {"x": 400, "y": 1648},
        "cameraMode": "follow",
        "playerStartingColor": "green",
        "placedObjects": [],
        "characterSwapObjects": [],
        "doorObjects": [],
        "keyObjects": [],
    }


def _validate_xy(value, label: str) -> str | None:
    """Shared by spawnPosition and every placed object - must be a
    {x, y} pair of grid-aligned numbers within the fixed world bounds.

    "Grid-aligned" here means the editor's own convention specifically
    - frontend/src/lib/game/gridSnap.ts's snapToGrid() snaps to the
    CENTER of a grid cell, not its corner (deliberately: "a
    gridSize-sized object dropped anywhere within a cell ends up
    centered in that cell, rather than straddling a corner between
    four cells"). So a valid value is never a bare multiple of
    GRID_SIZE - it's GRID_SIZE/2 plus a multiple of GRID_SIZE (16, 48,
    80, ... for GRID_SIZE=32), and this check has to match that or it
    rejects every genuinely valid position the editor could ever
    produce."""
    if not isinstance(value, dict):
        return f"{label} must be an object with x and y"

    x, y = value.get("x"), value.get("y")
    if not isinstance(x, (int, float)) or isinstance(x, bool):
        return f"{label}.x must be a number"
    if not isinstance(y, (int, float)) or isinstance(y, bool):
        return f"{label}.y must be a number"

    half_cell = GRID_SIZE / 2
    if (x - half_cell) % GRID_SIZE != 0 or (y - half_cell) % GRID_SIZE != 0:
        return f"{label} must be aligned to the center of the {GRID_SIZE}px grid"

    if not (0 <= x < WORLD_WIDTH):
        return f"{label}.x is outside the level's world bounds"
    if not (0 <= y < WORLD_HEIGHT):
        return f"{label}.y is outside the level's world bounds"

    return None


def _validate_placed_objects(value) -> str | None:
    if not isinstance(value, list):
        return "placedObjects must be a list"
    if len(value) > MAX_GROUND_TILES:
        return f"placedObjects exceeds the maximum of {MAX_GROUND_TILES} ground tiles"

    for i, obj in enumerate(value):
        if not isinstance(obj, dict):
            return f"placedObjects[{i}] must be an object"
        if obj.get("type") != "ground":
            return f"placedObjects[{i}].type must be \"ground\""

        error = _validate_xy(obj, f"placedObjects[{i}]")
        if error:
            return error

        if obj.get("style") not in GROUND_TILE_STYLES:
            return f"placedObjects[{i}].style must be one of: {', '.join(sorted(GROUND_TILE_STYLES))}"
        if not isinstance(obj.get("groupId"), str) or not obj.get("groupId"):
            return f"placedObjects[{i}].groupId must be a non-empty string"

    return None


def _validate_character_swap_objects(value) -> str | None:
    if not isinstance(value, list):
        return "characterSwapObjects must be a list"
    if len(value) > MAX_CHARACTER_SWAP_OBJECTS:
        return f"characterSwapObjects exceeds the maximum of {MAX_CHARACTER_SWAP_OBJECTS}"

    for i, obj in enumerate(value):
        if not isinstance(obj, dict):
            return f"characterSwapObjects[{i}] must be an object"

        error = _validate_xy(obj, f"characterSwapObjects[{i}]")
        if error:
            return error

        if obj.get("color") not in PLAYER_COLORS:
            return f"characterSwapObjects[{i}].color must be one of: {', '.join(sorted(PLAYER_COLORS))}"

    return None


def _validate_door_objects(value) -> str | None:
    if not isinstance(value, list):
        return "doorObjects must be a list"
    if len(value) > MAX_DOORS:
        return f"doorObjects exceeds the maximum of {MAX_DOORS}"

    for i, obj in enumerate(value):
        if not isinstance(obj, dict):
            return f"doorObjects[{i}] must be an object"

        error = _validate_xy(obj, f"doorObjects[{i}]")
        if error:
            return error

        requires_key = obj.get("requiresKey")
        if not isinstance(requires_key, bool):
            return f"doorObjects[{i}].requiresKey must be a boolean"

        required_color = obj.get("requiredKeyColor")
        if requires_key:
            if required_color not in KEY_COLORS:
                return (
                    f"doorObjects[{i}].requiredKeyColor must be one of: "
                    f"{', '.join(sorted(KEY_COLORS))} (door requires a key)"
                )
        elif required_color is not None:
            return f"doorObjects[{i}].requiredKeyColor must be null (door does not require a key)"

    return None


def _validate_key_objects(value) -> str | None:
    if not isinstance(value, list):
        return "keyObjects must be a list"
    if len(value) > MAX_KEYS:
        return f"keyObjects exceeds the maximum of {MAX_KEYS}"

    for i, obj in enumerate(value):
        if not isinstance(obj, dict):
            return f"keyObjects[{i}] must be an object"

        error = _validate_xy(obj, f"keyObjects[{i}]")
        if error:
            return error

        if obj.get("color") not in KEY_COLORS:
            return f"keyObjects[{i}].color must be one of: {', '.join(sorted(KEY_COLORS))}"

    return None


def validate_level_content(content) -> tuple[bool, str | None]:
    """
    Validates a full level content payload. Returns (True, None) if
    valid, or (False, message) naming the first problem found - not an
    exhaustive list of every issue, just enough for a clear error.
    """
    if not isinstance(content, dict):
        return False, "level content must be an object"

    error = _validate_xy(content.get("spawnPosition"), "spawnPosition")
    if error:
        return False, error

    if content.get("cameraMode") not in CAMERA_MODES:
        return False, f"cameraMode must be one of: {', '.join(sorted(CAMERA_MODES))}"

    if content.get("playerStartingColor") not in PLAYER_COLORS:
        return False, f"playerStartingColor must be one of: {', '.join(sorted(PLAYER_COLORS))}"

    for validator, key in (
        (_validate_placed_objects, "placedObjects"),
        (_validate_character_swap_objects, "characterSwapObjects"),
        (_validate_door_objects, "doorObjects"),
        (_validate_key_objects, "keyObjects"),
    ):
        error = validator(content.get(key))
        if error:
            return False, error

    return True, None