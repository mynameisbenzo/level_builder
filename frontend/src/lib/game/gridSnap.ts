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
 * Returns every grid-cell-center value between two already-snapped values
 * (inclusive, stepping by gridSize), along whichever axis the caller is
 * using it for - the math is identical whether the values represent x or
 * y. Used to fill in every cell a drag passed through: a fast drag can
 * skip cells between two consecutive pointermove events, so filling the
 * whole range (not just the endpoint) avoids gaps in a dragged line of
 * tiles, regardless of whether that line runs horizontally or vertically.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getFillRange(start: number, end: number, gridSize: number): number[] {
	const from = Math.min(start, end);
	const to = Math.max(start, end);
	const values: number[] = [];
	for (let value = from; value <= to; value += gridSize) {
		values.push(value);
	}
	return values;
}