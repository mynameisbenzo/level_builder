import { describe, expect, it } from 'vitest';
import { getSwapResult, isWithinSwapRange } from './characterSwapObjects';

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
		expect(isWithinSwapRange(0, 0, 18, 24, 24)).toBe(false);
	});
});