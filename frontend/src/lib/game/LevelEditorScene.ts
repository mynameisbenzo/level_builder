import Phaser from 'phaser';
import { getSceneKeyForMode, toggleMode, type GameMode } from './mode';
import {
	ensureCharacterAtlas,
	ensurePlayerTexture,
	ensureTilesAtlas,
	GROUND_TILE_FRAME,
	PLAYER_TEXTURE_KEY,
	TILES_ATLAS_KEY
} from './textures';
import {
	EDITOR_PLAYER_POSITION_KEY,
	resolveInitialPlayerPosition,
	type PlayerPosition
} from './playerState';
import { snapToGrid, GRID_SIZE } from './gridSnap';
import { isPositionOccupied, PLACED_OBJECTS_REGISTRY_KEY, removePosition, type PlacedObject } from './placedObjects';import { clearModeTogglePressed, touchInputState } from './touchInput';
import { currentMode } from './currentMode';

const CURRENT_MODE: GameMode = 'edit';
const GRID_COLOR = 0x333344;
const BACKGROUND_COLOR = 0x14141f;

export class LevelEditorScene extends Phaser.Scene {
	private toggleKey!: Phaser.Input.Keyboard.Key;
	private playerObject!: Phaser.GameObjects.Image;
	private instructionsVisible = true;
	private instructionTexts: Phaser.GameObjects.Text[] = [];

	constructor() {
		super('LevelEditorScene');
	}

	preload() {
		ensurePlayerTexture(this);
		ensureCharacterAtlas(this);
		ensureTilesAtlas(this);
	}

	create() {
		currentMode.set(CURRENT_MODE);
		this.cameras.main.setBackgroundColor(BACKGROUND_COLOR);
		this.drawGrid();

		const toggleInstructionsButton = this.add
			.text(10, 10, '[?] Hide Instructions', { font: '14px monospace', color: '#ffffff' })
			.setInteractive({ useHandCursor: true });

		toggleInstructionsButton.on('pointerdown', () => {
			this.instructionsVisible = !this.instructionsVisible;
			for (const text of this.instructionTexts) {
				text.setVisible(this.instructionsVisible);
			}
			toggleInstructionsButton.setText(
				this.instructionsVisible ? '[?] Hide Instructions' : '[?] Show Instructions'
			);
		});

		this.instructionTexts = [
			this.add.text(10, 30, 'Level Editor (placeholder) — Tab to return to Play Mode', {
				font: '14px monospace',
				color: '#ffffff'
			}),
			this.add.text(10, 50, 'Drag the square to reposition it', {
				font: '14px monospace',
				color: '#aaaaaa'
			}),
			this.add.text(10, 70, 'Click empty space to place ground, click a tile to remove it', {
				font: '14px monospace',
				color: '#aaaaaa'
			})
		];

		const placedObjects =
			(this.registry.get(PLACED_OBJECTS_REGISTRY_KEY) as PlacedObject[] | undefined) ?? [];
		for (const object of placedObjects) {
			this.renderGroundTile(object.x, object.y);
		}

		this.input.on(
			'pointerdown',
			(pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
				if (currentlyOver.length > 0) {
					// Clicked an existing object (e.g. the player) - let its own
					// handlers (like dragging) deal with it, don't place a tile.
					return;
				}

				const x = snapToGrid(pointer.x, GRID_SIZE);
				const y = snapToGrid(pointer.y, GRID_SIZE);
				const existing =
					(this.registry.get(PLACED_OBJECTS_REGISTRY_KEY) as PlacedObject[] | undefined) ?? [];

				if (isPositionOccupied(existing, x, y)) {
					return;
				}

				const updated: PlacedObject[] = [...existing, { type: 'ground', x, y }];
				this.registry.set(PLACED_OBJECTS_REGISTRY_KEY, updated);
				this.renderGroundTile(x, y);
			}
		);

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
		if (Phaser.Input.Keyboard.JustDown(this.toggleKey) || touchInputState.modeTogglePressed) {
			clearModeTogglePressed();
			this.registry.set(EDITOR_PLAYER_POSITION_KEY, {
				x: this.playerObject.x,
				y: this.playerObject.y
			} satisfies PlayerPosition);
			const nextMode = toggleMode(CURRENT_MODE);
			this.scene.start(getSceneKeyForMode(nextMode));
		}
	}

	private renderGroundTile(x: number, y: number) {
		const tile = this.add
			.image(x, y, TILES_ATLAS_KEY, GROUND_TILE_FRAME)
			.setDisplaySize(GRID_SIZE, GRID_SIZE)
			.setInteractive({ useHandCursor: true });

		tile.on('pointerdown', () => {
			const existing =
				(this.registry.get(PLACED_OBJECTS_REGISTRY_KEY) as PlacedObject[] | undefined) ?? [];
			this.registry.set(PLACED_OBJECTS_REGISTRY_KEY, removePosition(existing, x, y));
			tile.destroy();
		});
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