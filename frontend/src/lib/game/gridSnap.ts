export const GRID_SIZE = 32;

/**
 * Snaps a raw coordinate to the center of whichever grid cell it falls
 * within - not to the nearest grid line intersection. This means a
 * gridSize-sized object dropped anywhere within a cell ends up centered
 * in that cell, rather than straddling a corner between four cells.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function snapToGrid(value: number, gridSize: number): number {
	return Math.floor(value / gridSize) * gridSize + gridSize / 2;
}

/**
 * Returns every grid-cell-center x value between two already-snapped x
 * values, inclusive, stepping by gridSize. Used to fill in every cell a
 * drag passed through - a fast drag can skip cells between two consecutive
 * pointermove events, so filling the whole range (not just the endpoint)
 * avoids gaps in a dragged line of tiles.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getColumnRange(startX: number, endX: number, gridSize: number): number[] {
	const from = Math.min(startX, endX);
	const to = Math.max(startX, endX);
	const columns: number[] = [];
	for (let x = from; x <= to; x += gridSize) {
		columns.push(x);
	}
	return columns;
}