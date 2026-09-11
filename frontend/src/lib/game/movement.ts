export interface HorizontalInput {
	left: boolean;
	right: boolean;
}

/**
 * Determines horizontal velocity from directional input.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getHorizontalVelocity(input: HorizontalInput, speed: number): number {
	if (input.left && input.right) return 0;
	if (input.left) return -speed;
	if (input.right) return speed;
	return 0;
}

/**
 * Computes the next frame's horizontal velocity, ramping toward the
 * target speed (whichever direction is held, or zero if neither/both are)
 * by at most `acceleration * deltaSeconds`, rather than snapping to it
 * instantly. This is the core "build-up" feel from 2D Mario games'
 * running mechanic - hold a direction and speed ramps up over time; let
 * go (or reverse direction) and it ramps back down the same way, passing
 * through zero naturally rather than needing special-case braking logic.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getAcceleratedVelocity(
	input: HorizontalInput,
	currentVelocity: number,
	maxSpeed: number,
	acceleration: number,
	deltaSeconds: number
): number {
	const direction = input.left && input.right ? 0 : input.left ? -1 : input.right ? 1 : 0;
	const targetVelocity = direction * maxSpeed;
	const maxDelta = acceleration * deltaSeconds;

	if (targetVelocity > currentVelocity) {
		return Math.min(targetVelocity, currentVelocity + maxDelta);
	}
	if (targetVelocity < currentVelocity) {
		return Math.max(targetVelocity, currentVelocity - maxDelta);
	}
	return currentVelocity;
}

export interface JumpInput {
	jumpJustPressed: boolean;
	onGround: boolean;
}

/**
 * Determines whether a jump should trigger, and at what velocity.
 * Returns null when no jump should occur (e.g. airborne, or key not pressed).
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getJumpVelocity(input: JumpInput, jumpVelocity: number): number | null {
	if (input.jumpJustPressed && input.onGround) {
		return jumpVelocity;
	}
	return null;
}

/**
 * Determines whether an analog stick axis value counts as "pressed" in a
 * direction, ignoring small values caused by stick drift/noise.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function exceedsDeadzone(axisValue: number, deadzone: number): boolean {
	return Math.abs(axisValue) > deadzone;
}

/**
 * Detects whether the player has fallen far enough below the bottom of the
 * screen to count as "fallen off" - with no ground currently in Play mode,
 * this is what sends the player back to the Level Editor rather than
 * letting them fall forever.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function hasFallenOffScreen(
	playerY: number,
	screenHeight: number,
	threshold: number
): boolean {
	return playerY > screenHeight + threshold;
}

/**
 * Detects a "just pressed" rising edge (was up last frame, is down this
 * frame) for input sources without a native JustDown helper - gamepad
 * buttons and touch buttons both need this same manual comparison.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function hasRisingEdge(isDownNow: boolean, wasDownLastFrame: boolean): boolean {
	return isDownNow && !wasDownLastFrame;
}

export type PlayerPose = 'jump' | 'duck' | 'walk' | 'idle';

/**
 * Decides which pose the player should be in. Priority: airborne always
 * wins (you can't meaningfully duck or walk mid-air), then ducking
 * overrides walking, then walking overrides idle.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getPlayerPose(
	onGround: boolean,
	isDucking: boolean,
	velocityX: number
): PlayerPose {
	if (!onGround) {
		return 'jump';
	}
	if (isDucking) {
		return 'duck';
	}
	if (velocityX !== 0) {
		return 'walk';
	}
	return 'idle';
}