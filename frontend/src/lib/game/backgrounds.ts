import type Phaser from 'phaser';
import { BACKGROUNDS_ATLAS_KEY } from './atlases';
import { VIEWPORT_HEIGHT, WORLD_ROWS, WORLD_WIDTH } from './camera';

/**
 * Sits below everything else either scene ever draws - the grid,
 * platforms, the player, enemies, HUD, and toolbar all default to depth
 * 0 or higher (see PLAYER_DEPTH/HUD_DEPTH in PlatformerScene.ts and
 * TOOLBAR_DEPTH in LevelEditorScene.ts) - so the background art never
 * needs to race any of them for depth, no matter what order things get
 * created in.
 */
export const BACKGROUND_DEPTH = -1;

/**
 * Every background theme a level can choose, mirrored on the backend in
 * app/services/level_content.py's BACKGROUND_THEMES. Each name here maps
 * directly onto the spritesheet's own "background_color_<theme>" frame
 * (see getThemeSwatchFrame) - adding a theme means adding both a name
 * here AND confirming the atlas actually ships a
 * background_color_<name> frame for it (spritesheet-backgrounds-default
 * .xml currently also has fade/color pairs for "mushrooms" and "trees"
 * ready to go, beyond what's wired in here).
 */
export const BACKGROUND_THEMES = ['hills', 'desert'] as const;
export type BackgroundTheme = (typeof BACKGROUND_THEMES)[number];

export const DEFAULT_BACKGROUND_THEME: BackgroundTheme = 'hills';
export const BACKGROUND_THEME_REGISTRY_KEY = 'backgroundTheme';

/**
 * Returns the level's background theme, defaulting to (and storing)
 * DEFAULT_BACKGROUND_THEME if none has been explicitly chosen yet - same
 * ensure-and-set pattern as ensureStartingPlayerColor/ensureCameraMode.
 */
export function ensureBackgroundTheme(scene: Phaser.Scene): BackgroundTheme {
	const stored = scene.registry.get(BACKGROUND_THEME_REGISTRY_KEY) as BackgroundTheme | undefined;
	if (stored) {
		return stored;
	}

	scene.registry.set(BACKGROUND_THEME_REGISTRY_KEY, DEFAULT_BACKGROUND_THEME);
	return DEFAULT_BACKGROUND_THEME;
}

export function setBackgroundTheme(scene: Phaser.Scene, theme: BackgroundTheme) {
	scene.registry.set(BACKGROUND_THEME_REGISTRY_KEY, theme);
}

/**
 * The one frame that actually varies by theme - the bottom, ground-level
 * row (see getBackgroundFrameForRow). Also doubles as the toolbar
 * picker's swatch icon for a given theme (see LevelEditorScene's
 * createBackgroundThemeToolbar), since it's the one frame that visually
 * represents the theme at a glance.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getThemeSwatchFrame(theme: BackgroundTheme): string {
	return `background_color_${theme}`;
}

/**
 * Which background frame a given screen ROW should show - one shared
 * background per row, identical across every column. The level
 * designer's own spec was bottom-left anchored ("starting at the bottom
 * left (0, 0)... all screens to the right repeat the same rules in
 * place") - i.e. x never changes which background shows, only the row
 * does - so this is deliberately a function of row (and theme) alone,
 * never column.
 *
 * `row` is 0-indexed top-to-bottom, same numbering as
 * getQuadrantIndex/getQuadrantCenter in camera.ts (row 0 is the TOP
 * row). That's the opposite of how the backgrounds were specified
 * (bottom-up: row 0 = bottom), so it's converted via rowFromBottom
 * here rather than changing the row convention everywhere else in this
 * file.
 *
 * - Bottom row (rowFromBottom 0) - the one row every tier, even
 *   anonymous's single screen, can always reach - gets the chosen
 *   theme's ground-level background (see getThemeSwatchFrame). This is
 *   the ONLY row that varies by theme at all.
 * - The row above it (rowFromBottom 1, still within the free tier's
 *   2-row reach) always gets a plain clouds background, regardless of
 *   theme.
 * - Every row above that (rowFromBottom 2+, reachable only on the paid
 *   tier's full WORLD_ROWS height today) is always a solid sky color,
 *   regardless of theme - by then a level is high enough that even
 *   clouds no longer make sense.
 */
export function getBackgroundFrameForRow(row: number, theme: BackgroundTheme): string {
	const rowFromBottom = WORLD_ROWS - 1 - row;
	if (rowFromBottom <= 0) {
		return getThemeSwatchFrame(theme);
	}
	if (rowFromBottom === 1) {
		return 'background_clouds';
	}
	return 'background_solid_sky';
}

/**
 * Fills the entire WORLD_WIDTH x WORLD_HEIGHT play/edit area with the
 * level's chosen theme's background art (see ensureBackgroundTheme) -
 * one TileSprite per ROW, spanning the full WORLD_WIDTH, rather than one
 * Image per screen. A single TileSprite is one continuous draw with no
 * internal seam at all, which is what actually matters here: with one
 * Image per screen, each screen's on-screen position is
 * `worldX - camera.scrollX`, recomputed every frame as a fractional
 * value under a continuously-scrolling camera (PlatformerScene's
 * follow-lerp, LevelEditorScene's pan/edge-scroll) - two adjacent
 * Images' touching edges can each round to a different final pixel on a
 * given frame, producing an intermittent 1px flicker along the seam.
 * Texture-filter and roundPixels settings only reduce how often that
 * mismatch is visible, they don't remove the two separate quads causing
 * it. A TileSprite has no second quad to disagree with at the seam, so
 * the flicker is gone structurally, not just reduced.
 *
 * tileScale is uniform (same factor on x and y) specifically so the
 * source frame is scaled, not stretched - a non-uniform scale would
 * distort the art's aspect ratio. VIEWPORT_HEIGHT / 256 is the smallest
 * uniform scale that still makes each row exactly VIEWPORT_HEIGHT tall
 * (TileSprite's own height is set directly, independent of scale, but
 * the *tiles* are drawn at native-256px-times-tileScale size) - any
 * smaller and the repeats would look like tiny 256px squares again
 * (the earlier, rejected look); this keeps each repeat reading as one
 * of a few large background chunks instead. Kenney's background frames
 * are specifically authored as seamlessly-tiling 256x256 textures, so
 * the repeats themselves don't show a seam either.
 *
 * Called once from each scene's create() (see PlatformerScene.ts and
 * LevelEditorScene.ts), after that scene's own preload() has already
 * queued the atlas via ensureBackgroundsAtlas - this function only
 * reads the already-loaded texture, it never queues a load itself
 * (Phaser's loader only runs during preload()). LevelEditorScene also
 * calls this again any time the theme picker changes the theme, after
 * destroying the previous call's sprites itself - see its
 * selectBackgroundTheme - since a mid-session theme change needs the
 * whole grid redrawn, not just newly created ones.
 */
export function createScreenBackgrounds(scene: Phaser.Scene): Phaser.GameObjects.TileSprite[] {
	// Phaser's default texture filter is LINEAR (bilinear) sampling,
	// which blends in a texture's neighboring texels right at its edge -
	// including the atlas's own padding/the next frame over. That
	// sub-pixel blend can show as a faint seam between tile repeats.
	// Forcing NEAREST (no blending, exact texel lookup) is the standard
	// fix for this class of edge-bleed artifact - harmless to set
	// repeatedly (including on every theme switch), and scoped to just
	// this one atlas rather than every texture in the game (e.g.
	// gameConfig.ts's render settings).
	//
	// `1` is Phaser.Textures.FilterMode.NEAREST's own underlying value
	// (LINEAR is 0) - referenced as a literal, cast to the enum's TYPE
	// only, rather than importing the real 'phaser' module as a value
	// the way PlatformerScene.ts/LevelEditorScene.ts do. This file keeps
	// Phaser as a type-only import (see the import at the top) so it
	// stays loadable under Vitest/Node, which this scene-only value
	// import would break - real Phaser reaches for browser globals
	// (window, ...) the moment it's imported as a value, not just when
	// it's actually run (confirmed: backgrounds.spec.ts fails at import
	// time with "window is not defined" if this file imports the real
	// module instead).
	scene.textures.get(BACKGROUNDS_ATLAS_KEY).setFilter(1 as Phaser.Textures.FilterMode);

	const theme = ensureBackgroundTheme(scene);
	const tileScale = VIEWPORT_HEIGHT / 256;
	const sprites: Phaser.GameObjects.TileSprite[] = [];

	for (let row = 0; row < WORLD_ROWS; row++) {
		const frame = getBackgroundFrameForRow(row, theme);
		const sprite = scene.add.tileSprite(
			0,
			row * VIEWPORT_HEIGHT,
			WORLD_WIDTH,
			VIEWPORT_HEIGHT,
			BACKGROUNDS_ATLAS_KEY,
			frame
		);
		sprite.setOrigin(0, 0);
		sprite.setTileScale(tileScale, tileScale);
		sprite.setDepth(BACKGROUND_DEPTH);
		sprites.push(sprite);
	}

	return sprites;
}