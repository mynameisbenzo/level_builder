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
 * A "screen" (the playable world) is twice the viewport in each
 * dimension - exactly a 2x2 grid of four quadrants, each the same size
 * as the viewport itself.
 */
export const WORLD_WIDTH = VIEWPORT_WIDTH * 2;
export const WORLD_HEIGHT = VIEWPORT_HEIGHT * 2;

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
 * Which quadrant (0 = top-left, 1 = top-right, 2 = bottom-left,
 * 3 = bottom-right) a world position falls into.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getQuadrantIndex(x: number, y: number): number {
	const col = x < VIEWPORT_WIDTH ? 0 : 1;
	const row = y < VIEWPORT_HEIGHT ? 0 : 1;
	return row * 2 + col;
}

/**
 * The center point of the given quadrant, in world coordinates - what
 * the camera centers on when snapped to that quadrant (see
 * getQuadrantIndex for the numbering).
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getQuadrantCenter(quadrantIndex: number): { x: number; y: number } {
	const col = quadrantIndex % 2;
	const row = Math.floor(quadrantIndex / 2);
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