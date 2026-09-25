import { describe, expect, it } from 'vitest';
import {
	clampScroll,
	getEdgeScrollVelocity,
	getQuadrantCenter,
	getQuadrantIndex,
	VIEWPORT_HEIGHT,
	VIEWPORT_WIDTH,
	WORLD_COLUMNS,
	WORLD_HEIGHT,
	WORLD_ROWS,
	WORLD_WIDTH
} from './camera';

describe('world sizing', () => {
	it('is the viewport times the configured column/row count in each dimension', () => {
		expect(WORLD_WIDTH).toBe(VIEWPORT_WIDTH * WORLD_COLUMNS);
		expect(WORLD_HEIGHT).toBe(VIEWPORT_HEIGHT * WORLD_ROWS);
	});
});

describe('getQuadrantIndex', () => {
	it('identifies the top-left screen', () => {
		expect(getQuadrantIndex(10, 10)).toBe(0);
	});

	it('identifies the second screen in the top row', () => {
		expect(getQuadrantIndex(VIEWPORT_WIDTH + 10, 10)).toBe(1);
	});

	it('identifies the last screen in the top row', () => {
		expect(getQuadrantIndex(VIEWPORT_WIDTH * (WORLD_COLUMNS - 1) + 10, 10)).toBe(
			WORLD_COLUMNS - 1
		);
	});

	it('identifies the first screen in the second row', () => {
		expect(getQuadrantIndex(10, VIEWPORT_HEIGHT + 10)).toBe(WORLD_COLUMNS);
	});

	it('identifies the bottom-right screen (the last valid index)', () => {
		const lastCol = VIEWPORT_WIDTH * (WORLD_COLUMNS - 1) + 10;
		const lastRow = VIEWPORT_HEIGHT * (WORLD_ROWS - 1) + 10;
		expect(getQuadrantIndex(lastCol, lastRow)).toBe(WORLD_COLUMNS * WORLD_ROWS - 1);
	});

	it('treats the exact boundary as belonging to the next screen, not the previous one', () => {
		expect(getQuadrantIndex(VIEWPORT_WIDTH, 10)).toBe(1);
		expect(getQuadrantIndex(10, VIEWPORT_HEIGHT)).toBe(WORLD_COLUMNS);
	});

	it('clamps a negative position to the first column/row', () => {
		expect(getQuadrantIndex(-500, -500)).toBe(0);
	});

	it('clamps a position beyond the world bounds to the last column/row', () => {
		expect(getQuadrantIndex(WORLD_WIDTH + 5000, WORLD_HEIGHT + 5000)).toBe(
			WORLD_COLUMNS * WORLD_ROWS - 1
		);
	});
});

describe('getQuadrantCenter', () => {
	it('centers the top-left screen correctly', () => {
		expect(getQuadrantCenter(0)).toEqual({ x: VIEWPORT_WIDTH / 2, y: VIEWPORT_HEIGHT / 2 });
	});

	it('centers the last screen in the top row correctly', () => {
		expect(getQuadrantCenter(WORLD_COLUMNS - 1)).toEqual({
			x: VIEWPORT_WIDTH * (WORLD_COLUMNS - 1) + VIEWPORT_WIDTH / 2,
			y: VIEWPORT_HEIGHT / 2
		});
	});

	it('centers the first screen in the second row correctly', () => {
		expect(getQuadrantCenter(WORLD_COLUMNS)).toEqual({
			x: VIEWPORT_WIDTH / 2,
			y: VIEWPORT_HEIGHT + VIEWPORT_HEIGHT / 2
		});
	});

	it('round-trips with getQuadrantIndex for every screen in the grid', () => {
		for (let index = 0; index < WORLD_COLUMNS * WORLD_ROWS; index++) {
			const center = getQuadrantCenter(index);
			expect(getQuadrantIndex(center.x, center.y)).toBe(index);
		}
	});
});

describe('getEdgeScrollVelocity', () => {
	const threshold = 50;
	const speed = 300;

	it('is zero when the pointer is away from every edge', () => {
		expect(getEdgeScrollVelocity(400, 300, 800, 600, threshold, speed)).toEqual({ x: 0, y: 0 });
	});

	it('scrolls left when the pointer is near the left edge', () => {
		expect(getEdgeScrollVelocity(10, 300, 800, 600, threshold, speed)).toEqual({
			x: -speed,
			y: 0
		});
	});

	it('scrolls right when the pointer is near the right edge', () => {
		expect(getEdgeScrollVelocity(790, 300, 800, 600, threshold, speed)).toEqual({
			x: speed,
			y: 0
		});
	});

	it('scrolls up when the pointer is near the top edge', () => {
		expect(getEdgeScrollVelocity(400, 5, 800, 600, threshold, speed)).toEqual({ x: 0, y: -speed });
	});

	it('scrolls down when the pointer is near the bottom edge', () => {
		expect(getEdgeScrollVelocity(400, 595, 800, 600, threshold, speed)).toEqual({
			x: 0,
			y: speed
		});
	});

	it('scrolls diagonally in a corner', () => {
		expect(getEdgeScrollVelocity(5, 5, 800, 600, threshold, speed)).toEqual({
			x: -speed,
			y: -speed
		});
	});
});

describe('clampScroll', () => {
	it('leaves an in-bounds scroll position unchanged', () => {
		expect(clampScroll(400, 300, VIEWPORT_WIDTH, VIEWPORT_HEIGHT)).toEqual({ x: 400, y: 300 });
	});

	it('clamps a negative scroll position to zero', () => {
		expect(clampScroll(-50, -20, VIEWPORT_WIDTH, VIEWPORT_HEIGHT)).toEqual({ x: 0, y: 0 });
	});

	it('clamps a scroll position past the world edge', () => {
		expect(clampScroll(999999, 999999, VIEWPORT_WIDTH, VIEWPORT_HEIGHT)).toEqual({
			x: WORLD_WIDTH - VIEWPORT_WIDTH,
			y: WORLD_HEIGHT - VIEWPORT_HEIGHT
		});
	});
});