import { describe, expect, it } from 'vitest';
import {
	canOpenDoor,
	canPlaceDoorAt,
	DOOR_KEY_REQUIRED_CLOSED_FRAME,
	DOOR_KEY_REQUIRED_OPEN_FRAME,
	DOOR_NO_KEY_CLOSED_FRAME,
	DOOR_NO_KEY_OPEN_FRAME,
	getDoorClosedFrame,
	getDoorOpenFrame,
	isNearDoor,
	removeDoorAt,
	setDoorRequiredKeyColor,
	type DoorObject
} from './winConditions';

const plainDoor: DoorObject = { x: 0, y: 0, requiresKey: false, requiredKeyColor: null };
const unconfiguredLockedDoor: DoorObject = {
	x: 0,
	y: 0,
	requiresKey: true,
	requiredKeyColor: null
};
const blueLockedDoor: DoorObject = {
	x: 0,
	y: 0,
	requiresKey: true,
	requiredKeyColor: 'blue'
};

describe('getDoorClosedFrame', () => {
	it('returns the no-key frame when requiresKey is false', () => {
		expect(getDoorClosedFrame(false)).toBe(DOOR_NO_KEY_CLOSED_FRAME);
	});

	it('returns the key-required frame when requiresKey is true', () => {
		expect(getDoorClosedFrame(true)).toBe(DOOR_KEY_REQUIRED_CLOSED_FRAME);
	});
});

describe('getDoorOpenFrame', () => {
	it('returns the no-key frame when requiresKey is false', () => {
		expect(getDoorOpenFrame(false)).toBe(DOOR_NO_KEY_OPEN_FRAME);
	});

	it('returns the key-required frame when requiresKey is true', () => {
		expect(getDoorOpenFrame(true)).toBe(DOOR_KEY_REQUIRED_OPEN_FRAME);
	});
});

describe('canPlaceDoorAt', () => {
	it('allows placement when the cell is free', () => {
		expect(canPlaceDoorAt(32, 96, new Set())).toBe(true);
	});

	it('blocks placement when the cell is occupied', () => {
		expect(canPlaceDoorAt(32, 96, new Set(['32,96']))).toBe(false);
	});

	it('is unaffected by occupied cells elsewhere', () => {
		expect(canPlaceDoorAt(32, 96, new Set(['999,999']))).toBe(true);
	});
});

describe('removeDoorAt', () => {
	it('removes the door at the exact position', () => {
		const existing: DoorObject[] = [{ ...plainDoor, x: 32, y: 32 }];
		expect(removeDoorAt(existing, 32, 32)).toEqual([]);
	});

	it('only removes the exact match, keeping the rest', () => {
		const existing: DoorObject[] = [
			{ ...plainDoor, x: 0, y: 0 },
			{ ...blueLockedDoor, x: 96, y: 96 }
		];
		expect(removeDoorAt(existing, 0, 0)).toEqual([{ ...blueLockedDoor, x: 96, y: 96 }]);
	});

	it('returns an equivalent array unchanged when nothing matches', () => {
		const existing: DoorObject[] = [{ ...plainDoor, x: 32, y: 32 }];
		expect(removeDoorAt(existing, 64, 64)).toEqual(existing);
	});
});

describe('setDoorRequiredKeyColor', () => {
	it('sets the color on the matching door', () => {
		const existing: DoorObject[] = [{ ...unconfiguredLockedDoor, x: 32, y: 32 }];
		const updated = setDoorRequiredKeyColor(existing, 32, 32, 'green');
		expect(updated[0].requiredKeyColor).toBe('green');
	});

	it('leaves other doors untouched', () => {
		const existing: DoorObject[] = [
			{ ...unconfiguredLockedDoor, x: 0, y: 0 },
			{ ...unconfiguredLockedDoor, x: 96, y: 96 }
		];
		const updated = setDoorRequiredKeyColor(existing, 0, 0, 'red');
		expect(updated[0].requiredKeyColor).toBe('red');
		expect(updated[1].requiredKeyColor).toBeNull();
	});

	it('can overwrite an already-configured color', () => {
		const existing: DoorObject[] = [{ ...blueLockedDoor, x: 32, y: 32 }];
		const updated = setDoorRequiredKeyColor(existing, 32, 32, 'yellow');
		expect(updated[0].requiredKeyColor).toBe('yellow');
	});
});

describe('isNearDoor', () => {
	const door: DoorObject = { ...plainDoor, x: 100, y: 100 };

	it('is true when within the threshold distance', () => {
		expect(isNearDoor(105, 100, door, 24)).toBe(true);
	});

	it('is false when beyond the threshold distance', () => {
		expect(isNearDoor(500, 500, door, 24)).toBe(false);
	});
});

describe('canOpenDoor', () => {
	it('is true for a plain door regardless of collected keys', () => {
		expect(canOpenDoor(plainDoor, new Set())).toBe(true);
	});

	it('is false for an unconfigured key-required door, even holding keys', () => {
		expect(canOpenDoor(unconfiguredLockedDoor, new Set(['blue', 'green', 'red', 'yellow']))).toBe(
			false
		);
	});

	it('is false for a configured key-required door when the matching key is not held', () => {
		expect(canOpenDoor(blueLockedDoor, new Set())).toBe(false);
		expect(canOpenDoor(blueLockedDoor, new Set(['green']))).toBe(false);
	});

	it('is true for a configured key-required door when the matching key is held', () => {
		expect(canOpenDoor(blueLockedDoor, new Set(['blue']))).toBe(true);
	});

	it('is unaffected by holding the wrong keys alongside the right one', () => {
		expect(canOpenDoor(blueLockedDoor, new Set(['green', 'blue', 'red']))).toBe(true);
	});
});