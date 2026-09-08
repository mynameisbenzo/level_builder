import { determineOrientation, type GroundTileStyle, type PlatformOrientation } from './groundTiling';

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
	 * they're adjacent. A group's orientation (horizontal/vertical) isn't
	 * stored - it's derived from its tiles' actual positions (see
	 * determineOrientation in groundTiling.ts).
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
 * Returns a new array either way (unchanged if nothing matched).
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
 * Whether a candidate neighbor is safe to join: same style, AND (if its
 * own group has more than one tile) that group's derived orientation
 * matches the orientation being placed. This is what stops a horizontal
 * drag from accidentally merging into a vertical platform's group (or
 * vice versa) just because they happen to touch - a group can only ever
 * run one way, so a perpendicular touch stays two separate platforms.
 * A single-tile neighbor group has no orientation of its own yet, so it's
 * always compatible.
 */
function isCompatibleNeighbor(
	neighbor: PlacedObject,
	style: GroundTileStyle,
	orientation: PlatformOrientation,
	allObjects: PlacedObject[]
): boolean {
	if (neighbor.style !== style) {
		return false;
	}
	const neighborGroupTiles = allObjects.filter((object) => object.groupId === neighbor.groupId);
	if (neighborGroupTiles.length <= 1) {
		return true;
	}
	return determineOrientation(neighborGroupTiles) === orientation;
}

/**
 * Decides which platform (groupId) a newly placed tile should belong to,
 * checking neighbors along whichever axis matches the given orientation
 * (left/right for horizontal, above/below for vertical). The "before"
 * neighbor is checked first, so if both sides match, the new tile joins
 * that one (mergeGroupIds handles unifying the other side into it).
 * Falls back to a fresh id when neither neighbor matches or is
 * orientation-compatible.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function resolveGroupIdForPlacement(
	allObjects: PlacedObject[],
	x: number,
	y: number,
	orientation: PlatformOrientation,
	style: GroundTileStyle,
	gridSize: number,
	fallbackGroupId: string
): string {
	const before =
		orientation === 'horizontal'
			? allObjects.find((object) => object.x === x - gridSize && object.y === y)
			: allObjects.find((object) => object.x === x && object.y === y - gridSize);
	if (before && isCompatibleNeighbor(before, style, orientation, allObjects)) {
		return before.groupId;
	}

	const after =
		orientation === 'horizontal'
			? allObjects.find((object) => object.x === x + gridSize && object.y === y)
			: allObjects.find((object) => object.x === x && object.y === y + gridSize);
	if (after && isCompatibleNeighbor(after, style, orientation, allObjects)) {
		return after.groupId;
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

/**
 * Checks whether a newly placed tile sits directly between two existing
 * neighbors (one on each side, along the given orientation's axis) that
 * are orientation-compatible with each other and with the new tile's
 * style - if so, the new tile bridges two previously separate platforms
 * into one. Returns the possibly-updated array (unchanged if no bridge
 * applies) along with the groupId the new tile should end up using.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function bridgeIfBetweenTwoGroups(
	updated: PlacedObject[],
	x: number,
	y: number,
	orientation: PlatformOrientation,
	style: GroundTileStyle,
	gridSize: number,
	newTileGroupId: string
): PlacedObject[] {
	const before =
		orientation === 'horizontal'
			? updated.find((object) => object.x === x - gridSize && object.y === y)
			: updated.find((object) => object.x === x && object.y === y - gridSize);
	const after =
		orientation === 'horizontal'
			? updated.find((object) => object.x === x + gridSize && object.y === y)
			: updated.find((object) => object.x === x && object.y === y + gridSize);

	if (
		before &&
		after &&
		before.style === style &&
		after.style === style &&
		before.groupId !== after.groupId &&
		isCompatibleNeighbor(before, style, orientation, updated) &&
		isCompatibleNeighbor(after, style, orientation, updated)
	) {
		let merged = mergeGroupIds(updated, before.groupId, newTileGroupId);
		merged = mergeGroupIds(merged, after.groupId, newTileGroupId);
		return merged;
	}

	return updated;
}

/**
 * Checks whether the given platform's two ends (along its own derived
 * orientation) now touch a DIFFERENT, orientation-compatible platform of
 * the same style - which can happen after a restyle, since placement-time
 * merging doesn't retroactively apply. If so, merges the neighboring
 * platform into this one. A no-op if the group has no tiles, or neither
 * end has a matching neighbor.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function mergeAdjacentSameStyleGroups(
	existing: PlacedObject[],
	groupId: string,
	gridSize: number
): PlacedObject[] {
	const groupTiles = existing.filter((object) => object.groupId === groupId);
	if (groupTiles.length === 0) {
		return existing;
	}

	const style = groupTiles[0].style;

	if (groupTiles.length === 1) {
		// A lone tile hasn't committed to an orientation yet (determineOrientation
		// would arbitrarily call it "horizontal"), so check all four directions
		// rather than just left/right - merge with whichever compatible
		// same-style neighbor is found first (horizontal checked before
		// vertical, matching the two-neighbor case's left-before-right /
		// above-before-below priority).
		const { x, y } = groupTiles[0];
		const candidates: { x: number; y: number; orientation: PlatformOrientation }[] = [
			{ x: x - gridSize, y, orientation: 'horizontal' },
			{ x: x + gridSize, y, orientation: 'horizontal' },
			{ x, y: y - gridSize, orientation: 'vertical' },
			{ x, y: y + gridSize, orientation: 'vertical' }
		];
		for (const candidate of candidates) {
			const neighbor = existing.find(
				(object) => object.x === candidate.x && object.y === candidate.y
			);
			if (
				neighbor &&
				neighbor.groupId !== groupId &&
				isCompatibleNeighbor(neighbor, style, candidate.orientation, existing)
			) {
				return mergeGroupIds(existing, neighbor.groupId, groupId);
			}
		}
		return existing;
	}

	const orientation = determineOrientation(groupTiles);
	let updated = existing;

	if (orientation === 'horizontal') {
		const y = groupTiles[0].y;
		const xs = groupTiles.map((object) => object.x);
		const minX = Math.min(...xs);
		const maxX = Math.max(...xs);

		const before = updated.find((object) => object.x === minX - gridSize && object.y === y);
		if (
			before &&
			before.groupId !== groupId &&
			isCompatibleNeighbor(before, style, orientation, updated)
		) {
			updated = mergeGroupIds(updated, before.groupId, groupId);
		}

		const after = updated.find((object) => object.x === maxX + gridSize && object.y === y);
		if (
			after &&
			after.groupId !== groupId &&
			isCompatibleNeighbor(after, style, orientation, updated)
		) {
			updated = mergeGroupIds(updated, after.groupId, groupId);
		}
	} else {
		const x = groupTiles[0].x;
		const ys = groupTiles.map((object) => object.y);
		const minY = Math.min(...ys);
		const maxY = Math.max(...ys);

		const before = updated.find((object) => object.x === x && object.y === minY - gridSize);
		if (
			before &&
			before.groupId !== groupId &&
			isCompatibleNeighbor(before, style, orientation, updated)
		) {
			updated = mergeGroupIds(updated, before.groupId, groupId);
		}

		const after = updated.find((object) => object.x === x && object.y === maxY + gridSize);
		if (
			after &&
			after.groupId !== groupId &&
			isCompatibleNeighbor(after, style, orientation, updated)
		) {
			updated = mergeGroupIds(updated, after.groupId, groupId);
		}
	}

	return updated;
}