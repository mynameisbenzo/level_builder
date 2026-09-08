export const GROUND_TILE_STYLES = ['grass', 'dirt', 'sand', 'snow', 'stone', 'purple'] as const;
export type GroundTileStyle = (typeof GROUND_TILE_STYLES)[number];
export const GROUND_TILE_STYLE_REGISTRY_KEY = 'groundTileStyle';
export const DEFAULT_GROUND_TILE_STYLE: GroundTileStyle = 'grass';

export type PlatformOrientation = 'horizontal' | 'vertical';

export interface GroundTileFrameSet {
	single: string;
	left: string;
	right: string;
	center: string;
	top: string;
	middle: string;
	bottom: string;
}

/**
 * Every style in the Kenney tileset follows the same naming convention, so
 * each style's frame set can be derived from its name rather than
 * hand-written seven times per style.
 */
function buildFrameSet(style: GroundTileStyle): GroundTileFrameSet {
	return {
		single: `terrain_${style}_block`,
		left: `terrain_${style}_horizontal_left`,
		right: `terrain_${style}_horizontal_right`,
		center: `terrain_${style}_horizontal_middle`,
		top: `terrain_${style}_vertical_top`,
		middle: `terrain_${style}_vertical_middle`,
		bottom: `terrain_${style}_vertical_bottom`
	};
}

export const GROUND_TILE_FRAME_SETS: Record<GroundTileStyle, GroundTileFrameSet> = Object.fromEntries(
	GROUND_TILE_STYLES.map((style) => [style, buildFrameSet(style)])
) as Record<GroundTileStyle, GroundTileFrameSet>;

/**
 * Returns the next style in the cycle, wrapping back to the first after
 * the last.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getNextGroundTileStyle(current: GroundTileStyle): GroundTileStyle {
	const index = GROUND_TILE_STYLES.indexOf(current);
	const nextIndex = (index + 1) % GROUND_TILE_STYLES.length;
	return GROUND_TILE_STYLES[nextIndex];
}

/**
 * Returns the previous style in the cycle, wrapping around to the last
 * after the first.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getPreviousGroundTileStyle(current: GroundTileStyle): GroundTileStyle {
	const index = GROUND_TILE_STYLES.indexOf(current);
	const previousIndex = (index - 1 + GROUND_TILE_STYLES.length) % GROUND_TILE_STYLES.length;
	return GROUND_TILE_STYLES[previousIndex];
}

export interface PositionedTile {
	x: number;
	y: number;
	style: GroundTileStyle;
	groupId: string;
}

/**
 * Determines whether a group of tiles runs horizontally (all share a y,
 * differing x) or vertically (all share an x, differing y). A group is
 * only ever formed one way or the other by construction (see
 * resolveGroupIdForPlacement), so this just reads that back out of the
 * tiles' actual positions rather than needing it stored separately. A
 * single tile is arbitrarily called horizontal - it renders as "single"
 * either way, so it doesn't matter.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function determineOrientation(tiles: PositionedTile[]): PlatformOrientation {
	if (tiles.length <= 1) {
		return 'horizontal';
	}
	const firstY = tiles[0].y;
	const allSameY = tiles.every((tile) => tile.y === firstY);
	return allSameY ? 'horizontal' : 'vertical';
}

export interface TileFrameAssignment {
	x: number;
	y: number;
	frame: string;
}

/**
 * Computes the correct tile frame for every tile in a single platform
 * (group), using whichever axis the group actually runs along. Even
 * within one group, a physical gap (e.g. from erasing a middle tile)
 * gets its own end caps on each side rather than being rendered as one
 * continuous run - groups are contiguous by construction when placed,
 * but erasure can break that after the fact.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getGroupFrames(tiles: PositionedTile[], gridSize: number): TileFrameAssignment[] {
	if (tiles.length === 0) {
		return [];
	}

	const orientation = determineOrientation(tiles);
	const sorted =
		orientation === 'horizontal'
			? [...tiles].sort((a, b) => a.x - b.x)
			: [...tiles].sort((a, b) => a.y - b.y);

	const runs: PositionedTile[][] = [[sorted[0]]];
	for (let i = 1; i < sorted.length; i++) {
		const previous = sorted[i - 1];
		const current = sorted[i];
		const delta = orientation === 'horizontal' ? current.x - previous.x : current.y - previous.y;
		if (delta === gridSize) {
			runs[runs.length - 1].push(current);
		} else {
			runs.push([current]);
		}
	}

	const assignments: TileFrameAssignment[] = [];
	for (const run of runs) {
		for (let i = 0; i < run.length; i++) {
			const tile = run[i];
			const frames = GROUND_TILE_FRAME_SETS[tile.style];
			let frame: string;
			if (run.length === 1) {
				frame = frames.single;
			} else if (i === 0) {
				frame = orientation === 'horizontal' ? frames.left : frames.top;
			} else if (i === run.length - 1) {
				frame = orientation === 'horizontal' ? frames.right : frames.bottom;
			} else {
				frame = orientation === 'horizontal' ? frames.center : frames.middle;
			}
			assignments.push({ x: tile.x, y: tile.y, frame });
		}
	}
	return assignments;
}