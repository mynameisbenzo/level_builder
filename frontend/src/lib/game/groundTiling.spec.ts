import { describe, expect, it } from 'vitest';
import {
	getFrameForPositionInRun,
	getRowTileFrames,
	groupIntoContiguousRuns,
	GROUND_TILE_FRAMES
} from './groundTiling';

describe('groupIntoContiguousRuns', () => {
	it('returns an empty array for no positions', () => {
		expect(groupIntoContiguousRuns([], 32)).toEqual([]);
	});

	it('groups adjacent positions into a single run', () => {
		expect(groupIntoContiguousRuns([16, 48, 80], 32)).toEqual([[16, 48, 80]]);
	});

	it('splits into separate runs when there is a gap', () => {
		expect(groupIntoContiguousRuns([16, 48, 144, 176], 32)).toEqual([
			[16, 48],
			[144, 176]
		]);
	});

	it('treats a single isolated position as its own run', () => {
		expect(groupIntoContiguousRuns([16], 32)).toEqual([[16]]);
	});
});

describe('getFrameForPositionInRun', () => {
	it('uses the single-block frame for a run of one', () => {
		expect(getFrameForPositionInRun([16], 16)).toBe(GROUND_TILE_FRAMES.single);
	});

	it('uses left/right end caps for a run of two, no center', () => {
		const run = [16, 48];
		expect(getFrameForPositionInRun(run, 16)).toBe(GROUND_TILE_FRAMES.left);
		expect(getFrameForPositionInRun(run, 48)).toBe(GROUND_TILE_FRAMES.right);
	});

	it('uses left/center/right for a run of three', () => {
		const run = [16, 48, 80];
		expect(getFrameForPositionInRun(run, 16)).toBe(GROUND_TILE_FRAMES.left);
		expect(getFrameForPositionInRun(run, 48)).toBe(GROUND_TILE_FRAMES.center);
		expect(getFrameForPositionInRun(run, 80)).toBe(GROUND_TILE_FRAMES.right);
	});

	it('uses center for every interior tile in a longer run', () => {
		const run = [16, 48, 80, 112, 144];
		expect(getFrameForPositionInRun(run, 48)).toBe(GROUND_TILE_FRAMES.center);
		expect(getFrameForPositionInRun(run, 80)).toBe(GROUND_TILE_FRAMES.center);
		expect(getFrameForPositionInRun(run, 112)).toBe(GROUND_TILE_FRAMES.center);
	});
});

describe('getRowTileFrames', () => {
	it('handles a single tile', () => {
		expect(getRowTileFrames([16], 32)).toEqual([{ x: 16, frame: GROUND_TILE_FRAMES.single }]);
	});

	it('handles two tiles', () => {
		expect(getRowTileFrames([48, 16], 32)).toEqual([
			{ x: 16, frame: GROUND_TILE_FRAMES.left },
			{ x: 48, frame: GROUND_TILE_FRAMES.right }
		]);
	});

	it('handles three or more tiles with center pieces in between', () => {
		expect(getRowTileFrames([80, 16, 48], 32)).toEqual([
			{ x: 16, frame: GROUND_TILE_FRAMES.left },
			{ x: 48, frame: GROUND_TILE_FRAMES.center },
			{ x: 80, frame: GROUND_TILE_FRAMES.right }
		]);
	});

	it('gives each side of a gap its own end caps', () => {
		expect(getRowTileFrames([16, 48, 144, 176], 32)).toEqual([
			{ x: 16, frame: GROUND_TILE_FRAMES.left },
			{ x: 48, frame: GROUND_TILE_FRAMES.right },
			{ x: 144, frame: GROUND_TILE_FRAMES.left },
			{ x: 176, frame: GROUND_TILE_FRAMES.right }
		]);
	});
});