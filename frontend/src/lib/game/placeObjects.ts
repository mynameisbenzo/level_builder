export interface PlacedObject {
	type: 'ground';
	x: number;
	y: number;
}

export const PLACED_OBJECTS_REGISTRY_KEY = 'placedObjects';

/**
 * Checks whether a placed object already exists at the exact given
 * position, to avoid stacking duplicate tiles when a user clicks the same
 * already-occupied grid cell more than once.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function isPositionOccupied(existing: PlacedObject[], x: number, y: number): boolean {
	return existing.some((object) => object.x === x && object.y === y);
}