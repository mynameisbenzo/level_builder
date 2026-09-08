import Phaser from 'phaser';
import { getSceneKeyForMode, toggleMode, type GameMode } from './mode';
import {
	ensureCharacterAtlas,
	ensureEraserIcon,
	ensurePlayerTexture,
	ensureSelectCursorIcon,
	ensureTilesAtlas,
	ERASER_ICON_KEY,
	ERASER_ICON_PATH,
	PLAYER_TEXTURE_KEY,
	SELECT_CURSOR_ICON_KEY,
	SELECT_CURSOR_ICON_PATH,
	TILES_ATLAS_KEY
} from './textures';
import {
	DEFAULT_GROUND_TILE_STYLE,
	getGroupFrames,
	GROUND_TILE_FRAME_SETS,
	GROUND_TILE_STYLE_REGISTRY_KEY,
	GROUND_TILE_STYLES,
	type GroundTileStyle,
	type PlatformOrientation,
	type PositionedTile
} from './groundTiling';
import {
	EDITOR_PLAYER_POSITION_KEY,
	resolveInitialPlayerPosition,
	type PlayerPosition
} from './playerState';
import { snapToGrid, GRID_SIZE, getFillRange } from './gridSnap';
import {
	bridgeIfBetweenTwoGroups,
	getNextActiveGroupKeys,
	getSameGroupTileKeys,
	isPositionOccupied,
	mergeAdjacentSameStyleGroups,
	PLACED_OBJECTS_REGISTRY_KEY,
	removePosition,
	resolveGroupIdForPlacement,
	tileKey,
	updateObjectStyle,
	type PlacedObject
} from './placedObjects';
import { DEFAULT_EDITOR_TOOL, EDITOR_TOOL_REGISTRY_KEY, EDITOR_TOOLS, type EditorTool } from './tools';
import { clearModeTogglePressed, touchInputState } from './touchInput';
import { currentMode } from './currentMode';

const CURRENT_MODE: GameMode = 'edit';
const GRID_COLOR = 0x333344;
const BACKGROUND_COLOR = 0x14141f;

/**
 * Which UI the user prefers for changing a selected platform's style.
 * Stored in the registry so it persists across Play/Edit toggles.
 */
type StylePickerMode = 'toolbar' | 'radial';
const STYLE_PICKER_MODE_REGISTRY_KEY = 'stylePickerMode';
const DEFAULT_STYLE_PICKER_MODE: StylePickerMode = 'toolbar';

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
	private isInstructionsModalOpen = false;
	private instructionsModalElements: Phaser.GameObjects.GameObject[] = [];

	// Drag placement state. Orientation is undetermined at the start of a
	// gesture and locks to whichever axis the pointer first moves along -
	// a plain click (no movement) stays 'horizontal' by default, matching
	// pre-Y-axis behavior exactly for a single tile.
	private isDragPlacing = false;
	private dragOrientation: PlatformOrientation = 'horizontal';
	private dragOrientationLocked = false;
	private dragOriginX = 0;
	private dragOriginY = 0;
	private dragLastX = 0;
	private dragLastY = 0;

	// Rendering is per-group (a vertical platform spans multiple rows, so
	// per-row tracking can't correctly compute its top/middle/bottom
	// roles) - keyed by "x,y" so any specific tile's image can be found
	// and destroyed directly regardless of which group it belongs to.
	private tileImagesByKey = new Map<string, Phaser.GameObjects.Image>();

	private activeGroupKeys: string[] | null = null;
	private activeTileBorders: Phaser.GameObjects.Rectangle[] = [];

	// Tools toolbar (top-center)
	private toolButtons: {
		tool: EditorTool;
		hitArea: Phaser.GameObjects.GameObject;
		border: Phaser.GameObjects.Rectangle;
	}[] = [];

	// Style toolbar UI
	private styleSwatches: {
		style: GroundTileStyle;
		image: Phaser.GameObjects.Image;
		border: Phaser.GameObjects.Rectangle;
	}[] = [];

	// Radial menu UI
	private isRadialMenuOpen = false;
	private radialMenuCenter?: Phaser.GameObjects.Arc;
	private radialMenuOptions: {
		style: GroundTileStyle;
		swatch: Phaser.GameObjects.Image;
		border: Phaser.GameObjects.Arc;
	}[] = [];

	// UI mode toggle
	private uiModeToggleButton!: Phaser.GameObjects.Text;

	constructor() {
		super('LevelEditorScene');
	}

	preload() {
		ensurePlayerTexture(this);
		ensureCharacterAtlas(this);
		ensureTilesAtlas(this);
		ensureEraserIcon(this);
		ensureSelectCursorIcon(this);
	}

	create() {
		currentMode.set(CURRENT_MODE);
		this.activeGroupKeys = null;

		this.cameras.main.setBackgroundColor(BACKGROUND_COLOR);
		this.drawGrid();

		const openInstructionsButton = this.add
			.text(10, 10, '[?] Instructions', { font: '14px monospace', color: '#ffffff' })
			.setInteractive({ useHandCursor: true });

		openInstructionsButton.on('pointerdown', () => this.openInstructionsModal());

		this.createToolsToolbar();
		this.applyCursorForTool(this.getEditorTool());
		this.createUiModeToggle();
		this.createStyleToolbar();
		this.refreshStylePickerVisibility();

		const placedObjects =
			(this.registry.get(PLACED_OBJECTS_REGISTRY_KEY) as PlacedObject[] | undefined) ?? [];
		const initialGroupIds = new Set(placedObjects.map((object) => object.groupId));
		for (const groupId of initialGroupIds) {
			this.refreshGroup(groupId);
		}

		this.input.on(
			'pointerdown',
			(pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
				if (currentlyOver.length > 0) {
					// Clicked an existing object (e.g. the player, a tile, a
					// button) - let its own handlers deal with it.
					return;
				}

				if (this.getEditorTool() !== 'select') {
					// The eraser (and any future non-placement tool) has
					// nothing useful to do on empty space.
					return;
				}

				// Starting a new placement always clears any active (selected)
				// group - you're placing something new, not editing what was
				// selected before.
				this.setActiveGroup(null);

				const x = snapToGrid(pointer.x, GRID_SIZE);
				const y = snapToGrid(pointer.y, GRID_SIZE);

				this.isDragPlacing = true;
				this.dragOrientation = 'horizontal';
				this.dragOrientationLocked = false;
				this.dragOriginX = x;
				this.dragOriginY = y;
				this.dragLastX = x;
				this.dragLastY = y;
				this.placeTileIfEmpty(x, y, this.dragOrientation);
			}
		);

		this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
			if (this.getEditorTool() === 'eraser') {
				if (pointer.isDown) {
					this.eraseAtPointer(pointer);
				}
				return;
			}

			if (!this.isDragPlacing || !pointer.isDown) {
				return;
			}

			const currentX = snapToGrid(pointer.x, GRID_SIZE);
			const currentY = snapToGrid(pointer.y, GRID_SIZE);

			// The drag's axis locks in on whichever direction the pointer
			// first moves away from the anchor point - once locked, it stays
			// that way for the rest of the gesture, same as the anchor tile
			// locked a single row/column before Y-axis support existed.
			if (!this.dragOrientationLocked) {
				if (currentX !== this.dragOriginX) {
					this.dragOrientation = 'horizontal';
					this.dragOrientationLocked = true;
				} else if (currentY !== this.dragOriginY) {
					this.dragOrientation = 'vertical';
					this.dragOrientationLocked = true;
				} else {
					return;
				}
			}

			if (this.dragOrientation === 'horizontal') {
				// Filling the whole range (not just the current x) avoids
				// gaps if a fast drag skips past a cell between two
				// pointermove events.
				const columns = getFillRange(this.dragLastX, currentX, GRID_SIZE);
				for (const x of columns) {
					this.placeTileIfEmpty(x, this.dragOriginY, 'horizontal');
				}
				this.dragLastX = currentX;
			} else {
				const rows = getFillRange(this.dragLastY, currentY, GRID_SIZE);
				for (const y of rows) {
					this.placeTileIfEmpty(this.dragOriginX, y, 'vertical');
				}
				this.dragLastY = currentY;
			}
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
			.setInteractive({ draggable: true });

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

	// ── Instructions modal ───────────────────────────────────────────────

	/**
	 * A short, in-editor cheat-sheet. Kept intentionally brief - if this
	 * grows much further, it probably belongs on its own dedicated page
	 * rather than a modal (see README TODOs).
	 */
	private openInstructionsModal() {
		if (this.isInstructionsModalOpen) {
			return;
		}
		this.isInstructionsModalOpen = true;

		const centerX = this.scale.width / 2;
		const centerY = this.scale.height / 2;
		const panelWidth = Math.min(this.scale.width - 40, 640);
		const panelHeight = 260;

		const backdrop = this.add.rectangle(
			centerX,
			centerY,
			this.scale.width,
			this.scale.height,
			0x000000,
			0.6
		);

		const panelBg = this.add
			.rectangle(centerX, centerY, panelWidth, panelHeight, 0x2d1b4e, 1)
			.setStrokeStyle(3, 0xffd23f);

		const title = this.add
			.text(centerX, centerY - panelHeight / 2 + 20, 'Instructions', {
				font: '16px monospace',
				color: '#ffd23f'
			})
			.setOrigin(0.5);

		const closeButton = this.add
			.text(centerX + panelWidth / 2 - 24, centerY - panelHeight / 2 + 14, '[X]', {
				font: '14px monospace',
				color: '#ff6b6b'
			})
			.setInteractive({ useHandCursor: true });
		closeButton.on('pointerdown', () => this.closeInstructionsModal());

		const lines = [
			'Drag the square to reposition it',
			'Click-drag empty space to place a platform',
			'Drag horizontally or vertically - the platform follows whichever way you move first',
			'Click a platform to select it, click again to deselect',
			'Select a platform to reveal the style picker and change its appearance',
			'Eraser tool: click or click-drag a tile to remove it',
			'Tab, or the mobile \u21c4 button, switches to Play Mode'
		];
		const lineTexts = lines.map((line, index) =>
			this.add.text(
				centerX - panelWidth / 2 + 20,
				centerY - panelHeight / 2 + 50 + index * 22,
				line,
				{ font: '13px monospace', color: '#ffffff' }
			)
		);

		this.instructionsModalElements = [backdrop, panelBg, title, closeButton, ...lineTexts];
	}

	private closeInstructionsModal() {
		this.isInstructionsModalOpen = false;
		for (const element of this.instructionsModalElements) {
			element.destroy();
		}
		this.instructionsModalElements = [];
	}

	// ── Tools toolbar (top-center) ──────────────────────────────────────

	private createToolsToolbar() {
		const spacing = 56;
		const startX = this.scale.width / 2 - spacing / 2;
		const y = 24;

		const selectBorder = this.add.rectangle(startX, y, 40, 32).setStrokeStyle(2, 0x666666);
		const selectIcon = this.add
			.image(startX, y, SELECT_CURSOR_ICON_KEY)
			.setDisplaySize(24, 24)
			.setInteractive({ useHandCursor: true });
		selectIcon.on('pointerdown', () => this.setEditorTool('select'));
		this.toolButtons.push({ tool: 'select', hitArea: selectIcon, border: selectBorder });

		const eraserX = startX + spacing;
		const eraserBorder = this.add.rectangle(eraserX, y, 40, 32).setStrokeStyle(2, 0x666666);
		const eraserIcon = this.add
			.image(eraserX, y, ERASER_ICON_KEY)
			.setDisplaySize(24, 24)
			.setInteractive({ useHandCursor: true });
		eraserIcon.on('pointerdown', () => this.setEditorTool('eraser'));
		this.toolButtons.push({ tool: 'eraser', hitArea: eraserIcon, border: eraserBorder });

		this.refreshToolHighlight();
	}

	private refreshToolHighlight() {
		const current = this.getEditorTool();
		for (const button of this.toolButtons) {
			button.border.setStrokeStyle(2, button.tool === current ? 0xffd23f : 0x666666);
		}
	}

	private getEditorTool(): EditorTool {
		return (
			(this.registry.get(EDITOR_TOOL_REGISTRY_KEY) as EditorTool | undefined) ??
			DEFAULT_EDITOR_TOOL
		);
	}

	private setEditorTool(tool: EditorTool) {
		if (!EDITOR_TOOLS.includes(tool)) {
			return;
		}
		this.registry.set(EDITOR_TOOL_REGISTRY_KEY, tool);
		this.refreshToolHighlight();
		this.applyCursorForTool(tool);
		if (tool !== 'select') {
			// Switching to a non-placement tool clears any selection, so a
			// leftover style picker doesn't linger while erasing.
			this.setActiveGroup(null);
		}
	}

	/**
	 * Sets the browser cursor shown while hovering the canvas, matching
	 * whichever tool is active. The hotspot (8, 2) targets roughly the
	 * fingertip of the select cursor's pointing-hand icon; the eraser's
	 * hotspot (16, 16) is just its center.
	 */
	private applyCursorForTool(tool: EditorTool) {
		if (tool === 'eraser') {
			this.input.setDefaultCursor(`url(${ERASER_ICON_PATH}) 16 16, auto`);
		} else {
			this.input.setDefaultCursor(`url(${SELECT_CURSOR_ICON_PATH}) 8 2, auto`);
		}
	}

	/**
	 * Erases whatever tile (if any) sits exactly under the pointer. Used
	 * for both the initial click and for dragging across multiple tiles.
	 * Unlike placement, this isn't locked to a single axis or gap-filled
	 * for fast movement - it simply checks the current pointer position
	 * each time it's called.
	 */
	private eraseAtPointer(pointer: Phaser.Input.Pointer) {
		const x = snapToGrid(pointer.x, GRID_SIZE);
		const y = snapToGrid(pointer.y, GRID_SIZE);
		this.eraseTile(x, y);
	}

	private eraseTile(x: number, y: number) {
		const existing =
			(this.registry.get(PLACED_OBJECTS_REGISTRY_KEY) as PlacedObject[] | undefined) ?? [];
		const erasedObject = existing.find((object) => object.x === x && object.y === y);
		if (!erasedObject) {
			return;
		}
		this.registry.set(PLACED_OBJECTS_REGISTRY_KEY, removePosition(existing, x, y));

		const key = tileKey(x, y);
		this.tileImagesByKey.get(key)?.destroy();
		this.tileImagesByKey.delete(key);

		// Whatever remains of the erased tile's group may need its end
		// caps recomputed (e.g. the tile next to it is now an end, not a
		// middle piece).
		this.refreshGroup(erasedObject.groupId);
	}

	// ── UI mode toggle (top-right) ──────────────────────────────────────

	private createUiModeToggle() {
		const mode = this.getStylePickerMode();
		this.uiModeToggleButton = this.add
			.text(this.scale.width - 10, 10, this.uiModeLabel(mode), {
				font: '14px monospace',
				color: '#00d9ff'
			})
			.setOrigin(1, 0)
			.setInteractive({ useHandCursor: true });

		this.uiModeToggleButton.on('pointerdown', () => {
			const current = this.getStylePickerMode();
			const next: StylePickerMode = current === 'toolbar' ? 'radial' : 'toolbar';
			this.registry.set(STYLE_PICKER_MODE_REGISTRY_KEY, next);
			this.uiModeToggleButton.setText(this.uiModeLabel(next));
			// Switching UI while the radial menu happens to be open would
			// leave it orphaned on screen with no way to reach it again.
			this.closeRadialMenu();
			this.refreshStylePickerVisibility();
		});
	}

	private uiModeLabel(mode: StylePickerMode): string {
		return mode === 'toolbar' ? 'Style UI: Toolbar' : 'Style UI: Radial';
	}

	private getStylePickerMode(): StylePickerMode {
		return (
			(this.registry.get(STYLE_PICKER_MODE_REGISTRY_KEY) as StylePickerMode | undefined) ??
			DEFAULT_STYLE_PICKER_MODE
		);
	}

	/**
	 * Shows/enables whichever style-selection UI matches the current
	 * preference, and only while a platform is actually selected - neither
	 * UI makes sense with nothing to apply a style change to. The radial
	 * menu opens/closes here directly, mirroring how the toolbar's
	 * visibility is tied to selection rather than a separate open/close
	 * action.
	 */
	private refreshStylePickerVisibility() {
		const hasSelection = this.activeGroupKeys !== null && this.activeGroupKeys.length > 0;
		const mode = this.getStylePickerMode();

		const toolbarVisible = hasSelection && mode === 'toolbar';
		for (const swatch of this.styleSwatches) {
			swatch.image.setVisible(toolbarVisible);
			swatch.border.setVisible(toolbarVisible);
			if (toolbarVisible) {
				swatch.image.setInteractive({ useHandCursor: true });
			} else {
				swatch.image.disableInteractive();
			}
		}
		if (toolbarVisible) {
			this.refreshSwatchHighlight();
		}

		const radialVisible = hasSelection && mode === 'radial';
		if (radialVisible) {
			// Always close-then-reopen rather than leaving a stale instance
			// in place, so the highlighted style is never out of date after
			// a restyle or a merge.
			this.closeRadialMenu();
			const [xStr, yStr] = this.activeGroupKeys![0].split(',');
			this.openRadialMenu(Number(xStr), Number(yStr));
		} else {
			this.closeRadialMenu();
		}
	}

	// ── Style toolbar UI ─────────────────────────────────────────────────

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

			image.on('pointerdown', () => this.applyStyleToActiveGroup(style));

			return { style, image, border };
		});
	}

	/**
	 * The swatch highlight reflects the active platform's current style
	 * (all its tiles should match, so the first is representative). Only
	 * meaningful while the toolbar is actually visible.
	 */
	private refreshSwatchHighlight() {
		const displayedStyle = this.getDisplayedStyle();
		for (const swatch of this.styleSwatches) {
			swatch.border.setStrokeStyle(3, swatch.style === displayedStyle ? 0xffd23f : 0x666666);
		}
	}

	// ── Radial menu UI ───────────────────────────────────────────────────

	/**
	 * A simplified radial menu: all six styles arranged in a circle, each
	 * clickable directly, applying to the currently active platform. Opens
	 * automatically whenever a platform is selected in radial mode (see
	 * refreshStylePickerVisibility) - there's no separate "open" trigger,
	 * it mirrors the toolbar's own always-shown-while-selected behavior.
	 */
	private openRadialMenu(centerX: number, centerY: number) {
		if (this.isRadialMenuOpen) {
			return;
		}
		this.isRadialMenuOpen = true;

		this.radialMenuCenter = this.add
			.circle(centerX, centerY, 10, 0xffd23f, 0.9)
			.setInteractive({ useHandCursor: true });
		// Clicking the center deselects, same as clicking an already-active
		// tile directly would - this closes the menu via the same selection
		// state the toolbar's visibility already depends on.
		this.radialMenuCenter.on('pointerdown', () => this.setActiveGroup(null));

		const currentStyle = this.getDisplayedStyle();
		const radius = 70;
		const angleStep = (Math.PI * 2) / GROUND_TILE_STYLES.length;
		const startAngle = -Math.PI / 2;

		this.radialMenuOptions = GROUND_TILE_STYLES.map((style, index) => {
			const angle = startAngle + index * angleStep;
			const x = centerX + radius * Math.cos(angle);
			const y = centerY + radius * Math.sin(angle);

			const border = this.add
				.circle(x, y, 26, 0x000000, 0)
				.setStrokeStyle(3, style === currentStyle ? 0xffd23f : 0x666666);

			const swatch = this.add
				.image(x, y, TILES_ATLAS_KEY, GROUND_TILE_FRAME_SETS[style].single)
				.setDisplaySize(44, 44)
				.setInteractive({ useHandCursor: true });

			swatch.on('pointerdown', () => {
				// Menu stays open, mirroring the toolbar staying visible
				// after a click - applyStyleToActiveGroup's own visibility
				// refresh will close-and-reopen this menu with the updated
				// highlight, so further style changes can be made right away.
				this.applyStyleToActiveGroup(style);
			});

			return { style, swatch, border };
		});
	}

	private closeRadialMenu() {
		this.isRadialMenuOpen = false;
		this.radialMenuCenter?.destroy();
		this.radialMenuCenter = undefined;
		for (const option of this.radialMenuOptions) {
			option.swatch.destroy();
			option.border.destroy();
		}
		this.radialMenuOptions = [];
	}

	// ── Shared restyle logic (called by both UIs) ───────────────────────

	/**
	 * Restyles every tile in the currently active (selected) platform.
	 * Shared by both the toolbar and the radial menu - neither UI is
	 * visible/interactive with nothing selected, so this is never reached
	 * with an empty selection; the guard is defensive.
	 */
	private applyStyleToActiveGroup(style: GroundTileStyle) {
		if (this.activeGroupKeys === null || this.activeGroupKeys.length === 0) {
			return;
		}

		let existing =
			(this.registry.get(PLACED_OBJECTS_REGISTRY_KEY) as PlacedObject[] | undefined) ?? [];

		for (const key of this.activeGroupKeys) {
			const [xStr, yStr] = key.split(',');
			const x = Number(xStr);
			const y = Number(yStr);
			existing = updateObjectStyle(existing, x, y, style);
		}

		// The restyled platform's own id doesn't change - look it up from
		// any of its tiles now that the style update has been applied.
		const [firstXStr, firstYStr] = this.activeGroupKeys[0].split(',');
		const activeObject = existing.find(
			(object) => object.x === Number(firstXStr) && object.y === Number(firstYStr)
		);

		if (activeObject) {
			const groupId = activeObject.groupId;
			// Restyling can now make this platform match a directly
			// touching different platform - placement-time merging
			// doesn't retroactively apply, so check for that here.
			existing = mergeAdjacentSameStyleGroups(existing, groupId, GRID_SIZE);
			// Reflect the merge (if any) in the current selection, so the
			// highlight covers the whole newly-combined platform.
			this.activeGroupKeys = getSameGroupTileKeys(existing, groupId);
			this.registry.set(PLACED_OBJECTS_REGISTRY_KEY, existing);
			this.refreshGroup(groupId);
		} else {
			this.registry.set(PLACED_OBJECTS_REGISTRY_KEY, existing);
		}

		this.refreshStylePickerVisibility();
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
		this.refreshActiveGroupBorders();
		this.refreshStylePickerVisibility();
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

	private placeTileIfEmpty(x: number, y: number, orientation: PlatformOrientation) {
		const existing =
			(this.registry.get(PLACED_OBJECTS_REGISTRY_KEY) as PlacedObject[] | undefined) ?? [];

		if (isPositionOccupied(existing, x, y)) {
			return;
		}

		const style =
			(this.registry.get(GROUND_TILE_STYLE_REGISTRY_KEY) as GroundTileStyle | undefined) ??
			DEFAULT_GROUND_TILE_STYLE;

		const groupId = resolveGroupIdForPlacement(
			existing,
			x,
			y,
			orientation,
			style,
			GRID_SIZE,
			createGroupId()
		);

		let updated: PlacedObject[] = [...existing, { type: 'ground', x, y, style, groupId }];

		// If the new tile sits between two existing same-style,
		// orientation-compatible neighbors that belonged to different
		// platforms, it bridges them into one.
		updated = bridgeIfBetweenTwoGroups(updated, x, y, orientation, style, GRID_SIZE, groupId);

		this.registry.set(PLACED_OBJECTS_REGISTRY_KEY, updated);
		this.refreshGroup(groupId);
	}

	/**
	 * Destroys and re-renders every tile belonging to one platform (group),
	 * recomputing each one's frame (single/left-right-center or
	 * top-middle-bottom, depending on the group's own orientation) from the
	 * current full set of its tiles. Adding, removing, or restyling a tile
	 * can change what frame its neighbors within the same group should
	 * show, so the whole group is refreshed rather than just the one tile
	 * that changed.
	 */
	private refreshGroup(groupId: string) {
		const allObjects =
			(this.registry.get(PLACED_OBJECTS_REGISTRY_KEY) as PlacedObject[] | undefined) ?? [];
		const groupObjects = allObjects.filter((object) => object.groupId === groupId);

		for (const object of groupObjects) {
			const key = tileKey(object.x, object.y);
			this.tileImagesByKey.get(key)?.destroy();
			this.tileImagesByKey.delete(key);
		}

		const groupTiles: PositionedTile[] = groupObjects.map((object) => ({
			x: object.x,
			y: object.y,
			style: object.style,
			groupId: object.groupId
		}));
		const frameAssignments = getGroupFrames(groupTiles, GRID_SIZE);

		for (const { x, y, frame } of frameAssignments) {
			const tile = this.add
				.image(x, y, TILES_ATLAS_KEY, frame)
				.setDisplaySize(GRID_SIZE, GRID_SIZE)
				.setInteractive();

			tile.on('pointerdown', () => {
				if (this.getEditorTool() === 'eraser') {
					this.eraseTile(x, y);
					return;
				}

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

			this.tileImagesByKey.set(tileKey(x, y), tile);
		}

		// The active group's highlight borders sit above the tile images, so
		// redraw them after re-rendering in case this group contains any.
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