import Phaser from 'phaser';
import {
	exceedsDeadzone,
	getHorizontalVelocity,
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
	ensurePlayerWalkAnimation,
	ensureTilesAtlas,
	PLAYER_DISPLAY_SIZE,
	PLAYER_POSE_CONFIG,
	TILES_ATLAS_KEY
} from './textures';
import { getGroupFrames, type PositionedTile } from './groundTiling';
import { GRID_SIZE } from './gridSnap';
import { PLACED_OBJECTS_REGISTRY_KEY, type PlacedObject } from './placedObjects';
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
const JUMP_VELOCITY = -450;
const GRAVITY_Y = 900;
const STICK_DEADZONE = 0.2;
const GAMEPAD_MESSAGE_HOLD_MS = 2000;
const GAMEPAD_MESSAGE_FADE_MS = 800;
const FALL_OFF_SCREEN_THRESHOLD_PX = 100;

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
	private wasPadJumpButtonDown = false;
	private wasTouchJumpDown = false;
	private gamepadStatusText!: Phaser.GameObjects.Text;
	private gamepadStatusTween?: Phaser.Tweens.Tween;
	private toggleKey!: Phaser.Input.Keyboard.Key;
	private currentPose: PlayerPose | null = null;

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

		this.player = this.physics.add.sprite(
			spawnPosition.x,
			spawnPosition.y,
			CHARACTERS_ATLAS_KEY,
			PLAYER_POSE_CONFIG.idle.frame
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
			PLAYER_POSE_CONFIG.idle.hitbox.width,
			PLAYER_POSE_CONFIG.idle.hitbox.height,
			false
		);
		this.player.body?.setOffset(
			PLAYER_POSE_CONFIG.idle.hitbox.x,
			PLAYER_POSE_CONFIG.idle.hitbox.y
		);
		this.currentPose = 'idle';
		this.player.setCollideWorldBounds(true);
		this.player.setCollideWorldBounds(true);
		ensurePlayerWalkAnimation(this);

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

		this.add.text(10, 30, 'Tab: switch to Edit Mode', {
			font: '14px monospace',
			color: '#aaaaaa'
		});

		this.gamepadStatusText = this.add
			.text(10, 10, '', { font: '14px monospace', color: '#ffffff' })
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

	update() {
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
		const velocityX = getHorizontalVelocity({ left: leftDown, right: rightDown }, MOVE_SPEED);
		this.player.setVelocityX(velocityX);

		// Ducking takes priority over the walk/idle animation - held
		// regardless of horizontal movement, same as it would be in most
		// platformers (there's no separate duck-walk animation here).
		// Ducking (held regardless of horizontal movement, same as it
		// would be in most platformers - there's no separate duck-walk
		// animation here) and jumping (airborne, i.e. not onGround) are
		// the only two additional pose inputs; getPlayerPose applies the
		// actual priority between them (see movement.ts).
		const isDucking = this.wasd.s.isDown || this.arrows.down.isDown;
		const pose = getPlayerPose(onGround, isDucking, velocityX);

		if (pose !== this.currentPose) {
			const config = PLAYER_POSE_CONFIG[pose];
			this.player.body?.setSize(config.hitbox.width, config.hitbox.height, false);
			this.player.body?.setOffset(config.hitbox.x, config.hitbox.y);
			if (config.animationKey) {
				this.player.anims.play(config.animationKey, true);
			} else {
				this.player.anims.stop();
				this.player.setTexture(CHARACTERS_ATLAS_KEY, config.frame);
			}
			this.currentPose = pose;
		}

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
	}
}