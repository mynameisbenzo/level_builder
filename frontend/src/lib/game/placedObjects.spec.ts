import { describe, expect, it } from 'vitest';
import {
	getNextActiveGroupKeys,
	getSameGroupTileKeys,
	isPositionOccupied,
	removePosition,
	tileKey,
	updateObjectStyle,
	resolveGroupIdForPlacement,
	mergeGroupIds,
	type PlacedObject,
	mergeAdjacentSameStyleGroups
} from './placedObjects';

describe('isPositionOccupied', () => {
	it('returns false for an empty list', () => {
		expect(isPositionOccupied([], 32, 32)).toBe(false);
	});

	it('returns true when a matching position exists', () => {
		const existing: PlacedObject[] = [{ type: 'ground', x: 32, y: 32, style: 'grass', groupId: 'a' }];
		expect(isPositionOccupied(existing, 32, 32)).toBe(true);
	});

	it('returns false when positions are close but not exact', () => {
		const existing: PlacedObject[] = [{ type: 'ground', x: 32, y: 32, style: 'grass', groupId: 'a' }];
		expect(isPositionOccupied(existing, 64, 32)).toBe(false);
	});

	it('checks against all entries, not just the first', () => {
		const existing: PlacedObject[] = [
			{ type: 'ground', x: 0, y: 0, style: 'grass', groupId: 'a' },
			{ type: 'ground', x: 96, y: 96, style: 'grass', groupId: 'b' }
		];
		expect(isPositionOccupied(existing, 96, 96)).toBe(true);
	});
});

describe('removePosition', () => {
	it('removes the matching object', () => {
		const existing: PlacedObject[] = [{ type: 'ground', x: 32, y: 32, style: 'grass', groupId: 'a' }];
		expect(removePosition(existing, 32, 32)).toEqual([]);
	});

	it('returns an unchanged (but new) list when nothing matches', () => {
		const existing: PlacedObject[] = [{ type: 'ground', x: 32, y: 32, style: 'grass', groupId: 'a' }];
		expect(removePosition(existing, 64, 64)).toEqual(existing);
	});

	it('only removes the exact match, keeping the rest', () => {
		const existing: PlacedObject[] = [
			{ type: 'ground', x: 0, y: 0, style: 'grass', groupId: 'a' },
			{ type: 'ground', x: 96, y: 96, style: 'grass', groupId: 'b' }
		];
		expect(removePosition(existing, 0, 0)).toEqual([
			{ type: 'ground', x: 96, y: 96, style: 'grass', groupId: 'b' }
		]);
	});
});

describe('updateObjectStyle', () => {
	it("changes only the matching object's style, preserving its groupId", () => {
		const existing: PlacedObject[] = [
			{ type: 'ground', x: 0, y: 0, style: 'grass', groupId: 'a' },
			{ type: 'ground', x: 32, y: 0, style: 'grass', groupId: 'a' }
		];
		const updated = updateObjectStyle(existing, 0, 0, 'stone');
		expect(updated).toEqual([
			{ type: 'ground', x: 0, y: 0, style: 'stone', groupId: 'a' },
			{ type: 'ground', x: 32, y: 0, style: 'grass', groupId: 'a' }
		]);
	});

	it('returns an unchanged (but new) array when nothing matches', () => {
		const existing: PlacedObject[] = [{ type: 'ground', x: 0, y: 0, style: 'grass', groupId: 'a' }];
		expect(updateObjectStyle(existing, 999, 999, 'stone')).toEqual(existing);
	});
});

describe('tileKey', () => {
	it('formats a consistent key from x and y', () => {
		expect(tileKey(32, 64)).toBe('32,64');
	});
});

describe('getSameGroupTileKeys', () => {
	it('returns only the tiles sharing the given groupId', () => {
		const objects: PlacedObject[] = [
			{ type: 'ground', x: 16, y: 0, style: 'grass', groupId: 'a' },
			{ type: 'ground', x: 48, y: 0, style: 'grass', groupId: 'a' },
			{ type: 'ground', x: 80, y: 0, style: 'stone', groupId: 'b' }
		];
		expect(getSameGroupTileKeys(objects, 'a')).toEqual(['16,0', '48,0']);
	});

	it('returns tiles sharing a groupId even if not physically adjacent', () => {
		// Group membership is explicit, not inferred from position - this
		// wouldn't happen in practice today, but the function shouldn't
		// silently depend on adjacency to work correctly.
		const objects: PlacedObject[] = [
			{ type: 'ground', x: 16, y: 0, style: 'grass', groupId: 'a' },
			{ type: 'ground', x: 400, y: 0, style: 'grass', groupId: 'a' }
		];
		expect(getSameGroupTileKeys(objects, 'a')).toEqual(['16,0', '400,0']);
	});

	it('does not include a physically touching tile from a different group', () => {
		const objects: PlacedObject[] = [
			{ type: 'ground', x: 16, y: 0, style: 'grass', groupId: 'a' },
			{ type: 'ground', x: 48, y: 0, style: 'grass', groupId: 'b' }
		];
		expect(getSameGroupTileKeys(objects, 'a')).toEqual(['16,0']);
	});

	it('returns an empty array when no tiles match', () => {
		const objects: PlacedObject[] = [{ type: 'ground', x: 16, y: 0, style: 'grass', groupId: 'a' }];
		expect(getSameGroupTileKeys(objects, 'nonexistent')).toEqual([]);
	});
});

describe('getNextActiveGroupKeys', () => {
	it('activates a group when nothing was active', () => {
		expect(getNextActiveGroupKeys(null, '16,0', ['16,0', '48,0'])).toEqual(['16,0', '48,0']);
	});

	it('deactivates the whole group when clicking any tile already in it', () => {
		expect(getNextActiveGroupKeys(['16,0', '48,0'], '48,0', ['16,0', '48,0'])).toBeNull();
	});

	it('switches to a different group when clicking a tile outside the active one', () => {
		expect(getNextActiveGroupKeys(['16,0', '48,0'], '144,0', ['144,0', '176,0'])).toEqual([
			'144,0',
			'176,0'
		]);
	});
});

describe('resolveGroupIdForPlacement', () => {
	it('falls back to a fresh id when there are no neighbors', () => {
		expect(resolveGroupIdForPlacement([], 16, 'grass', 32, 'fresh')).toBe('fresh');
	});

	it('joins the left neighbor when it exists and matches style', () => {
		const rowObjects: PlacedObject[] = [{ type: 'ground', x: 16, y: 0, style: 'grass', groupId: 'a' }];
		expect(resolveGroupIdForPlacement(rowObjects, 48, 'grass', 32, 'fresh')).toBe('a');
	});

	it('does not join the left neighbor when styles differ', () => {
		const rowObjects: PlacedObject[] = [{ type: 'ground', x: 16, y: 0, style: 'stone', groupId: 'a' }];
		expect(resolveGroupIdForPlacement(rowObjects, 48, 'grass', 32, 'fresh')).toBe('fresh');
	});

	it('joins the right neighbor when it exists and matches style', () => {
		const rowObjects: PlacedObject[] = [{ type: 'ground', x: 48, y: 0, style: 'grass', groupId: 'b' }];
		expect(resolveGroupIdForPlacement(rowObjects, 16, 'grass', 32, 'fresh')).toBe('b');
	});

	it('prefers the left neighbor when both match (mergeGroupIds handles unifying the right one)', () => {
		const rowObjects: PlacedObject[] = [
			{ type: 'ground', x: 16, y: 0, style: 'grass', groupId: 'a' },
			{ type: 'ground', x: 80, y: 0, style: 'grass', groupId: 'b' }
		];
		expect(resolveGroupIdForPlacement(rowObjects, 48, 'grass', 32, 'fresh')).toBe('a');
	});

	it('ignores a neighbor of a different style even if the other side matches', () => {
		const rowObjects: PlacedObject[] = [
			{ type: 'ground', x: 16, y: 0, style: 'stone', groupId: 'a' },
			{ type: 'ground', x: 80, y: 0, style: 'grass', groupId: 'b' }
		];
		expect(resolveGroupIdForPlacement(rowObjects, 48, 'grass', 32, 'fresh')).toBe('b');
	});
});

describe('mergeGroupIds', () => {
	it('reassigns every object with the old groupId to the new one', () => {
		const existing: PlacedObject[] = [
			{ type: 'ground', x: 16, y: 0, style: 'grass', groupId: 'b' },
			{ type: 'ground', x: 48, y: 0, style: 'grass', groupId: 'a' },
			{ type: 'ground', x: 80, y: 0, style: 'grass', groupId: 'b' }
		];
		expect(mergeGroupIds(existing, 'b', 'a')).toEqual([
			{ type: 'ground', x: 16, y: 0, style: 'grass', groupId: 'a' },
			{ type: 'ground', x: 48, y: 0, style: 'grass', groupId: 'a' },
			{ type: 'ground', x: 80, y: 0, style: 'grass', groupId: 'a' }
		]);
	});

	it('is a no-op when the two ids are already the same', () => {
		const existing: PlacedObject[] = [{ type: 'ground', x: 16, y: 0, style: 'grass', groupId: 'a' }];
		expect(mergeGroupIds(existing, 'a', 'a')).toEqual(existing);
	});

	it('leaves objects with unrelated groupIds untouched', () => {
		const existing: PlacedObject[] = [
			{ type: 'ground', x: 16, y: 0, style: 'grass', groupId: 'a' },
			{ type: 'ground', x: 48, y: 0, style: 'stone', groupId: 'c' }
		];
		expect(mergeGroupIds(existing, 'a', 'z')).toEqual([
			{ type: 'ground', x: 16, y: 0, style: 'grass', groupId: 'z' },
			{ type: 'ground', x: 48, y: 0, style: 'stone', groupId: 'c' }
		]);
	});
});

describe('mergeAdjacentSameStyleGroups', () => {
	it('merges a touching same-style neighbor on the right after a restyle', () => {
		const existing: PlacedObject[] = [
			{ type: 'ground', x: 16, y: 0, style: 'grass', groupId: 'a' },
			{ type: 'ground', x: 48, y: 0, style: 'grass', groupId: 'b' }
		];
		expect(mergeAdjacentSameStyleGroups(existing, 'a', 0, 32)).toEqual([
			{ type: 'ground', x: 16, y: 0, style: 'grass', groupId: 'a' },
			{ type: 'ground', x: 48, y: 0, style: 'grass', groupId: 'a' }
		]);
	});

	it('merges a touching same-style neighbor on the left after a restyle', () => {
		const existing: PlacedObject[] = [
			{ type: 'ground', x: 16, y: 0, style: 'grass', groupId: 'b' },
			{ type: 'ground', x: 48, y: 0, style: 'grass', groupId: 'a' }
		];
		expect(mergeAdjacentSameStyleGroups(existing, 'a', 0, 32)).toEqual([
			{ type: 'ground', x: 16, y: 0, style: 'grass', groupId: 'a' },
			{ type: 'ground', x: 48, y: 0, style: 'grass', groupId: 'a' }
		]);
	});

	it('merges neighbors on both sides at once', () => {
		const existing: PlacedObject[] = [
			{ type: 'ground', x: 16, y: 0, style: 'grass', groupId: 'left' },
			{ type: 'ground', x: 48, y: 0, style: 'grass', groupId: 'active' },
			{ type: 'ground', x: 80, y: 0, style: 'grass', groupId: 'right' }
		];
		expect(mergeAdjacentSameStyleGroups(existing, 'active', 0, 32)).toEqual([
			{ type: 'ground', x: 16, y: 0, style: 'grass', groupId: 'active' },
			{ type: 'ground', x: 48, y: 0, style: 'grass', groupId: 'active' },
			{ type: 'ground', x: 80, y: 0, style: 'grass', groupId: 'active' }
		]);
	});

	it('does not merge when the touching neighbor is a different style', () => {
		const existing: PlacedObject[] = [
			{ type: 'ground', x: 16, y: 0, style: 'grass', groupId: 'a' },
			{ type: 'ground', x: 48, y: 0, style: 'stone', groupId: 'b' }
		];
		expect(mergeAdjacentSameStyleGroups(existing, 'a', 0, 32)).toEqual(existing);
	});

	it('does nothing when there is no neighbor at all', () => {
		const existing: PlacedObject[] = [{ type: 'ground', x: 16, y: 0, style: 'grass', groupId: 'a' }];
		expect(mergeAdjacentSameStyleGroups(existing, 'a', 0, 32)).toEqual(existing);
	});

	it('checks the edges of a multi-tile group, not just one tile', () => {
		const existing: PlacedObject[] = [
			{ type: 'ground', x: 16, y: 0, style: 'grass', groupId: 'active' },
			{ type: 'ground', x: 48, y: 0, style: 'grass', groupId: 'active' },
			{ type: 'ground', x: 80, y: 0, style: 'grass', groupId: 'neighbor' }
		];
		expect(mergeAdjacentSameStyleGroups(existing, 'active', 0, 32)).toEqual([
			{ type: 'ground', x: 16, y: 0, style: 'grass', groupId: 'active' },
			{ type: 'ground', x: 48, y: 0, style: 'grass', groupId: 'active' },
			{ type: 'ground', x: 80, y: 0, style: 'grass', groupId: 'active' }
		]);
	});

	it('is unaffected by tiles on other rows', () => {
		const existing: PlacedObject[] = [
			{ type: 'ground', x: 16, y: 0, style: 'grass', groupId: 'a' },
			{ type: 'ground', x: 48, y: 32, style: 'grass', groupId: 'b' }
		];
		expect(mergeAdjacentSameStyleGroups(existing, 'a', 0, 32)).toEqual(existing);
	});

	it('returns the input unchanged when the group has no tiles on that row', () => {
		const existing: PlacedObject[] = [{ type: 'ground', x: 16, y: 0, style: 'grass', groupId: 'a' }];
		expect(mergeAdjacentSameStyleGroups(existing, 'nonexistent', 0, 32)).toEqual(existing);
	});
});