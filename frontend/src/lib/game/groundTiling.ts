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
 * Groups a sorted list of grid-aligned x positions into contiguous runs -
 * a gap larger than one grid cell starts a new run. Each run gets its own
 * left/right end caps, so two separate platform segments on the same row
 * (with a gap between them) are visually distinct platforms, not one long
 * platform with a hole in it.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function groupIntoContiguousRuns(sortedXPositions: number[], gridSize: number): number[][] {
	if (sortedXPositions.length === 0) {
		return [];
	}

	const runs: number[][] = [[sortedXPositions[0]]];
	for (let i = 1; i < sortedXPositions.length; i++) {
		const previous = sortedXPositions[i - 1];
		const current = sortedXPositions[i];
		if (current - previous === gridSize) {
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
	run: number[],
	x: number,
	style: GroundTileStyle
): string {
	const frames = GROUND_TILE_FRAME_SETS[style];

	if (run.length === 1) {
		return frames.single;
	}

	const index = run.indexOf(x);
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
 * Computes the correct tile frame for every x position on a single row, in
 * the given style, accounting for gaps (separate platform segments) via
 * groupIntoContiguousRuns.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getRowTileFrames(
	xPositions: number[],
	gridSize: number,
	style: GroundTileStyle
): TileFrameAssignment[] {
	const sorted = [...xPositions].sort((a, b) => a - b);
	const runs = groupIntoContiguousRuns(sorted, gridSize);

	const assignments: TileFrameAssignment[] = [];
	for (const run of runs) {
		for (const x of run) {
			assignments.push({ x, frame: getFrameForPositionInRun(run, x, style) });
		}
	}
	return assignments;
}