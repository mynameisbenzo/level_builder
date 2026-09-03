export const GROUND_TILE_FRAMES = {
	single: 'terrain_grass_block',
	left: 'terrain_grass_horizontal_left',
	right: 'terrain_grass_horizontal_right',
	center: 'terrain_grass_horizontal_middle'
} as const;

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
 * contiguous run: the only tile in a run of one gets the plain block, the
 * two ends of a longer run get the matching end-cap, and everything
 * between gets the center frame.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getFrameForPositionInRun(run: number[], x: number): string {
	if (run.length === 1) {
		return GROUND_TILE_FRAMES.single;
	}

	const index = run.indexOf(x);
	if (index === 0) {
		return GROUND_TILE_FRAMES.left;
	}
	if (index === run.length - 1) {
		return GROUND_TILE_FRAMES.right;
	}
	return GROUND_TILE_FRAMES.center;
}

export interface TileFrameAssignment {
	x: number;
	frame: string;
}

/**
 * Computes the correct tile frame for every x position on a single row,
 * accounting for gaps (separate platform segments) via
 * groupIntoContiguousRuns.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getRowTileFrames(xPositions: number[], gridSize: number): TileFrameAssignment[] {
	const sorted = [...xPositions].sort((a, b) => a - b);
	const runs = groupIntoContiguousRuns(sorted, gridSize);

	const assignments: TileFrameAssignment[] = [];
	for (const run of runs) {
		for (const x of run) {
			assignments.push({ x, frame: getFrameForPositionInRun(run, x) });
		}
	}
	return assignments;
}