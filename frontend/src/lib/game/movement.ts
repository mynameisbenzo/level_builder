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