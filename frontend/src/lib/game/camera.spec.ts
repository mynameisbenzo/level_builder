import { describe, expect, it } from 'vitest';
import {
	clampScroll,
	getEdgeScrollVelocity,
	getQuadrantCenter,
	getQuadrantIndex,
	VIEWPORT_HEIGHT,
	VIEWPORT_WIDTH,
	WORLD_HEIGHT,
	WORLD_WIDTH
} from './camera';

describe('world sizing', () => {
	it('is exactly twice the viewport in each dimension', () => {
		expect(WORLD_WIDTH).toBe(VIEWPORT_WIDTH * 2);
		expect(WORLD_HEIGHT).toBe(VIEWPORT_HEIGHT * 2);
	});
});

describe('getQuadrantIndex', () => {
	it('identifies the top-left quadrant', () => {
		expect(getQuadrantIndex(10, 10)).toBe(0);
	});

	it('identifies the top-right quadrant', () => {
		expect(getQuadrantIndex(VIEWPORT_WIDTH + 10, 10)).toBe(1);
	});

	it('identifies the bottom-left quadrant', () => {
		expect(getQuadrantIndex(10, VIEWPORT_HEIGHT + 10)).toBe(2);
	});

	it('identifies the bottom-right quadrant', () => {
		expect(getQuadrantIndex(VIEWPORT_WIDTH + 10, VIEWPORT_HEIGHT + 10)).toBe(3);
	});

	it('treats the exact boundary as belonging to the next quadrant', () => {
		expect(getQuadrantIndex(VIEWPORT_WIDTH, 10)).toBe(1);
		expect(getQuadrantIndex(10, VIEWPORT_HEIGHT)).toBe(2);
	});
});

describe('getQuadrantCenter', () => {
	it('centers the top-left quadrant correctly', () => {
		expect(getQuadrantCenter(0)).toEqual({ x: VIEWPORT_WIDTH / 2, y: VIEWPORT_HEIGHT / 2 });
	});

	it('centers the bottom-right quadrant correctly', () => {
		expect(getQuadrantCenter(3)).toEqual({
			x: VIEWPORT_WIDTH + VIEWPORT_WIDTH / 2,
			y: VIEWPORT_HEIGHT + VIEWPORT_HEIGHT / 2
		});
	});

	it('round-trips with getQuadrantIndex for every quadrant', () => {
		for (let index = 0; index < 4; index++) {
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
		expect(clampScroll(9999, 9999, VIEWPORT_WIDTH, VIEWPORT_HEIGHT)).toEqual({
			x: WORLD_WIDTH - VIEWPORT_WIDTH,
			y: WORLD_HEIGHT - VIEWPORT_HEIGHT
		});
	});
});