import { describe, expect, it } from 'vitest';
import {
	getSwapResult,
	isWithinSwapRange,
	removeSwapObjectAt,
	type CharacterSwapObject
} from './characterSwapObjects';

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