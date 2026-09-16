import Phaser from 'phaser';
import {
	exceedsDeadzone,
	getAcceleratedVelocity,
	getFloatVelocity,
	getJumpCutVelocity,
	getJumpVelocity,
	getPlayerPose,
	hasFallenOffScreen,
	hasFloatBudgetExpired,
	hasRisingEdge,
	shouldStartFloating,
	shouldStopFloating,
	type PlayerPose
} from './movement';
import { canFloat, getSpeedMultiplier } from './characterAbilities';
import { getSceneKeyForMode, toggleMode, type GameMode } from './mode';
import { ensureSounds, playSfx } from './sounds';
import { CHARACTERS_ATLAS_KEY, ensureCharacterAtlas, ensureTilesAtlas, TILES_ATLAS_KEY } from './atlases';
import {
	ensureStartingPlayerColor,
	getCharacterSwapObjectFrame,
	getPlayerHudFrame,
	PLAYER_COLOR_REGISTRY_KEY,
	type PlayerColor
} from './playerColor';
import {
	getPlayerPoseConfig,
	PLAYER_DISPLAY_SIZE,
	setPlayerWalkAnimationColor
} from './playerPose';
import { getGroupFrames, type PositionedTile } from './groundTiling';
import { GRID_SIZE } from './gridSnap';
import { PLACED_OBJECTS_REGISTRY_KEY, type PlacedObject } from './placedObjects';
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
const MOVE_SPEED = 200;
// Time to reach MOVE_SPEED from a standstill: MOVE_SPEED / ACCELERATION
// seconds (200 / 800 = 0.25s) - the P-speed-style build-up test. Tune
// this to taste; higher = snappier ramp, lower = more gradual.
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
	private currentPose: PlayerPose | null = null;
	private playerPoseConfig!: ReturnType<typeof getPlayerPoseConfig>;
	private hudPortrait!: Phaser.GameObjects.Image;
	private swapObjects: TrackedSwapObject[] = [];
	private doors: TrackedDoor[] = [];
	private keys: TrackedKey[] = [];
	private uncollectedKeysGroup!: Phaser.Physics.Arcade.Group;
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

	constructor() {
		super('PlatformerScene');
	}

	preload() {
		ensureCharacterAtlas(this);
		ensureTilesAtlas(this);
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
		this.wasPadJumpButtonDown = false;
		this.wasTouchJumpDown = false;
		this.collectedKeyColors = new Set();
		this.collectedKeysInOrder = [];
		this.playerPositionHistory = [];
		this.isFloating = false;

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
		this.cameraMode = ensureCameraMode(this);

		const storedPosition = this.registry.get(EDITOR_PLAYER_POSITION_KEY) as
			| PlayerPosition
			| undefined;
		const spawnPosition = resolveInitialPlayerPosition(storedPosition, DEFAULT_PLAYER_POSITION);

		// Every fresh Play session begins as the level's starting color,
		// discarding whatever the runtime color was left at by a previous
		// session's swaps - a swap should never leak into what a level
		// begins as, or into what the Editor shows.
		const playerColor = ensureStartingPlayerColor(this);
		this.registry.set(PLAYER_COLOR_REGISTRY_KEY, playerColor);
		this.playerPoseConfig = getPlayerPoseConfig(playerColor);

		this.player = this.physics.add.sprite(
			spawnPosition.x,
			spawnPosition.y,
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
		for (const object of placedObjects) {
			const tiles = tilesByGroupId.get(object.groupId) ?? [];
			tiles.push({ x: object.x, y: object.y, style: object.style, groupId: object.groupId });
			tilesByGroupId.set(object.groupId, tiles);
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
		this.physics.add.collider(this.player, this.platforms);

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

		this.add
			.text(68, 26, 'Tab: switch to Edit Mode', {
				font: '14px monospace',
				color: '#aaaaaa'
			})
			.setDepth(HUD_DEPTH)
			.setScrollFactor(0);

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
	private collectKey(key: TrackedKey) {
		key.isCollected = true;
		this.uncollectedKeysGroup.remove(key.sprite, false, false);
		key.sprite.disableBody(false, false);
		key.sprite.setDisplaySize(KEY_COLLECTED_DISPLAY_SIZE, KEY_COLLECTED_DISPLAY_SIZE);
		key.sprite.setDepth(KEY_FOLLOW_DEPTH);
		this.collectedKeyColors.add(key.data.color);
		this.collectedKeysInOrder.push(key);
		playSfx(this, 'key');
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
	 * Freezes the player, shows a brief "Level Cleared!" message, and
	 * returns to the Editor after a short delay. update() checks hasWon
	 * first thing and returns early once true, so nothing else (movement,
	 * jumping, falling off screen, Tab) can interrupt this once it starts.
	 */
	private triggerWin() {
		this.hasWon = true;
		this.player.setVelocity(0, 0);
		const body = this.player.body as Phaser.Physics.Arcade.Body | null;
		if (body) {
			body.allowGravity = false;
		}
		playSfx(this, 'win');

		this.add
			.text(this.scale.width / 2, this.scale.height / 2, 'Level Cleared!', {
				font: '32px monospace',
				color: '#ffd23f'
			})
			.setOrigin(0.5)
			.setDepth(HUD_DEPTH)
			.setScrollFactor(0);

		this.time.delayedCall(WIN_DISPLAY_DURATION_MS, () => {
			const nextMode = toggleMode(CURRENT_MODE);
			this.scene.start(getSceneKeyForMode(nextMode));
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

	update(time: number, delta: number) {
		if (this.hasWon) {
			return;
		}

		if (Phaser.Input.Keyboard.JustDown(this.toggleKey) || touchInputState.modeTogglePressed) {
			clearModeTogglePressed();
			const nextMode = toggleMode(CURRENT_MODE);
			this.scene.start(getSceneKeyForMode(nextMode));
			return;
		}

		if (hasFallenOffScreen(this.player.y, WORLD_HEIGHT, FALL_OFF_SCREEN_THRESHOLD_PX)) {
			playSfx(this, 'death');
			const nextMode = toggleMode(CURRENT_MODE);
			this.scene.start(getSceneKeyForMode(nextMode));
			return;
		}

		this.updateKeys(time);
		this.updateQuadrantCamera();

		const currentPlayerColor = this.registry.get(PLAYER_COLOR_REGISTRY_KEY) as
			| PlayerColor
			| undefined;
		const speedMultiplier = currentPlayerColor ? getSpeedMultiplier(currentPlayerColor) : 1;

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
		const pad = this.input.gamepad?.getPad(0);

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
		const currentVelocityX = this.player.body?.velocity.x ?? 0;
		const velocityX = getAcceleratedVelocity(
			{ left: leftDown, right: rightDown },
			currentVelocityX,
			MOVE_SPEED * speedMultiplier,
			ACCELERATION * speedMultiplier,
			delta / 1000
		);
		this.player.setVelocityX(velocityX);

		// Ducking (held regardless of horizontal movement, same as it
		// would be in most platformers - there's no separate duck-walk
		// animation here) and jumping (airborne, i.e. not onGround) are
		// the only two additional pose inputs; getPlayerPose applies the
		// actual priority between them (see movement.ts).
		const isDucking = this.wasd.s.isDown || this.arrows.down.isDown;
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
				const velocityY = getJumpVelocity({ jumpJustPressed, onGround }, JUMP_VELOCITY);
				if (velocityY !== null) {
					this.player.setVelocityY(velocityY);
					// A fresh jump from the ground starts a new airborne
					// period, resetting the float budget - this is the
					// "only way to get more float time is to land and jump
					// again" rule that closes the release-and-re-press
					// exploit.
					this.airborneStartTime = time;
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