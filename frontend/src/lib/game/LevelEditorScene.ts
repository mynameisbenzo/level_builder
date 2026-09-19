import Phaser from 'phaser';
import { getSceneKeyForMode, toggleMode, type GameMode } from './mode';
import {
	CHARACTERS_ATLAS_KEY,
	ensureCharacterAtlas,
	ensureEraserIcon,
	ensureSelectCursorIcon,
	ensureTilesAtlas,
	ERASER_ICON_KEY,
	ERASER_ICON_PATH,
	SELECT_CURSOR_ICON_KEY,
	SELECT_CURSOR_ICON_PATH,
	TILES_ATLAS_KEY
} from './atlases';
import {
	ensureStartingPlayerColor,
	getCharacterSwapObjectFrame,
	getPlayerHudFrame,
	PLAYER_COLORS,
	setStartingPlayerColor,
	type PlayerColor
} from './playerColor';
import { getPlayerPoseConfig, PLAYER_DISPLAY_SIZE } from './playerPose';
import {
	CHARACTER_SWAP_OBJECTS_REGISTRY_KEY,
	getAvailableSwapColors,
	removeSwapObjectAt,
	type CharacterSwapObject
} from './characterSwapObjects';
import {
	canPlaceDoorAt,
	DEFAULT_REQUIRED_KEY_COLOR,
	DOOR_KEY_REQUIRED_CLOSED_FRAME,
	DOOR_NO_KEY_CLOSED_FRAME,
	DOOR_OBJECTS_REGISTRY_KEY,
	getDoorClosedFrame,
	removeDoorAt,
	setDoorRequiredKeyColor,
	type DoorObject
} from './winConditions';
import {
	canPlaceKeyAt,
	getKeyFrame,
	KEY_COLORS,
	KEY_OBJECTS_REGISTRY_KEY,
	removeKeyAt,
	type KeyColor,
	type KeyObject
} from './keys';
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
	DEFAULT_PLAYER_POSITION,
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
import {
	CAMERA_MODES,
	clampScroll,
	ensureCameraMode,
	getEdgeScrollVelocity,
	getQuadrantCenter,
	setCameraMode,
	VIEWPORT_HEIGHT,
	VIEWPORT_WIDTH,
	WORLD_HEIGHT,
	WORLD_WIDTH,
	type CameraMode
} from './camera';

const CURRENT_MODE: GameMode = 'edit';
const GRID_COLOR = 0x333344;
const BACKGROUND_COLOR = 0x14141f;

// Mouse-based edge-scroll panning, active only in 'navigate' interaction
// mode (see EditorInteractionMode) - hovering within this many pixels of
// a viewport edge scrolls the camera in that direction, continuously, at
// this speed. No animation involved (unlike Play mode's quadrant snap),
// just a direct per-frame scroll while the pointer stays near an edge.
const EDGE_SCROLL_THRESHOLD_PX = 50;
const EDGE_SCROLL_SPEED_PX_PER_SEC = 400;

// A small, fixed guard around the toolbar content itself (not tied to
// edge-scroll math at all now that the two are mutually exclusive by
// mode) - clicking in the gaps between toolbar buttons, or near but not
// exactly on one, should never fall through to world placement/erasure
// underneath. Sized to the toolbars' actual content, with a little
// margin, not to any scroll-trigger distance.
const TOP_UI_GUARD_HEIGHT = 100;
const BOTTOM_UI_GUARD_HEIGHT = 70;

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

// What's currently armed for placement via the win-condition toolbar -
// either flavor of door, or one of the four key colors.
type PlaceableWinConditionItem =
	| { kind: 'door'; requiresKey: boolean }
	| { kind: 'key'; color: KeyColor };

/**
 * The two top-level interaction modes, mutually exclusive by design so
 * camera panning and world editing never compete for the same mouse
 * input. 'edit' (the default) behaves like the Editor always has -
 * clicking places/erases/selects, no camera movement. 'navigate' is the
 * opposite - hovering near a viewport edge pans the camera, and nothing
 * places/erases/selects while it's active. Not persisted - always
 * starts fresh as 'edit' each time the Editor is (re)entered, same
 * reasoning as PlatformerScene's session-only runtime state (see its
 * hasWon comment).
 */
type EditorInteractionMode = 'edit' | 'navigate';

export class LevelEditorScene extends Phaser.Scene {
	private toggleKey!: Phaser.Input.Keyboard.Key;
	private playerObject!: Phaser.GameObjects.Image;
	// Method A: dual-camera setup for zoomed world + fixed-size UI.
	/** Detected once in create() via Phaser's own device info. */
	private isTouchDevice = false;
	/** A second camera, layered on top of the main one, dedicated to
	 * rendering only UI - never zoomed, regardless of what the main
	 * camera is doing. See markAsWorldObject/markAsUiObject below for
	 * how content is routed to the correct camera only. */
	private uiCamera!: Phaser.Cameras.Scene2D.Camera;
	private isInstructionsModalOpen = false;
	private instructionsModalElements: (Phaser.GameObjects.GameObject &
		Phaser.GameObjects.Components.ScrollFactor)[] = [];

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

	// Generic radial menu - shared by every picker except the style
	// picker (which keeps its own, more specialized radial above): the
	// character-swap, starting-character, win-condition, and
	// door-key-color pickers all place their options in a circle around
	// a contextual anchor point instead of a shared bottom-row toolbar,
	// so they can never visually overlap each other or the style picker.
	// Only one of these pickers is ever open at a time, so one shared
	// instance is enough - each picker's own refresh method calls
	// openGenericRadialMenu with its own items/callbacks/anchor.
	private genericRadialCenter?: Phaser.GameObjects.Arc;
	private genericRadialOptions: {
		key: string;
		swatch: Phaser.GameObjects.Image;
		border: Phaser.GameObjects.Arc;
	}[] = [];

	// UI mode toggle
	private uiModeToggleButton!: Phaser.GameObjects.Text;

	// Camera mode toggle - a level-wide setting (like starting
	// character), not a per-object one, so it's a simple button rather
	// than a swatch picker.
	private cameraModeToggleButton!: Phaser.GameObjects.Text;

	// Navigate/Edit interaction mode - see the EditorInteractionMode
	// comment above. Runtime-only, not persisted (always starts as
	// 'edit'), unlike the other toggles above which are genuine
	// per-level settings.
	private interactionMode: EditorInteractionMode = 'edit';
	private interactionModeToggleButton!: Phaser.GameObjects.Text;
	private interactionModeToggleKey!: Phaser.Input.Keyboard.Key;
	/** Every always-on toolbar element (Instructions button, main tools
	 * row, starting-character button, UI/camera mode toggles) - hidden
	 * as a group while navigating, since none of them do anything useful
	 * with the world not interactable there anyway. Does NOT include
	 * interactionModeToggleButton itself, which must stay visible and
	 * clickable in both modes to switch back. Swatch pickers aren't
	 * tracked here either - they already close via
	 * closeAllBottomRowPickers when Navigate mode is entered. */
	private persistentToolbarElements: (Phaser.GameObjects.GameObject &
		Phaser.GameObjects.Components.Visible)[] = [];

	// Character-swap placement tool
	/** Whether the color-swatch picker is showing. Independent of the
	 * active tool (see closeAllBottomRowPickers) - being in the
	 * characterSwap tool no longer implies this is open, since another
	 * picker (e.g. door-key-color) sharing the same bottom-row space can
	 * take over without a tool switch happening. */
	private isCharacterSwapPickerOpen = false;
	private selectedSwapColor: PlayerColor | null = null;
	private characterSwapSwatches: {
		color: PlayerColor;
		image: Phaser.GameObjects.Image;
		border: Phaser.GameObjects.Rectangle;
	}[] = [];
	private placedSwapObjectImages: Phaser.GameObjects.Image[] = [];

	// Starting-character picker - a standalone toolbar button, not an
	// EditorTool (it doesn't change what clicking in the level does; it
	// just sets a level-wide value directly).
	private startingCharacterButtonIcon!: Phaser.GameObjects.Image;
	private isStartingCharacterPickerOpen = false;
	private startingCharacterSwatches: {
		color: PlayerColor;
		image: Phaser.GameObjects.Image;
		border: Phaser.GameObjects.Rectangle;
	}[] = [];

	// Win-condition placement tool - doors and keys share one toolbar
	// since keys exist specifically to unlock key-required doors.
	/** Same independence rationale as isCharacterSwapPickerOpen above. */
	private isWinConditionPickerOpen = false;
	private selectedWinConditionItem: PlaceableWinConditionItem | null = null;
	private winConditionSwatches: {
		item: PlaceableWinConditionItem;
		image: Phaser.GameObjects.Image;
		border: Phaser.GameObjects.Rectangle;
	}[] = [];
	private placedDoorImages: Phaser.GameObjects.Image[] = [];
	private placedKeyImages: Phaser.GameObjects.Image[] = [];

	// Door key-color picker - opened by clicking a placed key-required
	// door from any non-eraser tool, to choose which key color unlocks
	// that specific door. Shares the same bottom-row space as
	// the other pickers, so mutual exclusivity matters here too (see
	// setActiveGroup).
	private selectedDoorForKeyConfig: { x: number; y: number } | null = null;
	private doorKeyColorSwatches: {
		color: KeyColor;
		image: Phaser.GameObjects.Image;
		border: Phaser.GameObjects.Rectangle;
	}[] = [];

	constructor() {
		super('LevelEditorScene');
	}

	preload() {
		ensureCharacterAtlas(this);
		ensureTilesAtlas(this);
		ensureEraserIcon(this);
		ensureSelectCursorIcon(this);
	}

	create() {
		currentMode.set(CURRENT_MODE);
		this.activeGroupKeys = null;
		this.interactionMode = 'edit';

		this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
		this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
		this.isTouchDevice = this.sys.game.device.input.touch;
		// UI camera created early - markAsUiObject/markAsWorldObject calls
		// happen throughout the rest of create() and other methods, so
		// this needs to exist before any of them run. Left with no
		// explicit background color, which defaults to transparent for
		// any camera beyond the main one - this is what lets the main
		// camera's (possibly zoomed) world content show through
		// underneath it.
		this.uiCamera = this.cameras.add(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
		if (this.isTouchDevice) {
			this.cameras.main.setZoom(1.5);
		}
		// Default framing is the bottom-left quadrant (index 2), rather
		// than wherever the camera happens to start by default (0,0 -
		// top-left). Independent of player spawn position; this is just
		// the initial view before any edge-scroll panning happens.
		const initialCenter = getQuadrantCenter(2);
		this.cameras.main.centerOn(initialCenter.x, initialCenter.y);
		this.cameras.main.setBackgroundColor(BACKGROUND_COLOR);
		this.drawGrid();

		const openInstructionsButton = this.markAsUiObject(
			this.add
				.text(10, 10, '[?] Instructions', { font: '14px monospace', color: '#ffffff' })
				.setInteractive({ useHandCursor: true })
				.setScrollFactor(0)
		);

		openInstructionsButton.on('pointerdown', () => this.openInstructionsModal());
		this.persistentToolbarElements.push(openInstructionsButton);

		this.createToolsToolbar();
		this.applyCursorForTool(this.getEditorTool());
		this.createUiModeToggle();
		this.createCameraModeToggle();
		this.createInteractionModeToggle();
		this.createStyleToolbar();
		this.createCharacterSwapToolbar();
		this.createStartingCharacterToolbar();
		this.createWinConditionToolbar();
		this.createDoorKeyColorPicker();
		this.refreshStylePickerVisibility();

		this.refreshSwapObjectImages();
		this.refreshDoorImages();
		this.refreshKeyImages();

		const placedObjects =
			(this.registry.get(PLACED_OBJECTS_REGISTRY_KEY) as PlacedObject[] | undefined) ?? [];
		const initialGroupIds = new Set(placedObjects.map((object) => object.groupId));
		for (const groupId of initialGroupIds) {
			this.refreshGroup(groupId);
		}

		this.input.on(
			'pointerdown',
			(pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
				if (
					this.interactionMode !== 'edit' ||
					currentlyOver.length > 0 ||
					this.isPointOverUi(pointer.x, pointer.y)
				) {
					// Navigating (not editing), clicked an existing object
					// (e.g. the player, a tile, a button), or clicked
					// somewhere within a UI strip - let its own handler deal
					// with it, or just ignore the click.
					return;
				}

				const tool = this.getEditorTool();

				if (tool === 'characterSwap') {
					this.placeSwapObjectAtPointer(pointer);
					return;
				}

				if (tool === 'winCondition') {
					this.placeWinConditionAtPointer(pointer);
					return;
				}

				if (tool !== 'select') {
					// The eraser (and any future non-placement tool) has
					// nothing useful to do on empty space.
					return;
				}

				// Starting a new placement always clears any active (selected)
				// group - you're placing something new, not editing what was
				// selected before.
				this.setActiveGroup(null);

				const x = snapToGrid(pointer.worldX, GRID_SIZE);
				const y = snapToGrid(pointer.worldY, GRID_SIZE);

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
			if (this.interactionMode !== 'edit' || this.isPointOverUi(pointer.x, pointer.y)) {
				return;
			}

			if (this.getEditorTool() === 'eraser') {
				if (pointer.isDown) {
					this.eraseAtPointer(pointer);
				}
				return;
			}

			if (!this.isDragPlacing || !pointer.isDown) {
				return;
			}

			const currentX = snapToGrid(pointer.worldX, GRID_SIZE);
			const currentY = snapToGrid(pointer.worldY, GRID_SIZE);

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
		const spawnPosition = resolveInitialPlayerPosition(storedPosition, DEFAULT_PLAYER_POSITION);

		const playerColor = ensureStartingPlayerColor(this);
		this.playerObject = this.markAsWorldObject(
			this.add
				.image(
					spawnPosition.x,
					spawnPosition.y,
					CHARACTERS_ATLAS_KEY,
					getPlayerPoseConfig(playerColor).idle.frame
				)
				.setDisplaySize(PLAYER_DISPLAY_SIZE, PLAYER_DISPLAY_SIZE)
				.setInteractive({ draggable: true })
		);

		this.playerObject.on(
			'drag',
			(_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
				if (this.interactionMode !== 'edit') {
					return;
				}
				this.playerObject.setPosition(snapToGrid(dragX, GRID_SIZE), snapToGrid(dragY, GRID_SIZE));
			}
		);

		if (!this.input.keyboard) {
			throw new Error('Keyboard input plugin is not available');
		}
		this.toggleKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TAB);
		this.interactionModeToggleKey = this.input.keyboard.addKey(
			Phaser.Input.Keyboard.KeyCodes.SPACE
		);
	}

	/**
	 * Registers a game object as world content for the dual-camera setup
	 * - tells the UI camera to skip rendering it, so it only ever
	 * appears via the (possibly zoomed) main camera, never duplicated or
	 * shown at the wrong scale by the UI camera layered on top. Returns
	 * the object unchanged so call sites can wrap creation calls inline
	 * (e.g. `this.markAsWorldObject(this.add.image(...))`).
	 *
	 * Called at the moment every world object is created - tiles, the
	 * player marker, swap objects, doors, keys, the grid, selection
	 * borders, the radial menu. There's no reliable way to retroactively
	 * catch dynamically created objects after the fact (camera.ignore()
	 * only takes a snapshot of whatever list you pass it at call time),
	 * so every world-object creation site needs to route through this
	 * individually rather than relying on one bulk call somewhere.
	 */
	private markAsWorldObject<T extends Phaser.GameObjects.GameObject>(obj: T): T {
		this.uiCamera.ignore(obj);
		return obj;
	}

	/**
	 * The mirror image of markAsWorldObject - registers a game object as
	 * UI content, telling the main (world) camera to skip rendering it,
	 * so UI only ever renders via the dedicated, never-zoomed UI camera.
	 * Same "every creation site routes through this" reasoning applies,
	 * even though UI elements are mostly created once at scene startup
	 * rather than growing dynamically - consistency here matters more
	 * than the two cases actually needing identical treatment.
	 */
	private markAsUiObject<T extends Phaser.GameObjects.GameObject>(obj: T): T {
		this.cameras.main.ignore(obj);
		return obj;
	}

	update(_time: number, delta: number) {
		if (Phaser.Input.Keyboard.JustDown(this.toggleKey) || touchInputState.modeTogglePressed) {
			clearModeTogglePressed();
			this.registry.set(EDITOR_PLAYER_POSITION_KEY, {
				x: this.playerObject.x,
				y: this.playerObject.y
			} satisfies PlayerPosition);
			const nextMode = toggleMode(CURRENT_MODE);
			this.scene.start(getSceneKeyForMode(nextMode));
			return;
		}

		if (Phaser.Input.Keyboard.JustDown(this.interactionModeToggleKey)) {
			this.toggleInteractionMode();
		}

		if (this.interactionMode === 'navigate') {
			this.updateEdgeScroll(delta);
		}
	}

	/**
	 * Whether a screen-space point falls within the toolbar guard region
	 * (top toolbar row, bottom picker row, or the instructions modal
	 * while open) - prevents a click in the gaps between buttons (or
	 * near but not exactly on one) from falling through to world
	 * placement/erasure underneath. No longer related to edge-scroll -
	 * that's gated entirely by interaction mode instead (see
	 * updateEdgeScroll).
	 */
	private isPointOverUi(screenX: number, screenY: number): boolean {
		if (this.isInstructionsModalOpen) {
			return true;
		}
		if (screenY <= TOP_UI_GUARD_HEIGHT) {
			return true;
		}
		if (screenY >= this.scale.height - BOTTOM_UI_GUARD_HEIGHT) {
			return true;
		}
		return false;
	}

	/**
	 * Pans the camera when the pointer hovers near a viewport edge - a
	 * direct, continuous scroll each frame, not an animated transition
	 * (that's specific to Play mode's quadrant snap).
	 */
	private updateEdgeScroll(delta: number) {
		const pointer = this.input.activePointer;

		const velocity = getEdgeScrollVelocity(
			pointer.x,
			pointer.y,
			VIEWPORT_WIDTH,
			VIEWPORT_HEIGHT,
			EDGE_SCROLL_THRESHOLD_PX,
			EDGE_SCROLL_SPEED_PX_PER_SEC
		);

		if (velocity.x === 0 && velocity.y === 0) {
			return;
		}

		const camera = this.cameras.main;
		const clamped = clampScroll(
			camera.scrollX + (velocity.x * delta) / 1000,
			camera.scrollY + (velocity.y * delta) / 1000,
			VIEWPORT_WIDTH,
			VIEWPORT_HEIGHT
		);
		camera.scrollX = clamped.x;
		camera.scrollY = clamped.y;
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
		for (const element of this.instructionsModalElements) {
			element.setScrollFactor(0);
			this.markAsUiObject(element);
		}
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
		const startX = this.scale.width / 2 - spacing * 2;
		const y = 24;

		const selectBorder = this.add
			.rectangle(startX, y, 40, 32)
			.setStrokeStyle(2, 0x666666)
			.setScrollFactor(0);
		const selectIcon = this.add
			.image(startX, y, SELECT_CURSOR_ICON_KEY)
			.setDisplaySize(24, 24)
			.setInteractive({ useHandCursor: true })
			.setScrollFactor(0);
		selectIcon.on('pointerdown', () => this.setEditorTool('select'));
		this.toolButtons.push({ tool: 'select', hitArea: selectIcon, border: selectBorder });

		const eraserX = startX + spacing;
		const eraserBorder = this.add
			.rectangle(eraserX, y, 40, 32)
			.setStrokeStyle(2, 0x666666)
			.setScrollFactor(0);
		const eraserIcon = this.add
			.image(eraserX, y, ERASER_ICON_KEY)
			.setDisplaySize(24, 24)
			.setInteractive({ useHandCursor: true })
			.setScrollFactor(0);
		eraserIcon.on('pointerdown', () => this.setEditorTool('eraser'));
		this.toolButtons.push({ tool: 'eraser', hitArea: eraserIcon, border: eraserBorder });

		const swapX = startX + spacing * 2;
		const swapBorder = this.add
			.rectangle(swapX, y, 40, 32)
			.setStrokeStyle(2, 0x666666)
			.setScrollFactor(0);
		// No dedicated tool icon exists for this - reusing one color's
		// swap-object frame as a representative icon.
		const swapIcon = this.add
			.image(swapX, y, TILES_ATLAS_KEY, getCharacterSwapObjectFrame('beige'))
			.setDisplaySize(24, 24)
			.setInteractive({ useHandCursor: true })
			.setScrollFactor(0);
		swapIcon.on('pointerdown', () => this.setEditorTool('characterSwap'));
		this.toolButtons.push({ tool: 'characterSwap', hitArea: swapIcon, border: swapBorder });

		const winConditionX = startX + spacing * 3;
		const winConditionBorder = this.add
			.rectangle(winConditionX, y, 40, 32)
			.setStrokeStyle(2, 0x666666)
			.setScrollFactor(0);
		// No dedicated tool icon exists for this category either - reusing
		// the no-key door's frame as a representative icon.
		const winConditionIcon = this.add
			.image(winConditionX, y, TILES_ATLAS_KEY, DOOR_NO_KEY_CLOSED_FRAME)
			.setDisplaySize(24, 24)
			.setInteractive({ useHandCursor: true })
			.setScrollFactor(0);
		winConditionIcon.on('pointerdown', () => this.setEditorTool('winCondition'));
		this.toolButtons.push({
			tool: 'winCondition',
			hitArea: winConditionIcon,
			border: winConditionBorder
		});

		// Starting-character picker - not an EditorTool, so it isn't
		// pushed into toolButtons/refreshToolHighlight; its icon reflects
		// whichever color is currently chosen instead of a fixed one.
		const startingCharX = startX + spacing * 4;
		const startingCharBorder = this.add
			.rectangle(startingCharX, y, 40, 32)
			.setStrokeStyle(2, 0x666666)
			.setScrollFactor(0);
		this.startingCharacterButtonIcon = this.add
			.image(startingCharX, y, TILES_ATLAS_KEY, getPlayerHudFrame(ensureStartingPlayerColor(this)))
			.setDisplaySize(24, 24)
			.setInteractive({ useHandCursor: true })
			.setScrollFactor(0);
		this.startingCharacterButtonIcon.on('pointerdown', () => this.toggleStartingCharacterPicker());

		for (const button of this.toolButtons) {
			this.persistentToolbarElements.push(
				button.hitArea as Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Visible,
				button.border
			);
		}
		this.persistentToolbarElements.push(startingCharBorder, this.startingCharacterButtonIcon);
		for (const element of this.persistentToolbarElements) {
			this.markAsUiObject(element);
		}

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

		this.closeAllBottomRowPickers();

		if (tool === 'characterSwap') {
			this.isCharacterSwapPickerOpen = true;
			this.refreshCharacterSwapToolbarVisibility();
		} else if (tool === 'winCondition') {
			this.isWinConditionPickerOpen = true;
			this.refreshWinConditionToolbarVisibility();
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
		const x = snapToGrid(pointer.worldX, GRID_SIZE);
		const y = snapToGrid(pointer.worldY, GRID_SIZE);
		this.eraseTile(x, y);
		this.eraseSwapObjectAt(x, y);
		this.eraseDoorAt(x, y);
		this.eraseKeyAt(x, y);
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

	// ── Character-swap placement tool ───────────────────────────────────

	private createCharacterSwapToolbar() {
		const swatchSize = 40;
		const spacing = 10;
		const totalWidth =
			PLAYER_COLORS.length * swatchSize + (PLAYER_COLORS.length - 1) * spacing;
		const startX = this.scale.width / 2 - totalWidth / 2 + swatchSize / 2;
		const y = this.scale.height - 40;

		this.characterSwapSwatches = PLAYER_COLORS.map((color, index) => {
			const x = startX + index * (swatchSize + spacing);

			const border = this.markAsUiObject(
				this.add
					.rectangle(x, y, swatchSize + 6, swatchSize + 6)
					.setStrokeStyle(3, 0x666666)
					.setScrollFactor(0)
			);

			const image = this.markAsUiObject(
				this.add
					.image(x, y, TILES_ATLAS_KEY, getCharacterSwapObjectFrame(color))
					.setDisplaySize(swatchSize, swatchSize)
					.setInteractive({ useHandCursor: true })
					.setScrollFactor(0)
			);

			image.on('pointerdown', () => this.selectSwapColor(color));

			return { color, image, border };
		});

		this.refreshCharacterSwapToolbarVisibility();
	}

	private getPlacedSwapObjects(): CharacterSwapObject[] {
		return (
			(this.registry.get(CHARACTER_SWAP_OBJECTS_REGISTRY_KEY) as
				| CharacterSwapObject[]
				| undefined) ?? []
		);
	}

	/**
	 * Shows the color swatches only while the character-swap tool is
	 * active. Colors already used by a placed object, or all colors once
	 * MAX_CHARACTER_SWAP_OBJECTS is reached, are dimmed and disabled
	 * rather than hidden - so it's visible *why* nothing more can be
	 * placed, not just that clicking does nothing.
	 */
	private refreshCharacterSwapToolbarVisibility() {
		const isOpen = this.isCharacterSwapPickerOpen;
		const availableColors = new Set(
			getAvailableSwapColors(this.getPlacedSwapObjects(), ensureStartingPlayerColor(this))
		);

		for (const swatch of this.characterSwapSwatches) {
			swatch.image.setVisible(isOpen);
			swatch.border.setVisible(isOpen);

			const isAvailable = availableColors.has(swatch.color);
			if (isOpen && isAvailable) {
				swatch.image.setInteractive({ useHandCursor: true });
				swatch.image.setAlpha(1);
			} else {
				swatch.image.disableInteractive();
				swatch.image.setAlpha(isOpen ? 0.3 : 1);
			}

			swatch.border.setStrokeStyle(
				3,
				swatch.color === this.selectedSwapColor ? 0xffd23f : 0x666666
			);
		}
	}

	private selectSwapColor(color: PlayerColor) {
		const availableColors = getAvailableSwapColors(
			this.getPlacedSwapObjects(),
			ensureStartingPlayerColor(this)
		);
		if (!availableColors.includes(color)) {
			// Shouldn't be reachable (the swatch is disabled), but defensive
			// against any state drift between the two checks.
			return;
		}
		this.selectedSwapColor = color;
		this.refreshCharacterSwapToolbarVisibility();
	}

	private placeSwapObjectAtPointer(pointer: Phaser.Input.Pointer) {
		if (this.selectedSwapColor === null) {
			return;
		}

		const existing = this.getPlacedSwapObjects();
		// Re-check availability at placement time, not just at
		// color-selection time, in case something else changed the
		// placed set in between (defensive, not expected in practice).
		if (!getAvailableSwapColors(existing, ensureStartingPlayerColor(this)).includes(this.selectedSwapColor)) {
			this.selectedSwapColor = null;
			this.refreshCharacterSwapToolbarVisibility();
			return;
		}

		const x = snapToGrid(pointer.worldX, GRID_SIZE);
		const y = snapToGrid(pointer.worldY, GRID_SIZE);
		if (existing.some((object) => object.x === x && object.y === y)) {
			// Something (another swap object) is already exactly here.
			return;
		}

		const updated: CharacterSwapObject[] = [
			...existing,
			{ x, y, color: this.selectedSwapColor }
		];
		this.registry.set(CHARACTER_SWAP_OBJECTS_REGISTRY_KEY, updated);

		// One placement per color selection - pick a color again for the
		// next object, rather than staying "armed" with a color that (at
		// most) could never be placed again anyway.
		this.selectedSwapColor = null;
		this.refreshSwapObjectImages();
		this.refreshCharacterSwapToolbarVisibility();
		this.refreshStartingCharacterPickerVisibility();
	}

	/**
	 * Destroys and re-renders every placed swap object. Static images
	 * here, not animated - the bobbing tween and cooldown visuals are
	 * Play-mode-only (see PlatformerScene), since these are purely
	 * editor-time placement markers. Interactive only for the eraser -
	 * these don't support anything analogous to the style picker, so
	 * there's nothing else for a click to do yet.
	 */
	private refreshSwapObjectImages() {
		for (const image of this.placedSwapObjectImages) {
			image.destroy();
		}

		this.placedSwapObjectImages = this.getPlacedSwapObjects().map((object) => {
			const image = this.markAsWorldObject(
				this.add
					.image(object.x, object.y, TILES_ATLAS_KEY, getCharacterSwapObjectFrame(object.color))
					.setDisplaySize(GRID_SIZE, GRID_SIZE)
					.setInteractive()
			);

			image.on('pointerdown', () => {
				if (this.getEditorTool() === 'eraser') {
					this.eraseSwapObjectAt(object.x, object.y);
				}
			});

			return image;
		});
	}

	private eraseSwapObjectAt(x: number, y: number) {
		const existing = this.getPlacedSwapObjects();
		const updated = removeSwapObjectAt(existing, x, y);
		if (updated.length === existing.length) {
			// Nothing was there - avoid a no-op registry write/re-render.
			return;
		}
		this.registry.set(CHARACTER_SWAP_OBJECTS_REGISTRY_KEY, updated);
		this.refreshSwapObjectImages();
		// Erasing an object frees up its color - reflect that immediately
		// if either color-picker toolbar happens to be open.
		this.refreshCharacterSwapToolbarVisibility();
		this.refreshStartingCharacterPickerVisibility();
	}

	// ── Starting-character picker ───────────────────────────────────────

	private toggleStartingCharacterPicker() {
		if (this.isStartingCharacterPickerOpen) {
			this.isStartingCharacterPickerOpen = false;
			this.refreshStartingCharacterPickerVisibility();
			return;
		}
		// Switching to Select closes every other bottom-row picker (via
		// setEditorTool -> closeAllBottomRowPickers) and clears whatever
		// was armed for placement, so clicking in the level while this is
		// open can't accidentally place something. This has to run
		// before setting isStartingCharacterPickerOpen true, not after -
		// closeAllBottomRowPickers would otherwise immediately clobber it
		// back to false.
		this.setEditorTool('select');
		this.isStartingCharacterPickerOpen = true;
		this.refreshStartingCharacterPickerVisibility();
	}

	private createStartingCharacterToolbar() {
		const swatchSize = 40;
		const spacing = 10;
		const totalWidth =
			PLAYER_COLORS.length * swatchSize + (PLAYER_COLORS.length - 1) * spacing;
		const startX = this.scale.width / 2 - totalWidth / 2 + swatchSize / 2;
		const y = this.scale.height - 40;

		this.startingCharacterSwatches = PLAYER_COLORS.map((color, index) => {
			const x = startX + index * (swatchSize + spacing);

			const border = this.markAsUiObject(
				this.add
					.rectangle(x, y, swatchSize + 6, swatchSize + 6)
					.setStrokeStyle(3, 0x666666)
					.setScrollFactor(0)
			);

			const image = this.markAsUiObject(
				this.add
					.image(x, y, TILES_ATLAS_KEY, getPlayerHudFrame(color))
					.setDisplaySize(swatchSize, swatchSize)
					.setInteractive({ useHandCursor: true })
					.setScrollFactor(0)
			);

			image.on('pointerdown', () => this.selectStartingCharacterColor(color));

			return { color, image, border };
		});

		this.refreshStartingCharacterPickerVisibility();
	}

	/**
	 * Shows the color swatches only while the picker is open. A color
	 * already used by a placed swap object is dimmed and disabled - it
	 * can't become the starting color without first freeing it up (by
	 * erasing that object), since a level's starting color and its swap
	 * objects' colors must always be distinct.
	 */
	private refreshStartingCharacterPickerVisibility() {
		const currentColor = ensureStartingPlayerColor(this);
		const usedByObjects = new Set(this.getPlacedSwapObjects().map((object) => object.color));

		for (const swatch of this.startingCharacterSwatches) {
			swatch.image.setVisible(this.isStartingCharacterPickerOpen);
			swatch.border.setVisible(this.isStartingCharacterPickerOpen);

			const isTakenByObject = usedByObjects.has(swatch.color) && swatch.color !== currentColor;
			if (this.isStartingCharacterPickerOpen && !isTakenByObject) {
				swatch.image.setInteractive({ useHandCursor: true });
				swatch.image.setAlpha(1);
			} else {
				swatch.image.disableInteractive();
				swatch.image.setAlpha(this.isStartingCharacterPickerOpen ? 0.3 : 1);
			}

			swatch.border.setStrokeStyle(3, swatch.color === currentColor ? 0xffd23f : 0x666666);
		}
	}

	private selectStartingCharacterColor(color: PlayerColor) {
		const usedByObjects = new Set(this.getPlacedSwapObjects().map((object) => object.color));
		if (usedByObjects.has(color) && color !== ensureStartingPlayerColor(this)) {
			// Shouldn't be reachable (the swatch is disabled), but
			// defensive against any state drift.
			return;
		}

		setStartingPlayerColor(this, color);
		this.isStartingCharacterPickerOpen = false;
		this.refreshStartingCharacterPickerVisibility();
		this.startingCharacterButtonIcon.setTexture(TILES_ATLAS_KEY, getPlayerHudFrame(color));
		this.playerObject.setTexture(CHARACTERS_ATLAS_KEY, getPlayerPoseConfig(color).idle.frame);
		// The newly-chosen starting color must now be excluded from
		// character-swap-object placement too.
		this.refreshCharacterSwapToolbarVisibility();
	}

	// ── Win-condition placement tool ────────────────────────────────────

	private createWinConditionToolbar() {
		const swatchSize = 40;
		const spacing = 10;
		const y = this.scale.height - 40;

		const items: PlaceableWinConditionItem[] = [
			{ kind: 'door', requiresKey: false },
			{ kind: 'door', requiresKey: true },
			...KEY_COLORS.map((color): PlaceableWinConditionItem => ({ kind: 'key', color }))
		];
		const totalWidth = items.length * swatchSize + (items.length - 1) * spacing;
		const startX = this.scale.width / 2 - totalWidth / 2 + swatchSize / 2;

		this.winConditionSwatches = items.map((item, index) => {
			const x = startX + index * (swatchSize + spacing);
			const frame =
				item.kind === 'door' ? getDoorClosedFrame(item.requiresKey) : getKeyFrame(item.color);

			const border = this.markAsUiObject(
				this.add
					.rectangle(x, y, swatchSize + 6, swatchSize + 6)
					.setStrokeStyle(3, 0x666666)
					.setScrollFactor(0)
			);
			const image = this.markAsUiObject(
				this.add
					.image(x, y, TILES_ATLAS_KEY, frame)
					.setDisplaySize(swatchSize, swatchSize)
					.setInteractive({ useHandCursor: true })
					.setScrollFactor(0)
			);
			image.on('pointerdown', () => this.selectWinConditionItem(item));

			return { item, image, border };
		});

		this.refreshWinConditionToolbarVisibility();
	}

	private isSameWinConditionItem(
		a: PlaceableWinConditionItem | null,
		b: PlaceableWinConditionItem
	): boolean {
		if (a === null || a.kind !== b.kind) {
			return false;
		}
		if (a.kind === 'door' && b.kind === 'door') {
			return a.requiresKey === b.requiresKey;
		}
		if (a.kind === 'key' && b.kind === 'key') {
			return a.color === b.color;
		}
		return false;
	}

	private refreshWinConditionToolbarVisibility() {
		const isOpen = this.isWinConditionPickerOpen;
		for (const swatch of this.winConditionSwatches) {
			swatch.image.setVisible(isOpen);
			swatch.border.setVisible(isOpen);
			if (isOpen) {
				swatch.image.setInteractive({ useHandCursor: true });
			} else {
				swatch.image.disableInteractive();
			}
			swatch.border.setStrokeStyle(
				3,
				this.isSameWinConditionItem(this.selectedWinConditionItem, swatch.item)
					? 0xffd23f
					: 0x666666
			);
		}
	}

	private selectWinConditionItem(item: PlaceableWinConditionItem) {
		this.selectedWinConditionItem = item;
		this.refreshWinConditionToolbarVisibility();
	}

	private getPlacedDoors(): DoorObject[] {
		return (this.registry.get(DOOR_OBJECTS_REGISTRY_KEY) as DoorObject[] | undefined) ?? [];
	}

	private getPlacedKeys(): KeyObject[] {
		return (this.registry.get(KEY_OBJECTS_REGISTRY_KEY) as KeyObject[] | undefined) ?? [];
	}

	/**
	 * Every grid position currently occupied by anything - ground tiles,
	 * swap objects, doors, and keys - used to check whether a new door
	 * or key can be placed without overlapping something else. Doesn't
	 * check the reverse direction: placing a ground tile or swap object
	 * on top of an existing door/key isn't currently prevented, a
	 * narrower scope than full cross-type collision checking in every
	 * direction.
	 */
	private getOccupiedPositionKeys(): Set<string> {
		const keys = new Set<string>();
		const placedObjects =
			(this.registry.get(PLACED_OBJECTS_REGISTRY_KEY) as PlacedObject[] | undefined) ?? [];
		for (const object of placedObjects) {
			keys.add(tileKey(object.x, object.y));
		}
		for (const swapObject of this.getPlacedSwapObjects()) {
			keys.add(tileKey(swapObject.x, swapObject.y));
		}
		for (const door of this.getPlacedDoors()) {
			keys.add(tileKey(door.x, door.y));
		}
		for (const key of this.getPlacedKeys()) {
			keys.add(tileKey(key.x, key.y));
		}
		return keys;
	}

	private placeWinConditionAtPointer(pointer: Phaser.Input.Pointer) {
		if (this.selectedWinConditionItem === null) {
			return;
		}

		if (this.selectedWinConditionItem.kind === 'door') {
			this.placeDoorAtPointer(pointer, this.selectedWinConditionItem.requiresKey);
		} else {
			this.placeKeyAtPointer(pointer, this.selectedWinConditionItem.color);
		}
	}

	private placeDoorAtPointer(pointer: Phaser.Input.Pointer, requiresKey: boolean) {
		const x = snapToGrid(pointer.worldX, GRID_SIZE);
		const y = snapToGrid(pointer.worldY, GRID_SIZE);

		if (!canPlaceDoorAt(x, y, this.getOccupiedPositionKeys())) {
			return;
		}

		const updated: DoorObject[] = [
			...this.getPlacedDoors(),
			{
				x,
				y,
				requiresKey,
				requiredKeyColor: requiresKey ? DEFAULT_REQUIRED_KEY_COLOR : null
			}
		];
		this.registry.set(DOOR_OBJECTS_REGISTRY_KEY, updated);

		this.selectedWinConditionItem = null;
		this.refreshDoorImages();
		this.refreshWinConditionToolbarVisibility();
	}

	private placeKeyAtPointer(pointer: Phaser.Input.Pointer, color: KeyColor) {
		const x = snapToGrid(pointer.worldX, GRID_SIZE);
		const y = snapToGrid(pointer.worldY, GRID_SIZE);

		if (!canPlaceKeyAt(x, y, this.getOccupiedPositionKeys())) {
			return;
		}

		const updated: KeyObject[] = [...this.getPlacedKeys(), { x, y, color }];
		this.registry.set(KEY_OBJECTS_REGISTRY_KEY, updated);

		this.selectedWinConditionItem = null;
		this.refreshKeyImages();
		this.refreshWinConditionToolbarVisibility();
	}

	/**
	 * Destroys and re-renders every placed door - a single static image
	 * each, always shown closed (frame chosen per door's own type - see
	 * getDoorClosedFrame). Doors carry no open/closed state in the
	 * Editor's design data at all (see winConditions.ts) - they always
	 * start closed in Play mode, so there's nothing else to reflect here.
	 * Clicking a key-required door while Select is active opens the
	 * key-color picker for that specific door (see
	 * selectedDoorForKeyConfig); the door's own appearance doesn't change
	 * per key color, since only one locked-door sprite exists.
	 */
	private refreshDoorImages() {
		for (const image of this.placedDoorImages) {
			image.destroy();
		}

		this.placedDoorImages = this.getPlacedDoors().map((door) => {
			const image = this.markAsWorldObject(
				this.add
					.image(door.x, door.y, TILES_ATLAS_KEY, getDoorClosedFrame(door.requiresKey))
					.setDisplaySize(GRID_SIZE, GRID_SIZE)
					.setInteractive()
			);

			image.on('pointerdown', () => {
				const tool = this.getEditorTool();
				if (tool === 'eraser') {
					this.eraseDoorAt(door.x, door.y);
				} else if (door.requiresKey) {
					const isSameDoor =
						this.selectedDoorForKeyConfig?.x === door.x &&
						this.selectedDoorForKeyConfig?.y === door.y;

					this.closeAllBottomRowPickers();

					if (!isSameDoor) {
						this.selectedDoorForKeyConfig = { x: door.x, y: door.y };
						this.refreshDoorKeyColorPickerVisibility();
					}
				}
			});

			return image;
		});
	}

	private eraseDoorAt(x: number, y: number) {
		const existing = this.getPlacedDoors();
		const updated = removeDoorAt(existing, x, y);
		if (updated.length === existing.length) {
			return;
		}
		this.registry.set(DOOR_OBJECTS_REGISTRY_KEY, updated);
		this.refreshDoorImages();
		// Erasing a door may free up space another placement was blocked
		// by.
		this.refreshWinConditionToolbarVisibility();
	}

	/**
	 * Destroys and re-renders every placed key - a single static image
	 * each, always the same frame (keys have no open/closed-style state
	 * variants). Collection is entirely a Play-mode, runtime concept (see
	 * PlatformerScene) - the Editor always shows every placed key at its
	 * design position, regardless of anything that happened in a
	 * previous Play session.
	 */
	private refreshKeyImages() {
		for (const image of this.placedKeyImages) {
			image.destroy();
		}

		this.placedKeyImages = this.getPlacedKeys().map((key) => {
			const image = this.markAsWorldObject(
				this.add
					.image(key.x, key.y, TILES_ATLAS_KEY, getKeyFrame(key.color))
					.setDisplaySize(GRID_SIZE, GRID_SIZE)
					.setInteractive()
			);

			image.on('pointerdown', () => {
				if (this.getEditorTool() === 'eraser') {
					this.eraseKeyAt(key.x, key.y);
				}
			});

			return image;
		});
	}

	private eraseKeyAt(x: number, y: number) {
		const existing = this.getPlacedKeys();
		const updated = removeKeyAt(existing, x, y);
		if (updated.length === existing.length) {
			return;
		}
		this.registry.set(KEY_OBJECTS_REGISTRY_KEY, updated);
		this.refreshKeyImages();
		this.refreshWinConditionToolbarVisibility();
	}

	// ── Door key-color picker ───────────────────────────────────────────

	private createDoorKeyColorPicker() {
		const swatchSize = 40;
		const spacing = 10;
		const totalWidth = KEY_COLORS.length * swatchSize + (KEY_COLORS.length - 1) * spacing;
		const startX = this.scale.width / 2 - totalWidth / 2 + swatchSize / 2;
		const y = this.scale.height - 40;

		this.doorKeyColorSwatches = KEY_COLORS.map((color, index) => {
			const x = startX + index * (swatchSize + spacing);

			const border = this.markAsUiObject(
				this.add
					.rectangle(x, y, swatchSize + 6, swatchSize + 6)
					.setStrokeStyle(3, 0x666666)
					.setScrollFactor(0)
			);
			const image = this.markAsUiObject(
				this.add
					.image(x, y, TILES_ATLAS_KEY, getKeyFrame(color))
					.setDisplaySize(swatchSize, swatchSize)
					.setInteractive({ useHandCursor: true })
					.setScrollFactor(0)
			);
			image.on('pointerdown', () => this.selectDoorKeyColor(color));

			return { color, image, border };
		});

		this.refreshDoorKeyColorPickerVisibility();
	}

	private refreshDoorKeyColorPickerVisibility() {
		const isOpen = this.selectedDoorForKeyConfig !== null;
		const currentDoor = this.selectedDoorForKeyConfig
			? this.getPlacedDoors().find(
					(door) =>
						door.x === this.selectedDoorForKeyConfig!.x &&
						door.y === this.selectedDoorForKeyConfig!.y
				)
			: undefined;

		for (const swatch of this.doorKeyColorSwatches) {
			swatch.image.setVisible(isOpen);
			swatch.border.setVisible(isOpen);
			if (isOpen) {
				swatch.image.setInteractive({ useHandCursor: true });
			} else {
				swatch.image.disableInteractive();
			}
			const isCurrentColor = currentDoor?.requiredKeyColor === swatch.color;
			swatch.border.setStrokeStyle(3, isCurrentColor ? 0xffd23f : 0x666666);
		}
	}

	private selectDoorKeyColor(color: KeyColor) {
		if (this.selectedDoorForKeyConfig === null) {
			return;
		}

		const updated = setDoorRequiredKeyColor(
			this.getPlacedDoors(),
			this.selectedDoorForKeyConfig.x,
			this.selectedDoorForKeyConfig.y,
			color
		);
		this.registry.set(DOOR_OBJECTS_REGISTRY_KEY, updated);

		// Deliberately not closing the picker here - it stays open so the
		// highlight moving to the clicked swatch is actually visible.
		// Click the door again (or switch tools/select something else) to
		// close it.
		this.refreshDoorKeyColorPickerVisibility();
	}

	// ── UI mode toggle (top-right) ──────────────────────────────────────

	private createUiModeToggle() {
		const mode = this.getStylePickerMode();
		this.uiModeToggleButton = this.markAsUiObject(
			this.add
				.text(this.scale.width - 10, 10, this.uiModeLabel(mode), {
					font: '14px monospace',
					color: '#00d9ff'
				})
				.setOrigin(1, 0)
				.setInteractive({ useHandCursor: true })
				.setScrollFactor(0)
		);
		this.persistentToolbarElements.push(this.uiModeToggleButton);

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

	private createCameraModeToggle() {
		const mode = ensureCameraMode(this);
		this.cameraModeToggleButton = this.markAsUiObject(
			this.add
				.text(this.scale.width - 10, 34, this.cameraModeLabel(mode), {
					font: '14px monospace',
					color: '#00d9ff'
				})
				.setOrigin(1, 0)
				.setInteractive({ useHandCursor: true })
				.setScrollFactor(0)
		);
		this.persistentToolbarElements.push(this.cameraModeToggleButton);

		this.cameraModeToggleButton.on('pointerdown', () => {
			const current = ensureCameraMode(this);
			const next: CameraMode = current === 'follow' ? 'quadrant' : 'follow';
			setCameraMode(this, next);
			this.cameraModeToggleButton.setText(this.cameraModeLabel(next));
		});
	}

	private cameraModeLabel(mode: CameraMode): string {
		return mode === 'follow' ? 'Camera: Follow' : 'Camera: Quadrant';
	}

	private createInteractionModeToggle() {
		this.interactionModeToggleButton = this.markAsUiObject(
			this.add
				.text(this.scale.width - 10, 58, this.interactionModeLabel(this.interactionMode), {
					font: '14px monospace',
					color: '#ffd23f'
				})
				.setOrigin(1, 0)
				.setInteractive({ useHandCursor: true })
				.setScrollFactor(0)
		);

		this.interactionModeToggleButton.on('pointerdown', () => this.toggleInteractionMode());
	}

	private interactionModeLabel(mode: EditorInteractionMode): string {
		return mode === 'edit' ? 'Mode: Edit (Space)' : 'Mode: Navigate (Space)';
	}

	/**
	 * Switches between Edit (place/erase/select, no camera movement) and
	 * Navigate (pan the camera, no world interaction) - the two are
	 * mutually exclusive by design, so there's never a moment where
	 * camera panning and clicking-to-place are both active and competing
	 * for the same mouse input.
	 */
	private toggleInteractionMode() {
		this.interactionMode = this.interactionMode === 'edit' ? 'navigate' : 'edit';
		this.interactionModeToggleButton.setText(this.interactionModeLabel(this.interactionMode));

		const showToolbar = this.interactionMode === 'edit';
		for (const element of this.persistentToolbarElements) {
			element.setVisible(showToolbar);
		}
		if (!showToolbar) {
			// Entering Navigate mode - nothing toolbar-related is usable
			// there, so close whichever swatch picker (if any) happened
			// to be open.
			this.closeAllBottomRowPickers();
		}
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

			const border = this.markAsUiObject(
				this.add
					.rectangle(x, y, swatchSize + 6, swatchSize + 6)
					.setStrokeStyle(3, 0x666666)
					.setScrollFactor(0)
			);

			const image = this.markAsUiObject(
				this.add
					.image(x, y, TILES_ATLAS_KEY, GROUND_TILE_FRAME_SETS[style].single)
					.setDisplaySize(swatchSize, swatchSize)
					.setInteractive({ useHandCursor: true })
					.setScrollFactor(0)
			);

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

		this.radialMenuCenter = this.markAsWorldObject(
			this.add.circle(centerX, centerY, 10, 0xffd23f, 0.9).setInteractive({ useHandCursor: true })
		);
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

			const border = this.markAsWorldObject(
				this.add
					.circle(x, y, 26, 0x000000, 0)
					.setStrokeStyle(3, style === currentStyle ? 0xffd23f : 0x666666)
			);

			const swatch = this.markAsWorldObject(
				this.add
					.image(x, y, TILES_ATLAS_KEY, GROUND_TILE_FRAME_SETS[style].single)
					.setDisplaySize(44, 44)
					.setInteractive({ useHandCursor: true })
			);

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
		// Selecting a tile (or clearing the selection) and configuring a
		// door's key color share the same bottom-row space - opening one
		// closes the other.
		this.selectedDoorForKeyConfig = null;
		this.refreshDoorKeyColorPickerVisibility();
		if (keys !== null) {
			// An actual tile just got selected (not cleared) - this can
			// happen from any tool (see refreshGroup's click handler), so
			// it needs to close the other pickers itself rather than
			// relying on a tool switch to have already done it.
			this.isCharacterSwapPickerOpen = false;
			this.refreshCharacterSwapToolbarVisibility();
			this.isWinConditionPickerOpen = false;
			this.refreshWinConditionToolbarVisibility();
			this.isStartingCharacterPickerOpen = false;
			this.refreshStartingCharacterPickerVisibility();
		}
	}

	/**
	 * Closes every bottom-row picker (style, character-swap,
	 * starting-character, win-condition, door-key-color) - they all
	 * share the same visual space. Tool switching already closes
	 * whichever picker belonged to the previous tool (see
	 * setEditorTool), but the door-key picker can now open from any
	 * non-eraser tool without a tool switch happening at all, so it
	 * needs to explicitly clear the others itself rather than relying on
	 * that.
	 */
	private closeAllBottomRowPickers() {
		this.setActiveGroup(null);
		this.isCharacterSwapPickerOpen = false;
		this.selectedSwapColor = null;
		this.refreshCharacterSwapToolbarVisibility();
		this.isStartingCharacterPickerOpen = false;
		this.refreshStartingCharacterPickerVisibility();
		this.isWinConditionPickerOpen = false;
		this.selectedWinConditionItem = null;
		this.refreshWinConditionToolbarVisibility();
		this.selectedDoorForKeyConfig = null;
		this.refreshDoorKeyColorPickerVisibility();
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
			const border = this.markAsWorldObject(
				this.add.rectangle(x, y, GRID_SIZE + 4, GRID_SIZE + 4).setStrokeStyle(3, 0xffd23f)
			);
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
	 *
	 * Horizontal and vertical platforms are never rendered together here -
	 * each group is entirely independent, since they don't visually
	 * connect (a junction piece was tried and removed; see README TODOs).
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
			const tile = this.markAsWorldObject(
				this.add
					.image(x, y, TILES_ATLAS_KEY, frame)
					.setDisplaySize(GRID_SIZE, GRID_SIZE)
					.setInteractive()
			);

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
		const graphics = this.markAsWorldObject(this.add.graphics());
		graphics.lineStyle(1, GRID_COLOR, 1);

		for (let x = 0; x <= WORLD_WIDTH; x += GRID_SIZE) {
			graphics.lineBetween(x, 0, x, WORLD_HEIGHT);
		}
		for (let y = 0; y <= WORLD_HEIGHT; y += GRID_SIZE) {
			graphics.lineBetween(0, y, WORLD_WIDTH, y);
		}
	}
}