import { describe, expect, it } from 'vitest';
import { snapToGrid } from './gridSnap';

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