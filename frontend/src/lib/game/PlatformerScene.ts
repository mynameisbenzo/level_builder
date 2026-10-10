import Phaser from 'phaser';
import {
	exceedsDeadzone,
	getAcceleratedVelocity,
	getFloatVelocity,
	getJumpCutVelocity,
	getJumpVelocity,
	getJumpVelocityMultiplier,
	getMaxSpeedForDashState,
	getPlayerPose,
	getPMeterValue,
	hasFallenOffScreen,
	hasFloatBudgetExpired,
	hasRisingEdge,
	isPhasingActive,
	isPMeterFull,
	shouldStartFloating,
	shouldStopFloating,
	type PlayerPose
} from './movement';

/**
 * Emitted game-wide (via this.game.events, not this.events - the
 * Svelte page hosting the game holds the `game` instance and needs to
 * hear this from outside any one scene) the moment a real test
 * playthrough reaches the win condition. /edit/[slug]'s page listens
 * for this and calls the beat API with a fresh access token - kept out
 * of this scene entirely, since Phaser has no business knowing about
 * auth, and an access token seeded once at game-boot could go stale
 * during a long editing session (see gameConfig.ts).
 */
export const LEVEL_BEATEN_EVENT = 'level-beaten';
// The event carries the playthrough's ClearedRuns (see ghost.ts): a full
// run, or - on a level whose checkpoint was reached - the spawn-to-
// checkpoint stretch and the final checkpoint-to-finish stretch.

/**
 * Same game-wide emission pattern as LEVEL_BEATEN_EVENT, for the other
 * end of a playthrough: falling off screen with nowhere to bounce back
 * to (see triggerDeath). Only ever fires in a public /play/[slug]
 * session - an owner testing their own level in the editor keeps the
 * old "bounce back to Edit Mode" behavior instead (see the
 * LevelEditorScene checks in update()), which was already a fine
 * outcome for that case and didn't need a modal of its own.
 */
export const LEVEL_DIED_EVENT = 'level-died';
import {
	RACE_FINISHED_EVENT,
	RACE_LOCKED_KEY,
	RACE_MODE_KEY,
	RACE_OPPONENTS_KEY,
	RACE_READY_EVENT,
	RACE_ROSTER_KEY,
	SLOT_CSS,
	SLOT_TINTS,
	type OpponentBuffer,
	type RosterEntry
} from './raceOpponents';
import { canFloat, canPhase, getJumpHeightMultiplier, getSpeedMultiplier } from './characterAbilities';
import { getSceneKeyForMode, toggleMode, type GameMode } from './mode';
import { ensureSounds, playSfx } from './sounds';
import {
	CHARACTERS_ATLAS_KEY,
	ensureBackgroundsAtlas,
	ensureCharacterAtlas,
	ensureEnemiesAtlas,
	ensureHazardAtlas,
	ensureTilesAtlas,
	ENEMIES_ATLAS_KEY,
	HAZARD_ATLAS_KEY,
	TILES_ATLAS_KEY
} from './atlases';
import { createScreenBackgrounds } from './backgrounds';
import {
	getNextPatrolDirection,
	getPlatformBoundsForEnemy,
	getSpiderHitboxSize,
	getSpiderWalkFrame,
	isStompHit,
	SPIDER_DEAD_FRAME,
	SPIDER_DEAD_HOLD_MS,
	SPIDER_DISPLAY_HEIGHT,
	SPIDER_DISPLAY_WIDTH,
	SPIDER_FLICKER_COUNT,
	SPIDER_FLICKER_INTERVAL_MS,
	SPIDER_HIT_FRAME,
	SPIDER_IDLE_FRAME,
	SPIDER_PATROL_SPEED,
	SPIDER_STOMP_BOUNCE_VELOCITY,
	SPIDER_STOMP_JUMP_GRACE_MS,
	SPIDER_STOMP_TOLERANCE_PX,
	type GroundTilePosition,
	type PatrolBounds
} from './enemies';
import {
	ensureStartingPlayerColor,
	getCharacterSwapObjectFrame,
	getPlayerHudFrame,
	PLAYER_COLOR_REGISTRY_KEY,
	type PlayerColor
} from './playerColor';
import {
	getPlayerFrameForPose,
	getPlayerHitFrame,
	getPlayerPoseConfig,
	PLAYER_DISPLAY_SIZE,
	setPlayerWalkAnimationColor
} from './playerPose';
import {
	chooseGhostRoute,
	decodeGhostState,
	emptyGhostSet,
	encodeGhostState,
	GHOSTS_REGISTRY_KEY,
	GhostRecorder,
	sampleGhost,
	type ClearedRuns,
	type GhostKind,
	type GhostRun,
	type GhostSet
} from './ghost';
import {
	CHECKPOINT_ACTIVE_FRAMES,
	CHECKPOINT_ANIMATION_INTERVAL_MS,
	CHECKPOINT_INACTIVE_FRAME,
	CHECKPOINT_OBJECTS_REGISTRY_KEY,
	clearCheckpointProgress,
	getCheckpointRespawn,
	isNearCheckpoint,
	readCheckpointBeforeRun,
	readCheckpointState,
	writeCheckpointCarry,
	type CheckpointObject,
	type CheckpointState
} from './checkpoints';
import { PlaytimeClock } from './playtime';
import { getGroupFrames, type PositionedTile } from './groundTiling';
import { GRID_SIZE } from './gridSnap';
import { 
	HAZARD_TILE_FRAME, 
	PLACED_OBJECTS_REGISTRY_KEY, 
	HAZARD_DISPLAY_WIDTH, 
	HAZARD_DISPLAY_HEIGHT, 
	getHazardPlacement,
	getHazardRotation,
	type PlacedObject } from './placedObjects';
import {
	CHARACTER_SWAP_OBJECTS_REGISTRY_KEY,
	getSwapResult,
	isWithinSwapRange,
	type CharacterSwapObject
} from './characterSwapObjects';
import {
	canOpenDoor,
	DOOR_OBJECTS_REGISTRY_KEY,
	getDoorClosedFrame,
	getDoorOpenFrame,
	isNearDoor,
	type DoorObject
} from './winConditions';
import {
	getKeyFrame,
	isNearKey,
	KEY_OBJECTS_REGISTRY_KEY,
	type KeyColor,
	type KeyObject
} from './keys';
import { clearModeTogglePressed, touchInputState } from './touchInput';
import { currentMode } from './currentMode';
import {
	ensureCameraMode,
	getQuadrantCenter,
	getQuadrantIndex,
	VIEWPORT_HEIGHT,
	VIEWPORT_WIDTH,
	WORLD_HEIGHT,
	WORLD_WIDTH,
	type CameraMode
} from './camera';
import {
	DEFAULT_PLAYER_POSITION,
	EDITOR_PLAYER_POSITION_KEY,
	resolveInitialPlayerPosition,
	type PlayerPosition
} from './playerState';

const CURRENT_MODE: GameMode = 'play';
// Three-tier dash/P-speed system, matching Super Mario World's actual
// mechanic (not just "hold a direction and speed ramps up automatically"
// - that alone isn't P-speed, it's just acceleration). Holding a
// direction alone caps at WALK_SPEED; holding the dash key too caps at
// RUN_SPEED and starts filling the P-meter; only once the meter is
// completely full does the character reach P_SPEED_TOP_SPEED. See
// getMaxSpeedForDashState/getPMeterValue in movement.ts.
const WALK_SPEED = 200;
const RUN_SPEED = 280;
const P_SPEED_TOP_SPEED = 360;
// How long the dash key (and a direction) need to be held continuously
// to fill the P-meter from empty. Draining uses the same rate, so
// releasing dash for this same duration fully resets it.
const P_METER_MAX_MS = 2000;
// EXPERIMENTAL (purple's phase ability, on its own branch). Purple can
// pass through platforms while holding dash, capped at this long per
// dash-hold - see isPhasingActive in movement.ts for why holding dash
// continuously past this doesn't just resume phasing.
const PHASE_MAX_DURATION_MS = 1000;
// Time to reach WALK_SPEED from a standstill: WALK_SPEED / ACCELERATION
// seconds (200 / 800 = 0.25s) - the build-up feel underlying every
// speed tier above, not just walking. Tune this to taste; higher =
// snappier ramp, lower = more gradual.
const ACCELERATION = 800;
const JUMP_VELOCITY = -450;
// Variable jump height ("jump cut"): releasing jump early while still
// ascending multiplies the remaining upward velocity by this factor,
// cutting the jump short. Lower = shorter minimum hop when tapped;
// holding the button the whole way up always reaches the full height
// regardless of this value.
const JUMP_CUT_MULTIPLIER = 0.5;
const GRAVITY_Y = 900;
// Pink's float ability: peak vertical velocity of the hover/bounce
// oscillation (px/sec) and how long one full up-down cycle takes.
const FLOAT_BOUNCE_AMPLITUDE = 40;
const FLOAT_BOUNCE_PERIOD_MS = 600;
// Floating stops being sustainable after this long, even with jump held
// continuously - keeps the ability from letting the character float
// indefinitely.
const FLOAT_MAX_DURATION_MS = 2500;
const STICK_DEADZONE = 0.2;
const GAMEPAD_MESSAGE_HOLD_MS = 2000;
const GAMEPAD_MESSAGE_FADE_MS = 800;
const FALL_OFF_SCREEN_THRESHOLD_PX = 100;

// Death sequence: however a death was triggered (a hazard, a spider, or
// simply falling with nothing underneath), the player freezes in place
// on the hit frame for this long before gravity resumes and they fall
// through every tile beneath them (see die()). DEATH_FALL_THRESHOLD_PX
// is deliberately separate from FALL_OFF_SCREEN_THRESHOLD_PX above - that
// one is how far below the world a *living* player has to fall before
// it counts as dying at all; this one is how far below the world a
// player already in the post-death fall has to go before the sequence
// is considered finished and the actual outcome (editor bounce-back or
// the result modal) fires.
const DEATH_FREEZE_DURATION_MS = 1000;
const DEATH_FALL_THRESHOLD_PX = 32;

// Character-swap objects: distance-based trigger/cooldown, plus the
// reactivation "pop" animation's scale steps and per-step durations.
const SWAP_TRIGGER_DISTANCE = 24;
// Must be bigger than SWAP_TRIGGER_DISTANCE - this is how far the player
// has to move away before a just-triggered object can fire again.
const SWAP_COOLDOWN_CLEAR_DISTANCE = 64;
const SWAP_COOLDOWN_OPACITY = 0.5;
const SWAP_COOLDOWN_SCALE = 0.5;
const SWAP_OBJECT_DISPLAY_SIZE = 32;
const SWAP_OBJECT_BOB_DISTANCE_PX = 6;
const SWAP_OBJECT_BOB_DURATION_MS = 800;
const SWAP_REACTIVATE_SHRINK_SCALE = 0.25;
const SWAP_REACTIVATE_OVERSHOOT_SCALE = 1.15;
const SWAP_REACTIVATE_SHRINK_DURATION_MS = 150;
const SWAP_REACTIVATE_OVERSHOOT_DURATION_MS = 200;
const SWAP_REACTIVATE_SETTLE_DURATION_MS = 150;
const HUD_PORTRAIT_SIZE = 48;

// Doors: stationary, two-tile-tall, so a bigger interaction radius than
// the small floating swap objects feels appropriate - the whole point is
// a large, easy-to-reach target once the player arrives.
const DOOR_INTERACTION_DISTANCE = 32;
// How long "Level Cleared!" stays on screen before returning to the
// Editor.
const WIN_DISPLAY_DURATION_MS = 2000;
// How long a public /play/[slug] playthrough waits, after either ending
// (win or death), before the result modal appears - deliberate breathing
// room for a win/death sound to play out first, rather than the modal
// slamming down the instant the door opens or the player falls off
// screen. Applies to both triggerWin() and triggerDeath() so the two
// endings feel consistent with each other.
const RESULT_MODAL_DELAY_MS = 2000;

// Explicit render depths (Phaser defaults everything to 0 and draws by
// creation order otherwise, which put doors - created after the player -
// visually in front of it). Ground tiles, doors, and swap objects all
// stay at the default depth (0); the player renders above them; HUD
// elements render above the player. This scene has no camera scrolling,
// so world and screen coordinates share the same space - without an
// explicit HUD depth, the player could walk under and visually obscure
// the top-left HUD.
const PLAYER_DEPTH = 1;
const HUD_DEPTH = 10;
// Collected keys render above the player (visible trailing behind them),
// but below the fixed-screen HUD.
const KEY_FOLLOW_DEPTH = PLAYER_DEPTH + 1;

// Keys bob continuously (collected or not), same sine-wave approach in
// both states rather than a tween - a tween fights for control once a
// collected key also needs to be manually repositioned every frame to
// follow the trailing chain (see updateKeys).
const KEY_BOB_AMPLITUDE = 6;
const KEY_BOB_PERIOD_MS = 1600;
// Uncollected keys render at a full grid tile, matching every other
// placed object; once carried, a smaller size reads better as a held
// item trailing behind the player rather than a world object.
const KEY_COLLECTED_DISPLAY_SIZE = 24;
// How many frames of delay separate each link in the trailing chain of
// collected keys - the first collected key trails this many frames
// behind the player's own path, the second trails that far behind the
// first, and so on. Tune for a tighter or looser-looking chain.
const KEY_TRAIL_SPACING_FRAMES = 10;
// At most 4 keys can ever exist (one per KEY_COLORS entry) - caps how
// much position history needs to be retained.
const MAX_POSSIBLE_KEYS = 4;

// How long the camera takes to pan to a new quadrant's center in
// 'quadrant' camera mode. Linear easing specifically (not eased) - a
// constant-speed pan, not an accelerate/decelerate curve.
const QUADRANT_TRANSITION_DURATION_MS = 500;

interface TrackedDoor {
	data: DoorObject;
	sprite: Phaser.GameObjects.Image;
	/** Runtime-only, like the door's existence in Play mode at all - a
	 * door always starts closed each session (see winConditions.ts). */
	isOpen: boolean;
}

interface TrackedKey {
	data: KeyObject;
	sprite: Phaser.Physics.Arcade.Sprite;
	/** Runtime-only, like a door's isOpen - a key always starts
	 * uncollected each session (see keys.ts). */
	isCollected: boolean;
}

interface TrackedSwapObject {
	data: CharacterSwapObject;
	sprite: Phaser.GameObjects.Image;
	bobTween: Phaser.Tweens.Tween;
	/** True from the moment this object triggers a swap until the player
	 * has moved SWAP_COOLDOWN_CLEAR_DISTANCE away and the reactivation
	 * animation has run - it can't trigger again while true. */
	onCooldown: boolean;
}

interface TrackedCheckpoint {
	data: CheckpointObject;
	sprite: Phaser.GameObjects.Image;
	/** Flips the flag between its two waving frames once it's active. */
	animationTimer: Phaser.Time.TimerEvent | null;
}

interface TrackedSpider {
	sprite: Phaser.Physics.Arcade.Sprite;
	direction: 1 | -1;
	/** null when no ground tile was found directly beneath this spider's
	 * spawn point (see getPlatformBoundsForEnemy) - it stands still
	 * rather than patrolling over open air. */
	bounds: PatrolBounds | null;
	/** Set once stomped - stops patrol/animation updates and further
	 * overlap handling (its body is also disabled) while the death
	 * animation plays out, see killSpider. */
	isDead: boolean;
	/** The walk frame currently shown, so update() only calls setTexture
	 * when it actually changes rather than every single frame. */
	lastWalkFrame: string;
}

export class PlatformerScene extends Phaser.Scene {
	private player!: Phaser.Physics.Arcade.Sprite;
	private wasd!: {
		w: Phaser.Input.Keyboard.Key;
		a: Phaser.Input.Keyboard.Key;
		s: Phaser.Input.Keyboard.Key;
		d: Phaser.Input.Keyboard.Key;
	};
	private arrows!: Phaser.Types.Input.Keyboard.CursorKeys;
	private platforms!: Phaser.Physics.Arcade.StaticGroup;
	private hazards!: Phaser.Physics.Arcade.StaticGroup;
	private currentPose: PlayerPose | null = null;
	private playerPoseConfig!: ReturnType<typeof getPlayerPoseConfig>;
	private hudPortrait!: Phaser.GameObjects.Image;
	private swapObjects: TrackedSwapObject[] = [];
	private doors: TrackedDoor[] = [];
	private keys: TrackedKey[] = [];
	private uncollectedKeysGroup!: Phaser.Physics.Arcade.Group;
	private spiders: TrackedSpider[] = [];
	private spiderGroup!: Phaser.Physics.Arcade.Group;
	/** Timestamp (Phaser scene time, ms) until which a jump press counts
	 * as a ground-equivalent jump even though the player isn't physically
	 * touching the ground - set by a spider stomp's bounce (see
	 * killSpider) so "jump is refreshed" doesn't require landing on the
	 * exact same physics frame the bounce happens on. 0 when not active. */
	private jumpAvailableUntil = 0;
	/** Which key colors the player currently holds - runtime-only, reset
	 * every fresh Play session, same principle as everything else that
	 * shouldn't leak between sessions (see the create() reset block). */
	private collectedKeyColors = new Set<KeyColor>();
	/** Keys in the order they were collected (not placement order) -
	 * drives the trailing-chain position, where the Nth collected key
	 * follows KEY_TRAIL_SPACING_FRAMES * N frames behind the player. */
	private collectedKeysInOrder: TrackedKey[] = [];
	/** Recent player positions, oldest first, used to compute each
	 * trailing key's delayed target position. Trimmed each frame to the
	 * longest delay any currently-collected key could need. */
	private playerPositionHistory: { x: number; y: number }[] = [];
	private hasWon = false;
	/** Time actually spent playing this stretch, in ms - the clock ghost
	 * runs are recorded against. A stretch is one unbroken run with no
	 * death in it: it starts at the spawn (or at the checkpoint after a
	 * respawn) and restarts at 0 in every create() and again the moment the
	 * checkpoint is touched. Advanced only while update() is running
	 * normally, so it excludes asset loading and the post-win modal delay. */
	private runElapsedMs = 0;
	private ghostRecorder = new GhostRecorder();
	/** The level's ghosts, if any were seeded into the registry (see
	 * GHOSTS_REGISTRY_KEY) - one is replayed as a translucent character
	 * alongside the real player. */
	private ghostSet: GhostSet = emptyGhostSet();
	/** Which of the ghosts is being replayed right now (null for none). */
	private ghostStage: GhostKind | null = null;
	/** Time into the ghost being replayed. Separate from runElapsedMs
	 * because a full ghost keeps running past the moment the player touches
	 * the checkpoint, while the after ghost starts over at that moment. */
	private ghostClockMs = 0;
	/** Live race mode (see raceOpponents.ts): set from the registry in create(). */
	private raceMode = false;
	private raceReadyEmitted = false;
	private raceSnapshot: { x: number; y: number; state: number } | null = null;
	private raceSprites = new Map<
		number,
		{ sprite: Phaser.GameObjects.Sprite; label: Phaser.GameObjects.Text }
	>();
	private ghostSprite: Phaser.GameObjects.Sprite | null = null;
	private ghostLabel: Phaser.GameObjects.Text | null = null;
	/** The player's real time spent on this level, reported to the server
	 * by the play page (see playtime.ts). Deliberately NOT reset by
	 * create(): time counted before a death is still waiting to be sent. */
	private playtime = new PlaytimeClock();
	/** The level's checkpoint, if it has one. */
	private checkpoint: TrackedCheckpoint | null = null;
	/** Whether the player has touched the checkpoint (or respawned at it). */
	private checkpointReached = false;
	/** Only ever set in a public /play/[slug] session - see
	 * LEVEL_DIED_EVENT. An owner testing in the editor bounces back to
	 * Edit Mode on death instead and never sets this. */
	private hasDied = false;
	/** True from the moment a death is triggered until the post-death
	 * fall finishes (see die()/updateDeathFall) - guards against running
	 * die() more than once within the same physics step (e.g. the
	 * player's body overlapping more than one hazard tile at once), and
	 * also tells update() to skip all normal game logic (movement,
	 * spiders, the camera, door/swap checks) for the whole death
	 * sequence, leaving only gravity to carry the player down. Runtime-
	 * only, reset each session like everything else above. */
	private isDying = false;
	/** False during the initial 1-second freeze (see
	 * DEATH_FREEZE_DURATION_MS), true once gravity has resumed and the
	 * player is actually falling through the level - only meaningful
	 * while isDying is true. Runtime-only, reset each session. */
	private isFallingThroughLevel = false;
	/** Runtime-only, reset each session like everything else above -
	 * whether the player is currently using the float ability (see
	 * shouldStartFloating/shouldStopFloating in movement.ts). */
	private isFloating = false;
	/** When the current airborne period began (Phaser's update() time,
	 * ms) - recorded the moment a normal jump triggers from the ground,
	 * used with FLOAT_MAX_DURATION_MS to cap the float budget for that
	 * whole airborne period (not per individual float - see
	 * hasFloatBudgetExpired in movement.ts for why). Always overwritten
	 * before it's ever compared against, so it doesn't need a separate
	 * session reset the way isFloating does. */
	private airborneStartTime = 0;
	/** Runtime-only, reset each session like everything else above - how
	 * long (ms) the dash key + a direction have been held continuously.
	 * See getPMeterValue/getMaxSpeedForDashState in movement.ts. */
	private pMeterMs = 0;
	// EXPERIMENTAL (purple's phase ability, on its own branch).
	/** Reference to the player/platforms collider so it can be toggled
	 * off while phasing and back on when not - Phaser colliders support
	 * this via their .active property without needing to destroy and
	 * recreate them. */
	private platformCollider!: Phaser.Physics.Arcade.Collider;
	/** When the dash key was last pressed (a fresh rising edge, not a
	 * continued hold) - used with PHASE_MAX_DURATION_MS to cap how long
	 * one dash-hold can phase for. Runtime-only, reset each session. */
	private dashHeldSinceTime = 0;
	/** For detecting the dash key's rising edge each frame - see
	 * dashHeldSinceTime above. Runtime-only, reset each session. */
	private wasDashHeldLastFrame = false;
	private cameraMode!: CameraMode;
	/** Only meaningful in 'quadrant' mode - which quadrant the camera is
	 * currently centered on, so update() can detect when the player has
	 * crossed into a different one. */
	private currentQuadrantIndex = 0;
	private wasPadJumpButtonDown = false;
	private wasTouchJumpDown = false;
	private gamepadStatusText!: Phaser.GameObjects.Text;
	private gamepadStatusTween?: Phaser.Tweens.Tween;
	private toggleKey!: Phaser.Input.Keyboard.Key;
	private dashKey!: Phaser.Input.Keyboard.Key;

	constructor() {
		super('PlatformerScene');
	}

	preload() {
		ensureCharacterAtlas(this);
		ensureTilesAtlas(this);
		ensureHazardAtlas(this);
		ensureEnemiesAtlas(this);
		ensureBackgroundsAtlas(this);
		ensureSounds(this);
	}

	create() {
		// Phaser reuses this same scene instance every time Play mode is
		// (re)entered rather than constructing a fresh one - field
		// declarations' default values (e.g. `hasWon = false`) only apply
		// once, at the object's true construction, not on a later
		// create() re-run. Anything that needs "fresh session" semantics
		// has to be explicitly reset here. Forgetting this for hasWon
		// specifically was a real bug: winning once left it permanently
		// true, so update() would return on its very first line - no
		// movement, not even Tab - on every session after the first win.
		this.hasWon = false;
		this.hasDied = false;
		this.raceMode = this.registry.get(RACE_MODE_KEY) === true;
		this.raceSnapshot = null;
		this.raceReadyEmitted = false;
		this.raceSprites = new Map();
		this.runElapsedMs = 0;
		this.ghostRecorder.reset();
		this.ghostSet = emptyGhostSet();
		this.ghostStage = null;
		this.ghostClockMs = 0;
		this.ghostSprite = null;
		this.ghostLabel = null;
		this.checkpoint = null;
		this.checkpointReached = false;
		// A (re)start waits for the player's first control before the
		// playtime clock runs again.
		this.playtime.resetControl();
		this.isDying = false;
		this.isFallingThroughLevel = false;
		this.wasPadJumpButtonDown = false;
		this.wasTouchJumpDown = false;
		this.collectedKeyColors = new Set();
		this.collectedKeysInOrder = [];
		this.playerPositionHistory = [];
		this.isFloating = false;
		this.pMeterMs = 0;
		this.dashHeldSinceTime = 0;
		this.wasDashHeldLastFrame = false;
		this.spiders = [];
		this.jumpAvailableUntil = 0;

		currentMode.set(CURRENT_MODE);

		this.physics.world.gravity.y = GRAVITY_Y;
		// No ground exists yet (real platforms come from actual level/screen
		// data later) - disable world-bounds collision on the bottom edge only,
		// so the player can fall through it, while still being contained on
		// the sides and top. This is a world-level setting, separate from a
		// body's own checkCollision (which governs body-to-body collisions,
		// not world-bounds collisions).
		this.physics.world.checkCollision.down = false;

		this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
		this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
		createScreenBackgrounds(this);
		this.cameraMode = ensureCameraMode(this);

		const storedPosition = this.registry.get(EDITOR_PLAYER_POSITION_KEY) as
			| PlayerPosition
			| undefined;
		const spawnPosition = resolveInitialPlayerPosition(storedPosition, DEFAULT_PLAYER_POSITION);

		// A reached checkpoint means this (re)start is a respawn there, not
		// a fresh start at the spawn. Progress left over from a level that
		// no longer has a checkpoint is dropped rather than trusted.
		const checkpointObjects =
			(this.registry.get(CHECKPOINT_OBJECTS_REGISTRY_KEY) as CheckpointObject[] | undefined) ?? [];
		let checkpointState = readCheckpointState(this.registry);
		const respawnPosition = getCheckpointRespawn(checkpointObjects, checkpointState);
		if (respawnPosition === null) {
			checkpointState = null;
			clearCheckpointProgress(this.registry);
		}
		const startPosition = respawnPosition ?? spawnPosition;

		// Every fresh Play session begins as the level's starting color,
		// discarding whatever the runtime color was left at by a previous
		// session's swaps - a swap should never leak into what a level
		// begins as, or into what the Editor shows.
		// ...except after a checkpoint respawn, which keeps the color the
		// player had when they touched it (the swap objects that gave it to
		// them are behind the checkpoint now).
		const startingColor = ensureStartingPlayerColor(this);
		const playerColor = checkpointState?.playerColor ?? startingColor;
		this.registry.set(PLAYER_COLOR_REGISTRY_KEY, playerColor);
		this.playerPoseConfig = getPlayerPoseConfig(playerColor);

		this.player = this.physics.add.sprite(
			startPosition.x,
			startPosition.y,
			CHARACTERS_ATLAS_KEY,
			this.playerPoseConfig.idle.frame
		);
		this.player.setDepth(PLAYER_DEPTH);
		this.player.setDisplaySize(PLAYER_DISPLAY_SIZE, PLAYER_DISPLAY_SIZE);
		// The source frame (128x128) is bigger than our 32px hitbox AND the
		// character art doesn't fill the frame edge-to-edge - Kenney pads
		// frames so different poses share one size, and this pose is
		// bottom-aligned with empty space above the head. Sizing the body
		// to the full frame (even scaled correctly) would center the
		// hitbox on the padded frame's middle, not on the character, which
		// is what caused collisions to register around the sprite's
		// midpoint instead of at its feet. Using the measured content
		// bounds (in the frame's own pre-scale units, which Phaser scales
		// down automatically to match the display scale) fits the hitbox
		// to the actual character silhouette instead.
		this.player.body?.setSize(
			this.playerPoseConfig.idle.hitbox.width,
			this.playerPoseConfig.idle.hitbox.height,
			false
		);
		this.player.body?.setOffset(
			this.playerPoseConfig.idle.hitbox.x,
			this.playerPoseConfig.idle.hitbox.y
		);
		this.currentPose = 'idle';
		this.player.setCollideWorldBounds(true);
		// Unconditional rebuild, not a guarded ensure* - the Animation
		// Manager is global and persists across scene restarts, so a
		// guard would wrongly skip rebuilding if a previous session's
		// character-swap left this animation registered for a different
		// color than this session's starting color. See
		// setPlayerWalkAnimationColor's own comment for the full story.
		setPlayerWalkAnimationColor(this, playerColor);
		this.createGhost(startPosition.x, startPosition.y, respawnPosition !== null);

		if (this.cameraMode === 'follow') {
			// A little smoothing (lerp < 1) reads as more polished than an
			// exact 1:1 follow - tune toward 1 for a snappier, more
			// immediate camera.
			this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
		} else {
			this.currentQuadrantIndex = getQuadrantIndex(this.player.x, this.player.y);
			const center = getQuadrantCenter(this.currentQuadrantIndex);
			this.cameras.main.centerOn(center.x, center.y);
		}

		this.platforms = this.physics.add.staticGroup();
		const placedObjects =
			(this.registry.get(PLACED_OBJECTS_REGISTRY_KEY) as PlacedObject[] | undefined) ?? [];
		const tilesByGroupId = new Map<string, PositionedTile[]>();
		// A lighter-weight parallel list (just x/y/groupId, not style) -
		// everything getPlatformBoundsForEnemy needs to work out which
		// platform a spider spawns on and how far it can patrol, without
		// that pure function needing to know about GroundPlacedObject at
		// all.
		const groundTilePositions: GroundTilePosition[] = [];
		for (const object of placedObjects) {
			if (object.type !== 'ground') {
				continue;
			}
			const tiles = tilesByGroupId.get(object.groupId) ?? [];
			tiles.push({ x: object.x, y: object.y, style: object.style, groupId: object.groupId });
			tilesByGroupId.set(object.groupId, tiles);
			groundTilePositions.push({ x: object.x, y: object.y, groupId: object.groupId });
		}
		for (const tiles of tilesByGroupId.values()) {
			for (const { x, y, frame } of getGroupFrames(tiles, GRID_SIZE)) {
				const tile = this.platforms.create(
					x,
					y,
					TILES_ATLAS_KEY,
					frame
				) as Phaser.Physics.Arcade.Sprite;
				tile.setDisplaySize(GRID_SIZE, GRID_SIZE);
				tile.refreshBody();
			}
		}
		this.platformCollider = this.physics.add.collider(this.player, this.platforms);

		// Hazard tiles: a spike strip that kills on touch (see die()
		// below) - a static physics group like platforms, but overlap
		// rather than a collider, since the whole point is that the
		// player passes into it rather than being physically blocked.
		this.hazards = this.physics.add.staticGroup();
		for (const object of placedObjects) {
			if (object.type !== 'hazard') continue;
			const rotation = getHazardRotation(object);
			const placement = getHazardPlacement(object.x, object.y, rotation);
			const tile = this.hazards.create(
				placement.x,
				placement.y,
				HAZARD_ATLAS_KEY,
				HAZARD_TILE_FRAME
			) as Phaser.Physics.Arcade.Sprite;
			if (rotation === 0) {
				tile.setDisplaySize(HAZARD_DISPLAY_WIDTH, HAZARD_DISPLAY_HEIGHT);
			} else {
				// A static body can't be turned, so a rotated spike gets an
				// invisible body sized to the turned strip (placement.width x
				// placement.height) and a separate, rotated image to draw.
				tile.setDisplaySize(placement.width, placement.height).setVisible(false);
				this.add
					.image(placement.x, placement.y, HAZARD_ATLAS_KEY, HAZARD_TILE_FRAME)
					.setDisplaySize(HAZARD_DISPLAY_WIDTH, HAZARD_DISPLAY_HEIGHT)
					.setAngle(placement.angle);
			}
			tile.refreshBody();
		}
		this.physics.add.overlap(this.player, this.hazards, () => this.die());

		// Spiders: patrol back and forth along whichever ground platform
		// they were placed on (see getPlatformBoundsForEnemy), turning
		// around at its edges. A real physics body (gravity + collider
		// against platforms, same as the player) rather than a kinematic
		// tween - this is what lets a spider rest naturally on its
		// platform and be stomped from above using the same kind of
		// position/velocity checks the player's own movement uses.
		this.spiderGroup = this.physics.add.group();
		for (const object of placedObjects) {
			if (object.type !== 'enemy' || object.enemyType !== 'spider') {
				continue;
			}

			const sprite = this.physics.add.sprite(object.x, object.y, ENEMIES_ATLAS_KEY, SPIDER_IDLE_FRAME);
			sprite.setDisplaySize(SPIDER_DISPLAY_WIDTH, SPIDER_DISPLAY_HEIGHT);
			sprite.refreshBody();
			// Narrower than the full sprite - see SPIDER_HITBOX_WIDTH_RATIO's
			// comment for why: without this, two spiders in adjacent cells
			// could register overlapping bodies and turn a clean stomp into
			// an accidental death from the neighbor. setOffset keeps the
			// body centered horizontally and planted at the sprite's feet
			// (not centered vertically), matching where a spider visually
			// stands.
			const spiderBody = sprite.body as Phaser.Physics.Arcade.Body;
			const hitbox = getSpiderHitboxSize(sprite.frame.width, sprite.frame.height);
			spiderBody.setSize(hitbox.width, hitbox.height);
			spiderBody.setOffset(
				(sprite.frame.width - hitbox.width) / 2,
				sprite.frame.height - hitbox.height
			);
			this.spiderGroup.add(sprite);

			const bounds = getPlatformBoundsForEnemy(groundTilePositions, object.x, object.y, GRID_SIZE);
			this.spiders.push({ sprite, direction: 1, bounds, isDead: false, lastWalkFrame: SPIDER_IDLE_FRAME });
		}
		// Reverses a spider's direction the instant it's physically blocked
		// sideways by a platform - not just when it reaches the edge of its
		// OWN platform (see getNextPatrolDirection/bounds above), but also
		// when a different, diagonally-offset platform happens to be close
		// enough to block it first. Without this, Arcade physics zeroes the
		// spider's velocity on contact but nothing ever tells it to turn
		// around, so it was getting stuck walking in place (animating, going
		// nowhere) against a neighboring platform it never reaches its own
		// bounds against.
		this.physics.add.collider(this.spiderGroup, this.platforms, (spiderObject) => {
			this.handleSpiderPlatformCollision(spiderObject as Phaser.Physics.Arcade.Sprite);
		});
		// Hazards are solid to spiders (unlike to the player, who dies on
		// touch instead - see the overlap set up above) - a spider that
		// patrols into one turns around exactly like it would at a
		// platform's edge or another spider, reusing the same reversal
		// logic since it only cares that it was blocked sideways, not what
		// it was blocked by.
		this.physics.add.collider(this.spiderGroup, this.hazards, (spiderObject) => {
			this.handleSpiderPlatformCollision(spiderObject as Phaser.Physics.Arcade.Sprite);
		});
		// Spiders collide with each other too (not just overlap) - this is
		// what keeps two spiders from ever actually occupying the same
		// space, whether they were placed right next to each other in the
		// Editor or walked into each other while patrolling. Arcade
		// physics separates colliding bodies on its own every step; the
		// callback just reverses each one's patrol direction on contact,
		// same as reaching the edge of its platform (see
		// handleSpiderCollision).
		this.physics.add.collider(this.spiderGroup, this.spiderGroup, (spiderObjectA, spiderObjectB) => {
			this.handleSpiderCollision(spiderObjectA as Phaser.Physics.Arcade.Sprite);
			this.handleSpiderCollision(spiderObjectB as Phaser.Physics.Arcade.Sprite);
		});
		this.physics.add.overlap(this.player, this.spiderGroup, (_player, spiderObject) => {
			this.handlePlayerSpiderOverlap(spiderObject as Phaser.Physics.Arcade.Sprite);
		});

		const swapObjectsData =
			(this.registry.get(CHARACTER_SWAP_OBJECTS_REGISTRY_KEY) as
				| CharacterSwapObject[]
				| undefined) ?? [];

		// Floating character-swap objects. Rendered as plain images (not
		// physics bodies) with a bobbing tween - see isWithinSwapRange in
		// characterSwapObjects.ts for why a tween-driven position isn't
		// paired with an Arcade body. Bobbing (and the cooldown visuals)
		// are Play-mode-only - the Editor renders these as plain static
		// images (see LevelEditorScene's refreshSwapObjectImages).
		this.swapObjects = swapObjectsData.map((originalData) => {
			// Copy rather than reuse the reference straight from the
			// registry - CharacterSwapObject is a plain object, and
			// mutating swapObject.data.color later (on a swap) would
			// otherwise mutate the exact same object still sitting inside
			// the registry's stored array, corrupting the level's design
			// data with no explicit registry.set() call even needed to do
			// it. A shallow copy is enough since every field here is a
			// primitive (x, y, color).
			const data: CharacterSwapObject = { ...originalData };

			const sprite = this.add
				.image(data.x, data.y, TILES_ATLAS_KEY, getCharacterSwapObjectFrame(data.color))
				.setDisplaySize(SWAP_OBJECT_DISPLAY_SIZE, SWAP_OBJECT_DISPLAY_SIZE);

			const bobTween = this.tweens.add({
				targets: sprite,
				y: data.y - SWAP_OBJECT_BOB_DISTANCE_PX,
				duration: SWAP_OBJECT_BOB_DURATION_MS,
				yoyo: true,
				repeat: -1,
				ease: 'Sine.easeInOut'
			});

			return { data, sprite, bobTween, onCooldown: false };
		});

		const doorsData =
			(this.registry.get(DOOR_OBJECTS_REGISTRY_KEY) as DoorObject[] | undefined) ?? [];

		// Doors are stationary (no bobbing tween needed) and always start
		// closed - see the TrackedDoor.isOpen comment for why that's
		// runtime-only rather than read from the registry.
		this.doors = doorsData.map((data) => {
			const sprite = this.add
				.image(data.x, data.y, TILES_ATLAS_KEY, getDoorClosedFrame(data.requiresKey))
				.setDisplaySize(GRID_SIZE, GRID_SIZE);

			return { data: { ...data }, sprite, isOpen: false };
		});

		const keysData =
			(this.registry.get(KEY_OBJECTS_REGISTRY_KEY) as KeyObject[] | undefined) ?? [];

		// Keys use a real physics body and Arcade overlap detection
		// (rather than the distance-check pattern doors/swap objects use)
		// since collection specifically requires the player to touch one,
		// not just be nearby. Gravity is disabled so a key doesn't fall;
		// using overlap (not a collider) means nothing physically blocks
		// movement, matching "will not collide with anything."
		this.uncollectedKeysGroup = this.physics.add.group();
		this.keys = keysData.map((data) => {
			const sprite = this.physics.add.sprite(data.x, data.y, TILES_ATLAS_KEY, getKeyFrame(data.color));
			sprite.setDisplaySize(GRID_SIZE, GRID_SIZE);
			const body = sprite.body as Phaser.Physics.Arcade.Body;
			body.setAllowGravity(false);
			this.uncollectedKeysGroup.add(sprite);

			return { data: { ...data }, sprite, isCollected: false };
		});

		this.physics.add.overlap(this.player, this.uncollectedKeysGroup, (_player, keySprite) => {
			const tracked = this.keys.find((key) => key.sprite === keySprite);
			if (tracked && !tracked.isCollected) {
				this.collectKey(tracked);
			}
		});

		// The checkpoint flag: grey until touched, then waving. A respawn
		// starts with it already active, and with the keys and swap
		// objects put back the way they were when it was touched.
		const checkpointData = checkpointObjects[0];
		if (checkpointData) {
			const sprite = this.add
				.image(checkpointData.x, checkpointData.y, TILES_ATLAS_KEY, CHECKPOINT_INACTIVE_FRAME)
				.setDisplaySize(GRID_SIZE, GRID_SIZE);
			this.checkpoint = { data: { ...checkpointData }, sprite, animationTimer: null };
			if (checkpointState !== null) {
				this.checkpointReached = true;
				this.restoreCheckpointState(checkpointState);
				this.activateCheckpointFlag();
			}
		}

		if (!this.input.keyboard) {
			throw new Error('Keyboard input plugin is not available');
		}

		this.wasd = {
			w: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
			a: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
			s: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
			d: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D)
		};
		this.arrows = this.input.keyboard.createCursorKeys();
		this.toggleKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TAB);
		this.dashKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

		// Character HUD - top-left corner. Portraits live in the TILES
		// atlas (not the character atlas).
		// Center origin (rather than top-left) so the shrink/grow swap
		// animation pops symmetrically around a fixed point, matching how
		// the swap objects themselves animate - position is offset by
		// half the size so the visible footprint still sits flush in the
		// corner, unchanged from a plain top-left placement.
		this.hudPortrait = this.add
			.image(
				10 + HUD_PORTRAIT_SIZE / 2,
				10 + HUD_PORTRAIT_SIZE / 2,
				TILES_ATLAS_KEY,
				getPlayerHudFrame(playerColor)
			)
			.setDisplaySize(HUD_PORTRAIT_SIZE, HUD_PORTRAIT_SIZE)
			.setDepth(HUD_DEPTH)
			.setScrollFactor(0);

		// Only shown when there's actually somewhere to toggle to. A
		// public /play/[slug] session never registers LevelEditorScene at
		// all (see gameConfig.ts) - a stranger playing someone else's
		// level has no edit mode to switch to, so telling them about a
		// Tab shortcut that does nothing would just be confusing.
		if (this.scene.get('LevelEditorScene')) {
			this.add
				.text(68, 26, 'Tab: switch to Edit Mode', {
					font: '14px monospace',
					color: '#aaaaaa'
				})
				.setDepth(HUD_DEPTH)
				.setScrollFactor(0);
		}

		this.gamepadStatusText = this.add
			.text(10, 68, '', { font: '14px monospace', color: '#ffffff' })
			.setAlpha(0)
			.setDepth(HUD_DEPTH)
			.setScrollFactor(0);

		this.input.gamepad?.on('connected', (pad: Phaser.Input.Gamepad.Gamepad) => {
			this.showGamepadStatus(`Gamepad connected: ${pad.id}`);
		});
		this.input.gamepad?.on('disconnected', (pad?: Phaser.Input.Gamepad.Gamepad) => {
			this.showGamepadStatus(`Gamepad disconnected${pad ? `: ${pad.id}` : ''}`);
		});
	}

	private showGamepadStatus(message: string) {
		this.gamepadStatusTween?.stop();

		this.gamepadStatusText.setText(message);
		this.gamepadStatusText.setAlpha(1);

		this.gamepadStatusTween = this.tweens.add({
			targets: this.gamepadStatusText,
			alpha: 0,
			delay: GAMEPAD_MESSAGE_HOLD_MS,
			duration: GAMEPAD_MESSAGE_FADE_MS,
			ease: 'Linear'
		});
	}

	/**
	 * Applies a character swap: the player takes on the touched object's
	 * color, the object is left holding the player's old color (both
	 * visually and in the data persisted back to the registry, so it
	 * survives toggling to the Editor and back). Puts the object on
	 * cooldown - pauses its bob and dims it - until the player moves far
	 * enough away (see reactivateSwapObject).
	 */
	private handleCharacterSwap(swapObject: TrackedSwapObject) {
		playSfx(this, 'characterSwap');

		const currentPlayerColor = (this.registry.get(PLAYER_COLOR_REGISTRY_KEY) as
			| PlayerColor
			| undefined) ?? swapObject.data.color;
		const { newPlayerColor, newObjectColor } = getSwapResult(
			currentPlayerColor,
			swapObject.data.color
		);

		this.registry.set(PLAYER_COLOR_REGISTRY_KEY, newPlayerColor);
		this.playerPoseConfig = getPlayerPoseConfig(newPlayerColor);
		setPlayerWalkAnimationColor(this, newPlayerColor);
		// Stop whatever's currently playing before the animation swap -
		// setPlayerWalkAnimationColor rebuilds the 'player-walk'
		// animation under the same key, but the sprite's own animation
		// state can still report "already playing player-walk" by key
		// match alone, even though the underlying frames just changed.
		// anims.play(key, true) below (see the pose-transition block)
		// would then silently skip rebinding to the new frames, since its
		// ignoreIfPlaying guard only checks the key, not whether the
		// definition changed. Stopping first guarantees the next play()
		// call always binds fresh.
		this.player.anims.stop();
		// Force the pose-transition block in update() to re-apply on the
		// very next frame even if the pose name itself (e.g. "idle")
		// hasn't changed - only its underlying frame/hitbox meaning has,
		// via the new playerPoseConfig above.
		this.currentPose = null;
		this.animateHudPortraitSwap(newPlayerColor);

		if (this.isFloating && !canFloat(newPlayerColor)) {
			// Swapped away from a float-capable character while mid-float -
			// the new character can't float, so stop immediately rather
			// than leaving gravity disabled for a character that shouldn't
			// have this ability at all.
			this.stopFloating();
		}

		// The object's color is only updated in memory here, for the rest
		// of this Play session - deliberately not written back to
		// CHARACTER_SWAP_OBJECTS_REGISTRY_KEY. That key is the level's
		// design data (what the Editor placed and shows); a mid-session
		// swap changing an object's held color is exactly the kind of
		// runtime-only state that should never leak back into it, same
		// principle as the player's own color (see playerColor.ts).
		swapObject.data.color = newObjectColor;
		swapObject.sprite.setTexture(TILES_ATLAS_KEY, getCharacterSwapObjectFrame(newObjectColor));

		swapObject.onCooldown = true;
		swapObject.bobTween.pause();
		swapObject.sprite.setAlpha(SWAP_COOLDOWN_OPACITY);
		swapObject.sprite.setDisplaySize(
			SWAP_OBJECT_DISPLAY_SIZE * SWAP_COOLDOWN_SCALE,
			SWAP_OBJECT_DISPLAY_SIZE * SWAP_COOLDOWN_SCALE
		);
	}

	/**
	 * Animates the HUD portrait through the swap: shrinks the outgoing
	 * portrait away, swaps its texture at the smallest point (so the
	 * change itself isn't visible mid-size), then grows back in via the
	 * shared pop animation (see playPopAnimation) - the same one a swap
	 * object's own reactivation uses, for visual consistency between the
	 * two.
	 */
	private animateHudPortraitSwap(newColor: PlayerColor) {
		this.playPopAnimation(this.hudPortrait, HUD_PORTRAIT_SIZE, () => {
			this.hudPortrait.setTexture(TILES_ATLAS_KEY, getPlayerHudFrame(newColor));
		});
	}

	/**
	 * Runs once the player has moved far enough away from a
	 * just-triggered object: the shared pop animation, then resumes
	 * normal bobbing and full opacity, and clears the cooldown so it can
	 * trigger again.
	 */
	private reactivateSwapObject(swapObject: TrackedSwapObject) {
		swapObject.sprite.setAlpha(1);
		this.playPopAnimation(swapObject.sprite, SWAP_OBJECT_DISPLAY_SIZE, undefined, () => {
			swapObject.bobTween.resume();
			swapObject.onCooldown = false;
		});
	}

	/**
	 * Shrink -> overshoot -> settle "pop" (25% -> 115% -> 100%), shared by
	 * the HUD portrait's swap transition and a swap object's reactivation
	 * - the only difference between the two is what's being animated,
	 * what (if anything) happens at the smallest point, and what (if
	 * anything) happens once it's fully settled.
	 */
	private playPopAnimation(
		target: Phaser.GameObjects.Image,
		baseSize: number,
		atSmallest?: () => void,
		onComplete?: () => void
	) {
		this.tweens.add({
			targets: target,
			displayWidth: baseSize * SWAP_REACTIVATE_SHRINK_SCALE,
			displayHeight: baseSize * SWAP_REACTIVATE_SHRINK_SCALE,
			duration: SWAP_REACTIVATE_SHRINK_DURATION_MS,
			onComplete: () => {
				atSmallest?.();
				this.tweens.add({
					targets: target,
					displayWidth: baseSize * SWAP_REACTIVATE_OVERSHOOT_SCALE,
					displayHeight: baseSize * SWAP_REACTIVATE_OVERSHOOT_SCALE,
					duration: SWAP_REACTIVATE_OVERSHOOT_DURATION_MS,
					onComplete: () => {
						this.tweens.add({
							targets: target,
							displayWidth: baseSize,
							displayHeight: baseSize,
							duration: SWAP_REACTIVATE_SETTLE_DURATION_MS,
							onComplete
						});
					}
				});
			}
		});
	}

	/**
	 * Opens a door: swaps both halves to their open frames and triggers
	 * the win state. Opening a door *is* the win condition for this
	 * first pass - there's no separate "walk through it" step.
	 */
	private openDoor(door: TrackedDoor) {
		door.isOpen = true;
		door.sprite.setTexture(TILES_ATLAS_KEY, getDoorOpenFrame(door.data.requiresKey));
		this.triggerWin();
	}

	/**
	 * Marks a key as collected: removes it from overlap checking (so it
	 * can't be "collected" again), shrinks it to its carried size, moves
	 * it above the player in the render order, records its color as held
	 * (for canOpenDoor checks), and appends it to the trailing-chain
	 * order (see updateKeys).
	 */
	private collectKey(key: TrackedKey, silent = false) {
		key.isCollected = true;
		this.uncollectedKeysGroup.remove(key.sprite, false, false);
		key.sprite.disableBody(false, false);
		key.sprite.setDisplaySize(KEY_COLLECTED_DISPLAY_SIZE, KEY_COLLECTED_DISPLAY_SIZE);
		key.sprite.setDepth(KEY_FOLLOW_DEPTH);
		this.collectedKeyColors.add(key.data.color);
		this.collectedKeysInOrder.push(key);
		if (!silent) {
			playSfx(this, 'key');
		}
	}

	/**
	 * Positions every key each frame: uncollected keys bob in place at
	 * their placed position; collected keys form a trailing chain behind
	 * the player, each one following a delayed sample of the player's own
	 * recent path (not a fixed offset) - the Nth collected key trails
	 * KEY_TRAIL_SPACING_FRAMES * N frames behind, so the chain visibly
	 * follows wherever the player actually walked, including turns and
	 * jumps.
	 */
	private updateKeys(time: number) {
		const bobOffset = Math.sin((time / KEY_BOB_PERIOD_MS) * Math.PI * 2) * KEY_BOB_AMPLITUDE;

		this.playerPositionHistory.push({ x: this.player.x, y: this.player.y });
		const maxHistoryLength =
			KEY_TRAIL_SPACING_FRAMES * Math.min(this.collectedKeysInOrder.length, MAX_POSSIBLE_KEYS) + 1;
		while (this.playerPositionHistory.length > maxHistoryLength) {
			this.playerPositionHistory.shift();
		}

		this.collectedKeysInOrder.forEach((key, index) => {
			const delayFrames = KEY_TRAIL_SPACING_FRAMES * (index + 1);
			const historyIndex = this.playerPositionHistory.length - 1 - delayFrames;
			const target =
				this.playerPositionHistory[Math.max(0, historyIndex)] ??
				this.playerPositionHistory[0];
			key.sprite.setPosition(target.x, target.y + bobOffset);
		});

		for (const key of this.keys) {
			if (!key.isCollected) {
				// body.reset() rather than sprite.setPosition() - the key
				// still has an active physics body (needed for overlap
				// detection), and setPosition() alone doesn't stop Arcade
				// Physics from separately integrating gravity/velocity onto
				// the body each step and overwriting our manual position.
				// reset() moves both the sprite and the body together and
				// zeroes velocity, so nothing is left to drift. This was
				// the actual cause of keys slowly sinking off-screen.
				const body = key.sprite.body as Phaser.Physics.Arcade.Body;
				body.reset(key.data.x, key.data.y + bobOffset);
			}
		}
	}

	/**
	 * In 'quadrant' camera mode, checks whether the player has crossed
	 * into a different quadrant this frame and, if so, pans the camera
	 * there with a linear (constant-speed) tween. No-op in 'follow' mode
	 * - that camera tracks the player continuously via startFollow
	 * instead, set up once in create().
	 */
	private updateQuadrantCamera() {
		if (this.cameraMode !== 'quadrant') {
			return;
		}

		const quadrant = getQuadrantIndex(this.player.x, this.player.y);
		if (quadrant === this.currentQuadrantIndex) {
			return;
		}
		this.currentQuadrantIndex = quadrant;

		const center = getQuadrantCenter(quadrant);
		this.tweens.add({
			targets: this.cameras.main,
			scrollX: center.x - VIEWPORT_WIDTH / 2,
			scrollY: center.y - VIEWPORT_HEIGHT / 2,
			duration: QUADRANT_TRANSITION_DURATION_MS,
			ease: 'Linear'
		});
	}

	/**
	 * Adds the level's ghost - the fastest recorded clear - as a
	 * translucent, tinted character with its owner's name above it, if any
	 * were seeded into the registry. Public play only: the editor's own
	 * test-play has no record to race.
	 *
	 * Which ghost runs first depends on how this stretch started. A player
	 * respawning at the checkpoint races the after ghost. One starting at
	 * the spawn races whichever route is faster (see chooseGhostRoute): the
	 * full ghost, or the before ghost - which hands over to the after
	 * ghost the moment this player touches the checkpoint (see
	 * reachCheckpoint).
	 */
	private createGhost(startX: number, startY: number, startedAtCheckpoint: boolean) {
		if (this.scene.get('LevelEditorScene')) {
			return;
		}

		const set = (this.registry.get(GHOSTS_REGISTRY_KEY) as GhostSet | undefined) ?? emptyGhostSet();
		const sample = set.full ?? set.before ?? set.after;
		if (!sample) {
			return;
		}

		this.ghostSet = set;
		this.ghostClockMs = 0;
		if (startedAtCheckpoint) {
			this.ghostStage = 'after';
		} else {
			const route = chooseGhostRoute(set);
			this.ghostStage = route === null ? null : route.kind === 'full' ? 'full' : 'before';
		}

		const first = decodeGhostState(sample.frames[0]?.[2] ?? 0);
		this.ghostSprite = this.add
			.sprite(startX, startY, CHARACTERS_ATLAS_KEY, getPlayerFrameForPose(first.color, first.pose, 0))
			.setDepth(PLAYER_DEPTH - 0.5)
			.setDisplaySize(PLAYER_DISPLAY_SIZE, PLAYER_DISPLAY_SIZE)
			.setAlpha(0.45)
			.setTint(0x9ad0ff);
		this.ghostLabel = this.add
			.text(startX, startY - PLAYER_DISPLAY_SIZE / 2 - 4, '', {
				font: '12px monospace',
				color: '#cfe6ff'
			})
			.setOrigin(0.5, 1)
			.setAlpha(0.7)
			.setDepth(PLAYER_DEPTH - 0.5);
		this.showCurrentGhost();
	}

	/** The ghost being replayed right now, or null (none exists for this stage, or it has no frames). */
	private getCurrentGhostRun(): GhostRun | null {
		const run = this.ghostStage ? this.ghostSet[this.ghostStage] : null;
		return run && run.frames.length > 0 ? run : null;
	}

	/** Shows (or hides) the ghost sprite for the current stage, with its holder's name. */
	private showCurrentGhost() {
		const run = this.getCurrentGhostRun();
		this.ghostSprite?.setVisible(run !== null);
		this.ghostLabel?.setVisible(run !== null);
		this.ghostLabel?.setText(run?.username ?? '');
	}

	/**
	 * Moves the ghost to where its run was at the ghost clock's current
	 * time. Once the run has played through it lingers briefly at the
	 * finish, then disappears - it shouldn't sit on top of the goal (or
	 * the checkpoint) for a slower player's whole attempt.
	 */
	private updateGhost() {
		const run = this.getCurrentGhostRun();
		if (!run || !this.ghostSprite || !this.ghostLabel) {
			return;
		}

		const sample = sampleGhost(run.frames, run.sampleIntervalMs, this.ghostClockMs);
		if (!sample) {
			return;
		}

		if (sample.finished && this.ghostClockMs > run.durationMs + 400) {
			this.ghostSprite.setVisible(false);
			this.ghostLabel.setVisible(false);
			return;
		}

		const state = decodeGhostState(sample.state);
		this.ghostSprite.setPosition(sample.x, sample.y);
		this.ghostSprite.setTexture(
			CHARACTERS_ATLAS_KEY,
			getPlayerFrameForPose(state.color, state.pose, this.ghostClockMs)
		);
		this.ghostSprite.setFlipX(state.facingLeft);
		this.ghostLabel.setPosition(sample.x, sample.y - PLAYER_DISPLAY_SIZE / 2 - 4);
	}

	/** Hands the play page the playtime counted since its last report (ms). */
	takePlaytimeMs(): number {
		return this.playtime.take();
	}

	/** A report failed: puts its time back so the next one carries it. */
	returnPlaytimeMs(ms: number): void {
		this.playtime.giveBack(ms);
	}

	/**
	 * Puts the flag into its active, waving state. Called when the
	 * checkpoint is touched and again at the start of every respawn there.
	 */
	private activateCheckpointFlag() {
		if (!this.checkpoint) {
			return;
		}
		let frameIndex = 0;
		this.checkpoint.sprite.setTexture(TILES_ATLAS_KEY, CHECKPOINT_ACTIVE_FRAMES[frameIndex]);
		this.checkpoint.animationTimer?.remove(false);
		this.checkpoint.animationTimer = this.time.addEvent({
			delay: CHECKPOINT_ANIMATION_INTERVAL_MS,
			loop: true,
			callback: () => {
				frameIndex = (frameIndex + 1) % CHECKPOINT_ACTIVE_FRAMES.length;
				this.checkpoint?.sprite.setTexture(TILES_ATLAS_KEY, CHECKPOINT_ACTIVE_FRAMES[frameIndex]);
			}
		});
	}

	/**
	 * The player just touched the checkpoint. Captures everything a
	 * respawn here has to restore (keys held, character color, swap-object
	 * colors), keeps the finished spawn-to-checkpoint stretch for the ghost
	 * submission at the finish, and starts the after-checkpoint stretch:
	 * the recorder and its clock begin again from here, and a ghost that
	 * was racing the before stretch hands over to the after ghost.
	 */
	private reachCheckpoint() {
		this.checkpointReached = true;

		const state: CheckpointState = {
			playerColor:
				(this.registry.get(PLAYER_COLOR_REGISTRY_KEY) as PlayerColor | undefined) ?? 'green',
			collectedKeys: this.collectedKeysInOrder.map((key) => ({ x: key.data.x, y: key.data.y })),
			swapObjectColors: this.swapObjects.map((swapObject) => swapObject.data.color)
		};
		// Touching it ends the stretch that began at the spawn - it can't
		// contain a death, or the level would have restarted it.
		const beforeRun = this.ghostRecorder.finish(this.runElapsedMs);
		writeCheckpointCarry(this.registry, { state, beforeRun });

		this.ghostRecorder.reset();
		this.runElapsedMs = 0;

		// A full ghost keeps running past the checkpoint - it never touched
		// it. The before ghost, though, ends here and the after ghost takes
		// over from the checkpoint.
		if (this.ghostStage === 'before') {
			this.ghostStage = 'after';
			this.ghostClockMs = 0;
			this.showCurrentGhost();
		}

		this.activateCheckpointFlag();
		playSfx(this, 'key');
	}

	/**
	 * Puts back what the player had when they touched the checkpoint:
	 * the keys they held (so a key behind the checkpoint can't be lost for
	 * good) and each swap object's color (so the swap objects they already
	 * used don't hand out their original color a second time).
	 */
	private restoreCheckpointState(state: CheckpointState) {
		for (const position of state.collectedKeys) {
			const key = this.keys.find(
				(candidate) =>
					!candidate.isCollected && candidate.data.x === position.x && candidate.data.y === position.y
			);
			if (key) {
				this.collectKey(key, true);
			}
		}

		state.swapObjectColors.forEach((color, index) => {
			const swapObject = this.swapObjects[index];
			if (swapObject) {
				swapObject.data.color = color;
				swapObject.sprite.setTexture(TILES_ATLAS_KEY, getCharacterSwapObjectFrame(color));
			}
		});
	}

	/**
	 * Freezes the player, shows a brief "Level Cleared!" message, and
	 * returns to the Editor after a short delay. update() checks hasWon
	 * first thing and returns early once true, so nothing else (movement,
	 * jumping, falling off screen, Tab) can interrupt this once it starts.
	 */
	private triggerWin() {
		this.hasWon = true;
		if (this.raceMode) {
			// The race page tells the room straight away; the usual delayed
			// result event below isn't listened to there.
			this.game.events.emit(RACE_FINISHED_EVENT);
		}
		this.player.setVelocity(0, 0);
		const body = this.player.body as Phaser.Physics.Arcade.Body | null;
		if (body) {
			body.allowGravity = false;
		}
		playSfx(this, 'win');

		// Always emitted, in both contexts - /edit/[slug]'s page listens
		// for this to call the beat API (only meaningful there), and
		// /play/[slug]'s page listens for the same event to show its
		// result modal (only meaningful there). Each page owns its own
		// separate Phaser game instance, so there's no cross-talk between
		// the two - emitting unconditionally just means whichever page
		// is actually hosting this scene hears it. This used to be
		// gated behind an editor-scene check (a public play-through
		// "isn't a beat that matters for publishing"), which was true
		// for the beat-API purpose but also meant a public win never
		// told the page anything at all - nothing ever showed the result
		// modal, so the level just sat on "Level Cleared!" forever.
		//
		// The public path delays this the same way triggerDeath() delays
		// LEVEL_DIED_EVENT - room for a win sound to play before the modal
		// covers the screen. The editor's own listener just records the
		// beat and isn't shown anything timed off this event, so it keeps
		// firing immediately rather than waiting on a delay that exists
		// for the result modal's sake.
		// What this playthrough produced: one full run, or - if the
		// checkpoint was reached - the spawn-to-checkpoint stretch kept when
		// it was touched plus the final stretch from there to the door.
		// Progress is forgotten here, so a replay after a win starts from
		// the spawn again.
		const finalStretch = this.ghostRecorder.finish(this.runElapsedMs);
		const beforeRun = readCheckpointBeforeRun(this.registry);
		const reachedCheckpoint = readCheckpointState(this.registry) !== null;
		const clearedRuns: ClearedRuns = reachedCheckpoint
			? beforeRun
				? { before: beforeRun, after: finalStretch }
				: { after: finalStretch }
			: { full: finalStretch };
		clearCheckpointProgress(this.registry);

		const editorScene = this.scene.get('LevelEditorScene');
		if (editorScene) {
			this.game.events.emit(LEVEL_BEATEN_EVENT, clearedRuns);
		} else {
			this.time.delayedCall(RESULT_MODAL_DELAY_MS, () => {
				this.game.events.emit(LEVEL_BEATEN_EVENT, clearedRuns);
			});
		}

		this.add
			.text(this.scale.width / 2, this.scale.height / 2, 'Level Cleared!', {
				font: '32px monospace',
				color: '#ffd23f'
			})
			.setOrigin(0.5)
			.setDepth(HUD_DEPTH)
			.setScrollFactor(0);

		// Same reasoning as the emit above: toggling "back to the
		// editor" only makes sense when there's an editor to go back to.
		// A public /play/[slug] session has nowhere else to transition
		// to yet, so it just stays on this cleared screen rather than
		// trying to start a scene that was never registered.
		if (editorScene) {
			this.time.delayedCall(WIN_DISPLAY_DURATION_MS, () => {
				const nextMode = toggleMode(CURRENT_MODE);
				this.scene.start(getSceneKeyForMode(nextMode));
			});
		}
	}

	/**
	 * Shared by every way a playthrough can end in death: falling off
	 * the world with nothing underneath, touching a hazard tile, or
	 * touching a spider other than stomping it (see the overlaps set up
	 * in create()). Rather than resolving the outcome immediately, this
	 * kicks off the shared death sequence - freeze on the hit frame,
	 * then fall through the level - and the actual outcome (editor
	 * bounce-back, or the public result modal) only fires once that
	 * sequence reaches the bottom (see finishDeathFall). isDying guards
	 * against running this twice in the same physics step - e.g. the
	 * player's body overlapping more than one hazard tile at once.
	 */
	private die() {
		if (this.hasWon || this.hasDied || this.isDying) {
			return;
		}
		this.isDying = true;
		this.isFallingThroughLevel = false;

		playSfx(this, 'death');

		// Freeze exactly where they died - zero velocity and gravity off
		// so the pause is a true hold in place, not just a slow drift -
		// and switch to the character's hit frame. update() already
		// skips the normal per-frame pose logic once isDying is true
		// (see the top of update()), so nothing overwrites this texture
		// until the fall sequence itself changes it again.
		this.player.setVelocity(0, 0);
		const body = this.player.body as Phaser.Physics.Arcade.Body | null;
		if (body) {
			body.allowGravity = false;
		}
		this.player.anims.stop();
		const currentPlayerColor = this.registry.get(PLAYER_COLOR_REGISTRY_KEY) as
			| PlayerColor
			| undefined;
		if (currentPlayerColor) {
			this.player.setTexture(CHARACTERS_ATLAS_KEY, getPlayerHitFrame(currentPlayerColor));
		}

		this.time.delayedCall(DEATH_FREEZE_DURATION_MS, () => {
			// Falling through every tile beneath them, rather than
			// resting back on whatever they died on top of, needs the
			// player/platforms collider itself turned off - the same
			// collider the (experimental) phase ability already toggles
			// via this .active flag, see update()'s isPhasing handling.
			this.platformCollider.active = false;
			if (body) {
				body.allowGravity = true;
			}
			this.isFallingThroughLevel = true;
		});
	}

	/**
	 * Runs once the post-death fall (see die()) has carried the player
	 * DEATH_FALL_THRESHOLD_PX below the bottom of the world - the point
	 * at which the death sequence is considered finished and the actual
	 * outcome fires. In the editor (testing your own level), that means
	 * bouncing back to Edit Mode, same as a death always has; in a
	 * public /play/[slug] session, it's the triggerDeath() path below
	 * instead.
	 */
	private finishDeathFall() {
		if (this.scene.get('LevelEditorScene')) {
			// Testing your own level: once the checkpoint has been
			// reached, a death restarts the test there instead of
			// bouncing back to Edit Mode - otherwise the part of the level
			// after the checkpoint would take a full run from the start to
			// test every time.
			if (readCheckpointState(this.registry) !== null) {
				this.scene.restart();
				return;
			}
			const nextMode = toggleMode(CURRENT_MODE);
			this.scene.start(getSceneKeyForMode(nextMode));
			return;
		}

		this.triggerDeath();
	}

	/**
	 * The public-play-only conclusion of a death (see finishDeathFall
	 * above) - marks the session as died (update() returns immediately
	 * from here on, same as hasWon) and emits LEVEL_DIED_EVENT for the
	 * hosting Svelte page to react to. Doesn't restart the scene itself:
	 * the result modal that event triggers offers Replay as an explicit
	 * action (which does restart it, via the same scene.restart()
	 * create() already resets everything for), rather than yanking the
	 * level back to its start the instant the fall finishes.
	 */
	private triggerDeath() {
		this.hasDied = true;
		// With a checkpoint reached the host respawns the player straight
		// away (no result modal), so there's nothing to leave room for -
		// the freeze and fall already paced the death.
		if (this.raceMode || readCheckpointState(this.registry) !== null) {
			this.game.events.emit(LEVEL_DIED_EVENT);
			return;
		}
		// Room for the death sound/fall animation to actually finish
		// playing out before the screen gets covered by a result modal -
		// same delay, and same reasoning, as triggerWin()'s own delay.
		this.time.delayedCall(RESULT_MODAL_DELAY_MS, () => {
			this.game.events.emit(LEVEL_DIED_EVENT);
		});
	}

	/**
	 * Moves and animates every living spider: continues patrolling in its
	 * current direction, reversing at its platform's edges (see
	 * getNextPatrolDirection), and advances its walk-cycle frame. A dead
	 * spider is skipped entirely - its death animation (playSpiderDeathAnimation)
	 * owns its texture from the moment it's stomped.
	 */
	private updateSpiders(time: number) {
		for (const spider of this.spiders) {
			if (spider.isDead) {
				continue;
			}

			if (!spider.bounds) {
				// No ground tile directly beneath this spider's spawn point
				// - nothing to patrol along, so it just stands in place
				// rather than wandering over open air.
				spider.sprite.setVelocityX(0);
				continue;
			}

			spider.direction = getNextPatrolDirection(spider.sprite.x, spider.direction, spider.bounds);
			spider.sprite.setVelocityX(SPIDER_PATROL_SPEED * spider.direction);
			spider.sprite.setFlipX(spider.direction > 0);

			const frame = getSpiderWalkFrame(time);
			if (frame !== spider.lastWalkFrame) {
				spider.sprite.setTexture(ENEMIES_ATLAS_KEY, frame);
				spider.lastWalkFrame = frame;
			}
		}
	}

	/**
	 * Reverses a spider's patrol direction on contact with another
	 * spider - the same reaction as reaching the edge of its platform
	 * (see getNextPatrolDirection), just triggered by a neighbor instead
	 * of running out of ground. Arcade physics has already separated the
	 * two bodies by the time this callback runs; this only decides which
	 * way each one heads next. A dead spider's body is disabled (see
	 * killSpider) so it never reaches this callback in the first place,
	 * but the isDead check is kept anyway as a defensive no-op.
	 */
	private handleSpiderCollision(spiderSprite: Phaser.Physics.Arcade.Sprite) {
		const spider = this.spiders.find((tracked) => tracked.sprite === spiderSprite);
		if (!spider || spider.isDead) {
			return;
		}
		spider.direction = spider.direction === 1 ? -1 : 1;
	}

	/**
	 * Reverses a spider's patrol direction when it's physically blocked
	 * sideways by something solid - a platform tile (e.g. a different,
	 * diagonally-offset platform placed close enough to collide with it
	 * before it ever reaches its own platform's computed bounds, see
	 * getPlatformBoundsForEnemy) or a hazard tile (solid to spiders, even
	 * though the player dies on touching one instead - see the player/
	 * hazards overlap set up in create()). Only reacts to a horizontal
	 * block (blocked.left/right) - landing on top of something
	 * (blocked.down) is completely normal and shouldn't flip the patrol
	 * direction.
	 */
	private handleSpiderPlatformCollision(spiderSprite: Phaser.Physics.Arcade.Sprite) {
		const spider = this.spiders.find((tracked) => tracked.sprite === spiderSprite);
		if (!spider || spider.isDead) {
			return;
		}
		const body = spiderSprite.body as Phaser.Physics.Arcade.Body;
		if (body.blocked.left || body.blocked.right) {
			spider.direction = spider.direction === 1 ? -1 : 1;
		}
	}

	/**
	 * Decides what touching a given spider means: landing on top of it
	 * (a stomp - see isStompHit) kills it, anything else (walking into it
	 * from the side, or being hit from underneath) kills the player, same
	 * as a hazard tile. Looks the sprite back up in this.spiders (the
	 * overlap callback only gives back the GameObject, not which tracked
	 * spider it belongs to) and bails out if it's already dead - a body
	 * stays enabled for the first physics step a kill happens in, so the
	 * overlap can still fire once more that same step before killSpider's
	 * body.enable = false takes effect.
	 */
	private handlePlayerSpiderOverlap(spiderSprite: Phaser.Physics.Arcade.Sprite) {
		const spider = this.spiders.find((tracked) => tracked.sprite === spiderSprite);
		if (!spider || spider.isDead) {
			return;
		}

		const playerBody = this.player.body as Phaser.Physics.Arcade.Body;
		const spiderBody = spiderSprite.body as Phaser.Physics.Arcade.Body;

		if (isStompHit(playerBody.velocity.y, playerBody.bottom, spiderBody.top, SPIDER_STOMP_TOLERANCE_PX)) {
			this.killSpider(spider);
		} else {
			this.die();
		}
	}

	/**
	 * Kills a stomped spider: stops and disables its body immediately (so
	 * it can't be stomped or collided with again mid-death-animation),
	 * bounces the player upward, and refreshes their jump/float budget the
	 * same way landing on real ground would (see jumpAvailableUntil and
	 * airborneStartTime) - "jump is refreshed" means a jump press shortly
	 * after this bounce gets full height, not just the automatic hop, and
	 * a float-capable character gets their float time back too.
	 */
	private killSpider(spider: TrackedSpider) {
		spider.isDead = true;
		spider.sprite.setVelocity(0, 0);
		const body = spider.sprite.body as Phaser.Physics.Arcade.Body;
		body.enable = false;

		playSfx(this, 'enemyStomp');

		this.player.setVelocityY(SPIDER_STOMP_BOUNCE_VELOCITY);
		this.airborneStartTime = this.time.now;
		this.jumpAvailableUntil = this.time.now + SPIDER_STOMP_JUMP_GRACE_MS;

		this.playSpiderDeathAnimation(spider);
	}

	/**
	 * Flickers between the spider's idle and hit frames SPIDER_FLICKER_COUNT
	 * times, then holds on its dead frame for SPIDER_DEAD_HOLD_MS before
	 * destroying it for good and dropping it from this.spiders.
	 */
	private playSpiderDeathAnimation(spider: TrackedSpider) {
		let flickerStep = 0;
		this.time.addEvent({
			delay: SPIDER_FLICKER_INTERVAL_MS,
			repeat: SPIDER_FLICKER_COUNT - 1,
			callback: () => {
				flickerStep++;
				const frame = flickerStep % 2 === 1 ? SPIDER_HIT_FRAME : SPIDER_IDLE_FRAME;
				spider.sprite.setTexture(ENEMIES_ATLAS_KEY, frame);
			}
		});

		this.time.delayedCall(SPIDER_FLICKER_INTERVAL_MS * SPIDER_FLICKER_COUNT, () => {
			spider.sprite.setTexture(ENEMIES_ATLAS_KEY, SPIDER_DEAD_FRAME);
			this.time.delayedCall(SPIDER_DEAD_HOLD_MS, () => {
				spider.sprite.destroy();
				this.spiders = this.spiders.filter((tracked) => tracked !== spider);
			});
		});
	}

	/**
	 * Engages the float ability: disables gravity so the oscillating
	 * velocity applied in update() (see getFloatVelocity) isn't fighting
	 * gravity's own contribution each frame, same reasoning as the win
	 * sequence freezing the player.
	 */
	private startFloating() {
		this.isFloating = true;
		const body = this.player.body as Phaser.Physics.Arcade.Body | null;
		if (body) {
			body.allowGravity = false;
		}
	}

	private stopFloating() {
		this.isFloating = false;
		const body = this.player.body as Phaser.Physics.Arcade.Body | null;
		if (body) {
			body.allowGravity = true;
		}
	}

	/** Where this player is, packed like a ghost sample, as of the last unlocked frame; null before GO. */
	getRaceSnapshot(): { x: number; y: number; state: number } | null {
		return this.raceSnapshot;
	}

	/**
	 * Draws the other racers from the buffer the race page fills: a tinted,
	 * name-tagged copy of each, a little behind real time. Racers who have
	 * finished, dropped out or not been heard from are hidden.
	 */
	private updateRaceOpponents() {
		const buffer = this.registry.get(RACE_OPPONENTS_KEY) as OpponentBuffer | undefined;
		const roster = (this.registry.get(RACE_ROSTER_KEY) as RosterEntry[] | undefined) ?? [];
		if (!buffer) {
			return;
		}
		const now = performance.now();
		for (const entry of roster) {
			let drawn = this.raceSprites.get(entry.slot);
			const pose = entry.status === 'racing' ? buffer.sample(entry.slot, now) : null;
			if (!pose) {
				drawn?.sprite.setVisible(false);
				drawn?.label.setVisible(false);
				continue;
			}
			if (!drawn) {
				const tint = SLOT_TINTS[entry.slot % SLOT_TINTS.length];
				drawn = {
					sprite: this.add
						.sprite(pose.x, pose.y, CHARACTERS_ATLAS_KEY)
						.setDepth(PLAYER_DEPTH - 0.2)
						.setDisplaySize(PLAYER_DISPLAY_SIZE, PLAYER_DISPLAY_SIZE)
						.setAlpha(0.9)
						.setTint(tint),
					label: this.add
						.text(pose.x, pose.y, entry.username, {
							font: '12px monospace',
							color: SLOT_CSS[entry.slot % SLOT_CSS.length]
						})
						.setOrigin(0.5, 1)
						.setDepth(PLAYER_DEPTH - 0.2)
				};
				this.raceSprites.set(entry.slot, drawn);
			}
			const state = decodeGhostState(pose.state);
			drawn.sprite
				.setVisible(true)
				.setPosition(pose.x, pose.y)
				.setTexture(CHARACTERS_ATLAS_KEY, getPlayerFrameForPose(state.color, state.pose, now))
				.setFlipX(state.facingLeft);
			drawn.label
				.setVisible(true)
				.setPosition(pose.x, pose.y - PLAYER_DISPLAY_SIZE / 2 - 4);
		}
	}

	update(time: number, delta: number) {
		if (this.raceMode) {
			if (!this.raceReadyEmitted) {
				this.raceReadyEmitted = true;
				this.game.events.emit(RACE_READY_EVENT);
			}
			this.updateRaceOpponents();
			// Before GO: nothing moves (the enemies patrol from update(), so
			// they hold too), and the clocks stand still.
			if (this.registry.get(RACE_LOCKED_KEY) === true) {
				return;
			}
		}

		if (this.hasWon || this.hasDied) {
			return;
		}

		if (this.isDying) {
			// The entire death sequence (the 1-second freeze, then the
			// fall through the level) pauses everything else - no
			// movement input, no spider patrol, no camera panning - the
			// only thing still happening is gravity pulling the player
			// down once the freeze ends. This is also why none of the
			// normal per-frame logic below (pose, animation, jump, etc.)
			// needs its own "unless dying" guard: it simply never runs.
			if (
				this.isFallingThroughLevel &&
				hasFallenOffScreen(this.player.y, WORLD_HEIGHT, DEATH_FALL_THRESHOLD_PX)
			) {
				this.finishDeathFall();
			}
			return;
		}

		// Both the Tab key and the mobile toggle button only make sense
		// when there's actually an Edit Mode to switch to - see the HUD
		// text's own guard in create() for the same reasoning. A public
		// /play/[slug] session never registers LevelEditorScene, so this
		// whole block is simply inert there rather than trying to start
		// a scene that doesn't exist.
		if (this.scene.get('LevelEditorScene')) {
			if (Phaser.Input.Keyboard.JustDown(this.toggleKey) || touchInputState.modeTogglePressed) {
				clearModeTogglePressed();
				const nextMode = toggleMode(CURRENT_MODE);
				this.scene.start(getSceneKeyForMode(nextMode));
				return;
			}
		}

		if (hasFallenOffScreen(this.player.y, WORLD_HEIGHT, FALL_OFF_SCREEN_THRESHOLD_PX)) {
			this.die();
			return;
		}

		if (
			this.checkpoint &&
			!this.checkpointReached &&
			isNearCheckpoint(this.player.x, this.player.y, this.checkpoint.data)
		) {
			this.reachCheckpoint();
		}

		this.updateKeys(time);
		this.updateSpiders(time);
		this.updateQuadrantCamera();

		const currentPlayerColor = this.registry.get(PLAYER_COLOR_REGISTRY_KEY) as
			| PlayerColor
			| undefined;
		const speedMultiplier = currentPlayerColor ? getSpeedMultiplier(currentPlayerColor) : 1;
		const jumpVelocityMultiplier = currentPlayerColor
			? getJumpVelocityMultiplier(getJumpHeightMultiplier(currentPlayerColor))
			: 1;

		// Looked up here (rather than down with the rest of the gamepad
		// reads below) because the dash check right after this needs it -
		// everything else that reads `pad` still works fine reading the
		// same reference further down.
		const pad = this.input.gamepad?.getPad(0);

		// EXPERIMENTAL (purple's phase ability, on its own branch).
		const isDashHeld = this.dashKey.isDown || touchInputState.dash || (pad?.X ?? false);
		if (hasRisingEdge(isDashHeld, this.wasDashHeldLastFrame)) {
			this.dashHeldSinceTime = time;
		}
		this.wasDashHeldLastFrame = isDashHeld;
		const isPhasing = currentPlayerColor
			? isPhasingActive(
					canPhase(currentPlayerColor),
					isDashHeld,
					this.dashHeldSinceTime,
					time,
					PHASE_MAX_DURATION_MS
				)
			: false;
		this.platformCollider.active = !isPhasing;
		this.player.setAlpha(isPhasing ? 0.5 : 1);

		for (const swapObject of this.swapObjects) {
			if (
				!swapObject.onCooldown &&
				isWithinSwapRange(
					this.player.x,
					this.player.y,
					swapObject.sprite.x,
					swapObject.sprite.y,
					SWAP_TRIGGER_DISTANCE
				)
			) {
				this.handleCharacterSwap(swapObject);
				// Stop after the first trigger this frame - if two objects'
				// trigger radii happen to overlap around the player,
				// handling both in the same frame would chain into a
				// confusing 3-way rotation instead of a single clean swap.
				break;
			} else if (
				swapObject.onCooldown &&
				!isWithinSwapRange(
					this.player.x,
					this.player.y,
					swapObject.sprite.x,
					swapObject.sprite.y,
					SWAP_COOLDOWN_CLEAR_DISTANCE
				)
			) {
				this.reactivateSwapObject(swapObject);
			}
		}

		const onGround = this.player.body?.blocked.down ?? false;

		const padStickLeft = pad ? exceedsDeadzone(pad.leftStick.x, STICK_DEADZONE) && pad.leftStick.x < 0 : false;
		const padStickRight = pad ? exceedsDeadzone(pad.leftStick.x, STICK_DEADZONE) && pad.leftStick.x > 0 : false;

		const leftDown =
			this.wasd.a.isDown ||
			this.arrows.left.isDown ||
			(pad?.left ?? false) ||
			padStickLeft ||
			touchInputState.left;
		const rightDown =
			this.wasd.d.isDown ||
			this.arrows.right.isDown ||
			(pad?.right ?? false) ||
			padStickRight ||
			touchInputState.right;
		const isMoving = leftDown || rightDown;
		this.pMeterMs = getPMeterValue(this.pMeterMs, isDashHeld, isMoving, delta, P_METER_MAX_MS);
		const maxSpeed = getMaxSpeedForDashState(
			isDashHeld,
			isPMeterFull(this.pMeterMs, P_METER_MAX_MS),
			WALK_SPEED,
			RUN_SPEED,
			P_SPEED_TOP_SPEED
		);
		const currentVelocityX = this.player.body?.velocity.x ?? 0;
		const velocityX = getAcceleratedVelocity(
			{ left: leftDown, right: rightDown },
			currentVelocityX,
			maxSpeed * speedMultiplier,
			ACCELERATION * speedMultiplier,
			delta / 1000
		);
		this.player.setVelocityX(velocityX);

		// Ducking (held regardless of horizontal movement, same as it
		// would be in most platformers - there's no separate duck-walk
		// animation here) and jumping (airborne, i.e. not onGround) are
		// the only two additional pose inputs; getPlayerPose applies the
		// actual priority between them (see movement.ts).
		const isDucking = this.wasd.s.isDown || this.arrows.down.isDown || touchInputState.duck;
		const pose = getPlayerPose(onGround, isDucking, velocityX);

		if (pose !== this.currentPose) {
			const config = this.playerPoseConfig[pose];
			this.player.body?.setSize(config.hitbox.width, config.hitbox.height, false);
			this.player.body?.setOffset(config.hitbox.x, config.hitbox.y);
			if (config.animationKey) {
				// true = don't restart the animation from frame 0 if it's
				// already playing, so alternating left/right taps stay smooth.
				this.player.anims.play(config.animationKey, true);
			} else {
				this.player.anims.stop();
				this.player.setTexture(CHARACTERS_ATLAS_KEY, config.frame);
			}
			this.currentPose = pose;
		}

		// Facing direction is independent of pose - update every frame
		// while moving, regardless of whether the pose itself changed.
		if (velocityX !== 0) {
			this.player.setFlipX(velocityX < 0);
		}

		// Ghost recording and playback share the run clock: this frame's
		// state is sampled first, then the clock advances.
		this.ghostRecorder.record(
			this.runElapsedMs,
			this.player.x,
			this.player.y,
			encodeGhostState(currentPlayerColor ?? 'green', pose, this.player.flipX)
		);
		this.updateGhost();
		if (this.raceMode) {
			this.raceSnapshot = {
				x: this.player.x,
				y: this.player.y,
				state: encodeGhostState(currentPlayerColor ?? 'green', pose, this.player.flipX)
			};
		}
		this.runElapsedMs += delta;
		this.ghostClockMs += delta;

		// Gamepad and touch buttons don't have Phaser's keyboard-style
		// JustDown() helper, so we track each source's previous-frame state
		// ourselves to detect the rising edge.
		const padJumpButtonDown = pad?.A ?? false;
		const padJumpJustPressed = hasRisingEdge(padJumpButtonDown, this.wasPadJumpButtonDown);
		this.wasPadJumpButtonDown = padJumpButtonDown;

		const touchJumpJustPressed = hasRisingEdge(touchInputState.jump, this.wasTouchJumpDown);
		this.wasTouchJumpDown = touchInputState.jump;

		const jumpJustPressed =
			Phaser.Input.Keyboard.JustDown(this.wasd.w) ||
			Phaser.Input.Keyboard.JustDown(this.arrows.up) ||
			padJumpJustPressed ||
			touchJumpJustPressed;
		const isJumpHeld =
			this.wasd.w.isDown || this.arrows.up.isDown || padJumpButtonDown || touchInputState.jump;

		// Total playtime: counts from the first control, and only on frames
		// where the player can move (update() returns early while dying or
		// won). Skipped in the editor's test-play, which has no record.
		if (!this.scene.get('LevelEditorScene') && !document.hidden) {
			this.playtime.advance(
				delta,
				leftDown || rightDown || isDucking || isJumpHeld || isDashHeld
			);
		}

		// Door interaction uses the same "up" input as jumping - pressing
		// up while near a closed door opens it instead of jumping, rather
		// than doing both at once, which would feel like an unintended
		// hop right as the door opens. Key-required doors are skipped
		// here entirely (canOpenDoor) - they can't be opened at all until
		// key-collection exists, so standing near one and pressing Up
		// just jumps normally rather than silently doing nothing.
		let openedDoorThisFrame = false;
		if (jumpJustPressed) {
			for (const door of this.doors) {
				if (
					!door.isOpen &&
					canOpenDoor(door.data, this.collectedKeyColors) &&
					isNearDoor(this.player.x, this.player.y, door.data, DOOR_INTERACTION_DISTANCE)
				) {
					this.openDoor(door);
					openedDoorThisFrame = true;
					break;
				}
			}
		}

		if (!openedDoorThisFrame) {
			const floatBudgetExpired = hasFloatBudgetExpired(
				this.airborneStartTime,
				time,
				FLOAT_MAX_DURATION_MS
			);
			if (shouldStopFloating(this.isFloating, onGround, isJumpHeld) || (this.isFloating && floatBudgetExpired)) {
				this.stopFloating();
			}

			if (
				currentPlayerColor &&
				shouldStartFloating(
					canFloat(currentPlayerColor),
					onGround,
					this.isFloating,
					jumpJustPressed,
					floatBudgetExpired
				)
			) {
				this.startFloating();
			}
		}

		if (this.isFloating) {
			// Floating overrides the normal jump/jump-cut physics entirely
			// while active - see getFloatVelocity in movement.ts for why
			// this single call handles both "stay airborne" and the
			// visible bounce as the same motion.
			this.player.setVelocityY(getFloatVelocity(time, FLOAT_BOUNCE_AMPLITUDE, FLOAT_BOUNCE_PERIOD_MS));
		} else {
			if (!openedDoorThisFrame) {
				// A spider stomp's bounce (see killSpider) grants a brief
				// window where a jump press counts the same as actually
				// touching the ground - this is what makes stomping a
				// spider "refresh" the jump rather than just bouncing the
				// player with no way to follow up with a real jump.
				const canJumpFromStomp = time < this.jumpAvailableUntil;
				const velocityY = getJumpVelocity(
					{ jumpJustPressed, onGround: onGround || canJumpFromStomp },
					JUMP_VELOCITY * jumpVelocityMultiplier
				);
				if (velocityY !== null) {
					this.player.setVelocityY(velocityY);
					// A fresh jump from the ground (or an equally fresh one
					// off a stomped spider) starts a new airborne period,
					// resetting the float budget - this is the "only way to
					// get more float time is to land and jump again" rule
					// that closes the release-and-re-press exploit.
					this.airborneStartTime = time;
					this.jumpAvailableUntil = 0;
					playSfx(this, 'jump');
				}
			}

			// Variable jump height: if jump isn't currently held and the
			// player is still moving upward, cut the ascent short rather
			// than letting gravity alone carry it to the full height.
			// Checked every frame (not just on release) since velocity
			// keeps changing under gravity regardless of when the button
			// came up.
			const currentVelocityY = this.player.body?.velocity.y ?? 0;
			const cutVelocityY = getJumpCutVelocity(currentVelocityY, isJumpHeld, JUMP_CUT_MULTIPLIER);
			if (cutVelocityY !== null) {
				this.player.setVelocityY(cutVelocityY);
			}
		}
	}
}