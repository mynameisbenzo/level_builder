import type { LevelContent } from './game/levelContent';

const PENDING_CONTENT_STORAGE_KEY = 'pixelmaker_pending_level_content';

/**
 * Persists level content built anonymously in the /play sandbox, the
 * instant someone clicks Save while logged out - before anything else
 * happens (opening a signup window, etc.) - so the work survives even
 * if this tab gets fully discarded by the browser while they're away
 * completing signup. This is a real, observed failure mode, not a
 * hypothetical one: a backgrounded tab isn't guaranteed to keep its
 * live, in-memory game state the way localStorage keeps this.
 */
export function storePendingLevelContent(content: LevelContent): void {
	try {
		localStorage.setItem(PENDING_CONTENT_STORAGE_KEY, JSON.stringify(content));
	} catch {
		// Storage unavailable - the in-memory game state is still there
		// for as long as this exact tab survives, it just won't recover
		// if the tab gets discarded while away.
	}
}

export function getPendingLevelContent(): LevelContent | null {
	try {
		const raw = localStorage.getItem(PENDING_CONTENT_STORAGE_KEY);
		if (!raw) return null;
		return JSON.parse(raw) as LevelContent;
	} catch {
		return null;
	}
}

export function clearPendingLevelContent(): void {
	try {
		localStorage.removeItem(PENDING_CONTENT_STORAGE_KEY);
	} catch {
		// Nothing meaningful to do if this fails.
	}
}