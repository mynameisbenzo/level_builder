import type Phaser from 'phaser';
import {
	BACKGROUND_THEME_REGISTRY_KEY,
	DEFAULT_BACKGROUND_THEME,
	type BackgroundTheme
} from './backgrounds';
import { CAMERA_MODE_REGISTRY_KEY, DEFAULT_CAMERA_MODE, type CameraMode } from './camera';
import {
	CHARACTER_SWAP_OBJECTS_REGISTRY_KEY,
	type CharacterSwapObject
} from './characterSwapObjects';
import { KEY_OBJECTS_REGISTRY_KEY, type KeyObject } from './keys';
import { PLACED_OBJECTS_REGISTRY_KEY, type PlacedObject } from './placedObjects';
import {
	DEFAULT_PLAYER_COLOR,
	PLAYER_STARTING_COLOR_REGISTRY_KEY,
	type PlayerColor
} from './playerColor';
import {
	DEFAULT_PLAYER_POSITION,
	EDITOR_PLAYER_POSITION_KEY,
	resolveInitialPlayerPosition,
	type PlayerPosition
} from './playerState';
import { DOOR_OBJECTS_REGISTRY_KEY, type DoorObject } from './winConditions';

/**
 * The exact shape the backend's app/services/level_content.py validates
 * and stores as a Level's draft_content / a LevelVersion's content -
 * mirrors that module field-for-field, same reasoning as its own
 * comment about there being no shared source of truth across the
 * Python/TypeScript boundary in this project.
 */
export interface LevelContent {
	spawnPosition: PlayerPosition;
	cameraMode: CameraMode;
	playerStartingColor: PlayerColor;
	backgroundTheme: BackgroundTheme;
	placedObjects: PlacedObject[];
	characterSwapObjects: CharacterSwapObject[];
	doorObjects: DoorObject[];
	keyObjects: KeyObject[];
}

/**
 * Reads every piece of a level's content straight out of the given
 * registry and assembles it into the exact shape Save actually sends.
 * Takes a Phaser.Data.DataManager directly (what both `scene.registry`
 * and `game.registry` are - the same underlying, game-wide object, not
 * two different things) rather than a full Phaser.Scene, since a
 * registry's plain get/set interface is genuinely all this needs.
 */
export function serializeLevelContent(registry: Phaser.Data.DataManager): LevelContent {
	return {
		spawnPosition: resolveInitialPlayerPosition(
			registry.get(EDITOR_PLAYER_POSITION_KEY) as PlayerPosition | undefined,
			DEFAULT_PLAYER_POSITION
		),
		cameraMode:
			(registry.get(CAMERA_MODE_REGISTRY_KEY) as CameraMode | undefined) ?? DEFAULT_CAMERA_MODE,
		playerStartingColor:
			(registry.get(PLAYER_STARTING_COLOR_REGISTRY_KEY) as PlayerColor | undefined) ??
			DEFAULT_PLAYER_COLOR,
		backgroundTheme:
			(registry.get(BACKGROUND_THEME_REGISTRY_KEY) as BackgroundTheme | undefined) ??
			DEFAULT_BACKGROUND_THEME,
		placedObjects: (registry.get(PLACED_OBJECTS_REGISTRY_KEY) as PlacedObject[] | undefined) ?? [],
		characterSwapObjects:
			(registry.get(CHARACTER_SWAP_OBJECTS_REGISTRY_KEY) as CharacterSwapObject[] | undefined) ??
			[],
		doorObjects: (registry.get(DOOR_OBJECTS_REGISTRY_KEY) as DoorObject[] | undefined) ?? [],
		keyObjects: (registry.get(KEY_OBJECTS_REGISTRY_KEY) as KeyObject[] | undefined) ?? []
	};
}

/**
 * The inverse of serializeLevelContent - writes a fetched level's
 * content into the given registry, so whatever scene boots next (via
 * the same, unmodified registry reads every scene already uses) picks
 * it up as if it had always been there. Called from createGameConfig's
 * postBoot callback specifically, before any scene's own create() runs
 * - see that file for why the timing matters and how postBoot
 * guarantees it.
 */
export function deserializeLevelContent(
	registry: Phaser.Data.DataManager,
	content: LevelContent
): void {
	registry.set(EDITOR_PLAYER_POSITION_KEY, content.spawnPosition);
	registry.set(CAMERA_MODE_REGISTRY_KEY, content.cameraMode);
	registry.set(PLAYER_STARTING_COLOR_REGISTRY_KEY, content.playerStartingColor);
	// Defensively defaulted, not trusted as always-present like the
	// fields above - unlike them, backgroundTheme was added after real
	// levels already existed, so content fetched for one saved before
	// this field shipped genuinely has no backgroundTheme key at
	// runtime, however the LevelContent type above claims it does (see
	// the backend's own validate_level_content, which treats a missing
	// backgroundTheme the same way for the same reason).
	registry.set(BACKGROUND_THEME_REGISTRY_KEY, content.backgroundTheme ?? DEFAULT_BACKGROUND_THEME);
	registry.set(PLACED_OBJECTS_REGISTRY_KEY, content.placedObjects);
	registry.set(CHARACTER_SWAP_OBJECTS_REGISTRY_KEY, content.characterSwapObjects);
	registry.set(DOOR_OBJECTS_REGISTRY_KEY, content.doorObjects);
	registry.set(KEY_OBJECTS_REGISTRY_KEY, content.keyObjects);
}