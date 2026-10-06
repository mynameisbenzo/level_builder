import { describe, expect, it } from 'vitest';
import { shouldSkipToProfile } from './appLaunch';

const base = { openedAtHome: true, alreadyChecked: false, isStandalone: true, isLoggedIn: true };

describe('shouldSkipToProfile', () => {
	it('skips to the profile on a fresh launch of the installed app while logged in', () => {
		expect(shouldSkipToProfile(base)).toBe(true);
	});

	it('does not skip on later visits to "/" (the navbar wordmark)', () => {
		expect(shouldSkipToProfile({ ...base, alreadyChecked: true })).toBe(false);
	});

	it('does not skip when the app was first opened somewhere other than "/"', () => {
		expect(shouldSkipToProfile({ ...base, openedAtHome: false })).toBe(false);
	});

	it('never skips in a normal browser tab', () => {
		expect(shouldSkipToProfile({ ...base, isStandalone: false })).toBe(false);
	});

	it('never skips for a logged-out user', () => {
		expect(shouldSkipToProfile({ ...base, isLoggedIn: false })).toBe(false);
	});
});