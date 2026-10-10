import { describe, expect, it } from 'vitest';
import { INTERP_DELAY_MS, interpolateSamples, OpponentBuffer, SNAP_DISTANCE_PX } from './raceOpponents';

const s = (at: number, x: number, y = 0, state = 0) => ({ at, x, y, state });

describe('interpolateSamples', () => {
	it('is null with no samples', () => {
		expect(interpolateSamples([], 100)).toBeNull();
	});

	it('waits at the first sample and holds at the last', () => {
		const samples = [s(100, 10), s(150, 20)];
		expect(interpolateSamples(samples, 0)).toMatchObject({ x: 10 });
		expect(interpolateSamples(samples, 999)).toMatchObject({ x: 20 });
	});

	it('glides between two samples', () => {
		const samples = [s(100, 0, 0), s(200, 100, 50)];
		expect(interpolateSamples(samples, 150)).toMatchObject({ x: 50, y: 25 });
	});

	it('takes the pose of the nearer sample', () => {
		const samples = [s(100, 0, 0, 2), s(200, 10, 0, 5)];
		expect(interpolateSamples(samples, 130)?.state).toBe(2);
		expect(interpolateSamples(samples, 170)?.state).toBe(5);
	});

	it('does not glide across a respawn: it stays, then snaps', () => {
		const samples = [s(100, 900, 0), s(150, 20, 0)];
		expect(interpolateSamples(samples, 120)).toMatchObject({ x: 900 });
		expect(interpolateSamples(samples, 150)).toMatchObject({ x: 20 });
		expect(SNAP_DISTANCE_PX).toBeGreaterThan(100);
	});

	it('finds the right pair among many samples', () => {
		const samples = [s(0, 0), s(50, 10), s(100, 20), s(150, 30)];
		expect(interpolateSamples(samples, 125)).toMatchObject({ x: 25 });
	});
});

describe('OpponentBuffer', () => {
	it('draws a little behind real time', () => {
		const b = new OpponentBuffer();
		b.push(1, 0, 0, 0, 1000);
		b.push(1, 100, 0, 0, 1100);
		expect(b.sample(1, 1000 + INTERP_DELAY_MS + 50)).toMatchObject({ x: 50 });
	});

	it('knows nothing about a slot it has not heard from', () => {
		expect(new OpponentBuffer().sample(2, 5000)).toBeNull();
	});

	it('ignores a sample that arrives out of order', () => {
		const b = new OpponentBuffer();
		b.push(0, 10, 0, 0, 1000);
		b.push(0, 99, 0, 0, 900);
		expect(b.sample(0, 5000)).toMatchObject({ x: 10 });
	});

	it('keeps a bounded history and can be cleared', () => {
		const b = new OpponentBuffer();
		for (let i = 0; i < 500; i++) b.push(0, i, 0, 0, i * 50);
		expect(b.sample(0, 500 * 50 + 1000)).toMatchObject({ x: 499 });
		b.clear();
		expect(b.sample(0, 1)).toBeNull();
	});
});