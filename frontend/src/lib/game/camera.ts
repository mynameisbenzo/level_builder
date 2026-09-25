import type Phaser from 'phaser';

/**
 * The camera's viewport stays this size in both scenes - what changed is
 * how much of the (now larger) world that viewport can show at once, not
 * the viewport itself. Matches the game's configured width/height in
 * gameConfig.ts.
 */
export const VIEWPORT_WIDTH = 800;
export const VIEWPORT_HEIGHT = 600;

/**
 * The playable world is a grid of viewport-sized "screens" - originally
 * a fixed 2x2 (hence the older name "quadrant" for this whole system,
 * kept below since renaming it is a separate, cosmetic concern from
 * resizing it). Widened considerably to 30x3 so a level can actually
 * span a long, Mario-Maker-style horizontal stretch rather than being
 * boxed into four screens total.
 */
export const WORLD_COLUMNS = 30;
export const WORLD_ROWS = 3;
export const WORLD_WIDTH = VIEWPORT_WIDTH * WORLD_COLUMNS;
export const WORLD_HEIGHT = VIEWPORT_HEIGHT * WORLD_ROWS;

export const CAMERA_MODES = ['follow', 'quadrant'] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];
export const DEFAULT_CAMERA_MODE: CameraMode = 'follow';
export const CAMERA_MODE_REGISTRY_KEY = 'cameraMode';

/**
 * Returns the level's camera mode, defaulting to (and storing)
 * DEFAULT_CAMERA_MODE if none has been explicitly chosen yet - same
 * ensure-and-set pattern as the starting player color.
 */
export function ensureCameraMode(scene: Phaser.Scene): CameraMode {
	const stored = scene.registry.get(CAMERA_MODE_REGISTRY_KEY) as CameraMode | undefined;
	if (stored) {
		return stored;
	}

	scene.registry.set(CAMERA_MODE_REGISTRY_KEY, DEFAULT_CAMERA_MODE);
	return DEFAULT_CAMERA_MODE;
}

export function setCameraMode(scene: Phaser.Scene, mode: CameraMode) {
	scene.registry.set(CAMERA_MODE_REGISTRY_KEY, mode);
}

/**
 * Which screen (numbered left-to-right, top-to-bottom - 0 is top-left,
 * 1 is the one to its right, WORLD_COLUMNS is the start of the second
 * row, and so on) a world position falls into. Generalizes what used to
 * be a hardcoded 2x2 "quadrant" split into any WORLD_COLUMNS x
 * WORLD_ROWS grid, while preserving the original's exact boundary
 * behavior: a position exactly on a screen's left/top edge belongs to
 * that screen, not the previous one (Math.floor already gives this for
 * free - at x === VIEWPORT_WIDTH, x / VIEWPORT_WIDTH is exactly 1.0,
 * which floors to column 1, not 0).
 *
 * Clamped to the valid grid range - unlike the old hardcoded 0-or-1
 * ternary (which couldn't produce an out-of-range result no matter what
 * x/y were), a plain division can, if a position is ever transiently
 * outside world bounds (e.g. a single physics frame before the world's
 * own bounds clamp catches up).
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getQuadrantIndex(x: number, y: number): number {
	const col = Math.min(Math.max(Math.floor(x / VIEWPORT_WIDTH), 0), WORLD_COLUMNS - 1);
	const row = Math.min(Math.max(Math.floor(y / VIEWPORT_HEIGHT), 0), WORLD_ROWS - 1);
	return row * WORLD_COLUMNS + col;
}

/**
 * The center point of the given screen, in world coordinates - what the
 * camera centers on when snapped to that screen (see getQuadrantIndex
 * for the numbering). Inverse of getQuadrantIndex, generalized the same
 * way.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getQuadrantCenter(quadrantIndex: number): { x: number; y: number } {
	const col = quadrantIndex % WORLD_COLUMNS;
	const row = Math.floor(quadrantIndex / WORLD_COLUMNS);
	return {
		x: col * VIEWPORT_WIDTH + VIEWPORT_WIDTH / 2,
		y: row * VIEWPORT_HEIGHT + VIEWPORT_HEIGHT / 2
	};
}

/**
 * Edge-scroll velocity (px/sec, each axis) for the Editor's mouse-based
 * camera panning: nonzero only when the pointer is within
 * edgeThreshold of a viewport edge, in the direction of that edge. No
 * animation involved here (unlike the Play-mode quadrant snap) - this
 * is a continuous scroll for as long as the pointer stays near an edge,
 * applied directly each frame by the caller.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getEdgeScrollVelocity(
	pointerX: number,
	pointerY: number,
	viewportWidth: number,
	viewportHeight: number,
	edgeThreshold: number,
	scrollSpeed: number
): { x: number; y: number } {
	let x = 0;
	let y = 0;

	if (pointerX < edgeThreshold) {
		x = -scrollSpeed;
	} else if (pointerX > viewportWidth - edgeThreshold) {
		x = scrollSpeed;
	}

	if (pointerY < edgeThreshold) {
		y = -scrollSpeed;
	} else if (pointerY > viewportHeight - edgeThreshold) {
		y = scrollSpeed;
	}

	return { x, y };
}

/**
 * Clamps a camera's top-left scroll position so the viewport never shows
 * anything outside the world bounds - shared by both the Editor's
 * edge-scroll panning and Play mode's follow/quadrant modes, since both
 * need this same clamp for different reasons (the camera itself doesn't
 * apply it automatically when scrollX/scrollY are set directly, only
 * when using startFollow with bounds).
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function clampScroll(
	scrollX: number,
	scrollY: number,
	viewportWidth: number,
	viewportHeight: number
): { x: number; y: number } {
	return {
		x: Math.min(Math.max(scrollX, 0), WORLD_WIDTH - viewportWidth),
		y: Math.min(Math.max(scrollY, 0), WORLD_HEIGHT - viewportHeight)
	};
}