/**
 * Only one enemy exists so far (the spider), but EnemyType and
 * EnemyPlacedObject (see placedObjects.ts) are already shaped as a set
 * rather than a single hardcoded kind, since a second enemy is already
 * planned - adding one later should mean adding a case here and in the
 * two scenes, not reworking this into a union after the fact.
 */
export const ENEMY_TYPES = ['spider'] as const;
export type EnemyType = (typeof ENEMY_TYPES)[number];

// ── Spider ───────────────────────────────────────────────────────────

// Frame names from enemies.xml (the Kenney "enemies" atlas - see
// ENEMIES_ATLAS_KEY in atlases.ts).
export const SPIDER_IDLE_FRAME = 'spider.png';
export const SPIDER_HIT_FRAME = 'spider_hit.png';
export const SPIDER_DEAD_FRAME = 'spider_dead.png';
export const SPIDER_WALK_FRAMES = ['spider_walk1.png', 'spider_walk2.png'] as const;

// Native spider.png is 71x45 - close enough to a 32px grid cell's
// footprint that, unlike the hazard tile, it doesn't need a special
// vertical offset to sit flush: locking the display height to GRID_SIZE
// itself means a spider placed one cell above a ground tile already
// rests exactly on top of it, same as a key or swap object would.
export const SPIDER_DISPLAY_WIDTH = 32;
export const SPIDER_DISPLAY_HEIGHT = 21;

// The display sprite above is wider than one grid cell, so two spiders
// placed in adjacent cells sit close enough that their full-sprite-sized
// physics bodies would overlap into each other's space - a player
// stomping one could simultaneously register a side-touch against its
// neighbor and die instead of landing cleanly. The hitbox is pulled in
// well inside the sprite to prevent that: these are fractions of
// SPIDER_DISPLAY_WIDTH/HEIGHT (not the source frame size - see
// getSpiderHitboxSize), so two adjacent spiders' bodies never touch
// regardless of which frame is currently showing.
export const SPIDER_HITBOX_WIDTH_RATIO = 0.5;
export const SPIDER_HITBOX_HEIGHT_RATIO = 0.8;

// Patrol speed, in px/sec - deliberately slower than the player's own
// walk speed (200px/sec, see PlatformerScene.WALK_SPEED), so a patrolling
// spider reads as an obstacle to react to, not something that out-paces
// the player.
export const SPIDER_PATROL_SPEED = 60;

// How long each walk frame (spider_walk1 <-> spider_walk2) is shown
// before advancing to the next - matches real time (ms), not a Phaser
// AnimationManager frame rate, since getSpiderWalkFrame below is a pure
// function of elapsed time rather than a registered animation.
export const SPIDER_WALK_FRAME_DURATION_MS = 220;

// Stomping a spider bounces the player upward (same idea as landing on
// solid ground - see PlatformerScene's jumpAvailableUntil) rather than
// just stopping their fall dead - this is what gives a stomp its
// satisfying "hop" feel rather than feeling like hitting an invisible
// floor.
export const SPIDER_STOMP_BOUNCE_VELOCITY = -300;
// How long after a stomp a jump press still counts as a ground-equivalent
// jump (full height, not just the automatic bounce above) - a short
// grace window rather than requiring the exact same physics frame, so a
// slightly-late jump press still "refreshes" the jump the way landing on
// real ground would.
export const SPIDER_STOMP_JUMP_GRACE_MS = 200;
// How many pixels of overlap between the player's feet and the spider's
// top are still forgiven as "landed on top of it" rather than "walked
// into it from the side" - without some tolerance, a falling player
// whose feet are a pixel or two below the spider's exact top on the
// frame overlap is first detected would register as a side hit instead
// of a stomp.
export const SPIDER_STOMP_TOLERANCE_PX = 10;

// Death animation timing (see playSpiderDeathAnimation in
// PlatformerScene): spider.png and spider_hit.png alternate this many
// times, then spider_dead.png holds for SPIDER_DEAD_HOLD_MS before the
// spider disappears for good.
export const SPIDER_FLICKER_INTERVAL_MS = 90;
export const SPIDER_FLICKER_COUNT = 5;
export const SPIDER_DEAD_HOLD_MS = 500;

export interface PatrolBounds {
	minX: number;
	maxX: number;
}

/**
 * A ground tile's position and platform (groupId) - just the fields
 * getPlatformBoundsForEnemy actually needs, so callers don't have to
 * import GroundPlacedObject just to pass one in.
 */
export interface GroundTilePosition {
	x: number;
	y: number;
	groupId: string;
}

/**
 * Finds the horizontal span (in world px) of the platform an enemy is
 * standing on, so it knows where to turn around. Looks for a ground tile
 * directly beneath the enemy's spawn position (one grid cell down), then
 * collects every tile sharing that tile's platform (groupId) and row (y)
 * - deliberately not the whole group regardless of row, since a vertical
 * platform's group spans multiple y values at the same x, which isn't a
 * span to patrol along at all. Returns null if there's no ground tile
 * directly beneath the enemy (nothing to patrol along), in which case the
 * enemy should just stand still rather than wandering over open air.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getPlatformBoundsForEnemy(
	groundTiles: GroundTilePosition[],
	enemyX: number,
	enemyY: number,
	gridSize: number
): PatrolBounds | null {
	const standingTile = groundTiles.find(
		(tile) => tile.x === enemyX && tile.y === enemyY + gridSize
	);
	if (!standingTile) {
		return null;
	}

	const sameRow = groundTiles.filter(
		(tile) => tile.groupId === standingTile.groupId && tile.y === standingTile.y
	);
	const xs = sameRow.map((tile) => tile.x);

	return {
		minX: Math.min(...xs) - gridSize / 2,
		maxX: Math.max(...xs) + gridSize / 2
	};
}

/**
 * The physics body size to apply to a spider, in the sprite's own
 * pre-scale frame-space pixels (what Phaser's Body#setSize/#setOffset
 * expect - see the player's own hitbox setup in PlatformerScene's
 * create() for the same convention). Takes the CURRENT frame's native
 * width/height (which differs slightly between spider.png,
 * spider_walk1.png, etc.) rather than assuming one fixed size, but
 * because the ratios are applied before Phaser's own display scaling,
 * the resulting on-screen hitbox always comes out to the same fraction
 * of SPIDER_DISPLAY_WIDTH/HEIGHT no matter which frame it was computed
 * from.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getSpiderHitboxSize(
	frameWidth: number,
	frameHeight: number
): { width: number; height: number } {
	return {
		width: frameWidth * SPIDER_HITBOX_WIDTH_RATIO,
		height: frameHeight * SPIDER_HITBOX_HEIGHT_RATIO
	};
}

/**
 * Whichever direction a patrolling enemy should move next: continues its
 * current direction unless it's reached (or passed) the edge of its
 * patrol bounds, in which case it reverses.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getNextPatrolDirection(
	x: number,
	direction: 1 | -1,
	bounds: PatrolBounds
): 1 | -1 {
	if (direction === 1 && x >= bounds.maxX) {
		return -1;
	}
	if (direction === -1 && x <= bounds.minX) {
		return 1;
	}
	return direction;
}

/**
 * Which walk frame a patrolling spider should show at a given point in
 * time - a simple two-frame cycle, computed from elapsed time rather
 * than a registered Phaser animation (consistent with how the death
 * flicker below is driven too), so there's one single place that owns
 * "what frame is this spider on right now."
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getSpiderWalkFrame(elapsedMs: number): string {
	const index = Math.floor(elapsedMs / SPIDER_WALK_FRAME_DURATION_MS) % SPIDER_WALK_FRAMES.length;
	return SPIDER_WALK_FRAMES[index];
}

/**
 * Whether the player touching an enemy counts as a stomp (lands on top,
 * killing it) rather than a side/underneath touch (hurts the player
 * instead) - falling (velocity.y >= 0) with the player's feet at or
 * above the enemy's top edge, within a small forgiving tolerance.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function isStompHit(
	playerVelocityY: number,
	playerBottom: number,
	enemyTop: number,
	tolerancePx: number
): boolean {
	return playerVelocityY >= 0 && playerBottom <= enemyTop + tolerancePx;
}