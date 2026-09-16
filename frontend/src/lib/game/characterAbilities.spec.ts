import { describe, expect, it } from 'vitest';
import { canFloat, getSpeedMultiplier } from './characterAbilities';
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

describe('getSpeedMultiplier', () => {
	it('is 1.7 for yellow', () => {
		expect(getSpeedMultiplier('yellow')).toBe(1.7);
	});

	it('is 1 (no change) for every other color', () => {
		for (const color of PLAYER_COLORS) {
			if (color === 'yellow') {
				continue;
			}
			expect(getSpeedMultiplier(color)).toBe(1);
		}
	});
});