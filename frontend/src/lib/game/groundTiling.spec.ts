import { describe, expect, it } from 'vitest';
import {
	getFrameForPositionInRun,
	getNextGroundTileStyle,
	getPreviousGroundTileStyle,
	getRowTileFrames,
	groupIntoContiguousRuns,
	GROUND_TILE_FRAME_SETS,
	GROUND_TILE_STYLES,
	type GroundTileStyle,
	type PositionedTile
} from './groundTiling';

describe('groupIntoContiguousRuns', () => {
	it('returns an empty array for no tiles', () => {
		expect(groupIntoContiguousRuns([], 32)).toEqual([]);
	});

	it('groups physically adjacent tiles from the same platform into one run', () => {
		const tiles: PositionedTile[] = [
			{ x: 16, style: 'grass', groupId: 'a' },
			{ x: 48, style: 'grass', groupId: 'a' },
			{ x: 80, style: 'grass', groupId: 'a' }
		];
		expect(groupIntoContiguousRuns(tiles, 32)).toEqual([tiles]);
	});

	it('splits into separate runs when there is a physical gap', () => {
		const tiles: PositionedTile[] = [
			{ x: 16, style: 'grass', groupId: 'a' },
			{ x: 48, style: 'grass', groupId: 'a' },
			{ x: 144, style: 'grass', groupId: 'a' },
			{ x: 176, style: 'grass', groupId: 'a' }
		];
		expect(groupIntoContiguousRuns(tiles, 32)).toEqual([
			[tiles[0], tiles[1]],
			[tiles[2], tiles[3]]
		]);
	});

	it('splits into separate runs when two physically touching tiles belong to different platforms', () => {
		const tiles: PositionedTile[] = [
			{ x: 16, style: 'grass', groupId: 'a' },
			{ x: 48, style: 'grass', groupId: 'a' },
			{ x: 80, style: 'stone', groupId: 'b' },
			{ x: 112, style: 'stone', groupId: 'b' }
		];
		expect(groupIntoContiguousRuns(tiles, 32)).toEqual([
			[tiles[0], tiles[1]],
			[tiles[2], tiles[3]]
		]);
	});

	it('treats a single isolated tile as its own run', () => {
		const tiles: PositionedTile[] = [{ x: 16, style: 'grass', groupId: 'a' }];
		expect(groupIntoContiguousRuns(tiles, 32)).toEqual([tiles]);
	});
});

describe('getFrameForPositionInRun', () => {
	const run = (xs: number[]): PositionedTile[] =>
		xs.map((x) => ({ x, style: 'grass', groupId: 'a' }));

	it('uses the single-block frame for a run of one', () => {
		expect(getFrameForPositionInRun(run([16]), 16, 'grass')).toBe(
			GROUND_TILE_FRAME_SETS.grass.single
		);
	});

	it('uses left/right end caps for a run of two, no center', () => {
		const tiles = run([16, 48]);
		expect(getFrameForPositionInRun(tiles, 16, 'grass')).toBe(GROUND_TILE_FRAME_SETS.grass.left);
		expect(getFrameForPositionInRun(tiles, 48, 'grass')).toBe(GROUND_TILE_FRAME_SETS.grass.right);
	});

	it('uses left/center/right for a run of three', () => {
		const tiles = run([16, 48, 80]);
		expect(getFrameForPositionInRun(tiles, 16, 'grass')).toBe(GROUND_TILE_FRAME_SETS.grass.left);
		expect(getFrameForPositionInRun(tiles, 48, 'grass')).toBe(GROUND_TILE_FRAME_SETS.grass.center);
		expect(getFrameForPositionInRun(tiles, 80, 'grass')).toBe(GROUND_TILE_FRAME_SETS.grass.right);
	});

	it('uses the correct frames for a non-default style', () => {
		const tiles = run([16, 48]);
		expect(getFrameForPositionInRun(tiles, 16, 'stone')).toBe(GROUND_TILE_FRAME_SETS.stone.left);
		expect(getFrameForPositionInRun(tiles, 48, 'stone')).toBe(GROUND_TILE_FRAME_SETS.stone.right);
	});
});

describe('getRowTileFrames', () => {
	it('handles a single tile', () => {
		expect(getRowTileFrames([{ x: 16, style: 'grass', groupId: 'a' }], 32)).toEqual([
			{ x: 16, frame: GROUND_TILE_FRAME_SETS.grass.single }
		]);
	});

	it('handles two tiles of the same platform', () => {
		expect(
			getRowTileFrames(
				[
					{ x: 48, style: 'grass', groupId: 'a' },
					{ x: 16, style: 'grass', groupId: 'a' }
				],
				32
			)
		).toEqual([
			{ x: 16, frame: GROUND_TILE_FRAME_SETS.grass.left },
			{ x: 48, frame: GROUND_TILE_FRAME_SETS.grass.right }
		]);
	});

	it('handles three or more tiles of the same platform with a center piece', () => {
		expect(
			getRowTileFrames(
				[
					{ x: 80, style: 'grass', groupId: 'a' },
					{ x: 16, style: 'grass', groupId: 'a' },
					{ x: 48, style: 'grass', groupId: 'a' }
				],
				32
			)
		).toEqual([
			{ x: 16, frame: GROUND_TILE_FRAME_SETS.grass.left },
			{ x: 48, frame: GROUND_TILE_FRAME_SETS.grass.center },
			{ x: 80, frame: GROUND_TILE_FRAME_SETS.grass.right }
		]);
	});

	it('gives each side of a physical gap its own end caps', () => {
		expect(
			getRowTileFrames(
				[
					{ x: 16, style: 'grass', groupId: 'a' },
					{ x: 48, style: 'grass', groupId: 'a' },
					{ x: 144, style: 'grass', groupId: 'a' },
					{ x: 176, style: 'grass', groupId: 'a' }
				],
				32
			)
		).toEqual([
			{ x: 16, frame: GROUND_TILE_FRAME_SETS.grass.left },
			{ x: 48, frame: GROUND_TILE_FRAME_SETS.grass.right },
			{ x: 144, frame: GROUND_TILE_FRAME_SETS.grass.left },
			{ x: 176, frame: GROUND_TILE_FRAME_SETS.grass.right }
		]);
	});

	it('gives two touching platforms (different groupIds) their own end caps, even with the same style', () => {
		expect(
			getRowTileFrames(
				[
					{ x: 16, style: 'grass', groupId: 'a' },
					{ x: 48, style: 'grass', groupId: 'a' },
					{ x: 80, style: 'grass', groupId: 'b' },
					{ x: 112, style: 'grass', groupId: 'b' }
				],
				32
			)
		).toEqual([
			{ x: 16, frame: GROUND_TILE_FRAME_SETS.grass.left },
			{ x: 48, frame: GROUND_TILE_FRAME_SETS.grass.right },
			{ x: 80, frame: GROUND_TILE_FRAME_SETS.grass.left },
			{ x: 112, frame: GROUND_TILE_FRAME_SETS.grass.right }
		]);
	});

	it('gives two touching platforms of different styles their own end caps', () => {
		expect(
			getRowTileFrames(
				[
					{ x: 16, style: 'grass', groupId: 'a' },
					{ x: 48, style: 'grass', groupId: 'a' },
					{ x: 80, style: 'stone', groupId: 'b' },
					{ x: 112, style: 'stone', groupId: 'b' }
				],
				32
			)
		).toEqual([
			{ x: 16, frame: GROUND_TILE_FRAME_SETS.grass.left },
			{ x: 48, frame: GROUND_TILE_FRAME_SETS.grass.right },
			{ x: 80, frame: GROUND_TILE_FRAME_SETS.stone.left },
			{ x: 112, frame: GROUND_TILE_FRAME_SETS.stone.right }
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