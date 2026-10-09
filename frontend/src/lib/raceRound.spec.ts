import { describe, expect, it } from 'vitest';
import { countdownFace, GO_SHOW_MS, secondsLeft, spinFrames, spinSlugAt } from './raceRound';

describe('countdownFace', () => {
	it('shows nothing during the margin before 3', () => {
		expect(countdownFace(3800)).toBeNull();
		expect(countdownFace(3001)).toBeNull();
	});

	it('counts 3, 2, 1 with one second each', () => {
		expect(countdownFace(3000)).toBe(3);
		expect(countdownFace(2001)).toBe(3);
		expect(countdownFace(2000)).toBe(2);
		expect(countdownFace(1001)).toBe(2);
		expect(countdownFace(1000)).toBe(1);
		expect(countdownFace(1)).toBe(1);
	});

	it('shows GO at the start and clears it a moment later', () => {
		expect(countdownFace(0)).toBe('go');
		expect(countdownFace(-GO_SHOW_MS + 1)).toBe('go');
		expect(countdownFace(-GO_SHOW_MS)).toBeNull();
	});
});

describe('spinFrames', () => {
	const tied = ['a', 'b', 'c'];

	it('lands on the chosen level, whichever it is', () => {
		for (const chosen of tied) {
			const frames = spinFrames(tied, chosen, 3500);
			expect(frames.at(-1)!.slug).toBe(chosen);
		}
	});

	it('only ever lights the tied levels, cycling through them in order', () => {
		const frames = spinFrames(tied, 'b', 3500);
		expect(new Set(frames.map((f) => f.slug))).toEqual(new Set(tied));
		for (let i = 1; i < frames.length; i++) {
			const prev = tied.indexOf(frames[i - 1].slug);
			expect(frames[i].slug).toBe(tied[(prev + 1) % tied.length]);
		}
	});

	it('slows down and finishes before the time is up', () => {
		const frames = spinFrames(tied, 'a', 3500);
		const gaps = frames.slice(1).map((f, i) => f.at - frames[i].at);
		for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThanOrEqual(gaps[i - 1]);
		expect(frames.at(-1)!.at).toBeLessThanOrEqual(3500 - 350);
		expect(frames.length).toBeGreaterThan(6);
	});

	it('is the same for every client', () => {
		expect(spinFrames(tied, 'c', 3500)).toEqual(spinFrames(tied, 'c', 3500));
	});

	it('handles a pair, a single level and none', () => {
		expect(spinFrames(['x', 'y'], 'y', 3500).at(-1)!.slug).toBe('y');
		expect(spinFrames(['x'], 'x', 3500)).toEqual([{ at: 0, slug: 'x' }]);
		expect(spinFrames([], 'x', 3500)).toEqual([]);
	});
});

describe('spinSlugAt', () => {
	it('follows the frames over time and holds the last one', () => {
		const frames = spinFrames(['a', 'b', 'c'], 'c', 3500);
		expect(spinSlugAt(frames, 0)).toBe(frames[0].slug);
		expect(spinSlugAt(frames, 99_999)).toBe('c');
		const mid = frames[3];
		expect(spinSlugAt(frames, mid.at)).toBe(mid.slug);
		expect(spinSlugAt([], 100)).toBeNull();
	});
});

describe('secondsLeft', () => {
	it('rounds up, never goes negative, and is null without a deadline', () => {
		expect(secondsLeft(10_500, 10_000)).toBe(1);
		expect(secondsLeft(12_001, 10_000)).toBe(3);
		expect(secondsLeft(9_000, 10_000)).toBe(0);
		expect(secondsLeft(null, 10_000)).toBeNull();
	});
});