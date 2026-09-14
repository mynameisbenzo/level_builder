import { describe, expect, it } from 'vitest';
import { parseStoredMuted, parseStoredVolume } from './sounds';

describe('parseStoredVolume', () => {
	it('defaults to 0.5 when nothing is stored', () => {
		expect(parseStoredVolume(null)).toBe(0.5);
	});

	it('returns a valid stored value as-is', () => {
		expect(parseStoredVolume('0.8')).toBe(0.8);
	});

	it('clamps a value above 1 down to 1', () => {
		expect(parseStoredVolume('1.5')).toBe(1);
	});

	it('clamps a negative value up to 0', () => {
		expect(parseStoredVolume('-0.3')).toBe(0);
	});

	it('defaults to 0.5 for non-numeric garbage', () => {
		expect(parseStoredVolume('not-a-number')).toBe(0.5);
	});

	it('accepts the exact boundary values', () => {
		expect(parseStoredVolume('0')).toBe(0);
		expect(parseStoredVolume('1')).toBe(1);
	});
});

describe('parseStoredMuted', () => {
	it('defaults to unmuted when nothing is stored', () => {
		expect(parseStoredMuted(null)).toBe(false);
	});

	it('is true only for the exact string "true"', () => {
		expect(parseStoredMuted('true')).toBe(true);
	});

	it('defaults to unmuted for anything else, including "false" or garbage', () => {
		expect(parseStoredMuted('false')).toBe(false);
		expect(parseStoredMuted('yes')).toBe(false);
		expect(parseStoredMuted('1')).toBe(false);
	});
});