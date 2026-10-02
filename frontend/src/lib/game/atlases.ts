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

export const TOOLBAR_TOGGLE_ICON_KEY = 'toolbar-toggle-icon';
export const TOOLBAR_TOGGLE_ICON_PATH = '/assets/icons/toolbar-toggle.png';

/**
 * Queues the toolbar expand/collapse button's icon for loading if it
 * isn't already registered. Same guarded pattern as the other ensure*
 * loaders.
 */
export function ensureToolbarToggleIcon(scene: Phaser.Scene) {
	if (scene.textures.exists(TOOLBAR_TOGGLE_ICON_KEY)) {
		return;
	}

	scene.load.image(TOOLBAR_TOGGLE_ICON_KEY, TOOLBAR_TOGGLE_ICON_PATH);
}

export const HAZARD_ATLAS_KEY = 'hazards';

/**
 * Queues the Kenney industrial-platform spritesheet atlas for loading if
 * it isn't already registered - a separate atlas from TILES_ATLAS_KEY's
 * spritesheet-tiles-default.png, since the one frame used from it
 * (platformIndustrial_052.png, a spike strip - see HAZARD_TILE_FRAME in
 * placedObjects.ts) only exists in this Kenney industrial-pack sheet,
 * not in the default tileset. Same guarded pattern as the other ensure*
 * loaders - safe to call from multiple scenes' preload().
 */
export function ensureHazardAtlas(scene: Phaser.Scene) {
	if (scene.textures.exists(HAZARD_ATLAS_KEY)) {
		return;
	}

	scene.load.atlasXML(
		HAZARD_ATLAS_KEY,
		'/assets/kenney/platformer-pack/Spritesheets/platformIndustrial_sheet.png',
		'/assets/kenney/platformer-pack/Spritesheets/platformIndustrial_sheet.xml'
	);
}

export const ENEMIES_ATLAS_KEY = 'enemies';

/**
 * Queues the Kenney enemies spritesheet atlas for loading if it isn't
 * already registered - every enemy sprite (spider now, more later - see
 * EnemyType in enemies.ts) lives in this one shared atlas. Same guarded
 * pattern as the other ensure* loaders.
 */
export function ensureEnemiesAtlas(scene: Phaser.Scene) {
	if (scene.textures.exists(ENEMIES_ATLAS_KEY)) {
		return;
	}

	scene.load.atlasXML(
		ENEMIES_ATLAS_KEY,
		'/assets/kenney/platformer-pack/Spritesheets/enemies.png',
		'/assets/kenney/platformer-pack/Spritesheets/enemies.xml'
	);
}