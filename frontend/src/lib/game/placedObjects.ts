import type { GroundTileStyle } from './groundTiling';

export interface PlacedObject {
	type: 'ground';
	x: number;
	y: number;
	style: GroundTileStyle;
	/**
	 * Identifies which platform this tile belongs to. Assigned once per
	 * click-and-drag placement action - every tile placed during the same
	 * gesture shares an id. Two platforms that happen to end up physically
	 * touching (placed as separate actions) have different ids and stay
	 * visually and functionally distinct, rather than merging just because
	 * they're adjacent.
	 */
	groupId: string;
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

/**
 * Removes the placed object at the exact given position, if one exists.
 * Returns a new array either way (unchanged if nothing matched). Not
 * currently wired into any interaction - kept for the planned eraser tool.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function removePosition(existing: PlacedObject[], x: number, y: number): PlacedObject[] {
	return existing.filter((object) => !(object.x === x && object.y === y));
}

/**
 * Returns a new array with the object at the given position's style
 * replaced. Returns an unchanged (but new) array if no object matches.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function updateObjectStyle(
	existing: PlacedObject[],
	x: number,
	y: number,
	style: GroundTileStyle
): PlacedObject[] {
	return existing.map((object) =>
		object.x === x && object.y === y ? { ...object, style } : object
	);
}

export function tileKey(x: number, y: number): string {
	return `${x},${y}`;
}

/**
 * Returns the tile keys of every placed object that shares the given
 * platform (groupId) - the whole platform a clicked tile belongs to.
 * Unlike physical-adjacency-based grouping, this doesn't need position or
 * grid size at all: platform membership is explicit, assigned at
 * placement time, not inferred from where tiles happen to sit.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getSameGroupTileKeys(allObjects: PlacedObject[], groupId: string): string[] {
	return allObjects
		.filter((object) => object.groupId === groupId)
		.map((object) => tileKey(object.x, object.y));
}

/**
 * Decides the next active selection (a whole group of tile keys) given
 * what's clicked: clicking any tile that's already part of the active
 * group deactivates the whole group (returns null); clicking a tile in a
 * different (or no) group activates that tile's whole group instead.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getNextActiveGroupKeys(
	currentGroupKeys: string[] | null,
	clickedKey: string,
	newGroupKeys: string[]
): string[] | null {
	if (currentGroupKeys !== null && currentGroupKeys.includes(clickedKey)) {
		return null;
	}
	return newGroupKeys;
}

/**
 * Decides which platform (groupId) a newly placed tile should belong to:
 * if its immediate left or right neighbor (on the same row) exists and
 * shares the same style, the new tile joins that neighbor's platform.
 * Left is checked first, so if both neighbors match, the new tile joins
 * the left one (mergeGroupIds handles unifying the right one into it).
 * Falls back to a fresh id when neither neighbor matches.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function resolveGroupIdForPlacement(
	rowObjects: PlacedObject[],
	x: number,
	style: GroundTileStyle,
	gridSize: number,
	fallbackGroupId: string
): string {
	const leftNeighbor = rowObjects.find((object) => object.x === x - gridSize);
	if (leftNeighbor && leftNeighbor.style === style) {
		return leftNeighbor.groupId;
	}
	const rightNeighbor = rowObjects.find((object) => object.x === x + gridSize);
	if (rightNeighbor && rightNeighbor.style === style) {
		return rightNeighbor.groupId;
	}
	return fallbackGroupId;
}

/**
 * Reassigns every object with fromGroupId to toGroupId - used when a
 * newly placed tile bridges two previously separate same-style platforms,
 * unifying them into one. A no-op if the two ids are already the same.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function mergeGroupIds(
	existing: PlacedObject[],
	fromGroupId: string,
	toGroupId: string
): PlacedObject[] {
	if (fromGroupId === toGroupId) {
		return existing;
	}
	return existing.map((object) =>
		object.groupId === fromGroupId ? { ...object, groupId: toGroupId } : object
	);
}