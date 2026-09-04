export const GROUND_TILE_STYLES = ['grass', 'dirt', 'sand', 'snow', 'stone', 'purple'] as const;
export type GroundTileStyle = (typeof GROUND_TILE_STYLES)[number];
export const GROUND_TILE_STYLE_REGISTRY_KEY = 'groundTileStyle';
export const DEFAULT_GROUND_TILE_STYLE: GroundTileStyle = 'grass';

export interface GroundTileFrameSet {
	single: string;
	left: string;
	right: string;
	center: string;
}

/**
 * Every style in the Kenney tileset follows the same naming convention, so
 * each style's frame set can be derived from its name rather than
 * hand-written four times per style.
 */
function buildFrameSet(style: GroundTileStyle): GroundTileFrameSet {
	return {
		single: `terrain_${style}_block`,
		left: `terrain_${style}_horizontal_left`,
		right: `terrain_${style}_horizontal_right`,
		center: `terrain_${style}_horizontal_middle`
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
	style: GroundTileStyle;
	groupId: string;
}

/**
 * Groups a sorted list of tiles into contiguous VISUAL runs - a run breaks
 * not only at a physical gap, but also whenever the platform (groupId)
 * changes between two physically adjacent tiles. Two platforms placed as
 * separate click-and-drag actions get their own end caps even when they
 * end up touching - physical adjacency alone no longer means "same
 * platform".
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function groupIntoContiguousRuns(
	sortedTiles: PositionedTile[],
	gridSize: number
): PositionedTile[][] {
	if (sortedTiles.length === 0) {
		return [];
	}

	const runs: PositionedTile[][] = [[sortedTiles[0]]];
	for (let i = 1; i < sortedTiles.length; i++) {
		const previous = sortedTiles[i - 1];
		const current = sortedTiles[i];
		const isPhysicallyAdjacent = current.x - previous.x === gridSize;
		const sameGroup = current.groupId === previous.groupId;
		if (isPhysicallyAdjacent && sameGroup) {
			runs[runs.length - 1].push(current);
		} else {
			runs.push([current]);
		}
	}
	return runs;
}

/**
 * Picks the correct tile frame for one x position within a single
 * contiguous run, in the given style: the only tile in a run of one gets
 * the plain block, the two ends of a longer run get the matching end-cap,
 * and everything between gets the center frame.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getFrameForPositionInRun(
	run: PositionedTile[],
	x: number,
	style: GroundTileStyle
): string {
	const frames = GROUND_TILE_FRAME_SETS[style];

	if (run.length === 1) {
		return frames.single;
	}

	const index = run.findIndex((tile) => tile.x === x);
	if (index === 0) {
		return frames.left;
	}
	if (index === run.length - 1) {
		return frames.right;
	}
	return frames.center;
}

export interface TileFrameAssignment {
	x: number;
	frame: string;
}

/**
 * Computes the correct tile frame for every tile on a single row,
 * accounting for both physical gaps AND platform (groupId) boundaries via
 * groupIntoContiguousRuns. Each tile's left/center/right/single ROLE is
 * determined by its position within its run; the actual frame drawn uses
 * that specific tile's own style.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getRowTileFrames(tiles: PositionedTile[], gridSize: number): TileFrameAssignment[] {
	const sortedTiles = [...tiles].sort((a, b) => a.x - b.x);
	const runs = groupIntoContiguousRuns(sortedTiles, gridSize);

	const assignments: TileFrameAssignment[] = [];
	for (const run of runs) {
		for (const tile of run) {
			assignments.push({ x: tile.x, frame: getFrameForPositionInRun(run, tile.x, tile.style) });
		}
	}
	return assignments;
}