/**
 * Whether two points are within a given distance of each other, using
 * simple circular (Euclidean) distance. Shared by any interaction that
 * doesn't use a Phaser physics body for its trigger zone (character-swap
 * objects, doors) - a lightweight distance check instead of an Arcade
 * overlap pair.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function isWithinRange(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	thresholdDistance: number
): boolean {
	const dx = x1 - x2;
	const dy = y1 - y2;
	return Math.sqrt(dx * dx + dy * dy) <= thresholdDistance;
}