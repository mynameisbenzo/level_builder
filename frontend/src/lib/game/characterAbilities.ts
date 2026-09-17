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
 * character's jump peaks at, compared to the baseline. Beige jumps
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

/**
 * Whether the given character color has the phase ability - holding the
 * dash button lets the character pass through platforms and other solid
 * objects, up to a capped duration per dash-hold (see PHASE_MAX_DURATION_MS
 * and isPhasingActive in movement.ts). Currently just purple. Experimental -
 * built on its own branch, not yet merged to main.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function canPhase(color: PlayerColor): boolean {
	return color === 'purple';
}