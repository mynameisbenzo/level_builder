import { describe, expect, it } from 'vitest';
import {
	decodeGhostState,
	encodeGhostState,
	formatRunTime,
	GHOST_POSES,
	GhostRecorder,
	sampleGhost,
	type GhostFrame
} from './ghost';
import { PLAYER_COLORS } from './playerColor';

describe('ghost state packing', () => {
	it('round-trips every color, pose and facing', () => {
		for (const color of PLAYER_COLORS) {
			for (const pose of GHOST_POSES) {
				for (const facingLeft of [false, true]) {
					const state = encodeGhostState(color, pose, facingLeft);
					expect(decodeGhostState(state)).toEqual({ color, pose, facingLeft });
				}
			}
		}
	});

	it('keeps every state within the backend\'s 0-39 range', () => {
		const all = PLAYER_COLORS.flatMap((color) =>
			GHOST_POSES.flatMap((pose) => [false, true].map((left) => encodeGhostState(color, pose, left)))
		);
		expect(Math.min(...all)).toBe(0);
		expect(Math.max(...all)).toBeLessThanOrEqual(39);
	});

	it('matches the documented formula', () => {
		// pink = index 2, duck = index 3, facing left: 2*8 + 3*2 + 1
		expect(encodeGhostState('pink', 'duck', true)).toBe(23);
	});

	it('decodes an out-of-range state without throwing', () => {
		expect(() => decodeGhostState(9999)).not.toThrow();
		expect(() => decodeGhostState(-3)).not.toThrow();
	});
});

describe('GhostRecorder', () => {
	it('stores the first sample at time 0', () => {
		const recorder = new GhostRecorder(50);
		recorder.record(0, 10, 20, 0);
		expect(recorder.finish(0).frames).toEqual([[10, 20, 0]]);
	});

	it('stores one sample per interval, not one per call', () => {
		const recorder = new GhostRecorder(50);
		for (let elapsed = 0; elapsed <= 208; elapsed += 16) {
			recorder.record(elapsed, elapsed, 0, 0);
		}
		// Boundaries reached: 0, 50, 100, 150, 200 -> five samples.
		expect(recorder.finish(208).frames).toHaveLength(5);
	});

	it('fills a frame hitch with the latest position so indexes stay on the grid', () => {
		const recorder = new GhostRecorder(50);
		recorder.record(0, 0, 0, 0);
		recorder.record(160, 100, 0, 0); // boundaries 50, 100, 150 all passed at once
		expect(recorder.finish(160).frames).toEqual([
			[0, 0, 0],
			[100, 0, 0],
			[100, 0, 0],
			[100, 0, 0]
		]);
	});

	it('rounds positions to whole numbers', () => {
		const recorder = new GhostRecorder(50);
		recorder.record(0, 10.6, 20.4, 3);
		expect(recorder.finish(10).frames[0]).toEqual([11, 20, 3]);
	});

	it('reports a rounded duration and a copy of the frames', () => {
		const recorder = new GhostRecorder(50);
		recorder.record(0, 1, 1, 0);
		const run = recorder.finish(1234.56);
		expect(run.durationMs).toBe(1235);
		recorder.record(50, 2, 2, 0);
		expect(run.frames).toHaveLength(1);
	});

	it('starts over after reset', () => {
		const recorder = new GhostRecorder(50);
		recorder.record(0, 1, 1, 0);
		recorder.record(50, 2, 2, 0);
		recorder.reset();
		recorder.record(0, 9, 9, 0);
		expect(recorder.finish(0).frames).toEqual([[9, 9, 0]]);
	});
});

describe('sampleGhost', () => {
	const frames: GhostFrame[] = [
		[0, 0, 1],
		[100, 40, 2],
		[200, 40, 3]
	];

	it('returns null for an empty run', () => {
		expect(sampleGhost([], 50, 0)).toBeNull();
	});

	it('is exactly the first sample at time 0', () => {
		expect(sampleGhost(frames, 50, 0)).toEqual({ x: 0, y: 0, state: 1, finished: false });
	});

	it('interpolates position between samples', () => {
		const mid = sampleGhost(frames, 50, 25)!;
		expect(mid.x).toBe(50);
		expect(mid.y).toBe(20);
	});

	it('uses the earlier sample\'s state while between two', () => {
		expect(sampleGhost(frames, 50, 25)!.state).toBe(1);
		expect(sampleGhost(frames, 50, 75)!.state).toBe(2);
	});

	it('holds the last position and reports finished past the end', () => {
		expect(sampleGhost(frames, 50, 100)).toEqual({ x: 200, y: 40, state: 3, finished: true });
		expect(sampleGhost(frames, 50, 5000)!.finished).toBe(true);
	});

	it('treats negative time as the start', () => {
		expect(sampleGhost(frames, 50, -100)!.x).toBe(0);
	});
});

describe('formatRunTime', () => {
	it('formats under a minute as seconds', () => {
		expect(formatRunTime(12340)).toBe('12.34s');
		expect(formatRunTime(900)).toBe('0.90s');
	});

	it('formats a minute and over as m:ss.cc', () => {
		expect(formatRunTime(65200)).toBe('1:05.20');
		expect(formatRunTime(600000)).toBe('10:00.00');
	});

	it('does not print 60.00s at the minute boundary', () => {
		expect(formatRunTime(59996)).toBe('1:00.00');
	});

	it('never prints NaN for a missing or invalid value', () => {
		expect(formatRunTime(undefined as unknown as number)).toBe('--');
		expect(formatRunTime(NaN)).toBe('--');
		expect(formatRunTime(Infinity)).toBe('--');
	});
});