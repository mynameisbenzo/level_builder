import { describe, expect, it } from 'vitest';
import {
	determineOrientation,
	getGroupFrames,
	getNextGroundTileStyle,
	getPreviousGroundTileStyle,
	GROUND_TILE_FRAME_SETS,
	GROUND_TILE_STYLES,
	type GroundTileStyle,
	type PositionedTile
} from './groundTiling';

const tile = (x: number, y: number, style: GroundTileStyle = 'grass', groupId = 'a'): PositionedTile => ({
	x,
	y,
	style,
	groupId
});

describe('determineOrientation', () => {
	it('treats a single tile as horizontal (arbitrary - renders as single either way)', () => {
		expect(determineOrientation([tile(0, 0)])).toBe('horizontal');
	});

	it('detects horizontal when all tiles share a y', () => {
		expect(determineOrientation([tile(0, 0), tile(32, 0), tile(64, 0)])).toBe('horizontal');
	});

	it('detects vertical when all tiles share an x', () => {
		expect(determineOrientation([tile(0, 0), tile(0, 32), tile(0, 64)])).toBe('vertical');
	});
});

describe('getGroupFrames', () => {
	it('handles a single tile', () => {
		expect(getGroupFrames([tile(16, 0)], 32)).toEqual([
			{ x: 16, y: 0, frame: GROUND_TILE_FRAME_SETS.grass.single }
		]);
	});

	describe('horizontal groups', () => {
		it('assigns left/right end caps for a run of two', () => {
			expect(getGroupFrames([tile(48, 0), tile(16, 0)], 32)).toEqual([
				{ x: 16, y: 0, frame: GROUND_TILE_FRAME_SETS.grass.left },
				{ x: 48, y: 0, frame: GROUND_TILE_FRAME_SETS.grass.right }
			]);
		});

		it('assigns left/center/right for a run of three', () => {
			expect(getGroupFrames([tile(80, 0), tile(16, 0), tile(48, 0)], 32)).toEqual([
				{ x: 16, y: 0, frame: GROUND_TILE_FRAME_SETS.grass.left },
				{ x: 48, y: 0, frame: GROUND_TILE_FRAME_SETS.grass.center },
				{ x: 80, y: 0, frame: GROUND_TILE_FRAME_SETS.grass.right }
			]);
		});

		it('splits into separate runs across a physical gap within the group', () => {
			// Can happen after erasing a middle tile - the remainder is still
			// one groupId but no longer physically contiguous.
			expect(
				getGroupFrames([tile(16, 0), tile(48, 0), tile(144, 0), tile(176, 0)], 32)
			).toEqual([
				{ x: 16, y: 0, frame: GROUND_TILE_FRAME_SETS.grass.left },
				{ x: 48, y: 0, frame: GROUND_TILE_FRAME_SETS.grass.right },
				{ x: 144, y: 0, frame: GROUND_TILE_FRAME_SETS.grass.left },
				{ x: 176, y: 0, frame: GROUND_TILE_FRAME_SETS.grass.right }
			]);
		});

		it('uses each tile\'s own style for its frame', () => {
			expect(getGroupFrames([tile(16, 0, 'grass'), tile(48, 0, 'stone'), tile(80, 0, 'grass')], 32)).toEqual([
				{ x: 16, y: 0, frame: GROUND_TILE_FRAME_SETS.grass.left },
				{ x: 48, y: 0, frame: GROUND_TILE_FRAME_SETS.stone.center },
				{ x: 80, y: 0, frame: GROUND_TILE_FRAME_SETS.grass.right }
			]);
		});
	});

	describe('vertical groups', () => {
		it('assigns top/bottom end caps for a run of two', () => {
			expect(getGroupFrames([tile(0, 32), tile(0, 0)], 32)).toEqual([
				{ x: 0, y: 0, frame: GROUND_TILE_FRAME_SETS.grass.top },
				{ x: 0, y: 32, frame: GROUND_TILE_FRAME_SETS.grass.bottom }
			]);
		});

		it('assigns top/middle/bottom for a run of three', () => {
			expect(getGroupFrames([tile(0, 64), tile(0, 0), tile(0, 32)], 32)).toEqual([
				{ x: 0, y: 0, frame: GROUND_TILE_FRAME_SETS.grass.top },
				{ x: 0, y: 32, frame: GROUND_TILE_FRAME_SETS.grass.middle },
				{ x: 0, y: 64, frame: GROUND_TILE_FRAME_SETS.grass.bottom }
			]);
		});

		it('splits into separate runs across a physical gap within the group', () => {
			expect(
				getGroupFrames([tile(0, 0), tile(0, 32), tile(0, 128), tile(0, 160)], 32)
			).toEqual([
				{ x: 0, y: 0, frame: GROUND_TILE_FRAME_SETS.grass.top },
				{ x: 0, y: 32, frame: GROUND_TILE_FRAME_SETS.grass.bottom },
				{ x: 0, y: 128, frame: GROUND_TILE_FRAME_SETS.grass.top },
				{ x: 0, y: 160, frame: GROUND_TILE_FRAME_SETS.grass.bottom }
			]);
		});
	});
});

describe('GROUND_TILE_FRAME_SETS', () => {
	it('derives the expected frame names for a given style, including vertical', () => {
		expect(GROUND_TILE_FRAME_SETS.stone).toEqual({
			single: 'terrain_stone_block',
			left: 'terrain_stone_horizontal_left',
			right: 'terrain_stone_horizontal_right',
			center: 'terrain_stone_horizontal_middle',
			top: 'terrain_stone_vertical_top',
			middle: 'terrain_stone_vertical_middle',
			bottom: 'terrain_stone_vertical_bottom'
		});
	});

	it('has a complete frame set for every declared style', () => {
		for (const style of GROUND_TILE_STYLES) {
			expect(GROUND_TILE_FRAME_SETS[style]).toBeDefined();
			expect(GROUND_TILE_FRAME_SETS[style].top).toBeTruthy();
			expect(GROUND_TILE_FRAME_SETS[style].middle).toBeTruthy();
			expect(GROUND_TILE_FRAME_SETS[style].bottom).toBeTruthy();
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