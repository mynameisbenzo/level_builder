import type Phaser from 'phaser';
import type { PlayerPose } from './movement';

export const CHARACTERS_ATLAS_KEY = 'characters';
export const PLAYER_DISPLAY_SIZE = 32;
export const PLAYER_SPRITE_FRAME = 'character_beige_idle';

/**
 * The visible character's bounds within its 128x128 source frame, in the
 * frame's own (pre-scale) pixel units - measured directly from the sprite
 * sheet. Kenney's character frames include padding so different poses
 * (e.g. "duck") can share one frame size with "idle"; this specific frame
 * is bottom-aligned with no padding below the feet but 31px of empty
 * space above the head. Used to fit the physics hitbox to the actual
 * character silhouette instead of the whole padded frame - if
 * PLAYER_SPRITE_FRAME ever changes to a different pose, these bounds
 * need remeasuring to match.
 */
export const PLAYER_SPRITE_CONTENT_BOUNDS = { x: 24, y: 31, width: 81, height: 97 };

export const PLAYER_DUCK_FRAME = 'character_beige_duck';
/**
 * The duck pose's hitbox: half the standing height, same width. Measuring
 * the actual duck frame shows it's barely narrower than standing (81 vs
 * 81 wide) - only shorter - so halving width too would make the hitbox
 * far narrower than the visible character. Anchored so the bottom (feet)
 * stays at the same y as standing (128, the frame's bottom edge) rather
 * than shrinking from the center, matching the bottom-aligned art
 * convention shared by every pose in this set.
 */

export const PLAYER_DUCK_CONTENT_BOUNDS = {
	x: PLAYER_SPRITE_CONTENT_BOUNDS.x,
	y: PLAYER_SPRITE_CONTENT_BOUNDS.y + PLAYER_SPRITE_CONTENT_BOUNDS.height / 2,
	width: PLAYER_SPRITE_CONTENT_BOUNDS.width,
	height: PLAYER_SPRITE_CONTENT_BOUNDS.height / 2
};
/**
 * Measured content bounds for this frame are nearly identical to
 * PLAYER_SPRITE_CONTENT_BOUNDS (82x97 vs 81x97, 1px difference) - close
 * enough to reuse the standing hitbox rather than define a separate one.
 */
export const PLAYER_JUMP_FRAME = 'character_beige_jump';
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
export const PLAYER_WALK_ANIMATION_KEY = 'player-walk';

/**
 * Registers the player's two-frame walk-cycle animation if it isn't
 * already registered. Animations live in the scene's global Animation
 * Manager (shared across scene restarts within the same Game instance,
 * same as textures), so this needs the same existence guard as the
 * texture loaders to avoid a duplicate-key warning when a scene restarts
 * (e.g. toggling between Play and Edit mode).
 */
export function ensurePlayerWalkAnimation(scene: Phaser.Scene) {
	if (scene.anims.exists(PLAYER_WALK_ANIMATION_KEY)) {
		return;
	}

	scene.anims.create({
		key: PLAYER_WALK_ANIMATION_KEY,
		frames: [
			{ key: CHARACTERS_ATLAS_KEY, frame: 'character_beige_walk_a' },
			{ key: CHARACTERS_ATLAS_KEY, frame: 'character_beige_walk_b' }
		],
		frameRate: 8,
		repeat: -1
	});
}

interface PlayerPoseConfig {
	frame: string;
	hitbox: { x: number; y: number; width: number; height: number };
	/** If set, this animation plays instead of a static frame. */
	animationKey?: string;
}

/**
 * What each pose (see getPlayerPose in movement.ts) actually looks like -
 * which frame or animation to show, and which hitbox to use. Adding a new
 * pose later means adding one entry here, not a new branch of duplicated
 * setSize/setOffset/setTexture calls in the scene.
 */
export const PLAYER_POSE_CONFIG: Record<PlayerPose, PlayerPoseConfig> = {
	jump: { frame: PLAYER_JUMP_FRAME, hitbox: PLAYER_SPRITE_CONTENT_BOUNDS },
	duck: { frame: PLAYER_DUCK_FRAME, hitbox: PLAYER_DUCK_CONTENT_BOUNDS },
	walk: {
		frame: PLAYER_SPRITE_FRAME,
		hitbox: PLAYER_SPRITE_CONTENT_BOUNDS,
		animationKey: PLAYER_WALK_ANIMATION_KEY
	},
	idle: { frame: PLAYER_SPRITE_FRAME, hitbox: PLAYER_SPRITE_CONTENT_BOUNDS }
};

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