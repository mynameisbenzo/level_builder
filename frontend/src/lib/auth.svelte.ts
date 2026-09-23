import { browser } from '$app/environment';
import type { CreatedUser } from './api';

const STORAGE_KEY = 'pixelmaker_auth';

interface AuthState {
	accessToken: string | null;
	user: CreatedUser | null;
}

function loadInitialState(): AuthState {
	// `browser` is SvelteKit's own check for "actually running client-
	// side" (false during any SSR pass, where localStorage doesn't
	// exist). Reading this at module-load time - not from a component's
	// onMount - means state is already correct before any component
	// even starts rendering, which sidesteps entirely having to reason
	// about onMount ordering between a page and its parent layout.
	if (!browser) return { accessToken: null, user: null };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { accessToken: null, user: null };
		const parsed = JSON.parse(raw);
		return { accessToken: parsed.accessToken ?? null, user: parsed.user ?? null };
	} catch {
		// Corrupt or inaccessible storage - just start logged out.
		return { accessToken: null, user: null };
	}
}

let state = $state<AuthState>(loadInitialState());

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

	login(accessToken: string, user: CreatedUser) {
		state.accessToken = accessToken;
		state.user = user;
		persist();
	},

	/** Updates just the stored user (after a successful profile edit) -
	 * keeps the Navbar greeting and anything else reading auth.user in
	 * sync immediately, without needing to log in again. */
	updateUser(user: CreatedUser) {
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