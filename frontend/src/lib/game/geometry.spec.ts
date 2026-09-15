import { describe, expect, it } from 'vitest';
import { isWithinRange } from './geometry';

describe('isWithinRange', () => {
	it('is true when exactly on top of the target', () => {
		expect(isWithinRange(100, 100, 100, 100, 24)).toBe(true);
	});

	it('is true when within the threshold distance', () => {
		expect(isWithinRange(100, 100, 110, 100, 24)).toBe(true);
	});

	it('is false when beyond the threshold distance', () => {
		expect(isWithinRange(100, 100, 200, 100, 24)).toBe(false);
	});

	it('is true exactly at the threshold boundary', () => {
		expect(isWithinRange(0, 0, 24, 0, 24)).toBe(true);
	});

	it('measures true circular distance, not axis-aligned distance', () => {
		expect(isWithinRange(0, 0, 18, 24, 24)).toBe(false);
	});
});