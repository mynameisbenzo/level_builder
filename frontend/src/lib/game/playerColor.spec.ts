import { describe, expect, it } from 'vitest';
import { getCharacterSwapObjectFrame, getPlayerHudFrame, PLAYER_COLORS } from './playerColor';

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

describe('getCharacterSwapObjectFrame', () => {
	it('maps each color to its non-helmet hud_player frame', () => {
		expect(getCharacterSwapObjectFrame('beige')).toBe('hud_player_beige');
		expect(getCharacterSwapObjectFrame('green')).toBe('hud_player_green');
		expect(getCharacterSwapObjectFrame('pink')).toBe('hud_player_pink');
		expect(getCharacterSwapObjectFrame('purple')).toBe('hud_player_purple');
		expect(getCharacterSwapObjectFrame('yellow')).toBe('hud_player_yellow');
	});

	it('is distinct from the HUD portrait frame for every color', () => {
		for (const color of PLAYER_COLORS) {
			expect(getCharacterSwapObjectFrame(color)).not.toBe(getPlayerHudFrame(color));
		}
	});
});