import type Phaser from 'phaser';

export const PLAYER_TEXTURE_KEY = 'player-square';
export const PLAYER_TEXTURE_SIZE = 32;
export const CHARACTERS_ATLAS_KEY = 'characters';
export const TILES_ATLAS_KEY = 'tiles';
export const ERASER_ICON_KEY = 'eraser-icon';
export const ERASER_ICON_PATH = '/assets/icons/eraser.png';
export const SELECT_CURSOR_ICON_KEY = 'select-cursor-icon';
export const SELECT_CURSOR_ICON_PATH = '/assets/icons/select-cursor.png';

/**
 * Generates the placeholder player square texture if it doesn't already
 * exist. Textures are shared across all scenes on a Game instance, so this
 * is safe to call from multiple scenes' preload() without duplicating work.
 */
export function ensurePlayerTexture(scene: Phaser.Scene) {
	if (scene.textures.exists(PLAYER_TEXTURE_KEY)) {
		return;
	}

	const graphics = scene.make.graphics({ x: 0, y: 0 });
	graphics.fillStyle(0xffffff, 1);
	graphics.fillRect(0, 0, PLAYER_TEXTURE_SIZE, PLAYER_TEXTURE_SIZE);
	graphics.generateTexture(PLAYER_TEXTURE_KEY, PLAYER_TEXTURE_SIZE, PLAYER_TEXTURE_SIZE);
	graphics.destroy();
}

/**
 * Queues the Kenney character spritesheet atlas for loading if it isn't
 * already registered. Like ensurePlayerTexture, this is safe to call from
 * multiple scenes' preload() - without the existence check, a second scene
 * would re-queue a redundant network fetch and risk a duplicate-key warning
 * when Phaser tries to register it into the shared Texture Manager again.
 */
export function ensureCharacterAtlas(scene: Phaser.Scene) {
	if (scene.textures.exists(CHARACTERS_ATLAS_KEY)) {
		return;
	}

	scene.load.atlasXML(
		CHARACTERS_ATLAS_KEY,
		'/assets/kenney/platformer-pack/Spritesheets/spritesheet-characters-default.png',
		'/assets/kenney/platformer-pack/Spritesheets/spritesheet-characters-default.xml'
	);
}

/**
 * Queues the Kenney tile spritesheet atlas for loading if it isn't already
 * registered. Same guarded pattern as ensureCharacterAtlas.
 */
export function ensureTilesAtlas(scene: Phaser.Scene) {
	if (scene.textures.exists(TILES_ATLAS_KEY)) {
		return;
	}

	scene.load.atlasXML(
		TILES_ATLAS_KEY,
		'/assets/kenney/platformer-pack/Spritesheets/spritesheet-tiles-default.png',
		'/assets/kenney/platformer-pack/Spritesheets/spritesheet-tiles-default.xml'
	);
}

/**
 * Queues the eraser tool icon for loading if it isn't already registered.
 * Same guarded pattern as the other ensure* loaders.
 */
export function ensureEraserIcon(scene: Phaser.Scene) {
	if (scene.textures.exists(ERASER_ICON_KEY)) {
		return;
	}

	scene.load.image(ERASER_ICON_KEY, ERASER_ICON_PATH);
}

/**
 * Queues the select-tool cursor/button icon for loading if it isn't
 * already registered. Same guarded pattern as the other ensure* loaders.
 */
export function ensureSelectCursorIcon(scene: Phaser.Scene) {
	if (scene.textures.exists(SELECT_CURSOR_ICON_KEY)) {
		return;
	}

	scene.load.image(SELECT_CURSOR_ICON_KEY, SELECT_CURSOR_ICON_PATH);
}