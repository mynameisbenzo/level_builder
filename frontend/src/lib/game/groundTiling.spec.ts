import { describe, expect, it } from 'vitest';
import {
	getFrameForPositionInRun,
	getNextGroundTileStyle,
	getPreviousGroundTileStyle,
	getRowTileFrames,
	groupIntoContiguousRuns,
	GROUND_TILE_FRAME_SETS,
	GROUND_TILE_STYLES,
	type GroundTileStyle
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
		expect(getFrameForPositionInRun([16], 16, 'grass')).toBe(
			GROUND_TILE_FRAME_SETS.grass.single
		);
	});

	it('uses left/right end caps for a run of two, no center', () => {
		const run = [16, 48];
		expect(getFrameForPositionInRun(run, 16, 'grass')).toBe(GROUND_TILE_FRAME_SETS.grass.left);
		expect(getFrameForPositionInRun(run, 48, 'grass')).toBe(GROUND_TILE_FRAME_SETS.grass.right);
	});

	it('uses left/center/right for a run of three', () => {
		const run = [16, 48, 80];
		expect(getFrameForPositionInRun(run, 16, 'grass')).toBe(GROUND_TILE_FRAME_SETS.grass.left);
		expect(getFrameForPositionInRun(run, 48, 'grass')).toBe(GROUND_TILE_FRAME_SETS.grass.center);
		expect(getFrameForPositionInRun(run, 80, 'grass')).toBe(GROUND_TILE_FRAME_SETS.grass.right);
	});

	it('uses center for every interior tile in a longer run', () => {
		const run = [16, 48, 80, 112, 144];
		expect(getFrameForPositionInRun(run, 48, 'grass')).toBe(GROUND_TILE_FRAME_SETS.grass.center);
		expect(getFrameForPositionInRun(run, 80, 'grass')).toBe(GROUND_TILE_FRAME_SETS.grass.center);
		expect(getFrameForPositionInRun(run, 112, 'grass')).toBe(
			GROUND_TILE_FRAME_SETS.grass.center
		);
	});

	it('uses the correct frames for a non-default style', () => {
		const run = [16, 48];
		expect(getFrameForPositionInRun(run, 16, 'stone')).toBe(GROUND_TILE_FRAME_SETS.stone.left);
		expect(getFrameForPositionInRun(run, 48, 'stone')).toBe(GROUND_TILE_FRAME_SETS.stone.right);
	});
});

describe('getRowTileFrames', () => {
	it('handles a single tile', () => {
		expect(getRowTileFrames([16], 32, 'grass')).toEqual([
			{ x: 16, frame: GROUND_TILE_FRAME_SETS.grass.single }
		]);
	});

	it('handles two tiles', () => {
		expect(getRowTileFrames([48, 16], 32, 'grass')).toEqual([
			{ x: 16, frame: GROUND_TILE_FRAME_SETS.grass.left },
			{ x: 48, frame: GROUND_TILE_FRAME_SETS.grass.right }
		]);
	});

	it('handles three or more tiles with center pieces in between', () => {
		expect(getRowTileFrames([80, 16, 48], 32, 'grass')).toEqual([
			{ x: 16, frame: GROUND_TILE_FRAME_SETS.grass.left },
			{ x: 48, frame: GROUND_TILE_FRAME_SETS.grass.center },
			{ x: 80, frame: GROUND_TILE_FRAME_SETS.grass.right }
		]);
	});

	it('gives each side of a gap its own end caps', () => {
		expect(getRowTileFrames([16, 48, 144, 176], 32, 'grass')).toEqual([
			{ x: 16, frame: GROUND_TILE_FRAME_SETS.grass.left },
			{ x: 48, frame: GROUND_TILE_FRAME_SETS.grass.right },
			{ x: 144, frame: GROUND_TILE_FRAME_SETS.grass.left },
			{ x: 176, frame: GROUND_TILE_FRAME_SETS.grass.right }
		]);
	});
});

describe('GROUND_TILE_FRAME_SETS', () => {
	it('derives the expected frame names for a given style', () => {
		expect(GROUND_TILE_FRAME_SETS.stone).toEqual({
			single: 'terrain_stone_block',
			left: 'terrain_stone_horizontal_left',
			right: 'terrain_stone_horizontal_right',
			center: 'terrain_stone_horizontal_middle'
		});
	});

	it('has a complete frame set for every declared style', () => {
		for (const style of GROUND_TILE_STYLES) {
			expect(GROUND_TILE_FRAME_SETS[style]).toBeDefined();
		}
	});
});

describe('getNextGroundTileStyle', () => {
	it('cycles to the next style in order', () => {
		expect(getNextGroundTileStyle('grass')).toBe('dirt');
	});

	it('wraps back to the first style after the last', () => {
		const lastStyle = GROUND_TILE_STYLES[GROUND_TILE_STYLES.length - 1];
		expect(getNextGroundTileStyle(lastStyle)).toBe(GROUND_TILE_STYLES[0]);
	});

	it('cycles through every style exactly once before repeating', () => {
		let current: GroundTileStyle = GROUND_TILE_STYLES[0];
		const seen = new Set<string>([current]);
		for (let i = 1; i < GROUND_TILE_STYLES.length; i++) {
			current = getNextGroundTileStyle(current);
			seen.add(current);
		}
		expect(seen.size).toBe(GROUND_TILE_STYLES.length);
	});
});

describe('getPreviousGroundTileStyle', () => {
	it('cycles to the previous style in order', () => {
		expect(getPreviousGroundTileStyle('dirt')).toBe('grass');
	});

	it('wraps back to the last style before the first', () => {
		const lastStyle = GROUND_TILE_STYLES[GROUND_TILE_STYLES.length - 1];
		expect(getPreviousGroundTileStyle(GROUND_TILE_STYLES[0])).toBe(lastStyle);
	});

	it('is the exact inverse of getNextGroundTileStyle', () => {
		for (const style of GROUND_TILE_STYLES) {
			expect(getPreviousGroundTileStyle(getNextGroundTileStyle(style))).toBe(style);
		}
	});
});