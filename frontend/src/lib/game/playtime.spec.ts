import { describe, expect, it } from 'vitest';
import { PLAYTIME_MAX_FRAME_MS, PlaytimeClock } from './playtime';

describe('PlaytimeClock', () => {
	it('counts nothing until the first control', () => {
		const clock = new PlaytimeClock();
		clock.advance(16, false);
		clock.advance(16, false);
		expect(clock.pendingMs).toBe(0);
	});

	it('starts at the first control and counts that frame', () => {
		const clock = new PlaytimeClock();
		clock.advance(16, true);
		expect(clock.pendingMs).toBe(16);
	});

	it('keeps counting once started, even with no control held', () => {
		const clock = new PlaytimeClock();
		clock.advance(16, true);
		clock.advance(16, false);
		clock.advance(16, false);
		expect(clock.pendingMs).toBe(48);
	});

	it('caps a long frame, such as catching up after a hidden tab', () => {
		const clock = new PlaytimeClock();
		clock.advance(16, true);
		clock.advance(60_000, false);
		expect(clock.pendingMs).toBe(16 + PLAYTIME_MAX_FRAME_MS);
	});

	it('ignores a negative delta', () => {
		const clock = new PlaytimeClock();
		clock.advance(16, true);
		clock.advance(-50, false);
		expect(clock.pendingMs).toBe(16);
	});

	it('waits for the first control again after a restart, keeping unsent time', () => {
		const clock = new PlaytimeClock();
		clock.advance(40, true);
		clock.resetControl();
		clock.advance(500, false);
		expect(clock.pendingMs).toBe(40);

		clock.advance(16, true);
		expect(clock.pendingMs).toBe(56);
	});

	it('hands over whole milliseconds and keeps the fraction', () => {
		const clock = new PlaytimeClock();
		clock.advance(16.7, true);
		expect(clock.take()).toBe(16);
		expect(clock.pendingMs).toBe(0);
		clock.advance(16.7, false);
		expect(clock.take()).toBe(17); // 0.7 + 16.7 = 17.4
	});

	it('puts time back when a report fails', () => {
		const clock = new PlaytimeClock();
		clock.advance(100, true);
		const ms = clock.take();
		expect(clock.pendingMs).toBe(0);
		clock.giveBack(ms);
		expect(clock.pendingMs).toBe(100);
	});
});