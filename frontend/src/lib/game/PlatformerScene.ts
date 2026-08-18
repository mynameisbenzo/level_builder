import Phaser from 'phaser';
import { exceedsDeadzone, getHorizontalVelocity, getJumpVelocity } from './movement';
import { getSceneKeyForMode, toggleMode, type GameMode } from './mode';
import { ensurePlayerTexture, PLAYER_TEXTURE_KEY } from './textures';
import {
	DEFAULT_PLAYER_POSITION,
	PLAYER_POSITION_REGISTRY_KEY,
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
	private gamepadStatusText!: Phaser.GameObjects.Text;
	private gamepadStatusTween?: Phaser.Tweens.Tween;
	private toggleKey!: Phaser.Input.Keyboard.Key;

	constructor() {
		super('PlatformerScene');
	}

	preload() {
		// Generate a simple white square texture for the player.
		// Real sprites get swapped in later phases.
		ensurePlayerTexture(this);

		// Ground platform texture.
		const groundGraphics = this.make.graphics({ x: 0, y: 0 });
		groundGraphics.fillStyle(0x4a4a4a, 1);
		groundGraphics.fillRect(0, 0, 400, 32);
		groundGraphics.generateTexture('ground', 400, 32);
		groundGraphics.destroy();
	}

	create() {
		this.physics.world.gravity.y = GRAVITY_Y;

		this.platforms = this.physics.add.staticGroup();
		this.platforms.create(400, 568, 'ground').setScale(2, 1).refreshBody();

		const storedPosition = this.registry.get(PLAYER_POSITION_REGISTRY_KEY) as
			| PlayerPosition
			| undefined;
		const spawnPosition = resolveInitialPlayerPosition(storedPosition, DEFAULT_PLAYER_POSITION);

		this.player = this.physics.add.sprite(spawnPosition.x, spawnPosition.y, PLAYER_TEXTURE_KEY);
		this.player.setCollideWorldBounds(true);

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
		if (Phaser.Input.Keyboard.JustDown(this.toggleKey)) {
			this.registry.set(PLAYER_POSITION_REGISTRY_KEY, {
				x: this.player.x,
				y: this.player.y
			} satisfies PlayerPosition);
			const nextMode = toggleMode(CURRENT_MODE);
			this.scene.start(getSceneKeyForMode(nextMode));
			return;
		}

		const onGround = this.player.body?.blocked.down ?? false;
		const pad = this.input.gamepad?.getPad(0);

		const padStickLeft = pad ? exceedsDeadzone(pad.leftStick.x, STICK_DEADZONE) && pad.leftStick.x < 0 : false;
		const padStickRight = pad ? exceedsDeadzone(pad.leftStick.x, STICK_DEADZONE) && pad.leftStick.x > 0 : false;

		const leftDown = this.wasd.a.isDown || this.arrows.left.isDown || (pad?.left ?? false) || padStickLeft;
		const rightDown =
			this.wasd.d.isDown || this.arrows.right.isDown || (pad?.right ?? false) || padStickRight;
		const velocityX = getHorizontalVelocity({ left: leftDown, right: rightDown }, MOVE_SPEED);
		this.player.setVelocityX(velocityX);

		// Gamepad buttons don't have Phaser's keyboard-style JustDown() helper,
		// so we track the previous frame's state ourselves to detect the edge.
		const padJumpButtonDown = pad?.A ?? false;
		const padJumpJustPressed = padJumpButtonDown && !this.wasPadJumpButtonDown;
		this.wasPadJumpButtonDown = padJumpButtonDown;

		const jumpJustPressed =
			Phaser.Input.Keyboard.JustDown(this.wasd.w) ||
			Phaser.Input.Keyboard.JustDown(this.arrows.up) ||
			padJumpJustPressed;
		const velocityY = getJumpVelocity({ jumpJustPressed, onGround }, JUMP_VELOCITY);
		if (velocityY !== null) {
			this.player.setVelocityY(velocityY);
		}
	}
}