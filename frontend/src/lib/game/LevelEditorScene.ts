import Phaser from 'phaser';
import { getSceneKeyForMode, toggleMode, type GameMode } from './mode';
import {
	ensureCharacterAtlas,
	ensurePlayerTexture,
	ensureTilesAtlas,
	PLAYER_TEXTURE_KEY,
	TILES_ATLAS_KEY
} from './textures';
import {
	DEFAULT_GROUND_TILE_STYLE,
	getRowTileFrames,
	GROUND_TILE_FRAME_SETS,
	GROUND_TILE_STYLE_REGISTRY_KEY,
	GROUND_TILE_STYLES,
	type GroundTileStyle
} from './groundTiling';
import {
	EDITOR_PLAYER_POSITION_KEY,
	resolveInitialPlayerPosition,
	type PlayerPosition
} from './playerState';
import { snapToGrid, GRID_SIZE, getColumnRange } from './gridSnap';
import { isPositionOccupied, PLACED_OBJECTS_REGISTRY_KEY, removePosition, type PlacedObject } from './placedObjects';
import { clearModeTogglePressed, touchInputState } from './touchInput';
import { currentMode } from './currentMode';

const CURRENT_MODE: GameMode = 'edit';
const GRID_COLOR = 0x333344;
const BACKGROUND_COLOR = 0x14141f;

export class LevelEditorScene extends Phaser.Scene {
	private toggleKey!: Phaser.Input.Keyboard.Key;
	private styleIndicatorText!: Phaser.GameObjects.Text;
	private styleSwatches: {
		style: GroundTileStyle;
		image: Phaser.GameObjects.Image;
		border: Phaser.GameObjects.Rectangle;
	}[] = [];
	private playerObject!: Phaser.GameObjects.Image;
	private instructionsVisible = true;
	private instructionTexts: Phaser.GameObjects.Text[] = [];
	private isDragPlacing = false;
	private dragOriginY = 0;
	private dragLastX = 0;
	private tileImagesByRow = new Map<number, Phaser.GameObjects.Image[]>();

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

		const currentStyle =
			(this.registry.get(GROUND_TILE_STYLE_REGISTRY_KEY) as GroundTileStyle | undefined) ??
			DEFAULT_GROUND_TILE_STYLE;
		this.styleIndicatorText = this.add.text(10, 90, `Tile style: ${currentStyle}`, {
			font: '14px monospace',
			color: '#ffd23f'
		});

		this.createStyleToolbar();

		const placedObjects =
			(this.registry.get(PLACED_OBJECTS_REGISTRY_KEY) as PlacedObject[] | undefined) ?? [];
		const initialRows = new Set(placedObjects.map((object) => object.y));
		for (const y of initialRows) {
			this.refreshRow(y);
		}

		this.input.on(
			'pointerdown',
			(pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
				if (currentlyOver.length > 0) {
					return;
				}

				const x = snapToGrid(pointer.x, GRID_SIZE);
				const y = snapToGrid(pointer.y, GRID_SIZE);

				this.isDragPlacing = true;
				this.dragOriginY = y;
				this.dragLastX = x;
				this.placeTileIfEmpty(x, y);
			}
		);

		this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
			if (!this.isDragPlacing || !pointer.isDown) {
				return;
			}

			const currentX = snapToGrid(pointer.x, GRID_SIZE);
			const columns = getColumnRange(this.dragLastX, currentX, GRID_SIZE);
			for (const x of columns) {
				this.placeTileIfEmpty(x, this.dragOriginY);
			}
			this.dragLastX = currentX;
		});

		this.input.on('pointerup', () => {
			this.isDragPlacing = false;
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

	private createStyleToolbar() {
		const swatchSize = 40;
		const spacing = 10;
		const totalWidth =
			GROUND_TILE_STYLES.length * swatchSize + (GROUND_TILE_STYLES.length - 1) * spacing;
		const startX = this.scale.width / 2 - totalWidth / 2 + swatchSize / 2;
		const y = this.scale.height - 40;

		const currentStyle =
			(this.registry.get(GROUND_TILE_STYLE_REGISTRY_KEY) as GroundTileStyle | undefined) ??
			DEFAULT_GROUND_TILE_STYLE;

		this.styleSwatches = GROUND_TILE_STYLES.map((style, index) => {
			const x = startX + index * (swatchSize + spacing);

			const border = this.add
				.rectangle(x, y, swatchSize + 6, swatchSize + 6)
				.setStrokeStyle(3, style === currentStyle ? 0xffd23f : 0x666666);

			const image = this.add
				.image(x, y, TILES_ATLAS_KEY, GROUND_TILE_FRAME_SETS[style].single)
				.setDisplaySize(swatchSize, swatchSize)
				.setInteractive({ useHandCursor: true });

			image.on('pointerdown', () => {
				this.registry.set(GROUND_TILE_STYLE_REGISTRY_KEY, style);
				this.styleIndicatorText.setText(`Tile style: ${style}`);
				this.refreshAllRows();
				this.highlightSelectedSwatch(style);
			});

			return { style, image, border };
		});
	}

	private highlightSelectedSwatch(selectedStyle: GroundTileStyle) {
		for (const swatch of this.styleSwatches) {
			swatch.border.setStrokeStyle(3, swatch.style === selectedStyle ? 0xffd23f : 0x666666);
		}
	}

	private refreshAllRows() {
		const allObjects =
			(this.registry.get(PLACED_OBJECTS_REGISTRY_KEY) as PlacedObject[] | undefined) ?? [];
		const rows = new Set(allObjects.map((object) => object.y));
		for (const y of rows) {
			this.refreshRow(y);
		}
	}

	private placeTileIfEmpty(x: number, y: number) {
		const existing =
			(this.registry.get(PLACED_OBJECTS_REGISTRY_KEY) as PlacedObject[] | undefined) ?? [];

		if (isPositionOccupied(existing, x, y)) {
			return;
		}

		const updated: PlacedObject[] = [...existing, { type: 'ground', x, y }];
		this.registry.set(PLACED_OBJECTS_REGISTRY_KEY, updated);
		this.refreshRow(y);
	}

	private refreshRow(y: number) {
		const existingImages = this.tileImagesByRow.get(y) ?? [];
		for (const image of existingImages) {
			image.destroy();
		}

		const allObjects =
			(this.registry.get(PLACED_OBJECTS_REGISTRY_KEY) as PlacedObject[] | undefined) ?? [];
		const rowXPositions = allObjects.filter((object) => object.y === y).map((object) => object.x);
		const currentStyle =
			(this.registry.get(GROUND_TILE_STYLE_REGISTRY_KEY) as GroundTileStyle | undefined) ??
			DEFAULT_GROUND_TILE_STYLE;
		const frameAssignments = getRowTileFrames(rowXPositions, GRID_SIZE, currentStyle);

		const newImages: Phaser.GameObjects.Image[] = [];
		for (const { x, frame } of frameAssignments) {
			const tile = this.add
				.image(x, y, TILES_ATLAS_KEY, frame)
				.setDisplaySize(GRID_SIZE, GRID_SIZE)
				.setInteractive({ useHandCursor: true });

			tile.on('pointerdown', () => {
				const current =
					(this.registry.get(PLACED_OBJECTS_REGISTRY_KEY) as PlacedObject[] | undefined) ?? [];
				this.registry.set(PLACED_OBJECTS_REGISTRY_KEY, removePosition(current, x, y));
				this.refreshRow(y);
			});

			newImages.push(tile);
		}
		this.tileImagesByRow.set(y, newImages);
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