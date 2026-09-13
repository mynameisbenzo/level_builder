import type Phaser from 'phaser';
import type { PlayerPose } from './movement';

export const CHARACTERS_ATLAS_KEY = 'characters';
export const PLAYER_DISPLAY_SIZE = 48;
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

function playerFrameName(color: PlayerColor, poseSuffix: string): string {
	return `character_${color}_${poseSuffix}`;
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

/**
 * The visible character's bounds within its 128x128 source frame, in the
 * frame's own (pre-scale) pixel units - measured directly from the sprite
 * sheet. Kenney's character frames include padding so different poses
 * (e.g. "duck") can share one frame size with "idle"; this specific pose
 * is bottom-aligned with no padding below the feet but 31px of empty
 * space above the head. Used to fit the physics hitbox to the actual
 * character silhouette instead of the whole padded frame. Verified
 * identical (same bbox, pixel-for-pixel) across all five PLAYER_COLORS -
 * these are recolors sharing one rig, not separately-drawn poses, so one
 * set of bounds covers every color.
 */
export const PLAYER_SPRITE_CONTENT_BOUNDS = { x: 24, y: 31, width: 81, height: 97 };

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
 * (Re)builds the player's two-frame walk-cycle animation for the given
 * color, replacing any existing registration. Use this (not
 * ensurePlayerWalkAnimation) when the player's color changes mid-session
 * (e.g. a character-swap object) - the animation needs to be rebuilt with
 * the new color's frames, not just left as whatever color it was
 * originally registered with.
 */
export function setPlayerWalkAnimationColor(scene: Phaser.Scene, color: PlayerColor) {
	if (scene.anims.exists(PLAYER_WALK_ANIMATION_KEY)) {
		scene.anims.remove(PLAYER_WALK_ANIMATION_KEY);
	}

	scene.anims.create({
		key: PLAYER_WALK_ANIMATION_KEY,
		frames: [
			{ key: CHARACTERS_ATLAS_KEY, frame: playerFrameName(color, 'walk_a') },
			{ key: CHARACTERS_ATLAS_KEY, frame: playerFrameName(color, 'walk_b') }
		],
		frameRate: 8,
		repeat: -1
	});
}

/**
 * Registers the player's walk-cycle animation, in the given color, only
 * if it isn't already registered. Animations live in the scene's global
 * Animation Manager (shared across scene restarts within the same Game
 * instance, same as textures), so this guard avoids a duplicate-key
 * warning when a scene restarts (e.g. toggling between Play and Edit
 * mode) - for the initial setup only. If the color changes later, use
 * setPlayerWalkAnimationColor instead, which rebuilds unconditionally.
 */
export function ensurePlayerWalkAnimation(scene: Phaser.Scene, color: PlayerColor) {
	if (scene.anims.exists(PLAYER_WALK_ANIMATION_KEY)) {
		return;
	}
	setPlayerWalkAnimationColor(scene, color);
}

interface PlayerPoseConfig {
	frame: string;
	hitbox: { x: number; y: number; width: number; height: number };
	/** If set, this animation plays instead of a static frame. */
	animationKey?: string;
}

/**
 * What each pose (see getPlayerPose in movement.ts) actually looks like,
 * in the given color - which frame or animation to show, and which
 * hitbox to use. Adding a new pose later means adding one entry here, not
 * a new branch of duplicated setSize/setOffset/setTexture calls in the
 * scene.
 */
export function getPlayerPoseConfig(color: PlayerColor): Record<PlayerPose, PlayerPoseConfig> {
	return {
		jump: { frame: playerFrameName(color, 'jump'), hitbox: PLAYER_SPRITE_CONTENT_BOUNDS },
		duck: { frame: playerFrameName(color, 'duck'), hitbox: PLAYER_DUCK_CONTENT_BOUNDS },
		walk: {
			frame: playerFrameName(color, 'idle'),
			hitbox: PLAYER_SPRITE_CONTENT_BOUNDS,
			animationKey: PLAYER_WALK_ANIMATION_KEY
		},
		idle: { frame: playerFrameName(color, 'idle'), hitbox: PLAYER_SPRITE_CONTENT_BOUNDS }
	};
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