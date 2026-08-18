import Phaser from 'phaser';
import { getSceneKeyForMode, toggleMode, type GameMode } from './mode';
import { ensurePlayerTexture, PLAYER_TEXTURE_KEY } from './textures';
import {
	DEFAULT_PLAYER_POSITION,
	PLAYER_POSITION_REGISTRY_KEY,
	resolveInitialPlayerPosition,
	type PlayerPosition
} from './playerState';

const CURRENT_MODE: GameMode = 'edit';
const GRID_SIZE = 32;
const GRID_COLOR = 0x333344;
const BACKGROUND_COLOR = 0x14141f;

export class LevelEditorScene extends Phaser.Scene {
	private toggleKey!: Phaser.Input.Keyboard.Key;
	private playerObject!: Phaser.GameObjects.Image;

	constructor() {
		super('LevelEditorScene');
	}

	preload() {
		ensurePlayerTexture(this);
	}

	create() {
		this.cameras.main.setBackgroundColor(BACKGROUND_COLOR);
		this.drawGrid();

		this.add.text(10, 10, 'Level Editor (placeholder) — Tab to return to Play Mode', {
			font: '14px monospace',
			color: '#ffffff'
		});
		this.add.text(10, 30, 'Drag the square to reposition it', {
			font: '14px monospace',
			color: '#aaaaaa'
		});

		const storedPosition = this.registry.get(PLAYER_POSITION_REGISTRY_KEY) as
			| PlayerPosition
			| undefined;
		const spawnPosition = resolveInitialPlayerPosition(storedPosition, DEFAULT_PLAYER_POSITION);

		this.playerObject = this.add
			.image(spawnPosition.x, spawnPosition.y, PLAYER_TEXTURE_KEY)
			.setInteractive({ draggable: true, useHandCursor: true });

		this.playerObject.on(
			'drag',
			(_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
				this.playerObject.setPosition(dragX, dragY);
			}
		);

		if (!this.input.keyboard) {
			throw new Error('Keyboard input plugin is not available');
		}
		this.toggleKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TAB);
	}

	update() {
		if (Phaser.Input.Keyboard.JustDown(this.toggleKey)) {
			this.registry.set(PLAYER_POSITION_REGISTRY_KEY, {
				x: this.playerObject.x,
				y: this.playerObject.y
			} satisfies PlayerPosition);
			const nextMode = toggleMode(CURRENT_MODE);
			this.scene.start(getSceneKeyForMode(nextMode));
		}
	}

	private drawGrid() {
		const { width, height } = this.scale;
		const graphics = this.add.graphics();
		graphics.lineStyle(1, GRID_COLOR, 1);

		for (let x = 0; x <= width; x += GRID_SIZE) {
			graphics.lineBetween(x, 0, x, height);
		}
		for (let y = 0; y <= height; y += GRID_SIZE) {
			graphics.lineBetween(0, y, width, y);
		}
	}
}