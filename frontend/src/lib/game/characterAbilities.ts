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