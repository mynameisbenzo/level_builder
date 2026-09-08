import { describe, expect, it } from 'vitest';
import { getFillRange, snapToGrid } from './gridSnap';

describe('snapToGrid', () => {
	it('snaps a value near the start of a cell to that cell\'s center', () => {
		expect(snapToGrid(2, 32)).toBe(16);
	});

	it('snaps a value near the end of a cell to that cell\'s center', () => {
		expect(snapToGrid(30, 32)).toBe(16);
	});

	it('snaps a value exactly on a grid line to the cell it starts', () => {
		expect(snapToGrid(32, 32)).toBe(48);
	});

	it('snaps zero to the center of the first cell', () => {
		expect(snapToGrid(0, 32)).toBe(16);
	});

	it('snaps a value in the second cell correctly', () => {
		expect(snapToGrid(50, 32)).toBe(48);
	});

	it('works with a different grid size', () => {
		expect(snapToGrid(12, 16)).toBe(8);
		expect(snapToGrid(20, 16)).toBe(24);
	});
});

describe('getFillRange', () => {
	it('returns a single value when start and end are the same', () => {
		expect(getFillRange(48, 48, 32)).toEqual([48]);
	});

	it('returns every value between start and end, moving forward', () => {
		expect(getFillRange(16, 112, 32)).toEqual([16, 48, 80, 112]);
	});

	it('returns every value between start and end, moving backward', () => {
		expect(getFillRange(112, 16, 32)).toEqual([16, 48, 80, 112]);
	});

	it('returns adjacent values for a one-cell move', () => {
		expect(getFillRange(16, 48, 32)).toEqual([16, 48]);
	});

	it('works identically regardless of which axis the values represent', () => {
		// Same math either way - this is what lets one function serve both
		// horizontal (x) and vertical (y) drag fills.
		expect(getFillRange(0, 96, 32)).toEqual([0, 32, 64, 96]);
	});
});