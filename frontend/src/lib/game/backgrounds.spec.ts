import { describe, expect, it } from 'vitest';
import { BACKGROUND_THEMES, getBackgroundFrameForRow, getThemeSwatchFrame } from './backgrounds';
import { WORLD_ROWS } from './camera';

describe('getThemeSwatchFrame', () => {
	it('maps a theme to its background_<theme> frame', () => {
		expect(getThemeSwatchFrame('color_hills')).toBe('background_color_hills');
		expect(getThemeSwatchFrame('color_desert')).toBe('background_color_desert');
		expect(getThemeSwatchFrame('fade_hills')).toBe('background_fade_hills');
		expect(getThemeSwatchFrame('fade_desert')).toBe('background_fade_desert');
	});
});

describe('getBackgroundFrameForRow', () => {
	it('gives the bottom row the chosen theme\u2019s own ground-level background', () => {
		for (const theme of BACKGROUND_THEMES) {
			expect(getBackgroundFrameForRow(WORLD_ROWS - 1, theme)).toBe(getThemeSwatchFrame(theme));
		}
	});

	it('gives the row above the bottom a plain clouds background, regardless of theme', () => {
		for (const theme of BACKGROUND_THEMES) {
			expect(getBackgroundFrameForRow(WORLD_ROWS - 2, theme)).toBe('background_clouds');
		}
	});

	it('gives every row above that a solid sky background, regardless of theme (paid-tier-only today)', () => {
		for (const theme of BACKGROUND_THEMES) {
			for (let row = 0; row <= WORLD_ROWS - 3; row++) {
				expect(getBackgroundFrameForRow(row, theme)).toBe('background_solid_sky');
			}
		}
	});

	it('never varies by column - only row (and theme) determine the frame, per the bottom-left-anchored spec', () => {
		// Nothing here takes a column argument at all - this test exists to
		// document that omission is deliberate, not an oversight: the same
		// row-by-row progression is meant to repeat identically across every
		// column (WORLD_COLUMNS), never changing left-to-right.
		for (const theme of BACKGROUND_THEMES) {
			for (let row = 0; row < WORLD_ROWS; row++) {
				const frame = getBackgroundFrameForRow(row, theme);
				expect(getBackgroundFrameForRow(row, theme)).toBe(frame);
			}
		}
	});
});