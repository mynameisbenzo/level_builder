export interface PlayerPosition {
	x: number;
	y: number;
}

// Bottom-left screen (matches the Editor's default camera framing - see
// camera.ts), horizontally centered and positioned toward the bottom of
// that screen, so the player starts near ground level rather than
// floating in open space. The world grew from 2 rows to 3 (see
// WORLD_ROWS in camera.ts) - this had to move down a full row's worth
// (600px) to stay in the actual bottom row; leaving the old y value in
// place would have spawned every new level in what's now the middle
// row, floating with nothing underneath by default.
//
// Nudged slightly off dead-center (400, 1650) to the nearest
// grid-aligned position - the original values were never actually
// multiples of GRID_SIZE (32px), just visually centered in the
// viewport, which is a different goal that happens not to coincide
// with grid alignment here. That went unnoticed until the backend's
// save validation started checking every position against the grid,
// same as the editor's own drag-handler already does when a creator
// actually drags the player - alignment is the real invariant this was
// always supposed to hold, the original constant just never got
// checked against it.
export const DEFAULT_PLAYER_POSITION: PlayerPosition = { x: 384, y: 1664 };
export const EDITOR_PLAYER_POSITION_KEY = 'editorPlayerPosition';

/**
 * Resolves the position a scene should spawn the player at: the carried-over
 * stored position if one exists, otherwise the default spawn point.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function resolveInitialPlayerPosition(
	stored: PlayerPosition | null | undefined,
	fallback: PlayerPosition
): PlayerPosition {
	return stored ?? fallback;
}