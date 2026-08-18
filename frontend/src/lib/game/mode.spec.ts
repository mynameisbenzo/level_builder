import { describe, expect, it } from 'vitest';
import { getSceneKeyForMode, toggleMode } from './mode';

describe('getSceneKeyForMode', () => {
	it('maps play mode to the platformer scene key', () => {
		expect(getSceneKeyForMode('play')).toBe('PlatformerScene');
	});

	it('maps edit mode to the level editor scene key', () => {
		expect(getSceneKeyForMode('edit')).toBe('LevelEditorScene');
	});
});

describe('toggleMode', () => {
	it('switches from play to edit', () => {
		expect(toggleMode('play')).toBe('edit');
	});

	it('switches from edit to play', () => {
		expect(toggleMode('edit')).toBe('play');
	});
});