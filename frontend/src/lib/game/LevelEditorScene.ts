import Phaser from 'phaser';
import { getSceneKeyForMode, toggleMode, type GameMode } from './mode';
import { ensureCharacterAtlas, ensurePlayerTexture, PLAYER_TEXTURE_KEY } from './textures';
import {
	EDITOR_PLAYER_POSITION_KEY,
	resolveInitialPlayerPosition,
	type PlayerPosition
} from './playerState';
import { snapToGrid } from './gridSnap';

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
		ensureCharacterAtlas(this);
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

		const storedPosition = this.registry.get(EDITOR_PLAYER_POSITION_KEY) as
			| PlayerPosition
			| undefined;
		const screenCenter = { x: this.scale.width / 2, y: this.scale.height / 2 };
		const spawnPosition = resolveInitialPlayerPosition(storedPosition, screenCenter);

		this.playerObject = this.add
			.image(spawnPosition.x, spawnPosition.y, PLAYER_TEXTURE_KEY)
			.setInteractive({ draggable: true, useHandCursor: true });

		this.playerObject.on(
			'drag',
			(_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
				this.playerObject.setPosition(snapToGrid(dragX, GRID_SIZE), snapToGrid(dragY, GRID_SIZE));
			}
		);

		if (!this.input.keyboard) {
			throw new Error('Keyboard input plugin is not available');
		}
		this.toggleKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TAB);
	}

	update() {
		if (Phaser.Input.Keyboard.JustDown(this.toggleKey)) {
			this.registry.set(EDITOR_PLAYER_POSITION_KEY, {
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