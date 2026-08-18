import type Phaser from 'phaser';

export const PLAYER_TEXTURE_KEY = 'player-square';
export const PLAYER_TEXTURE_SIZE = 32;

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