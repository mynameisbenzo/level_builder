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
export const DEFAULT_PLAYER_POSITION: PlayerPosition = { x: 400, y: 1650 };
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