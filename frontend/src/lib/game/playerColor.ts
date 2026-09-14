import type Phaser from 'phaser';

export const PLAYER_COLORS = ['beige', 'green', 'pink', 'purple', 'yellow'] as const;
export type PlayerColor = (typeof PLAYER_COLORS)[number];

/**
 * The player's color for the current, in-progress Play session -
 * intentionally separate from PLAYER_STARTING_COLOR_REGISTRY_KEY. This
 * one changes at runtime (character-swap objects write to it) and is
 * reset back to the starting color every time Play mode boots (see
 * PlatformerScene.create()), so a mid-session swap never leaks back into
 * what the Editor shows or what a fresh Play session begins as.
 */
export const PLAYER_COLOR_REGISTRY_KEY = 'playerColor';

export const DEFAULT_PLAYER_COLOR: PlayerColor = 'green';
export const PLAYER_STARTING_COLOR_REGISTRY_KEY = 'playerStartingColor';

/**
 * Returns the level's starting player color, defaulting to (and storing)
 * DEFAULT_PLAYER_COLOR if none has been explicitly chosen yet. This is
 * the Editor-controlled, level-wide setting - what a fresh Play session
 * always begins as, regardless of how a previous session ended.
 */
export function ensureStartingPlayerColor(scene: Phaser.Scene): PlayerColor {
	const stored = scene.registry.get(PLAYER_STARTING_COLOR_REGISTRY_KEY) as PlayerColor | undefined;
	if (stored) {
		return stored;
	}

	scene.registry.set(PLAYER_STARTING_COLOR_REGISTRY_KEY, DEFAULT_PLAYER_COLOR);
	return DEFAULT_PLAYER_COLOR;
}

export function setStartingPlayerColor(scene: Phaser.Scene, color: PlayerColor) {
	scene.registry.set(PLAYER_STARTING_COLOR_REGISTRY_KEY, color);
}

/**
 * Maps a player color to its HUD portrait frame ("helmet" variant - the
 * plain hud_player_<color> frames, without "helmet", are reserved for the
 * planned character-swap floating objects, see README TODOs). These live
 * in the TILES atlas, not the character atlas - Kenney grouped the HUD
 * icons in with the tile spritesheet.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getPlayerHudFrame(color: PlayerColor): string {
	return `hud_player_helmet_${color}`;
}

/**
 * Maps a player color to the frame a character-swap floating object shows
 * while holding that color - the non-"helmet" hud_player_<color> frames,
 * distinct from getPlayerHudFrame's portraits.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getCharacterSwapObjectFrame(color: PlayerColor): string {
	return `hud_player_${color}`;
}