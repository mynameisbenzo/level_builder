import { describe, expect, it } from 'vitest';
import { getHorizontalVelocity, getJumpVelocity, exceedsDeadzone, hasFallenOffScreen, hasRisingEdge } from './movement';

describe('getHorizontalVelocity', () => {
	it('moves left when only the left key is down', () => {
		const velocity = getHorizontalVelocity({ left: true, right: false }, 200);
		expect(velocity).toBe(-200);
	});

	it('moves right when only the right key is down', () => {
		const velocity = getHorizontalVelocity({ left: false, right: true }, 200);
		expect(velocity).toBe(200);
	});

	it('stays still when neither key is down', () => {
		const velocity = getHorizontalVelocity({ left: false, right: false }, 200);
		expect(velocity).toBe(0);
	});

	it('stays still when both keys are down at once', () => {
		const velocity = getHorizontalVelocity({ left: true, right: true }, 200);
		expect(velocity).toBe(0);
	});
});

describe('getJumpVelocity', () => {
	it('returns the jump velocity when jump is pressed and player is on the ground', () => {
		const velocity = getJumpVelocity({ jumpJustPressed: true, onGround: true }, -450);
		expect(velocity).toBe(-450);
	});

	it('returns null when jump is pressed but player is airborne', () => {
		const velocity = getJumpVelocity({ jumpJustPressed: true, onGround: false }, -450);
		expect(velocity).toBeNull();
	});

	it('returns null when jump is not pressed, even on the ground', () => {
		const velocity = getJumpVelocity({ jumpJustPressed: false, onGround: true }, -450);
		expect(velocity).toBeNull();
	});
});

describe('exceedsDeadzone', () => {
	it('returns false for small positive drift within the deadzone', () => {
		expect(exceedsDeadzone(0.05, 0.2)).toBe(false);
	});

	it('returns false for small negative drift within the deadzone', () => {
		expect(exceedsDeadzone(-0.05, 0.2)).toBe(false);
	});

	it('returns true when the value clearly exceeds the deadzone in the positive direction', () => {
		expect(exceedsDeadzone(0.8, 0.2)).toBe(true);
	});

	it('returns true when the value clearly exceeds the deadzone in the negative direction', () => {
		expect(exceedsDeadzone(-0.8, 0.2)).toBe(true);
	});

	it('returns false exactly at the deadzone boundary', () => {
		expect(exceedsDeadzone(0.2, 0.2)).toBe(false);
	});
});

describe('hasFallenOffScreen', () => {
	it('returns false while still above the bottom of the screen', () => {
		expect(hasFallenOffScreen(300, 600, 100)).toBe(false);
	});

	it('returns false while within the threshold below the screen', () => {
		expect(hasFallenOffScreen(650, 600, 100)).toBe(false);
	});

	it('returns false exactly at the threshold boundary', () => {
		expect(hasFallenOffScreen(700, 600, 100)).toBe(false);
	});

	it('returns true once past the threshold below the screen', () => {
		expect(hasFallenOffScreen(701, 600, 100)).toBe(true);
	});
});

describe('hasRisingEdge', () => {
	it('returns true when down now but was up last frame', () => {
		expect(hasRisingEdge(true, false)).toBe(true);
	});

	it('returns false when down now and was already down last frame (held)', () => {
		expect(hasRisingEdge(true, true)).toBe(false);
	});

	it('returns false when up now, regardless of last frame', () => {
		expect(hasRisingEdge(false, true)).toBe(false);
		expect(hasRisingEdge(false, false)).toBe(false);
	});
});