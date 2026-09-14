import type Phaser from 'phaser';

export const CHARACTERS_ATLAS_KEY = 'characters';

/**
 * Queues the Kenney character spritesheet atlas for loading if it isn't
 * already registered. Safe to call from multiple scenes' preload() -
 * without the existence check, a second scene would re-queue a redundant
 * network fetch and risk a duplicate-key warning when Phaser tries to
 * register it into the shared Texture Manager again.
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

export const TILES_ATLAS_KEY = 'tiles';

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

export const ERASER_ICON_KEY = 'eraser-icon';
export const ERASER_ICON_PATH = '/assets/icons/eraser.png';

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

export const SELECT_CURSOR_ICON_KEY = 'select-cursor-icon';
export const SELECT_CURSOR_ICON_PATH = '/assets/icons/select-cursor.png';

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