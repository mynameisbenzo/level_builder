import type Phaser from 'phaser';

export const PLAYER_COLORS = ['beige', 'green', 'pink', 'purple', 'yellow'] as const;
export type PlayerColor = (typeof PLAYER_COLORS)[number];
export const PLAYER_COLOR_REGISTRY_KEY = 'playerColor';

/**
 * Picks a player color given a [0, 1) random value (pass Math.random()).
 * Taking the random value as a parameter, rather than calling Math.random()
 * internally, keeps the actual selection logic deterministic and testable -
 * for the same input, this always returns the same color.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function pickPlayerColor(randomValue: number): PlayerColor {
	const index = Math.floor(randomValue * PLAYER_COLORS.length);
	return PLAYER_COLORS[index];
}

/**
 * Returns the player's color for this session, picking and storing a
 * random one (see pickPlayerColor) if none has been chosen yet. Reading
 * from the registry rather than picking fresh every time means whichever
 * scene boots first decides the color, and every scene after it (including
 * the same scene restarting, e.g. toggling Play/Edit) sees the same one
 * for the rest of the session instead of re-randomizing on every restart.
 */
export function ensurePlayerColor(scene: Phaser.Scene): PlayerColor {
	const stored = scene.registry.get(PLAYER_COLOR_REGISTRY_KEY) as PlayerColor | undefined;
	if (stored) {
		return stored;
	}

	const picked = pickPlayerColor(Math.random());
	scene.registry.set(PLAYER_COLOR_REGISTRY_KEY, picked);
	return picked;
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