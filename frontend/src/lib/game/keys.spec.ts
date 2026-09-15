import { describe, expect, it } from 'vitest';
import { canPlaceKeyAt, getKeyFrame, isNearKey, removeKeyAt, type KeyObject } from './keys';

describe('getKeyFrame', () => {
	it('maps each color to its world frame', () => {
		expect(getKeyFrame('blue')).toBe('key_blue');
		expect(getKeyFrame('green')).toBe('key_green');
		expect(getKeyFrame('red')).toBe('key_red');
		expect(getKeyFrame('yellow')).toBe('key_yellow');
	});
});

describe('canPlaceKeyAt', () => {
	it('allows placement when the cell is free', () => {
		expect(canPlaceKeyAt(32, 96, new Set())).toBe(true);
	});

	it('blocks placement when the cell is occupied', () => {
		expect(canPlaceKeyAt(32, 96, new Set(['32,96']))).toBe(false);
	});

	it('is unaffected by occupied cells elsewhere', () => {
		expect(canPlaceKeyAt(32, 96, new Set(['999,999']))).toBe(true);
	});
});

describe('removeKeyAt', () => {
	it('removes the key at the exact position', () => {
		const existing: KeyObject[] = [{ x: 32, y: 32, color: 'blue' }];
		expect(removeKeyAt(existing, 32, 32)).toEqual([]);
	});

	it('only removes the exact match, keeping the rest', () => {
		const existing: KeyObject[] = [
			{ x: 0, y: 0, color: 'green' },
			{ x: 96, y: 96, color: 'red' }
		];
		expect(removeKeyAt(existing, 0, 0)).toEqual([{ x: 96, y: 96, color: 'red' }]);
	});

	it('returns an equivalent array unchanged when nothing matches', () => {
		const existing: KeyObject[] = [{ x: 32, y: 32, color: 'yellow' }];
		expect(removeKeyAt(existing, 64, 64)).toEqual(existing);
	});
});

describe('isNearKey', () => {
	const key: KeyObject = { x: 100, y: 100, color: 'blue' };

	it('is true when within the threshold distance', () => {
		expect(isNearKey(105, 100, key, 24)).toBe(true);
	});

	it('is false when beyond the threshold distance', () => {
		expect(isNearKey(500, 500, key, 24)).toBe(false);
	});
});