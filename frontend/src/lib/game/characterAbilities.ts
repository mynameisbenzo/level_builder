import type { PlayerColor } from './playerColor';

/**
 * Whether the given character color has the float ability - holding
 * jump again after releasing it, while still airborne, lets the
 * character hover in place (bouncing gently) rather than falling.
 * Currently just pink; more abilities and colors are planned (see
 * README TODOs) but not built yet.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function canFloat(color: PlayerColor): boolean {
	return color === 'pink';
}

/**
 * The horizontal speed multiplier for the given character color -
 * applied to both acceleration and top speed, so the whole movement
 * curve scales together rather than just the cap or just the ramp-up.
 * Yellow moves faster than the baseline; everyone else is unaffected
 * (multiplier of 1).
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getSpeedMultiplier(color: PlayerColor): number {
	return color === 'yellow' ? 1.7 : 1;
}

/**
 * The jump apex-height multiplier for the given character color - how
 * much higher (not how much more initial launch velocity) the
 * character's jump peaks at, compared to the baseline. Beige jumps 50%
 * higher; everyone else is unaffected (multiplier of 1). This is
 * deliberately expressed in height-space, not velocity-space - jump
 * height scales with the square of initial velocity under constant
 * gravity, so turning this into the actual velocity to apply requires
 * getJumpVelocityMultiplier (movement.ts), not using this value
 * directly.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getJumpHeightMultiplier(color: PlayerColor): number {
	return color === 'beige' ? 2 : 1;
}