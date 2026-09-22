import type { CreatedUser } from './api';

const STORAGE_KEY = 'pixelmaker_auth';

interface AuthState {
	accessToken: string | null;
	user: CreatedUser | null;
}

// Starts empty, not hydrated from localStorage here - this file is
// evaluated at module-import time, which would also run during any SSR
// pass (localStorage doesn't exist there). Actual hydration happens via
// the exported hydrate() function below, called explicitly from the
// root layout's onMount, which is guaranteed to only ever run
// client-side.
let state = $state<AuthState>({ accessToken: null, user: null });

function persist() {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// Storage unavailable (private browsing quota, etc.) - the
		// in-memory state still works for the rest of this session,
		// it just won't survive a reload.
	}
}

export const auth = {
	get accessToken() {
		return state.accessToken;
	},
	get user() {
		return state.user;
	},
	get isLoggedIn() {
		return state.accessToken !== null;
	},

	/** Client-only - call once, from the root layout's onMount. */
	hydrate() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw);
			state.accessToken = parsed.accessToken ?? null;
			state.user = parsed.user ?? null;
		} catch {
			// Corrupt or inaccessible storage - just start logged out
			// rather than throwing.
		}
	},

	login(accessToken: string, user: CreatedUser) {
		state.accessToken = accessToken;
		state.user = user;
		persist();
	},

	logout() {
		state.accessToken = null;
		state.user = null;
		try {
			localStorage.removeItem(STORAGE_KEY);
		} catch {
			// Nothing meaningful to do if this fails - in-memory state
			// is already cleared either way.
		}
	}
};