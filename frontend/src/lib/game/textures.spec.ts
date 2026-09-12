import { describe, expect, it } from 'vitest';
import { getPlayerHudFrame, pickPlayerColor, PLAYER_COLORS } from './textures';

describe('pickPlayerColor', () => {
	it('picks the first color for a random value of 0', () => {
		expect(pickPlayerColor(0)).toBe(PLAYER_COLORS[0]);
	});

	it('picks the last color for a random value just under 1', () => {
		expect(pickPlayerColor(0.999999)).toBe(PLAYER_COLORS[PLAYER_COLORS.length - 1]);
	});

	it('picks a middle color for a mid-range random value', () => {
		expect(pickPlayerColor(0.5)).toBe(PLAYER_COLORS[Math.floor(0.5 * PLAYER_COLORS.length)]);
	});

	it('always returns one of the declared colors', () => {
		for (let i = 0; i < 20; i++) {
			const randomValue = i / 20;
			expect(PLAYER_COLORS).toContain(pickPlayerColor(randomValue));
		}
	});

	it('is deterministic for the same input', () => {
		expect(pickPlayerColor(0.37)).toBe(pickPlayerColor(0.37));
	});
});

describe('getPlayerHudFrame', () => {
	it('maps each color to its named helmet portrait frame', () => {
		expect(getPlayerHudFrame('beige')).toBe('hud_player_helmet_beige');
		expect(getPlayerHudFrame('green')).toBe('hud_player_helmet_green');
		expect(getPlayerHudFrame('pink')).toBe('hud_player_helmet_pink');
		expect(getPlayerHudFrame('purple')).toBe('hud_player_helmet_purple');
		expect(getPlayerHudFrame('yellow')).toBe('hud_player_helmet_yellow');
	});

	it('produces a distinct frame for every color', () => {
		const frames = PLAYER_COLORS.map((color) => getPlayerHudFrame(color));
		expect(new Set(frames).size).toBe(PLAYER_COLORS.length);
	});
});