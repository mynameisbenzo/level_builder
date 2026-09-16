import type Phaser from 'phaser';
import type { PlayerPose } from './movement';
import { CHARACTERS_ATLAS_KEY } from './atlases';
import type { PlayerColor } from './playerColor';

export const PLAYER_DISPLAY_SIZE = 48;

function playerFrameName(color: PlayerColor, poseSuffix: string): string {
	return `character_${color}_${poseSuffix}`;
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

export const PLAYER_WALK_ANIMATION_KEY = 'player-walk';

/**
 * (Re)builds the player's two-frame walk-cycle animation for the given
 * color, replacing any existing registration. Always rebuilds
 * unconditionally rather than guarding on "does this animation already
 * exist" - the Animation Manager is global and persists across scene
 * restarts, so a guard would skip rebuilding even when the *previous*
 * registration is for the wrong color (e.g. a character-swap object
 * changed it mid-session, then a fresh Play session starts as a
 * different color - a guard would silently leave the walk animation
 * showing the old session's color while every other part of the
 * character, from the registry to the static idle texture, correctly
 * shows the new one). This was a real bug, not a hypothetical.
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