export interface PlayerPosition {
	x: number;
	y: number;
}

export const DEFAULT_PLAYER_POSITION: PlayerPosition = { x: 400, y: 450 };
export const PLAYER_POSITION_REGISTRY_KEY = 'playerPosition';

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