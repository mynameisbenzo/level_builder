import Phaser from 'phaser';
import {
	exceedsDeadzone,
	getAcceleratedVelocity,
	getJumpCutVelocity,
	getJumpVelocity,
	getPlayerPose,
	hasFallenOffScreen,
	hasRisingEdge,
	type PlayerPose
} from './movement';
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
	ensurePlayerWalkAnimation,
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
import { clearModeTogglePressed, touchInputState } from './touchInput';
import { currentMode } from './currentMode';
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
		currentMode.set(CURRENT_MODE);

		this.physics.world.gravity.y = GRAVITY_Y;
		// No ground exists yet (real platforms come from actual level/screen
		// data later) - disable world-bounds collision on the bottom edge only,
		// so the player can fall through it, while still being contained on
		// the sides and top. This is a world-level setting, separate from a
		// body's own checkCollision (which governs body-to-body collisions,
		// not world-bounds collisions).
		this.physics.world.checkCollision.down = false;

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
		ensurePlayerWalkAnimation(this, playerColor);

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
			.setDisplaySize(HUD_PORTRAIT_SIZE, HUD_PORTRAIT_SIZE);

		this.add.text(68, 26, 'Tab: switch to Edit Mode', {
			font: '14px monospace',
			color: '#aaaaaa'
		});

		this.gamepadStatusText = this.add
			.text(10, 68, '', { font: '14px monospace', color: '#ffffff' })
			.setAlpha(0);

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
		// Force the pose-transition block in update() to re-apply on the
		// very next frame even if the pose name itself (e.g. "idle")
		// hasn't changed - only its underlying frame/hitbox meaning has,
		// via the new playerPoseConfig above.
		this.currentPose = null;
		this.animateHudPortraitSwap(newPlayerColor);

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

	update(_time: number, delta: number) {
		if (Phaser.Input.Keyboard.JustDown(this.toggleKey) || touchInputState.modeTogglePressed) {
			clearModeTogglePressed();
			const nextMode = toggleMode(CURRENT_MODE);
			this.scene.start(getSceneKeyForMode(nextMode));
			return;
		}

		if (hasFallenOffScreen(this.player.y, this.scale.height, FALL_OFF_SCREEN_THRESHOLD_PX)) {
			playSfx(this, 'death');
			const nextMode = toggleMode(CURRENT_MODE);
			this.scene.start(getSceneKeyForMode(nextMode));
			return;
		}

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
			MOVE_SPEED,
			ACCELERATION,
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
		const velocityY = getJumpVelocity({ jumpJustPressed, onGround }, JUMP_VELOCITY);
		if (velocityY !== null) {
			this.player.setVelocityY(velocityY);
			playSfx(this, 'jump');
		}

		// Variable jump height: if jump isn't currently held and the player
		// is still moving upward, cut the ascent short rather than letting
		// gravity alone carry it to the full height. Checked every frame
		// (not just on release) since velocity keeps changing under
		// gravity regardless of when the button came up.
		const isJumpHeld =
			this.wasd.w.isDown || this.arrows.up.isDown || padJumpButtonDown || touchInputState.jump;
		const currentVelocityY = this.player.body?.velocity.y ?? 0;
		const cutVelocityY = getJumpCutVelocity(currentVelocityY, isJumpHeld, JUMP_CUT_MULTIPLIER);
		if (cutVelocityY !== null) {
			this.player.setVelocityY(cutVelocityY);
		}
	}
}