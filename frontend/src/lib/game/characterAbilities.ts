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