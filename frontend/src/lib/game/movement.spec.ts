import { describe, expect, it } from 'vitest';
import { getHorizontalVelocity, getJumpVelocity, exceedsDeadzone, hasFallenOffScreen, hasRisingEdge, getPlayerPose, getAcceleratedVelocity, getJumpCutVelocity, shouldStartFloating, shouldStopFloating, getFloatVelocity, hasFloatBudgetExpired, getJumpVelocityMultiplier, getPMeterValue, isPMeterFull, getMaxSpeedForDashState } from './movement';

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

describe('getPlayerPose', () => {
	it('is idle when grounded, not ducking, not moving', () => {
		expect(getPlayerPose(true, false, 0)).toBe('idle');
	});

	it('is walk when grounded, not ducking, moving', () => {
		expect(getPlayerPose(true, false, 200)).toBe('walk');
		expect(getPlayerPose(true, false, -200)).toBe('walk');
	});

	it('is duck when grounded and ducking, regardless of movement', () => {
		expect(getPlayerPose(true, true, 0)).toBe('duck');
		expect(getPlayerPose(true, true, 200)).toBe('duck');
	});

	it('is jump whenever airborne, regardless of ducking or movement', () => {
		expect(getPlayerPose(false, false, 0)).toBe('jump');
		expect(getPlayerPose(false, false, 200)).toBe('jump');
		expect(getPlayerPose(false, true, 0)).toBe('jump');
		expect(getPlayerPose(false, true, 200)).toBe('jump');
	});

	it('prioritizes airborne over ducking', () => {
		// Ducking key held while airborne should not produce 'duck'.
		expect(getPlayerPose(false, true, 0)).not.toBe('duck');
	});

	it('prioritizes ducking over walking', () => {
		// Moving while ducking (grounded) should not produce 'walk'.
		expect(getPlayerPose(true, true, 200)).not.toBe('walk');
	});
});
describe('getAcceleratedVelocity', () => {
	it('ramps up gradually toward max speed rather than snapping instantly', () => {
		// accel=800, dt=0.1s -> +80 this frame, well short of maxSpeed=200
		const result = getAcceleratedVelocity({ left: false, right: true }, 0, 200, 800, 0.1);
		expect(result).toBe(80);
		expect(result).toBeLessThan(200);
	});

	it('does not overshoot max speed when the step would exceed it', () => {
		// accel=800, dt=0.5s -> +400 this frame, way past maxSpeed=200
		const result = getAcceleratedVelocity({ left: false, right: true }, 0, 200, 800, 0.5);
		expect(result).toBe(200);
	});

	it('reaches exactly max speed and stays there once at max', () => {
		const atMax = getAcceleratedVelocity({ left: false, right: true }, 200, 200, 800, 0.1);
		expect(atMax).toBe(200);
	});

	it('accelerates symmetrically in the negative direction', () => {
		const result = getAcceleratedVelocity({ left: true, right: false }, 0, 200, 800, 0.1);
		expect(result).toBe(-80);
	});

	it('decelerates toward zero when input is released', () => {
		const result = getAcceleratedVelocity({ left: false, right: false }, 200, 200, 800, 0.1);
		expect(result).toBe(120);
	});

	it('does not overshoot past zero when decelerating', () => {
		const result = getAcceleratedVelocity({ left: false, right: false }, 40, 200, 800, 0.1);
		expect(result).toBe(0);
	});

	it('reverses direction by decelerating through zero, not snapping', () => {
		// Moving right at 200, right released and left pressed - should
		// move toward -200 by the accel step, not jump straight there.
		const result = getAcceleratedVelocity({ left: true, right: false }, 200, 200, 800, 0.1);
		expect(result).toBe(120);
	});

	it('both directions held cancels out, same as getHorizontalVelocity', () => {
		const result = getAcceleratedVelocity({ left: true, right: true }, 100, 200, 800, 0.1);
		expect(result).toBe(20);
	});

	it('zero deltaSeconds produces no change', () => {
		const result = getAcceleratedVelocity({ left: false, right: true }, 50, 200, 800, 0);
		expect(result).toBe(50);
	});
});

describe('getJumpCutVelocity', () => {
	it('does not cut the jump while the button is still held', () => {
		expect(getJumpCutVelocity(-450, true, 0.5)).toBeNull();
	});

	it('cuts the jump when released while still moving upward', () => {
		expect(getJumpCutVelocity(-450, false, 0.5)).toBe(-225);
	});

	it('applies the given multiplier exactly', () => {
		expect(getJumpCutVelocity(-400, false, 0.4)).toBe(-160);
	});

	it('does nothing once already falling, even if released', () => {
		expect(getJumpCutVelocity(100, false, 0.5)).toBeNull();
	});

	it('does nothing at the exact peak (velocity zero)', () => {
		expect(getJumpCutVelocity(0, false, 0.5)).toBeNull();
	});

	it('a held button always wins regardless of velocity direction', () => {
		expect(getJumpCutVelocity(-450, true, 0.5)).toBeNull();
		expect(getJumpCutVelocity(100, true, 0.5)).toBeNull();
	});
});

describe('shouldStartFloating', () => {
	it('starts floating when every condition is met', () => {
		expect(shouldStartFloating(true, false, false, true, false)).toBe(true);
	});

	it('does not start without the float ability', () => {
		expect(shouldStartFloating(false, false, false, true, false)).toBe(false);
	});

	it('does not start while grounded (that is just a normal jump)', () => {
		expect(shouldStartFloating(true, true, false, true, false)).toBe(false);
	});

	it('does not start if already floating', () => {
		expect(shouldStartFloating(true, false, true, true, false)).toBe(false);
	});

	it('does not start without a fresh press', () => {
		expect(shouldStartFloating(true, false, false, false, false)).toBe(false);
	});

	it('does not (re-)start once the float budget for this airborne period is used up - this is what closes the exploit of releasing and re-pressing jump to keep floating indefinitely', () => {
		expect(shouldStartFloating(true, false, false, true, true)).toBe(false);
	});
});

describe('shouldStopFloating', () => {
	it('does nothing if not currently floating', () => {
		expect(shouldStopFloating(false, false, true)).toBe(false);
	});

	it('stops on landing, even while jump is still held', () => {
		expect(shouldStopFloating(true, true, true)).toBe(true);
	});

	it('stops when jump is released, even while still airborne', () => {
		expect(shouldStopFloating(true, false, false)).toBe(true);
	});

	it('keeps floating while airborne and jump is held', () => {
		expect(shouldStopFloating(true, false, true)).toBe(false);
	});
});

describe('getFloatVelocity', () => {
	it('is zero at the start of a cycle', () => {
		expect(getFloatVelocity(0, 40, 600)).toBeCloseTo(0);
	});

	it('reaches peak positive velocity a quarter of the way through', () => {
		expect(getFloatVelocity(150, 40, 600)).toBeCloseTo(40);
	});

	it('returns to zero halfway through the cycle', () => {
		expect(getFloatVelocity(300, 40, 600)).toBeCloseTo(0);
	});

	it('reaches peak negative velocity three-quarters of the way through', () => {
		expect(getFloatVelocity(450, 40, 600)).toBeCloseTo(-40);
	});

	it('completes a full cycle back to zero', () => {
		expect(getFloatVelocity(600, 40, 600)).toBeCloseTo(0);
	});

	it('scales with the given amplitude', () => {
		expect(getFloatVelocity(150, 100, 600)).toBeCloseTo(100);
	});
});

describe('hasFloatBudgetExpired', () => {
	it('has not expired right at the start', () => {
		expect(hasFloatBudgetExpired(1000, 1000, 5000)).toBe(false);
	});

	it('has not expired just under the max duration', () => {
		expect(hasFloatBudgetExpired(1000, 5999, 5000)).toBe(false);
	});

	it('has expired at exactly the max duration', () => {
		expect(hasFloatBudgetExpired(1000, 6000, 5000)).toBe(true);
	});

	it('has expired well past the max duration', () => {
		expect(hasFloatBudgetExpired(1000, 20000, 5000)).toBe(true);
	});
});
describe('getJumpVelocityMultiplier', () => {
	it('is 1 (no change) for a height multiplier of 1', () => {
		expect(getJumpVelocityMultiplier(1)).toBe(1);
	});

	it('is the square root of the height multiplier, not the value itself', () => {
		expect(getJumpVelocityMultiplier(1.5)).toBeCloseTo(1.2247, 4);
	});

	it('squaring the result recovers the original height multiplier', () => {
		const heightMultiplier = 1.5;
		const velocityMultiplier = getJumpVelocityMultiplier(heightMultiplier);
		expect(velocityMultiplier * velocityMultiplier).toBeCloseTo(heightMultiplier);
	});

	it('a 4x height multiplier requires exactly 2x velocity', () => {
		expect(getJumpVelocityMultiplier(4)).toBe(2);
	});
});

describe('getPMeterValue', () => {
	it('fills while both dash and a direction are held', () => {
		expect(getPMeterValue(0, true, true, 100, 2000)).toBe(100);
	});

	it('does not fill while dash is held but not moving', () => {
		expect(getPMeterValue(500, true, false, 100, 2000)).toBe(400);
	});

	it('does not fill while moving but dash is not held', () => {
		expect(getPMeterValue(500, false, true, 100, 2000)).toBe(400);
	});

	it('drains when neither condition holds', () => {
		expect(getPMeterValue(500, false, false, 100, 2000)).toBe(400);
	});

	it('clamps fill at the max', () => {
		expect(getPMeterValue(1950, true, true, 100, 2000)).toBe(2000);
	});

	it('clamps drain at zero', () => {
		expect(getPMeterValue(50, false, false, 100, 2000)).toBe(0);
	});
});

describe('isPMeterFull', () => {
	it('is not full below the max', () => {
		expect(isPMeterFull(1999, 2000)).toBe(false);
	});

	it('is full exactly at the max', () => {
		expect(isPMeterFull(2000, 2000)).toBe(true);
	});

	it('is full above the max', () => {
		expect(isPMeterFull(2500, 2000)).toBe(true);
	});
});

describe('getMaxSpeedForDashState', () => {
	it('is walk speed when dash is not held', () => {
		expect(getMaxSpeedForDashState(false, false, 200, 280, 360)).toBe(200);
	});

	it('is run speed when dash is held but the meter is not full', () => {
		expect(getMaxSpeedForDashState(true, false, 200, 280, 360)).toBe(280);
	});

	it('is full P-speed once the meter is full', () => {
		expect(getMaxSpeedForDashState(true, true, 200, 280, 360)).toBe(360);
	});

	it('a full meter wins even if dash is somehow reported not held', () => {
		expect(getMaxSpeedForDashState(false, true, 200, 280, 360)).toBe(360);
	});
});