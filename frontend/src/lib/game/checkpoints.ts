import { isWithinRange } from './geometry';
import type { RecordedRun } from './ghost';
import { PLAYER_COLORS, type PlayerColor } from './playerColor';

/**
 * Checkpoints: at most one per level (the backend's validate_level_content
 * enforces the same limit), available to every account type. Once the
 * player touches it, dying respawns them here instead of at the level's
 * start - with the same keys, character color and swap objects they had
 * the moment they touched it.
 *
 * This file is the pure, Phaser-free half: placement rules, the touch
 * check, and the runtime state that has to survive a respawn.
 */

export interface CheckpointObject {
	x: number;
	y: number;
}

/** The level's design data: a list holding zero or one checkpoint. */
export const CHECKPOINT_OBJECTS_REGISTRY_KEY = 'checkpointObjects';

/** Runtime-only: the state captured when the checkpoint was touched. Its presence means "reached". */
export const CHECKPOINT_STATE_REGISTRY_KEY = 'checkpointState';

/** Runtime-only: the finished spawn-to-checkpoint stretch, kept for the ghost submission at the finish. */
export const CHECKPOINT_BEFORE_RUN_REGISTRY_KEY = 'checkpointBeforeRun';

export const MAX_CHECKPOINTS = 1;

/**
 * A respawn drops the player in this far above the flag's cell center, so
 * they land on the floor instead of starting with their feet already inside
 * it (the floor tile just below a flag would otherwise swallow them).
 */
export const CHECKPOINT_RESPAWN_LIFT_PX = 16;

/** How close the player has to be to the flag to touch it. */
export const CHECKPOINT_TOUCH_DISTANCE = 28;

export const CHECKPOINT_INACTIVE_FRAME = 'flag_off';
export const CHECKPOINT_ACTIVE_FRAMES = ['flag_green_a', 'flag_green_b'] as const;
export const CHECKPOINT_ANIMATION_INTERVAL_MS = 250;

export interface KeyPosition {
	x: number;
	y: number;
}

/**
 * Everything a respawn has to put back the way it was at the moment the
 * checkpoint was touched. Keys collected afterwards come back (they're
 * ahead of the checkpoint), and so do swap objects used afterwards.
 */
export interface CheckpointState {
	playerColor: PlayerColor;
	/** Positions of the keys already held, in the order they were collected. */
	collectedKeys: KeyPosition[];
	/** Each character-swap object's current color, in placement order. */
	swapObjectColors: PlayerColor[];
}

/** What an endless run carries across the new game it boots after each death. */
export interface CheckpointCarry {
	state: CheckpointState;
	beforeRun: RecordedRun | null;
}

/** The slice of Phaser's registry (a DataManager) this file needs, so it can be tested without Phaser. */
export interface RegistryLike {
	get(key: string): unknown;
	set(key: string, value: unknown): unknown;
	remove(key: string): unknown;
}

/**
 * Whether a checkpoint can be placed at the given cell - it just needs the
 * cell free of every other kind of placed content. Takes the occupied
 * positions as a flat set of "x,y" keys, same pattern as canPlaceKeyAt.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function canPlaceCheckpointAt(
	x: number,
	y: number,
	occupiedPositionKeys: ReadonlySet<string>
): boolean {
	return !occupiedPositionKeys.has(`${x},${y}`);
}

/**
 * The checkpoint list after placing one at (x, y). A level only ever has
 * one, so placing again moves it rather than adding a second.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function placeCheckpoint(x: number, y: number): CheckpointObject[] {
	return [{ x, y }];
}

/**
 * Removes the checkpoint at the exact given position, if there is one.
 * Returns a new array either way (unchanged if nothing matched).
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function removeCheckpointAt(
	checkpoints: CheckpointObject[],
	x: number,
	y: number
): CheckpointObject[] {
	return checkpoints.filter((checkpoint) => !(checkpoint.x === x && checkpoint.y === y));
}

/**
 * Whether the player is close enough to the checkpoint to touch it. Same
 * distance-check approach as keys, swap objects and doors.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function isNearCheckpoint(
	playerX: number,
	playerY: number,
	checkpoint: CheckpointObject,
	thresholdDistance: number = CHECKPOINT_TOUCH_DISTANCE
): boolean {
	return isWithinRange(playerX, playerY, checkpoint.x, checkpoint.y, thresholdDistance);
}

function isPlayerColor(value: unknown): value is PlayerColor {
	return typeof value === 'string' && (PLAYER_COLORS as readonly string[]).includes(value);
}

function isKeyPosition(value: unknown): value is KeyPosition {
	const candidate = value as KeyPosition | null;
	return (
		typeof candidate === 'object' &&
		candidate !== null &&
		typeof candidate.x === 'number' &&
		typeof candidate.y === 'number'
	);
}

/** Runtime check for a registry value, since the registry itself is untyped. */
export function isCheckpointState(value: unknown): value is CheckpointState {
	const candidate = value as CheckpointState | null;
	return (
		typeof candidate === 'object' &&
		candidate !== null &&
		isPlayerColor(candidate.playerColor) &&
		Array.isArray(candidate.collectedKeys) &&
		candidate.collectedKeys.every(isKeyPosition) &&
		Array.isArray(candidate.swapObjectColors) &&
		candidate.swapObjectColors.every(isPlayerColor)
	);
}

/**
 * Where a respawn puts the player: just above the checkpoint, but only if
 * the checkpoint was reached AND the level still has one (a state left
 * over from before the checkpoint was removed must not move the player).
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getCheckpointRespawn(
	checkpoints: CheckpointObject[],
	state: CheckpointState | null
): CheckpointObject | null {
	if (state === null || checkpoints.length === 0) {
		return null;
	}
	return { x: checkpoints[0].x, y: checkpoints[0].y - CHECKPOINT_RESPAWN_LIFT_PX };
}

export function readCheckpointState(registry: RegistryLike): CheckpointState | null {
	const value = registry.get(CHECKPOINT_STATE_REGISTRY_KEY);
	return isCheckpointState(value) ? value : null;
}

export function readCheckpointBeforeRun(registry: RegistryLike): RecordedRun | null {
	const value = registry.get(CHECKPOINT_BEFORE_RUN_REGISTRY_KEY) as RecordedRun | null | undefined;
	return value && Array.isArray(value.frames) ? value : null;
}

/** Forgets the reached checkpoint - the next start is from the spawn again. */
export function clearCheckpointProgress(registry: RegistryLike): void {
	registry.remove(CHECKPOINT_STATE_REGISTRY_KEY);
	registry.remove(CHECKPOINT_BEFORE_RUN_REGISTRY_KEY);
}

/** What to carry into a freshly booted game, or null if no checkpoint was reached. */
export function readCheckpointCarry(registry: RegistryLike): CheckpointCarry | null {
	const state = readCheckpointState(registry);
	if (state === null) {
		return null;
	}
	return { state, beforeRun: readCheckpointBeforeRun(registry) };
}

export function writeCheckpointCarry(registry: RegistryLike, carry: CheckpointCarry): void {
	registry.set(CHECKPOINT_STATE_REGISTRY_KEY, carry.state);
	if (carry.beforeRun) {
		registry.set(CHECKPOINT_BEFORE_RUN_REGISTRY_KEY, carry.beforeRun);
	} else {
		registry.remove(CHECKPOINT_BEFORE_RUN_REGISTRY_KEY);
	}
}