import { describe, expect, it } from 'vitest';
import { canFloat } from './characterAbilities';
import { PLAYER_COLORS } from './playerColor';

describe('canFloat', () => {
	it('is true only for pink', () => {
		expect(canFloat('pink')).toBe(true);
	});

	it('is false for every other color', () => {
		for (const color of PLAYER_COLORS) {
			if (color === 'pink') {
				continue;
			}
			expect(canFloat(color)).toBe(false);
		}
	});
});