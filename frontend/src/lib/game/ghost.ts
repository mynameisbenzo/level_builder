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

/** Registry key the page seeds the ghost under (see createGameConfig). */
export const GHOST_REGISTRY_KEY = 'ghostRun';

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