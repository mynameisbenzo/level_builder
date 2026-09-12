import type { PlayerColor } from './textures';

export interface CharacterSwapObject {
	x: number;
	y: number;
	color: PlayerColor;
}

export const CHARACTER_SWAP_OBJECTS_REGISTRY_KEY = 'characterSwapObjects';

export interface SwapResult {
	newPlayerColor: PlayerColor;
	newObjectColor: PlayerColor;
}

/**
 * Computes the result of touching a character-swap object: the player
 * takes on the object's color, and the object is left holding whatever
 * color the player had before touching it.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getSwapResult(currentPlayerColor: PlayerColor, objectColor: PlayerColor): SwapResult {
	return { newPlayerColor: objectColor, newObjectColor: currentPlayerColor };
}

/**
 * Whether the player is close enough to a swap object to trigger it,
 * using simple circular distance rather than full physics-body overlap.
 * These objects bob via a visual tween rather than a physics body (a
 * tween writing the GameObject's position directly would fight an Arcade
 * body for authority over it), so a lightweight distance check is used
 * instead of a collider/overlap pair.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function isWithinSwapRange(
	playerX: number,
	playerY: number,
	objectX: number,
	objectY: number,
	thresholdDistance: number
): boolean {
	const dx = playerX - objectX;
	const dy = playerY - objectY;
	return Math.sqrt(dx * dx + dy * dy) <= thresholdDistance;
}