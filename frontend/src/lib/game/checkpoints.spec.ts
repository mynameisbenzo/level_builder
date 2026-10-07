import { describe, expect, it } from 'vitest';
import {
	CHECKPOINT_BEFORE_RUN_REGISTRY_KEY,
	CHECKPOINT_RESPAWN_LIFT_PX,
	CHECKPOINT_STATE_REGISTRY_KEY,
	CHECKPOINT_TOUCH_DISTANCE,
	canPlaceCheckpointAt,
	clearCheckpointProgress,
	getCheckpointRespawn,
	isCheckpointState,
	isNearCheckpoint,
	placeCheckpoint,
	readCheckpointCarry,
	readCheckpointState,
	removeCheckpointAt,
	writeCheckpointCarry,
	type CheckpointState,
	type RegistryLike
} from './checkpoints';

function fakeRegistry(): RegistryLike & { values: Map<string, unknown> } {
	const values = new Map<string, unknown>();
	return {
		values,
		get: (key) => values.get(key),
		set: (key, value) => values.set(key, value),
		remove: (key) => values.delete(key)
	};
}

const state: CheckpointState = {
	playerColor: 'pink',
	collectedKeys: [{ x: 48, y: 80 }],
	swapObjectColors: ['green', 'beige']
};

describe('placement', () => {
	it('can be placed on a free cell and not an occupied one', () => {
		expect(canPlaceCheckpointAt(16, 16, new Set())).toBe(true);
		expect(canPlaceCheckpointAt(16, 16, new Set(['16,16']))).toBe(false);
	});

	it('placing always leaves exactly one checkpoint (it moves)', () => {
		expect(placeCheckpoint(48, 80)).toEqual([{ x: 48, y: 80 }]);
	});

	it('erases only the checkpoint at the given position', () => {
		const list = [{ x: 48, y: 80 }];
		expect(removeCheckpointAt(list, 48, 80)).toEqual([]);
		expect(removeCheckpointAt(list, 16, 16)).toEqual(list);
	});
});

describe('isNearCheckpoint', () => {
	const checkpoint = { x: 100, y: 100 };

	it('is true within the touch distance, inclusive', () => {
		expect(isNearCheckpoint(100, 100, checkpoint)).toBe(true);
		expect(isNearCheckpoint(100 + CHECKPOINT_TOUCH_DISTANCE, 100, checkpoint)).toBe(true);
	});

	it('is false beyond it', () => {
		expect(isNearCheckpoint(100 + CHECKPOINT_TOUCH_DISTANCE + 1, 100, checkpoint)).toBe(false);
	});
});

describe('isCheckpointState', () => {
	it('accepts a real state', () => {
		expect(isCheckpointState(state)).toBe(true);
	});

	it.each([
		['null', null],
		['a string', 'x'],
		['a bad color', { ...state, playerColor: 'teal' }],
		['bad keys', { ...state, collectedKeys: [{ x: 'a', y: 1 }] }],
		['keys not a list', { ...state, collectedKeys: null }],
		['a bad swap color', { ...state, swapObjectColors: ['teal'] }]
	])('rejects %s', (_label, value) => {
		expect(isCheckpointState(value)).toBe(false);
	});
});

describe('getCheckpointRespawn', () => {
	it('is just above the checkpoint when it was reached', () => {
		expect(getCheckpointRespawn([{ x: 48, y: 80 }], state)).toEqual({
			x: 48,
			y: 80 - CHECKPOINT_RESPAWN_LIFT_PX
		});
	});

	it('is null when it was never reached', () => {
		expect(getCheckpointRespawn([{ x: 48, y: 80 }], null)).toBeNull();
	});

	it('is null when the level has no checkpoint, even with stale state', () => {
		expect(getCheckpointRespawn([], state)).toBeNull();
	});
});

describe('registry helpers', () => {
	it('reads nothing from an empty registry', () => {
		const registry = fakeRegistry();
		expect(readCheckpointState(registry)).toBeNull();
		expect(readCheckpointCarry(registry)).toBeNull();
	});

	it('ignores a malformed value in the registry', () => {
		const registry = fakeRegistry();
		registry.set(CHECKPOINT_STATE_REGISTRY_KEY, { playerColor: 'teal' });
		expect(readCheckpointState(registry)).toBeNull();
	});

	it('round-trips a carry with its before run', () => {
		const registry = fakeRegistry();
		const beforeRun = { durationMs: 1000, frames: [[1, 2, 0]] as [number, number, number][] };

		writeCheckpointCarry(registry, { state, beforeRun });

		expect(readCheckpointCarry(registry)).toEqual({ state, beforeRun });
	});

	it('round-trips a carry with no before run, clearing a stale one', () => {
		const registry = fakeRegistry();
		registry.set(CHECKPOINT_BEFORE_RUN_REGISTRY_KEY, { durationMs: 1, frames: [] });

		writeCheckpointCarry(registry, { state, beforeRun: null });

		expect(readCheckpointCarry(registry)).toEqual({ state, beforeRun: null });
	});

	it('clearing progress forgets both the state and the before run', () => {
		const registry = fakeRegistry();
		writeCheckpointCarry(registry, {
			state,
			beforeRun: { durationMs: 1000, frames: [[1, 2, 0]] }
		});

		clearCheckpointProgress(registry);

		expect(readCheckpointCarry(registry)).toBeNull();
		expect(registry.values.size).toBe(0);
	});
});