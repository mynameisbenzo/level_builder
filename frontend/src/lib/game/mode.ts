export type GameMode = 'play' | 'edit';

const SCENE_KEYS_BY_MODE: Record<GameMode, string> = {
	play: 'PlatformerScene',
	edit: 'LevelEditorScene'
};

/**
 * Maps a game mode to the Phaser scene key responsible for it.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getSceneKeyForMode(mode: GameMode): string {
	return SCENE_KEYS_BY_MODE[mode];
}

/**
 * Returns the opposite mode - the one you'd switch to next.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function toggleMode(mode: GameMode): GameMode {
	return mode === 'play' ? 'edit' : 'play';
}