import { describe, expect, it } from 'vitest';
import {
	getAvailableSwapColors,
	getSwapResult,
	isWithinSwapRange,
	MAX_CHARACTER_SWAP_OBJECTS,
	removeSwapObjectAt,
	type CharacterSwapObject
} from './characterSwapObjects';
import { PLAYER_COLORS } from './playerColor';

describe('getSwapResult', () => {
	it('gives the player the object\'s color', () => {
		expect(getSwapResult('beige', 'green').newPlayerColor).toBe('green');
	});

	it('leaves the object holding the player\'s old color', () => {
		expect(getSwapResult('beige', 'green').newObjectColor).toBe('beige');
	});

	it('handles swapping with the same color as a no-op result', () => {
		const result = getSwapResult('purple', 'purple');
		expect(result.newPlayerColor).toBe('purple');
		expect(result.newObjectColor).toBe('purple');
	});
});

describe('isWithinSwapRange', () => {
	it('is true when exactly on top of the object', () => {
		expect(isWithinSwapRange(100, 100, 100, 100, 24)).toBe(true);
	});

	it('is true when within the threshold distance', () => {
		expect(isWithinSwapRange(100, 100, 110, 100, 24)).toBe(true);
	});

	it('is false when beyond the threshold distance', () => {
		expect(isWithinSwapRange(100, 100, 200, 100, 24)).toBe(false);
	});

	it('is true exactly at the threshold boundary', () => {
		expect(isWithinSwapRange(0, 0, 24, 0, 24)).toBe(true);
	});

	it('measures true circular distance, not axis-aligned distance', () => {
		// 3-4-5 triangle: dx=18, dy=24 -> distance 30, outside a 24 threshold
		// even though each axis alone would be within it.
		expect(isWithinSwapRange(0, 0, 18, 24, 24)).toBe(false);
	});
});

const obj = (color: CharacterSwapObject['color']): CharacterSwapObject => ({ x: 0, y: 0, color });

describe('MAX_CHARACTER_SWAP_OBJECTS', () => {
	it('is one less than the total number of player colors', () => {
		expect(MAX_CHARACTER_SWAP_OBJECTS).toBe(PLAYER_COLORS.length - 1);
	});
});

describe('getAvailableSwapColors', () => {
	it('returns every color except the player\'s own when nothing is placed yet', () => {
		expect(getAvailableSwapColors([], 'beige')).toEqual(
			PLAYER_COLORS.filter((color) => color !== 'beige')
		);
	});

	it('excludes colors already used by a placed object', () => {
		const result = getAvailableSwapColors([obj('beige'), obj('green')], 'purple');
		expect(result).not.toContain('beige');
		expect(result).not.toContain('green');
		expect(result).toContain('pink');
	});

	it('excludes the player\'s own current color even if no object uses it yet', () => {
		const result = getAvailableSwapColors([], 'green');
		expect(result).not.toContain('green');
		expect(result).toHaveLength(PLAYER_COLORS.length - 1);
	});

	it('does not double-count if a placed object happens to share the player\'s color', () => {
		// Shouldn't normally happen (this same exclusion is what prevents
		// it), but the result should still just be a clean exclusion set,
		// not miscounted.
		const result = getAvailableSwapColors([obj('beige')], 'beige');
		expect(result).not.toContain('beige');
		expect(result).toHaveLength(PLAYER_COLORS.length - 1);
	});

	it('returns nothing once at the cap, even if a color is technically unused', () => {
		// 4 objects placed (the cap), one color (whichever 5th) never used -
		// still returns empty, since a 5th object would leave nothing for
		// the player to start as.
		const placed = PLAYER_COLORS.slice(0, MAX_CHARACTER_SWAP_OBJECTS).map((color) => obj(color));
		expect(getAvailableSwapColors(placed, PLAYER_COLORS[MAX_CHARACTER_SWAP_OBJECTS])).toEqual([]);
	});

	it('never returns any colors once at or past the cap', () => {
		for (let count = MAX_CHARACTER_SWAP_OBJECTS; count <= PLAYER_COLORS.length; count++) {
			const placed = PLAYER_COLORS.slice(0, count).map((color) => obj(color));
			expect(getAvailableSwapColors(placed, 'beige')).toEqual([]);
		}
	});
});

describe('removeSwapObjectAt', () => {
	it('removes the object at the exact position', () => {
		const existing: CharacterSwapObject[] = [{ x: 32, y: 32, color: 'beige' }];
		expect(removeSwapObjectAt(existing, 32, 32)).toEqual([]);
	});

	it('only removes the exact match, keeping the rest', () => {
		const existing: CharacterSwapObject[] = [
			{ x: 0, y: 0, color: 'green' },
			{ x: 96, y: 96, color: 'pink' }
		];
		expect(removeSwapObjectAt(existing, 0, 0)).toEqual([
			{ x: 96, y: 96, color: 'pink' }
		]);
	});

	it('returns an equivalent array unchanged when nothing matches', () => {
		const existing: CharacterSwapObject[] = [{ x: 32, y: 32, color: 'purple' }];
		expect(removeSwapObjectAt(existing, 64, 64)).toEqual(existing);
	});
});