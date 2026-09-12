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
import {
	CHARACTERS_ATLAS_KEY,
	ensureCharacterAtlas,
	ensurePlayerColor,
	ensurePlayerWalkAnimation,
	ensureTilesAtlas,
	getCharacterSwapObjectFrame,
	getPlayerHudFrame,
	getPlayerPoseConfig,
	PLAYER_COLOR_REGISTRY_KEY,
	PLAYER_COLORS,
	PLAYER_DISPLAY_SIZE,
	setPlayerWalkAnimationColor,
	TILES_ATLAS_KEY,
	type PlayerColor
} from './textures';
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
// How close the player needs to be to a character-swap object to trigger
// it. These use a simple distance check rather than a physics body (see
// characterSwapObjects.ts for why).
const SWAP_TRIGGER_DISTANCE = 24;
const SWAP_OBJECT_DISPLAY_SIZE = 32;
const SWAP_OBJECT_BOB_DISTANCE_PX = 6;
const SWAP_OBJECT_BOB_DURATION_MS = 800;

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
	private swapObjects: { data: CharacterSwapObject; sprite: Phaser.GameObjects.Image }[] = [];
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

		const playerColor = ensurePlayerColor(this);
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

		// TEMPORARY: placing these via the Level Editor is a separate,
		// not-yet-built TODO. Until that exists, spawn one test object near
		// the player (a color different from the player's own) so the swap
		// mechanic can actually be tried out. Remove this block once the
		// editor placement tool exists and levels can carry their own
		// swap-object data instead.
		let swapObjectsData =
			(this.registry.get(CHARACTER_SWAP_OBJECTS_REGISTRY_KEY) as
				| CharacterSwapObject[]
				| undefined) ?? [];
		if (swapObjectsData.length === 0) {
			const testColor = PLAYER_COLORS.find((color) => color !== playerColor) ?? PLAYER_COLORS[0];
			swapObjectsData = [{ x: spawnPosition.x + 100, y: spawnPosition.y, color: testColor }];
			this.registry.set(CHARACTER_SWAP_OBJECTS_REGISTRY_KEY, swapObjectsData);
		}

		// Floating character-swap objects. Rendered as plain images (not
		// physics bodies) with a bobbing tween - see isWithinSwapRange in
		// characterSwapObjects.ts for why a tween-driven position isn't
		// paired with an Arcade body. Bobbing (and the objects existing at
		// all) is Play-mode-only, since this scene IS Play mode - there's
		// no Editor-side rendering of these yet.
		this.swapObjects = swapObjectsData.map((data) => {
			const sprite = this.add
				.image(data.x, data.y, TILES_ATLAS_KEY, getCharacterSwapObjectFrame(data.color))
				.setDisplaySize(SWAP_OBJECT_DISPLAY_SIZE, SWAP_OBJECT_DISPLAY_SIZE);

			this.tweens.add({
				targets: sprite,
				y: data.y - SWAP_OBJECT_BOB_DISTANCE_PX,
				duration: SWAP_OBJECT_BOB_DURATION_MS,
				yoyo: true,
				repeat: -1,
				ease: 'Sine.easeInOut'
			});

			return { data, sprite };
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
		this.hudPortrait = this.add
			.image(10, 10, TILES_ATLAS_KEY, getPlayerHudFrame(playerColor))
			.setOrigin(0, 0)
			.setDisplaySize(48, 48);

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
	 * survives toggling to the Editor and back).
	 *
	 * Item 1 (an animated HUD portrait transition) is a deferred TODO -
	 * for now the portrait and the object's own sprite both update
	 * instantly, with no animation.
	 */
	private handleCharacterSwap(swapObject: {
		data: CharacterSwapObject;
		sprite: Phaser.GameObjects.Image;
	}) {
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
		this.hudPortrait.setTexture(TILES_ATLAS_KEY, getPlayerHudFrame(newPlayerColor));

		swapObject.data.color = newObjectColor;
		swapObject.sprite.setTexture(TILES_ATLAS_KEY, getCharacterSwapObjectFrame(newObjectColor));
		this.registry.set(
			CHARACTER_SWAP_OBJECTS_REGISTRY_KEY,
			this.swapObjects.map((object) => object.data)
		);
	}

	update(_time: number, delta: number) {
		if (Phaser.Input.Keyboard.JustDown(this.toggleKey) || touchInputState.modeTogglePressed) {
			clearModeTogglePressed();
			const nextMode = toggleMode(CURRENT_MODE);
			this.scene.start(getSceneKeyForMode(nextMode));
			return;
		}

		if (hasFallenOffScreen(this.player.y, this.scale.height, FALL_OFF_SCREEN_THRESHOLD_PX)) {
			const nextMode = toggleMode(CURRENT_MODE);
			this.scene.start(getSceneKeyForMode(nextMode));
			return;
		}

		for (const swapObject of this.swapObjects) {
			if (
				isWithinSwapRange(
					this.player.x,
					this.player.y,
					swapObject.sprite.x,
					swapObject.sprite.y,
					SWAP_TRIGGER_DISTANCE
				)
			) {
				this.handleCharacterSwap(swapObject);
				break;
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