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
	type GroundTileStyle,
	type PositionedTile
} from './groundTiling';
import {
	EDITOR_PLAYER_POSITION_KEY,
	resolveInitialPlayerPosition,
	type PlayerPosition
} from './playerState';
import { snapToGrid, GRID_SIZE, getColumnRange } from './gridSnap';
import {
	getNextActiveGroupKeys,
	getSameGroupTileKeys,
	isPositionOccupied,
	PLACED_OBJECTS_REGISTRY_KEY,
	tileKey,
	updateObjectStyle,
	mergeGroupIds,
	resolveGroupIdForPlacement,
	mergeAdjacentSameStyleGroups,
	type PlacedObject
} from './placedObjects';
import { clearModeTogglePressed, touchInputState } from './touchInput';
import { currentMode } from './currentMode';

const CURRENT_MODE: GameMode = 'edit';
const GRID_COLOR = 0x333344;
const BACKGROUND_COLOR = 0x14141f;

/**
 * Generates a fresh id to use as the fallback when a newly placed tile has
 * no matching-style neighbor to join. crypto.randomUUID() is broadly
 * supported in evergreen browsers.
 */
function createGroupId(): string {
	return crypto.randomUUID();
}

export class LevelEditorScene extends Phaser.Scene {
	private toggleKey!: Phaser.Input.Keyboard.Key;
	private playerObject!: Phaser.GameObjects.Image;
	private instructionsVisible = true;
	private instructionTexts: Phaser.GameObjects.Text[] = [];
	private isDragPlacing = false;
	private dragOriginY = 0;
	private dragLastX = 0;
	private tileImagesByRow = new Map<number, Phaser.GameObjects.Image[]>();
	private activeGroupKeys: string[] | null = null;
	private activeTileBorders: Phaser.GameObjects.Rectangle[] = [];
	private styleSwatches: {
		style: GroundTileStyle;
		image: Phaser.GameObjects.Image;
		border: Phaser.GameObjects.Rectangle;
	}[] = [];

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
		this.activeGroupKeys = null;

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
			this.add.text(
				10,
				70,
				'Click-drag empty space to place a platform. Click a platform to select it, click again to deselect.',
				{
					font: '14px monospace',
					color: '#aaaaaa'
				}
			),
			this.add.text(
				10,
				90,
				'Style palette: Select a platform to reveal the style palette and change its appearance.',
				{
					font: '14px monospace',
					color: '#aaaaaa'
				}
			)
		];

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
					// Clicked an existing object (e.g. the player) - let its own
					// handlers (like dragging) deal with it, don't place a tile.
					return;
				}

				// Starting a new placement always clears any active (selected)
				// group - you're placing something new, not editing what was
				// selected before.
				this.setActiveGroup(null);

				// Every click-and-drag placement gesture is its own platform,
				// even if it ends up touching an existing one.

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

			// X-axis only for now: the row is fixed at wherever the drag
			// started (dragOriginY), regardless of how far the pointer moves
			// vertically. Filling the whole column range (not just the
			// current x) avoids gaps if a fast drag skips past a cell
			// between two pointermove events.
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

		this.styleSwatches = GROUND_TILE_STYLES.map((style, index) => {
			const x = startX + index * (swatchSize + spacing);

			const border = this.add
				.rectangle(x, y, swatchSize + 6, swatchSize + 6)
				.setStrokeStyle(3, 0x666666);

			const image = this.add
				.image(x, y, TILES_ATLAS_KEY, GROUND_TILE_FRAME_SETS[style].single)
				.setDisplaySize(swatchSize, swatchSize)
				.setInteractive({ useHandCursor: true });

			image.on('pointerdown', () => this.applyStyleFromToolbar(style));

			return { style, image, border };
		});

		this.refreshSwatchHighlight();
		this.refreshToolbarVisibility();
	}

	/**
	 * Clicking a toolbar swatch restyles every tile in the currently
	 * active (selected) platform. The toolbar is only visible/interactive
	 * when something is selected (see refreshToolbarVisibility), so this
	 * is never reachable with nothing active - the guard is defensive.
	 */
	private applyStyleFromToolbar(style: GroundTileStyle) {
		if (this.activeGroupKeys === null || this.activeGroupKeys.length === 0) {
			return;
		}

		let existing =
			(this.registry.get(PLACED_OBJECTS_REGISTRY_KEY) as PlacedObject[] | undefined) ?? [];
		const affectedRows = new Set<number>();

		for (const key of this.activeGroupKeys) {
			const [xStr, yStr] = key.split(',');
			const x = Number(xStr);
			const y = Number(yStr);
			existing = updateObjectStyle(existing, x, y, style);
			affectedRows.add(y);
		}

		const [firstXStr, firstYStr] = this.activeGroupKeys[0].split(',');
		const activeObject = existing.find(
			(object) => object.x === Number(firstXStr) && object.y === Number(firstYStr)
		);

		if (activeObject) {
			const groupId = activeObject.groupId;
			for (const y of affectedRows) {
				existing = mergeAdjacentSameStyleGroups(existing, groupId, y, GRID_SIZE);
			}
			this.activeGroupKeys = getSameGroupTileKeys(existing, groupId);
		}

		this.registry.set(PLACED_OBJECTS_REGISTRY_KEY, existing);
		for (const y of affectedRows) {
			this.refreshRow(y);
		}
		this.refreshSwatchHighlight();
	}

	/**
	 * The swatch highlight reflects the style relevant to the current
	 * selection state: the active platform's style (all its tiles should
	 * match, so the first is representative) if one is selected, otherwise
	 * the default style that will be used for new placements.
	 */
	private refreshSwatchHighlight() {
		const displayedStyle = this.getDisplayedStyle();
		for (const swatch of this.styleSwatches) {
			swatch.border.setStrokeStyle(3, swatch.style === displayedStyle ? 0xffd23f : 0x666666);
		}
	}

	private getDisplayedStyle(): GroundTileStyle {
		if (this.activeGroupKeys !== null && this.activeGroupKeys.length > 0) {
			const [xStr, yStr] = this.activeGroupKeys[0].split(',');
			const x = Number(xStr);
			const y = Number(yStr);
			const existing =
				(this.registry.get(PLACED_OBJECTS_REGISTRY_KEY) as PlacedObject[] | undefined) ?? [];
			const activeObject = existing.find((object) => object.x === x && object.y === y);
			if (activeObject) {
				return activeObject.style;
			}
		}
		return (
			(this.registry.get(GROUND_TILE_STYLE_REGISTRY_KEY) as GroundTileStyle | undefined) ??
			DEFAULT_GROUND_TILE_STYLE
		);
	}

	private setActiveGroup(keys: string[] | null) {
		this.activeGroupKeys = keys;
		this.refreshSwatchHighlight();
		this.refreshActiveGroupBorders();
		this.refreshToolbarVisibility();
	}
	
	/**
	 * The style toolbar only makes sense as a "restyle what's selected"
	 * tool, so it's only shown (and only clickable) while something is
	 * actually selected. setVisible() alone wouldn't stop clicks/taps from
	 * still hitting a hidden swatch, so interactivity is toggled too.
	 */
	private refreshToolbarVisibility() {
		const visible = this.activeGroupKeys !== null && this.activeGroupKeys.length > 0;
		for (const swatch of this.styleSwatches) {
			swatch.image.setVisible(visible);
			swatch.border.setVisible(visible);
			if (visible) {
				swatch.image.setInteractive({ useHandCursor: true });
			} else {
				swatch.image.disableInteractive();
			}
		}
	}

	private refreshActiveGroupBorders() {
		for (const border of this.activeTileBorders) {
			border.destroy();
		}
		this.activeTileBorders = [];

		if (this.activeGroupKeys === null) {
			return;
		}

		for (const key of this.activeGroupKeys) {
			const [xStr, yStr] = key.split(',');
			const x = Number(xStr);
			const y = Number(yStr);
			const border = this.add
				.rectangle(x, y, GRID_SIZE + 4, GRID_SIZE + 4)
				.setStrokeStyle(3, 0xffd23f);
			this.activeTileBorders.push(border);
		}
	}
	private placeTileIfEmpty(x: number, y: number) {
		const existing =
			(this.registry.get(PLACED_OBJECTS_REGISTRY_KEY) as PlacedObject[] | undefined) ?? [];

		if (isPositionOccupied(existing, x, y)) {
			return;
		}

		const style =
			(this.registry.get(GROUND_TILE_STYLE_REGISTRY_KEY) as GroundTileStyle | undefined) ??
			DEFAULT_GROUND_TILE_STYLE;

		const rowObjects = existing.filter((object) => object.y === y);
		const groupId = resolveGroupIdForPlacement(rowObjects, x, style, GRID_SIZE, createGroupId());

		let updated: PlacedObject[] = [...existing, { type: 'ground', x, y, style, groupId }];

		// If the new tile sits between two existing same-style neighbors that
		// belonged to different platforms, it bridges them into one.
		const leftNeighbor = rowObjects.find((object) => object.x === x - GRID_SIZE);
		const rightNeighbor = rowObjects.find((object) => object.x === x + GRID_SIZE);
		if (
			leftNeighbor &&
			rightNeighbor &&
			leftNeighbor.style === style &&
			rightNeighbor.style === style &&
			leftNeighbor.groupId !== rightNeighbor.groupId
		) {
			updated = mergeGroupIds(updated, rightNeighbor.groupId, groupId);
		}

		this.registry.set(PLACED_OBJECTS_REGISTRY_KEY, updated);
		this.refreshRow(y);
	}

	/**
	 * Destroys and re-renders every tile on the given row, recomputing each
	 * one's frame (single/left/center/right) from the current full set of
	 * tiles on that row. Adding, removing, or restyling a tile can change
	 * what frame its neighbors should show, so the whole row is refreshed
	 * rather than just the one tile that changed.
	 */
	private refreshRow(y: number) {
		const existingImages = this.tileImagesByRow.get(y) ?? [];
		for (const image of existingImages) {
			image.destroy();
		}

		const allObjects =
			(this.registry.get(PLACED_OBJECTS_REGISTRY_KEY) as PlacedObject[] | undefined) ?? [];
		const rowObjects = allObjects.filter((object) => object.y === y);
		const rowTiles: PositionedTile[] = rowObjects.map((object) => ({
			x: object.x,
			style: object.style,
			groupId: object.groupId
		}));
		const frameAssignments = getRowTileFrames(rowTiles, GRID_SIZE);

		const newImages: Phaser.GameObjects.Image[] = [];
		for (const { x, frame } of frameAssignments) {
			const tile = this.add
				.image(x, y, TILES_ATLAS_KEY, frame)
				.setDisplaySize(GRID_SIZE, GRID_SIZE)
				.setInteractive({ useHandCursor: true });

			tile.on('pointerdown', () => {
				const clickedKey = tileKey(x, y);
				const currentObjects =
					(this.registry.get(PLACED_OBJECTS_REGISTRY_KEY) as PlacedObject[] | undefined) ?? [];
				const clickedObject = currentObjects.find(
					(object) => object.x === x && object.y === y
				);
				if (!clickedObject) {
					return;
				}
				const groupKeys = getSameGroupTileKeys(currentObjects, clickedObject.groupId);
				const nextActive = getNextActiveGroupKeys(this.activeGroupKeys, clickedKey, groupKeys);
				this.setActiveGroup(nextActive);
			});

			newImages.push(tile);
		}
		this.tileImagesByRow.set(y, newImages);

		// The active group's highlight borders sit above the tile images, so
		// redraw them after re-rendering in case this row contains any.
		this.refreshActiveGroupBorders();
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