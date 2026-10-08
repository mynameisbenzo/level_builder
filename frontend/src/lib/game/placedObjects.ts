import { determineOrientation, type GroundTileStyle, type PlatformOrientation } from './groundTiling';
import { GRID_SIZE } from './gridSnap';
import type { EnemyType } from './enemies';

export interface GroundPlacedObject {
	type: 'ground';
	x: number;
	y: number;
	style: GroundTileStyle;
	groupId: string;
}

/**
 * A hazard tile - kills the player on touch in Play mode (see
 * PlatformerScene's hazards group and die()). Painted the same way
 * ground tiles are - click-and-drag, using the same drag-orientation
 * plumbing (see LevelEditorScene's placeHazardIfEmpty) - and sharing the
 * same array means the same one-object-per-cell rule (isPositionOccupied)
 * applies for free: a hazard and a ground tile can't occupy the same
 * cell. Unlike ground tiles, a hazard carries no style or groupId -
 * every hazard tile is the same fixed sprite (see HAZARD_TILE_FRAME
 * below), and hazards never merge into multi-tile platforms.
 */
export interface HazardPlacedObject {
	type: 'hazard';
	x: number;
	y: number;
	/**
	 * Which way the spikes point, in degrees clockwise: 0 (up, sitting on
	 * the cell's floor - the original and default), 90 (right, against the
	 * cell's left edge), 180 (down, hanging from the cell's ceiling), or
	 * 270 (left, against the cell's right edge). Left off for 0, so
	 * hazards saved before rotation existed are unchanged.
	 */
	rotation?: HazardRotation;
}

export const HAZARD_ROTATIONS = [0, 90, 180, 270] as const;
export type HazardRotation = (typeof HAZARD_ROTATIONS)[number];

/**
 * An enemy spawn point - which kind (enemyType) patrols/behaves however
 * that kind is defined in enemies.ts and the two scenes. Like a hazard,
 * an enemy carries no style or grouping of its own; unlike a hazard, it
 * isn't a fixed single sprite - enemyType is what the two scenes use to
 * pick which frames, speed, and behavior apply.
 */
export interface EnemyPlacedObject {
	type: 'enemy';
	enemyType: EnemyType;
	x: number;
	y: number;
}

export type PlacedObject = GroundPlacedObject | HazardPlacedObject | EnemyPlacedObject;

// The one frame every hazard tile renders with - lives in a separate
// atlas from every other placed object (see HAZARD_ATLAS_KEY in
// atlases.ts), since it isn't part of the default tileset spritesheet
// the rest of this file's objects draw from.
export const HAZARD_TILE_FRAME = 'platformIndustrial_052.png';

// Native sprite is 70x30 - squashing it into a 32x32 grid cell (like a
// ground tile) came out stretched tall and thin. Rendered close to its
// native size instead, wider and taller than a single grid cell, rather
// than forced to fit it.
export const HAZARD_DISPLAY_WIDTH = 28;
export const HAZARD_DISPLAY_HEIGHT = 16;

// Placed objects are keyed by their grid cell's center (x, y). Centering
// a taller-than-GRID_SIZE sprite on that same y would let it sink below
// the cell's bottom edge by just as much as it pokes up above the top.
// Shifting the sprite's center up by this offset keeps its bottom edge
// flush with the bottom of the grid cell instead, so it reads as sitting
// on the ground rather than floating or sinking into it.
export const HAZARD_Y_OFFSET = (GRID_SIZE - HAZARD_DISPLAY_HEIGHT) / 2;

export const PLACED_OBJECTS_REGISTRY_KEY = 'placedObjects';

/** The rotation a hazard has (0 when none is stored, or the value is unknown). */
export function getHazardRotation(object: { rotation?: unknown }): HazardRotation {
	return (HAZARD_ROTATIONS as readonly unknown[]).includes(object.rotation)
		? (object.rotation as HazardRotation)
		: 0;
}

/** The next rotation in the click cycle: 0 -> 90 -> 180 -> 270 -> 0. */
export function nextHazardRotation(rotation: HazardRotation): HazardRotation {
	return ((rotation + 90) % 360) as HazardRotation;
}

/**
 * Returns a new array with the hazard at the given position turned 90
 * degrees clockwise. A rotation of 0 is stored by leaving `rotation` off,
 * so a full turn gives back the original `{ type, x, y }`. Anything that
 * isn't a hazard at that position is left alone (the array comes back
 * unchanged, but still new).
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function rotateHazardAt(existing: PlacedObject[], x: number, y: number): PlacedObject[] {
	return existing.map((object) => {
		if (object.type !== 'hazard' || object.x !== x || object.y !== y) {
			return object;
		}
		const next = nextHazardRotation(getHazardRotation(object));
		const { rotation: _previous, ...rest } = object;
		return next === 0 ? rest : { ...rest, rotation: next };
	});
}

export interface HazardPlacement {
	/** Center of the spike strip. */
	x: number;
	y: number;
	/** Degrees clockwise to draw the sprite at. */
	angle: number;
	/** Size of the spike strip once rotated (its hitbox). */
	width: number;
	height: number;
}

/**
 * Where a hazard in the grid cell centered at (cellX, cellY) is drawn and
 * what space it covers. The strip sits flush against the edge of the cell
 * it points away from - the floor when pointing up, the ceiling when
 * pointing down, the left edge when pointing right, the right edge when
 * pointing left - the same way the upright strip rests on the floor
 * (see HAZARD_Y_OFFSET).
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getHazardPlacement(
	cellX: number,
	cellY: number,
	rotation: HazardRotation
): HazardPlacement {
	const sideways = rotation === 90 || rotation === 270;
	const width = sideways ? HAZARD_DISPLAY_HEIGHT : HAZARD_DISPLAY_WIDTH;
	const height = sideways ? HAZARD_DISPLAY_WIDTH : HAZARD_DISPLAY_HEIGHT;
	const inset = (GRID_SIZE - HAZARD_DISPLAY_HEIGHT) / 2;

	let x = cellX;
	let y = cellY;
	if (rotation === 0) y = cellY + inset;
	else if (rotation === 90) x = cellX - inset;
	else if (rotation === 180) y = cellY - inset;
	else x = cellX + inset;

	return { x, y, angle: rotation, width, height };
}

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
	existing: GroundPlacedObject[],
	x: number,
	y: number,
	style: GroundTileStyle
): GroundPlacedObject[] {
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
export function getSameGroupTileKeys(allObjects: GroundPlacedObject[], groupId: string): string[] {
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
	neighbor: GroundPlacedObject,
	style: GroundTileStyle,
	orientation: PlatformOrientation,
	allObjects: GroundPlacedObject[]
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
	allObjects: GroundPlacedObject[],
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
	existing: GroundPlacedObject[],
	fromGroupId: string,
	toGroupId: string
): GroundPlacedObject[] {
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
	updated: GroundPlacedObject[],
	x: number,
	y: number,
	orientation: PlatformOrientation,
	style: GroundTileStyle,
	gridSize: number,
	newTileGroupId: string
): GroundPlacedObject[] {
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
	existing: GroundPlacedObject[],
	groupId: string,
	gridSize: number
): GroundPlacedObject[] {
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