import { type PlayerColor } from './playerColor';

export interface CharacterSwapObject {
	x: number;
	y: number;
	color: PlayerColor;
}

export const CHARACTER_SWAP_OBJECTS_REGISTRY_KEY = 'characterSwapObjects';

/**
 * Removes the swap object at the exact given position, if one exists.
 * Returns a new array either way (unchanged if nothing matched).
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function removeSwapObjectAt(
	objects: CharacterSwapObject[],
	x: number,
	y: number
): CharacterSwapObject[] {
	return objects.filter((object) => !(object.x === x && object.y === y));
}

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
 * Whether the player is close enough to a swap object to trigger it.
 * These objects bob via a visual tween rather than a physics body (a
 * tween writing the GameObject's position directly would fight an Arcade
 * body for authority over it), so a lightweight distance check is used
 * instead of a collider/overlap pair - see isWithinRange in geometry.ts,
 * shared with doors for the same reason.
 */
export { isWithinRange as isWithinSwapRange } from './geometry';