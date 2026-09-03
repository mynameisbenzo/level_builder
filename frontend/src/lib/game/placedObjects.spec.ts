import { describe, expect, it } from 'vitest';
import { isPositionOccupied, removePosition, type PlacedObject } from './placedObjects';

describe('isPositionOccupied', () => {
	it('returns false for an empty list', () => {
		expect(isPositionOccupied([], 32, 32)).toBe(false);
	});

	it('returns true when a matching position exists', () => {
		const existing: PlacedObject[] = [{ type: 'ground', x: 32, y: 32 }];
		expect(isPositionOccupied(existing, 32, 32)).toBe(true);
	});

	it('returns false when positions are close but not exact', () => {
		const existing: PlacedObject[] = [{ type: 'ground', x: 32, y: 32 }];
		expect(isPositionOccupied(existing, 64, 32)).toBe(false);
	});

	it('checks against all entries, not just the first', () => {
		const existing: PlacedObject[] = [
			{ type: 'ground', x: 0, y: 0 },
			{ type: 'ground', x: 96, y: 96 }
		];
		expect(isPositionOccupied(existing, 96, 96)).toBe(true);
	});
});

describe('removePosition', () => {
	it('removes the matching object', () => {
		const existing: PlacedObject[] = [{ type: 'ground', x: 32, y: 32 }];
		expect(removePosition(existing, 32, 32)).toEqual([]);
	});

	it('returns an unchanged (but new) list when nothing matches', () => {
		const existing: PlacedObject[] = [{ type: 'ground', x: 32, y: 32 }];
		expect(removePosition(existing, 64, 64)).toEqual(existing);
	});

	it('only removes the exact match, keeping the rest', () => {
		const existing: PlacedObject[] = [
			{ type: 'ground', x: 0, y: 0 },
			{ type: 'ground', x: 96, y: 96 }
		];
		expect(removePosition(existing, 0, 0)).toEqual([{ type: 'ground', x: 96, y: 96 }]);
	});
});