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