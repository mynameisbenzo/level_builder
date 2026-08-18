import { describe, expect, it } from 'vitest';
import { resolveInitialPlayerPosition } from './playerState';

describe('resolveInitialPlayerPosition', () => {
	it('uses the stored position when one exists', () => {
		const stored = { x: 123, y: 456 };
		const fallback = { x: 0, y: 0 };

		expect(resolveInitialPlayerPosition(stored, fallback)).toEqual(stored);
	});

	it('falls back to the default when nothing is stored (null)', () => {
		const fallback = { x: 400, y: 450 };

		expect(resolveInitialPlayerPosition(null, fallback)).toEqual(fallback);
	});

	it('falls back to the default when nothing is stored (undefined)', () => {
		const fallback = { x: 400, y: 450 };

		expect(resolveInitialPlayerPosition(undefined, fallback)).toEqual(fallback);
	});
});