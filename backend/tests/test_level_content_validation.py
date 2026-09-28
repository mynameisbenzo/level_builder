from app.services.level_content import (
    GRID_SIZE,
    MAX_CHARACTER_SWAP_OBJECTS,
    MAX_DOORS,
    MAX_GROUND_TILES,
    MAX_KEYS,
    WORLD_HEIGHT,
    WORLD_WIDTH,
    validate_level_content,
)

# The editor's snapToGrid() snaps to the CENTER of a grid cell, not its
# corner (frontend/src/lib/game/gridSnap.ts, deliberately - "a
# gridSize-sized object dropped anywhere within a cell ends up centered
# in that cell"). So a genuinely valid position is never a bare
# multiple of GRID_SIZE - it's this offset (half a cell) plus a
# multiple of GRID_SIZE. Every fixture below uses this, not 0/GRID_SIZE
# directly, so these tests actually exercise real, editor-producible
# positions rather than ones the editor could never generate.
CELL_CENTER_OFFSET = GRID_SIZE // 2


def _cell_center(index: int) -> int:
    """The center x/y of the given grid cell index (0, 1, 2, ...)."""
    return index * GRID_SIZE + CELL_CENTER_OFFSET


def _minimal_valid_content(**overrides) -> dict:
    """A genuinely valid, minimal payload - every test starts from this
    and overrides just the one thing it's actually testing, so a test
    failure means that one field, not some unrelated part of the
    fixture being wrong."""
    content = {
        "spawnPosition": {"x": _cell_center(2), "y": _cell_center(2)},
        "cameraMode": "follow",
        "playerStartingColor": "green",
        "placedObjects": [],
        "characterSwapObjects": [],
        "doorObjects": [],
        "keyObjects": [],
    }
    content.update(overrides)
    return content


def test_minimal_valid_content_passes():
    is_valid, error = validate_level_content(_minimal_valid_content())
    assert is_valid is True
    assert error is None


def test_content_must_be_an_object():
    is_valid, error = validate_level_content(["not", "an", "object"])
    assert is_valid is False
    assert "object" in error


def test_missing_spawn_position_is_rejected():
    content = _minimal_valid_content()
    del content["spawnPosition"]
    is_valid, error = validate_level_content(content)
    assert is_valid is False
    assert "spawnPosition" in error


def test_spawn_position_off_grid_is_rejected():
    # A bare multiple of GRID_SIZE (a cell CORNER) is exactly what the
    # editor never produces - this is the real regression case.
    is_valid, error = validate_level_content(
        _minimal_valid_content(spawnPosition={"x": GRID_SIZE, "y": _cell_center(2)})
    )
    assert is_valid is False
    assert "grid" in error


def test_spawn_position_out_of_bounds_is_rejected():
    one_cell_beyond_last = WORLD_WIDTH // GRID_SIZE
    is_valid, error = validate_level_content(
        _minimal_valid_content(spawnPosition={"x": _cell_center(one_cell_beyond_last), "y": _cell_center(2)})
    )
    assert is_valid is False
    assert "bounds" in error


def test_spawn_position_negative_is_rejected():
    is_valid, error = validate_level_content(
        _minimal_valid_content(spawnPosition={"x": _cell_center(-1), "y": _cell_center(2)})
    )
    assert is_valid is False
    assert "bounds" in error


def test_invalid_camera_mode_is_rejected():
    is_valid, error = validate_level_content(_minimal_valid_content(cameraMode="orbit"))
    assert is_valid is False
    assert "cameraMode" in error


def test_invalid_player_starting_color_is_rejected():
    is_valid, error = validate_level_content(_minimal_valid_content(playerStartingColor="rainbow"))
    assert is_valid is False
    assert "playerStartingColor" in error


# --- placedObjects (ground tiles) ---


def test_placed_objects_must_be_a_list():
    is_valid, error = validate_level_content(_minimal_valid_content(placedObjects="not a list"))
    assert is_valid is False
    assert "placedObjects" in error


def test_placed_objects_at_exactly_the_budget_passes():
    tiles = [
        {
            "type": "ground",
            "x": _cell_center(i % 100),
            "y": _cell_center(i // 100),
            "style": "grass",
            "groupId": "g",
        }
        for i in range(MAX_GROUND_TILES)
    ]
    is_valid, error = validate_level_content(_minimal_valid_content(placedObjects=tiles))
    assert is_valid is True
    assert error is None


def test_placed_objects_one_over_the_budget_is_rejected():
    tiles = [
        {
            "type": "ground",
            "x": _cell_center(i % 100),
            "y": _cell_center(i // 100),
            "style": "grass",
            "groupId": "g",
        }
        for i in range(MAX_GROUND_TILES + 1)
    ]
    is_valid, error = validate_level_content(_minimal_valid_content(placedObjects=tiles))
    assert is_valid is False
    assert "4000" in error


def test_placed_object_with_invalid_style_is_rejected():
    tile = {"type": "ground", "x": _cell_center(0), "y": _cell_center(0), "style": "lava", "groupId": "g"}
    is_valid, error = validate_level_content(_minimal_valid_content(placedObjects=[tile]))
    assert is_valid is False
    assert "style" in error


def test_placed_object_with_empty_group_id_is_rejected():
    tile = {"type": "ground", "x": _cell_center(0), "y": _cell_center(0), "style": "grass", "groupId": ""}
    is_valid, error = validate_level_content(_minimal_valid_content(placedObjects=[tile]))
    assert is_valid is False
    assert "groupId" in error


def test_placed_object_with_wrong_type_field_is_rejected():
    tile = {"type": "water", "x": _cell_center(0), "y": _cell_center(0), "style": "grass", "groupId": "g"}
    is_valid, error = validate_level_content(_minimal_valid_content(placedObjects=[tile]))
    assert is_valid is False
    assert "type" in error


# --- characterSwapObjects ---


def test_character_swap_objects_at_exactly_the_budget_passes():
    objects = [
        {"x": _cell_center(i % 100), "y": _cell_center(0), "color": "green"}
        for i in range(MAX_CHARACTER_SWAP_OBJECTS)
    ]
    is_valid, error = validate_level_content(_minimal_valid_content(characterSwapObjects=objects))
    assert is_valid is True


def test_character_swap_objects_one_over_the_budget_is_rejected():
    objects = [
        {"x": _cell_center(i % 100), "y": _cell_center(0), "color": "green"}
        for i in range(MAX_CHARACTER_SWAP_OBJECTS + 1)
    ]
    is_valid, error = validate_level_content(_minimal_valid_content(characterSwapObjects=objects))
    assert is_valid is False
    assert str(MAX_CHARACTER_SWAP_OBJECTS) in error


def test_character_swap_object_with_invalid_color_is_rejected():
    obj = {"x": _cell_center(0), "y": _cell_center(0), "color": "invisible"}
    is_valid, error = validate_level_content(_minimal_valid_content(characterSwapObjects=[obj]))
    assert is_valid is False
    assert "color" in error


# --- doorObjects ---


def test_doors_at_exactly_the_budget_passes():
    doors = [
        {"x": _cell_center(i), "y": _cell_center(0), "requiresKey": False, "requiredKeyColor": None}
        for i in range(MAX_DOORS)
    ]
    is_valid, error = validate_level_content(_minimal_valid_content(doorObjects=doors))
    assert is_valid is True


def test_doors_one_over_the_budget_is_rejected():
    doors = [
        {"x": _cell_center(i), "y": _cell_center(0), "requiresKey": False, "requiredKeyColor": None}
        for i in range(MAX_DOORS + 1)
    ]
    is_valid, error = validate_level_content(_minimal_valid_content(doorObjects=doors))
    assert is_valid is False
    assert str(MAX_DOORS) in error


def test_key_required_door_with_valid_color_passes():
    door = {"x": _cell_center(0), "y": _cell_center(0), "requiresKey": True, "requiredKeyColor": "yellow"}
    is_valid, error = validate_level_content(_minimal_valid_content(doorObjects=[door]))
    assert is_valid is True


def test_key_required_door_with_null_color_is_rejected():
    """A key-required door has to actually name a color - null would
    mean it can never be opened at all."""
    door = {"x": _cell_center(0), "y": _cell_center(0), "requiresKey": True, "requiredKeyColor": None}
    is_valid, error = validate_level_content(_minimal_valid_content(doorObjects=[door]))
    assert is_valid is False
    assert "requiredKeyColor" in error


def test_non_key_door_with_a_color_set_is_rejected():
    """Mirrors the editor's own documented invariant - requiredKeyColor
    is always null for a door that doesn't require a key, never a
    leftover/stale value."""
    door = {"x": _cell_center(0), "y": _cell_center(0), "requiresKey": False, "requiredKeyColor": "yellow"}
    is_valid, error = validate_level_content(_minimal_valid_content(doorObjects=[door]))
    assert is_valid is False
    assert "requiredKeyColor" in error


def test_door_with_invalid_required_key_color_is_rejected():
    door = {"x": _cell_center(0), "y": _cell_center(0), "requiresKey": True, "requiredKeyColor": "rainbow"}
    is_valid, error = validate_level_content(_minimal_valid_content(doorObjects=[door]))
    assert is_valid is False
    assert "requiredKeyColor" in error


# --- keyObjects ---


def test_keys_at_exactly_the_budget_passes():
    keys = [{"x": _cell_center(i), "y": _cell_center(0), "color": "blue"} for i in range(MAX_KEYS)]
    is_valid, error = validate_level_content(_minimal_valid_content(keyObjects=keys))
    assert is_valid is True


def test_keys_one_over_the_budget_is_rejected():
    keys = [{"x": _cell_center(i), "y": _cell_center(0), "color": "blue"} for i in range(MAX_KEYS + 1)]
    is_valid, error = validate_level_content(_minimal_valid_content(keyObjects=keys))
    assert is_valid is False
    assert str(MAX_KEYS) in error


def test_key_with_invalid_color_is_rejected():
    key = {"x": _cell_center(0), "y": _cell_center(0), "color": "rainbow"}
    is_valid, error = validate_level_content(_minimal_valid_content(keyObjects=[key]))
    assert is_valid is False
    assert "color" in error


def test_keys_are_allowed_with_no_matching_door_at_all():
    """Deliberate design decision - a key doesn't need any door to
    justify existing. An unusable key is a creator's own (harmless)
    choice, not something this validates against; the real gate is
    that the level has to be genuinely beaten to ever get published."""
    key = {"x": _cell_center(0), "y": _cell_center(0), "color": "red"}
    is_valid, error = validate_level_content(_minimal_valid_content(keyObjects=[key], doorObjects=[]))
    assert is_valid is True
    assert error is None


# --- world bounds, generally ---


def test_position_exactly_at_the_last_valid_cell_center_is_in_bounds():
    last_col_index = (WORLD_WIDTH // GRID_SIZE) - 1
    last_row_index = (WORLD_HEIGHT // GRID_SIZE) - 1
    tile = {
        "type": "ground",
        "x": _cell_center(last_col_index),
        "y": _cell_center(last_row_index),
        "style": "grass",
        "groupId": "g",
    }
    is_valid, error = validate_level_content(_minimal_valid_content(placedObjects=[tile]))
    assert is_valid is True
    assert error is None


def test_position_one_cell_beyond_the_world_edge_is_rejected():
    last_col_index = WORLD_WIDTH // GRID_SIZE
    tile = {
        "type": "ground",
        "x": _cell_center(last_col_index),
        "y": _cell_center(0),
        "style": "grass",
        "groupId": "g",
    }
    is_valid, error = validate_level_content(_minimal_valid_content(placedObjects=[tile]))
    assert is_valid is False
    assert "bounds" in error


def test_a_bare_multiple_of_grid_size_is_rejected_not_accepted():
    """The actual regression this whole file exists to catch: a corner-
    aligned position (a bare multiple of GRID_SIZE) is NOT what the
    editor's snapToGrid() ever produces, and must not validate."""
    tile = {"type": "ground", "x": GRID_SIZE * 3, "y": GRID_SIZE * 3, "style": "grass", "groupId": "g"}
    is_valid, error = validate_level_content(_minimal_valid_content(placedObjects=[tile]))
    assert is_valid is False
    assert "grid" in error