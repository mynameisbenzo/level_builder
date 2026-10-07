import type { PlayerPose } from './movement';
import { PLAYER_COLORS, type PlayerColor } from './playerColor';

/**
 * Ghost runs: the fastest recorded clear of a level, replayed as a
 * translucent character. This file is the pure, Phaser-free half -
 * recording, the packed sample format, and playback interpolation.
 *
 * FORMAT (mirrors backend/app/services/ghosts.py - keep in sync): a run
 * is a list of samples, one every GHOST_SAMPLE_INTERVAL_MS from the start
 * of play, each [x, y, state] of whole numbers, where
 *   state = colorIndex * 8 + poseIndex * 2 + facingLeft
 */

export const GHOST_SAMPLE_INTERVAL_MS = 50;

/** Registry key the page seeds the level's ghosts under (see createGameConfig). */
export const GHOSTS_REGISTRY_KEY = 'ghostSet';

/** Order matters - a pose's position here is what gets stored. */
export const GHOST_POSES: readonly PlayerPose[] = ['idle', 'walk', 'jump', 'duck'];

export type GhostFrame = [x: number, y: number, state: number];

export interface RecordedRun {
	durationMs: number;
	frames: GhostFrame[];
}

export interface GhostRun {
	username: string;
	durationMs: number;
	sampleIntervalMs: number;
	frames: GhostFrame[];
}

/**
 * A level holds up to three ghosts, each with its own holder and fastest
 * time (mirrors backend/app/services/ghosts.py):
 *   full    spawn -> finish, from a run that never touched the checkpoint
 *   before  spawn -> checkpoint touch
 *   after   checkpoint -> finish
 * A level without a checkpoint only ever has a full ghost.
 */
export type GhostKind = 'full' | 'before' | 'after';
export const GHOST_KINDS: readonly GhostKind[] = ['full', 'before', 'after'];

export interface GhostSet {
	full: GhostRun | null;
	before: GhostRun | null;
	after: GhostRun | null;
}

export function emptyGhostSet(): GhostSet {
	return { full: null, before: null, after: null };
}

/**
 * What one playthrough produced when the level was beaten: a full run if
 * the checkpoint was never touched, otherwise the spawn-to-checkpoint
 * stretch and the final checkpoint-to-finish stretch.
 */
export interface ClearedRuns {
	full?: RecordedRun;
	before?: RecordedRun;
	after?: RecordedRun;
}

/** The time a cleared route took: the full run, or its two halves added together. */
export function clearedRunsDurationMs(cleared: ClearedRuns): number {
	if (cleared.full) {
		return cleared.full.durationMs;
	}
	return (cleared.before?.durationMs ?? 0) + (cleared.after?.durationMs ?? 0);
}

export interface GhostRecord {
	username: string;
	durationMs: number;
}

/**
 * The level's record: the fastest complete route, either the full ghost or
 * the before + after pair (credited to both holders if they differ; the
 * full ghost wins a tie). Mirrors backend best_route.
 */
export function routeRecord(set: GhostSet): GhostRecord | null {
	const candidates: GhostRecord[] = [];
	if (set.full) {
		candidates.push({ username: set.full.username, durationMs: set.full.durationMs });
	}
	if (set.before && set.after) {
		candidates.push({
			username:
				set.before.username === set.after.username
					? set.before.username
					: `${set.before.username} & ${set.after.username}`,
			durationMs: set.before.durationMs + set.after.durationMs
		});
	}
	if (candidates.length === 0) {
		return null;
	}
	return candidates.reduce((best, next) => (next.durationMs < best.durationMs ? next : best));
}

/** Which ghost(s) a player starting at the spawn follows. */
export type GhostRoute =
	| { kind: 'full'; full: GhostRun }
	| { kind: 'split'; before: GhostRun | null; after: GhostRun | null };

/**
 * Picks the route a player starting at the spawn races: whichever of the
 * full ghost and the before + after pair is faster (the full ghost on a
 * tie). With no complete route, whatever half exists is still followed.
 */
export function chooseGhostRoute(set: GhostSet): GhostRoute | null {
	const complete = routeRecord(set);
	if (complete !== null) {
		const pairTime = set.before && set.after ? set.before.durationMs + set.after.durationMs : Infinity;
		if (set.full && set.full.durationMs <= pairTime) {
			return { kind: 'full', full: set.full };
		}
		return { kind: 'split', before: set.before, after: set.after };
	}
	if (set.before || set.after) {
		return { kind: 'split', before: set.before, after: set.after };
	}
	return null;
}

export interface GhostState {
	color: PlayerColor;
	pose: PlayerPose;
	facingLeft: boolean;
}

export function encodeGhostState(color: PlayerColor, pose: PlayerPose, facingLeft: boolean): number {
	const colorIndex = Math.max(PLAYER_COLORS.indexOf(color), 0);
	const poseIndex = Math.max(GHOST_POSES.indexOf(pose), 0);
	return colorIndex * 8 + poseIndex * 2 + (facingLeft ? 1 : 0);
}

export function decodeGhostState(state: number): GhostState {
	const colorIndex = Math.min(Math.max(Math.floor(state / 8), 0), PLAYER_COLORS.length - 1);
	const poseIndex = Math.min(Math.max(Math.floor((state % 8) / 2), 0), GHOST_POSES.length - 1);
	return {
		color: PLAYER_COLORS[colorIndex],
		pose: GHOST_POSES[poseIndex],
		facingLeft: state % 2 === 1
	};
}

/**
 * Samples a run as it plays. Call record() once per update with the run
 * clock's current value (time actually spent playing, starting at 0) and
 * the player's current state; a sample is stored for every
 * sampleIntervalMs boundary the clock has reached, so the Nth sample is
 * always the player's position at N * sampleIntervalMs. A frame hitch
 * longer than one interval repeats the latest position to fill the gap,
 * keeping that index-to-time mapping exact.
 */
export class GhostRecorder {
	private frames: GhostFrame[] = [];
	private nextSampleAtMs = 0;

	constructor(private readonly sampleIntervalMs: number = GHOST_SAMPLE_INTERVAL_MS) {}

	reset() {
		this.frames = [];
		this.nextSampleAtMs = 0;
	}

	record(elapsedMs: number, x: number, y: number, state: number) {
		while (elapsedMs >= this.nextSampleAtMs) {
			this.frames.push([Math.round(x), Math.round(y), state]);
			this.nextSampleAtMs += this.sampleIntervalMs;
		}
	}

	/** The run so far, with the clock's value at the moment it ended as its duration. */
	finish(durationMs: number): RecordedRun {
		return { durationMs: Math.round(durationMs), frames: this.frames.map((frame) => [...frame]) };
	}
}

export interface GhostSample {
	x: number;
	y: number;
	state: number;
	/** True once the run has played all the way through. */
	finished: boolean;
}

/**
 * Where the ghost is `elapsedMs` into its run: position interpolated
 * between the two surrounding samples, state taken from the earlier one
 * (a pose change shouldn't blend). Past the last sample it holds the
 * final position and reports finished.
 */
export function sampleGhost(
	frames: readonly GhostFrame[],
	sampleIntervalMs: number,
	elapsedMs: number
): GhostSample | null {
	if (frames.length === 0) return null;

	const position = Math.max(elapsedMs, 0) / sampleIntervalMs;
	const lastIndex = frames.length - 1;

	if (position >= lastIndex) {
		const [x, y, state] = frames[lastIndex];
		return { x, y, state, finished: true };
	}

	const index = Math.floor(position);
	const progress = position - index;
	const [x1, y1, state] = frames[index];
	const [x2, y2] = frames[index + 1];

	return {
		x: x1 + (x2 - x1) * progress,
		y: y1 + (y2 - y1) * progress,
		state,
		finished: false
	};
}

/** "12.34s" under a minute, "1:05.20" from a minute up. */
export function formatRunTime(durationMs: number): string {
	// Never print "NaN" - a missing or garbage value (e.g. a field an
	// older backend doesn't send yet) reads as an obvious placeholder.
	if (!Number.isFinite(durationMs)) {
		return '--';
	}

	const totalCentiseconds = Math.max(0, Math.round(durationMs / 10));
	const minutes = Math.floor(totalCentiseconds / 6000);
	const seconds = (totalCentiseconds % 6000) / 100;

	if (minutes === 0) {
		return `${seconds.toFixed(2)}s`;
	}
	return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`;
}