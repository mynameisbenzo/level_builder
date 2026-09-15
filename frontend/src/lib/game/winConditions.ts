import { isWithinRange } from './geometry';
import type { KeyColor } from './keys';

/**
 * A newly-placed key-required door defaults to needing this color - the
 * level designer can change it via the click-to-configure picker in the
 * Editor, but a locked door is never left without some real requirement
 * from the moment it's placed.
 */
export const DEFAULT_REQUIRED_KEY_COLOR: KeyColor = 'yellow';

/**
 * Two independent door types exist, distinguished by requiresKey - not
 * two halves of one door. A plain door (requiresKey: false) has no
 * prerequisite and opens on pressing Up while nearby (requiredKeyColor
 * is always null for these - not applicable). A key-required door uses
 * different art (door_closed/door_open instead of
 * door_closed_top/door_open_top) and needs a matching-color key to open;
 * requiredKeyColor defaults to DEFAULT_REQUIRED_KEY_COLOR the moment
 * it's placed, and the level designer can change it via the
 * click-to-configure picker in the Editor. null is still handled
 * defensively (treated as unopenable, see canOpenDoor) but shouldn't
 * occur in practice for a key-required door.
 */
export interface DoorObject {
	x: number;
	y: number;
	requiresKey: boolean;
	requiredKeyColor: KeyColor | null;
}

export type WinConditionType = 'doorNoKey' | 'doorKeyRequired';

export const DOOR_OBJECTS_REGISTRY_KEY = 'doorObjects';

export const DOOR_NO_KEY_CLOSED_FRAME = 'door_closed_top';
export const DOOR_NO_KEY_OPEN_FRAME = 'door_open_top';
export const DOOR_KEY_REQUIRED_CLOSED_FRAME = 'door_closed';
export const DOOR_KEY_REQUIRED_OPEN_FRAME = 'door_open';

/**
 * Which closed-state frame a door should show, based on its type.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getDoorClosedFrame(requiresKey: boolean): string {
	return requiresKey ? DOOR_KEY_REQUIRED_CLOSED_FRAME : DOOR_NO_KEY_CLOSED_FRAME;
}

/**
 * Which open-state frame a door should show, based on its type.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getDoorOpenFrame(requiresKey: boolean): string {
	return requiresKey ? DOOR_KEY_REQUIRED_OPEN_FRAME : DOOR_NO_KEY_OPEN_FRAME;
}

/**
 * Whether a new door can be placed at the given position - just needs
 * that one cell free of every other kind of placed content (ground
 * tiles, swap objects, other doors). Takes the already-occupied
 * positions as a flat set of "x,y" keys so callers can combine whichever
 * content types they track without this needing to know about each one
 * specifically.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function canPlaceDoorAt(
	x: number,
	y: number,
	occupiedPositionKeys: ReadonlySet<string>
): boolean {
	return !occupiedPositionKeys.has(`${x},${y}`);
}

/**
 * Removes the door at the exact given position, if one exists. Returns a
 * new array either way (unchanged if nothing matched).
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function removeDoorAt(doors: DoorObject[], x: number, y: number): DoorObject[] {
	return doors.filter((door) => !(door.x === x && door.y === y));
}

/**
 * Whether the player is close enough to a door to interact with it. Same
 * distance-check approach as character-swap objects (see isWithinRange
 * in geometry.ts) and for the same reason: no physics body backing
 * these, so no Arcade overlap pair to check instead.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function isNearDoor(
	playerX: number,
	playerY: number,
	door: DoorObject,
	thresholdDistance: number
): boolean {
	return isWithinRange(playerX, playerY, door.x, door.y, thresholdDistance);
}

/**
 * Sets the required key color on the door at the exact given position,
 * leaving every other door untouched. Returns a new array either way
 * (unchanged if nothing matched). Same update-in-place-via-new-array
 * pattern as updateObjectStyle in placedObjects.ts.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function setDoorRequiredKeyColor(
	doors: DoorObject[],
	x: number,
	y: number,
	color: KeyColor
): DoorObject[] {
	return doors.map((door) =>
		door.x === x && door.y === y ? { ...door, requiredKeyColor: color } : door
	);
}

/**
 * Whether a door can currently be opened. A plain door always can. A
 * key-required door can only be opened if it's been configured with a
 * specific color (requiredKeyColor isn't null - see the DoorObject
 * comment) AND the player currently holds a key of that color.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function canOpenDoor(door: DoorObject, collectedKeyColors: ReadonlySet<KeyColor>): boolean {
	if (!door.requiresKey) {
		return true;
	}
	if (door.requiredKeyColor === null) {
		return false;
	}
	return collectedKeyColors.has(door.requiredKeyColor);
}