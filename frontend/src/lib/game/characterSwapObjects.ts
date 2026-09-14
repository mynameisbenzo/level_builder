import { PLAYER_COLORS, type PlayerColor } from './playerColor';

export interface CharacterSwapObject {
	x: number;
	y: number;
	color: PlayerColor;
}

export const CHARACTER_SWAP_OBJECTS_REGISTRY_KEY = 'characterSwapObjects';

/**
 * At most this many swap objects may exist in a level: PLAYER_COLORS.length
 * minus 1, so at least one color is always left over for whichever
 * character the player starts as - every object gets a genuinely distinct
 * color, never a duplicate of another object's.
 */
export const MAX_CHARACTER_SWAP_OBJECTS = PLAYER_COLORS.length - 1;

/**
 * Which colors can still be placed as a new swap object: every declared
 * color not already used by an existing object AND not the player's own
 * current color (an object representing the character you're already
 * playing as would be redundant, and placing one would also break the
 * "every color has exactly one holder" invariant the moment the level
 * loads, before any swap even happens) - or none at all once the level
 * is already at MAX_CHARACTER_SWAP_OBJECTS, even if a color happens to
 * be technically unused, since a 5th object would leave nothing for the
 * player to (re)start as.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getAvailableSwapColors(
	placedObjects: CharacterSwapObject[],
	currentPlayerColor: PlayerColor
): PlayerColor[] {
	if (placedObjects.length >= MAX_CHARACTER_SWAP_OBJECTS) {
		return [];
	}
	const usedColors = new Set(placedObjects.map((object) => object.color));
	usedColors.add(currentPlayerColor);
	return PLAYER_COLORS.filter((color) => !usedColors.has(color));
}

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