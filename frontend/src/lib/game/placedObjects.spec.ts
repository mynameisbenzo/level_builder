import { describe, expect, it } from 'vitest';
import {
	bridgeIfBetweenTwoGroups,
	getNextActiveGroupKeys,
	getSameGroupTileKeys,
	isPositionOccupied,
	mergeAdjacentSameStyleGroups,
	mergeGroupIds,
	removePosition,
	resolveGroupIdForPlacement,
	tileKey,
	updateObjectStyle,
	type PlacedObject
} from './placedObjects';

const obj = (
	x: number,
	y: number,
	style: 'grass' | 'stone' = 'grass',
	groupId = 'a'
): PlacedObject => ({ type: 'ground', x, y, style, groupId });

describe('isPositionOccupied', () => {
	it('returns false for an empty list', () => {
		expect(isPositionOccupied([], 32, 32)).toBe(false);
	});

	it('returns true when a matching position exists', () => {
		expect(isPositionOccupied([obj(32, 32)], 32, 32)).toBe(true);
	});

	it('returns false when positions are close but not exact', () => {
		expect(isPositionOccupied([obj(32, 32)], 64, 32)).toBe(false);
	});
});

describe('removePosition', () => {
	it('removes the matching object', () => {
		expect(removePosition([obj(32, 32)], 32, 32)).toEqual([]);
	});

	it('only removes the exact match, keeping the rest', () => {
		const existing = [obj(0, 0), obj(96, 96)];
		expect(removePosition(existing, 0, 0)).toEqual([obj(96, 96)]);
	});
});

describe('updateObjectStyle', () => {
	it("changes only the matching object's style, preserving its groupId", () => {
		const existing = [obj(0, 0, 'grass', 'a'), obj(32, 0, 'grass', 'a')];
		expect(updateObjectStyle(existing, 0, 0, 'stone')).toEqual([
			obj(0, 0, 'stone', 'a'),
			obj(32, 0, 'grass', 'a')
		]);
	});
});

describe('tileKey', () => {
	it('formats a consistent key from x and y', () => {
		expect(tileKey(32, 64)).toBe('32,64');
	});
});

describe('getSameGroupTileKeys', () => {
	it('returns only the tiles sharing the given groupId', () => {
		const objects = [obj(16, 0, 'grass', 'a'), obj(48, 0, 'grass', 'a'), obj(80, 0, 'stone', 'b')];
		expect(getSameGroupTileKeys(objects, 'a')).toEqual(['16,0', '48,0']);
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

describe('resolveGroupIdForPlacement - horizontal', () => {
	it('falls back to a fresh id when there are no neighbors', () => {
		expect(resolveGroupIdForPlacement([], 16, 0, 'horizontal', 'grass', 32, 'fresh')).toBe('fresh');
	});

	it('joins the left neighbor when it exists, matches style, and is horizontal', () => {
		const existing = [obj(16, 0, 'grass', 'a')];
		expect(resolveGroupIdForPlacement(existing, 48, 0, 'horizontal', 'grass', 32, 'fresh')).toBe('a');
	});

	it('does not join the left neighbor when styles differ', () => {
		const existing = [obj(16, 0, 'stone', 'a')];
		expect(resolveGroupIdForPlacement(existing, 48, 0, 'horizontal', 'grass', 32, 'fresh')).toBe(
			'fresh'
		);
	});

	it('joins the right neighbor when the left one does not match', () => {
		const existing = [obj(48, 0, 'grass', 'b')];
		expect(resolveGroupIdForPlacement(existing, 16, 0, 'horizontal', 'grass', 32, 'fresh')).toBe('b');
	});
});

describe('resolveGroupIdForPlacement - vertical', () => {
	it('joins the neighbor above when it exists, matches style, and is vertical', () => {
		const existing = [obj(0, 0, 'grass', 'a')];
		expect(resolveGroupIdForPlacement(existing, 0, 32, 'vertical', 'grass', 32, 'fresh')).toBe('a');
	});

	it('joins the neighbor below when the one above does not match', () => {
		const existing = [obj(0, 64, 'grass', 'b')];
		expect(resolveGroupIdForPlacement(existing, 0, 32, 'vertical', 'grass', 32, 'fresh')).toBe('b');
	});

	it('a horizontal neighbor at the same x/y-adjacent spot is ignored for vertical placement', () => {
		// A tile sitting where a vertical neighbor would be, but which
		// belongs to a >1-tile HORIZONTAL group, must not be joined by a
		// vertical placement - orientations never mix.
		const existing = [obj(0, 0, 'grass', 'h'), obj(32, 0, 'grass', 'h')];
		expect(resolveGroupIdForPlacement(existing, 0, 32, 'vertical', 'grass', 32, 'fresh')).toBe(
			'fresh'
		);
	});
});

describe('resolveGroupIdForPlacement - orientation compatibility', () => {
	it('does not join a same-style neighbor whose own group is a different, established orientation', () => {
		// "below" exists and matches style, but its group ('v') is already a
		// 2-tile VERTICAL run - a horizontal placement must not join it.
		const existing = [obj(0, 32, 'grass', 'v'), obj(0, 64, 'grass', 'v')];
		expect(resolveGroupIdForPlacement(existing, 32, 32, 'horizontal', 'grass', 32, 'fresh')).toBe(
			'fresh'
		);
	});

	it('does join a same-style neighbor that is still a single-tile (orientation-less) group', () => {
		const existing = [obj(0, 32, 'grass', 'solo')];
		expect(resolveGroupIdForPlacement(existing, 32, 32, 'horizontal', 'grass', 32, 'fresh')).toBe(
			'solo'
		);
	});
});

describe('mergeGroupIds', () => {
	it('reassigns every object with the old groupId to the new one', () => {
		const existing = [obj(16, 0, 'grass', 'b'), obj(48, 0, 'grass', 'a'), obj(80, 0, 'grass', 'b')];
		expect(mergeGroupIds(existing, 'b', 'a')).toEqual([
			obj(16, 0, 'grass', 'a'),
			obj(48, 0, 'grass', 'a'),
			obj(80, 0, 'grass', 'a')
		]);
	});

	it('is a no-op when the two ids are already the same', () => {
		const existing = [obj(16, 0, 'grass', 'a')];
		expect(mergeGroupIds(existing, 'a', 'a')).toEqual(existing);
	});
});

describe('bridgeIfBetweenTwoGroups', () => {
	it('merges two horizontal neighbors the new tile sits between', () => {
		const updated = [obj(16, 0, 'grass', 'left'), obj(48, 0, 'grass', 'mid'), obj(80, 0, 'grass', 'right')];
		const result = bridgeIfBetweenTwoGroups(updated, 48, 0, 'horizontal', 'grass', 32, 'mid');
		const groupIds = new Set(result.map((o) => o.groupId));
		expect(groupIds.size).toBe(1);
	});

	it('merges two vertical neighbors the new tile sits between', () => {
		const updated = [obj(0, 16, 'grass', 'top'), obj(0, 48, 'grass', 'mid'), obj(0, 80, 'grass', 'bottom')];
		const result = bridgeIfBetweenTwoGroups(updated, 0, 48, 'vertical', 'grass', 32, 'mid');
		const groupIds = new Set(result.map((o) => o.groupId));
		expect(groupIds.size).toBe(1);
	});

	it('does not bridge when only one side has a neighbor', () => {
		const updated = [obj(16, 0, 'grass', 'left'), obj(48, 0, 'grass', 'mid')];
		const result = bridgeIfBetweenTwoGroups(updated, 48, 0, 'horizontal', 'grass', 32, 'mid');
		expect(result).toEqual(updated);
	});

	it('does not bridge across an orientation mismatch', () => {
		// "before" is part of an established vertical group; a horizontal
		// bridge attempt must not merge it in.
		const updated = [
			obj(-32, 0, 'grass', 'before-vertical'),
			obj(-32, 32, 'grass', 'before-vertical'),
			obj(0, 0, 'grass', 'mid'),
			obj(32, 0, 'grass', 'after')
		];
		const result = bridgeIfBetweenTwoGroups(updated, 0, 0, 'horizontal', 'grass', 32, 'mid');
		const beforeGroupStillIntact = result.filter((o) => o.groupId === 'before-vertical');
		expect(beforeGroupStillIntact).toHaveLength(2);
	});
});

describe('mergeAdjacentSameStyleGroups', () => {
	it('merges a touching same-style horizontal neighbor after a restyle', () => {
		const existing = [obj(16, 0, 'grass', 'a'), obj(48, 0, 'grass', 'b')];
		expect(mergeAdjacentSameStyleGroups(existing, 'a', 32)).toEqual([
			obj(16, 0, 'grass', 'a'),
			obj(48, 0, 'grass', 'a')
		]);
	});

	it('merges a touching same-style vertical neighbor after a restyle', () => {
		const existing = [obj(0, 0, 'grass', 'a'), obj(0, 32, 'grass', 'b')];
		expect(mergeAdjacentSameStyleGroups(existing, 'a', 32)).toEqual([
			obj(0, 0, 'grass', 'a'),
			obj(0, 32, 'grass', 'a')
		]);
	});

	it('checks both ends of a multi-tile group, not just one tile', () => {
		const existing = [
			obj(16, 0, 'grass', 'active'),
			obj(48, 0, 'grass', 'active'),
			obj(80, 0, 'grass', 'neighbor')
		];
		const result = mergeAdjacentSameStyleGroups(existing, 'active', 32);
		const groupIds = new Set(result.map((o) => o.groupId));
		expect(groupIds.size).toBe(1);
	});

	it('does not merge across an orientation mismatch', () => {
		const existing = [
			obj(16, 0, 'grass', 'horiz'),
			obj(48, 0, 'grass', 'horiz'),
			obj(80, 0, 'grass', 'vert-a'),
			obj(80, 32, 'grass', 'vert-a')
		];
		const result = mergeAdjacentSameStyleGroups(existing, 'horiz', 32);
		const vertStillIntact = result.filter((o) => o.groupId === 'vert-a');
		expect(vertStillIntact).toHaveLength(2);
	});

	it('returns the input unchanged when the group has no tiles', () => {
		const existing = [obj(16, 0, 'grass', 'a')];
		expect(mergeAdjacentSameStyleGroups(existing, 'nonexistent', 32)).toEqual(existing);
	});
});