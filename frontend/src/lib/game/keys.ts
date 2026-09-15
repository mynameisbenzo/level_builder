import { isWithinRange } from './geometry';

export const KEY_COLORS = ['blue', 'green', 'red', 'yellow'] as const;
export type KeyColor = (typeof KEY_COLORS)[number];

export interface KeyObject {
	x: number;
	y: number;
	color: KeyColor;
}

export const KEY_OBJECTS_REGISTRY_KEY = 'keyObjects';

/**
 * Maps a key color to its world/pickup frame. A separate hud_key_<color>
 * frame also exists in the tileset for a future inventory-style display,
 * not used here.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getKeyFrame(color: KeyColor): string {
	return `key_${color}`;
}

/**
 * Whether a new key can be placed at the given position - just needs
 * that one cell free of every other kind of placed content. Takes the
 * already-occupied positions as a flat set of "x,y" keys, same pattern
 * as canPlaceDoorAt in winConditions.ts.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function canPlaceKeyAt(
	x: number,
	y: number,
	occupiedPositionKeys: ReadonlySet<string>
): boolean {
	return !occupiedPositionKeys.has(`${x},${y}`);
}

/**
 * Removes the key at the exact given position, if one exists. Returns a
 * new array either way (unchanged if nothing matched).
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function removeKeyAt(keys: KeyObject[], x: number, y: number): KeyObject[] {
	return keys.filter((key) => !(key.x === x && key.y === y));
}

/**
 * Whether the player is close enough to an uncollected key to pick it up.
 * Same distance-check approach as swap objects and doors (see
 * isWithinRange in geometry.ts) and for the same reason: no physics body
 * backing these, so no Arcade overlap pair to check instead.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function isNearKey(
	playerX: number,
	playerY: number,
	key: KeyObject,
	thresholdDistance: number
): boolean {
	return isWithinRange(playerX, playerY, key.x, key.y, thresholdDistance);
}