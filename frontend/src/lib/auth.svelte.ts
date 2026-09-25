import { browser } from '$app/environment';
import { refreshAccessToken, type CreatedUser } from './api';

const STORAGE_KEY = 'pixelmaker_auth';
// Refresh this long before the access token's real expiry - a buffer
// for network latency/clock skew, not cutting it right at the deadline.
const REFRESH_MARGIN_MS = 2 * 60 * 1000;

interface AuthState {
	accessToken: string | null;
	refreshToken: string | null;
	user: CreatedUser | null;
}

function loadInitialState(): AuthState {
	// `browser` is SvelteKit's own check for "actually running client-
	// side" (false during any SSR pass, where localStorage doesn't
	// exist). Reading this at module-load time - not from a component's
	// onMount - means state is already correct before any component
	// even starts rendering, which sidesteps entirely having to reason
	// about onMount ordering between a page and its parent layout.
	if (!browser) return { accessToken: null, refreshToken: null, user: null };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { accessToken: null, refreshToken: null, user: null };
		const parsed = JSON.parse(raw);
		return {
			accessToken: parsed.accessToken ?? null,
			refreshToken: parsed.refreshToken ?? null,
			user: parsed.user ?? null
		};
	} catch {
		// Corrupt or inaccessible storage - just start logged out.
		return { accessToken: null, refreshToken: null, user: null };
	}
}

let state = $state<AuthState>(loadInitialState());
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function persist() {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// Storage unavailable (private browsing quota, etc.) - the
		// in-memory state still works for the rest of this session,
		// it just won't survive a reload.
	}
}

/**
 * Reads an access token's own `exp` claim, client-side, with no
 * signature verification - safe here because this is only used to
 * schedule a proactive renewal, never to make an actual auth decision
 * (the backend independently re-checks the token on every real
 * request regardless of what this reads).
 */
function decodeJwtExpiryMs(token: string): number | null {
	try {
		const payloadSegment = token.split('.')[1];
		const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
		const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
		const payload = JSON.parse(atob(padded));
		return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
	} catch {
		return null;
	}
}

function clearScheduledRefresh() {
	if (refreshTimer !== null) {
		clearTimeout(refreshTimer);
		refreshTimer = null;
	}
}

/**
 * Schedules a silent renewal shortly before the given access token's
 * real expiry, read from the token itself rather than a hardcoded
 * duration - so this keeps working correctly even if the backend's
 * configured expiry ever changes.
 */
function scheduleRefresh(accessToken: string) {
	clearScheduledRefresh();
	if (!browser) return;

	const expiresAtMs = decodeJwtExpiryMs(accessToken);
	if (expiresAtMs === null) return;

	const delayMs = Math.max(expiresAtMs - REFRESH_MARGIN_MS - Date.now(), 0);
	refreshTimer = setTimeout(() => {
		performSilentRefresh();
	}, delayMs);
}

async function performSilentRefresh(): Promise<boolean> {
	if (!state.refreshToken) return false;

	const result = await refreshAccessToken(state.refreshToken);
	if (result.success && result.accessToken && result.refreshToken) {
		state.accessToken = result.accessToken;
		state.refreshToken = result.refreshToken;
		persist();
		scheduleRefresh(result.accessToken);
		return true;
	}

	// The refresh token itself is dead (expired, revoked, or the
	// account's no longer accessible) - this is a real end of the
	// session, not something worth retrying.
	auth.logout();
	return false;
}

// If the page loaded with an existing session already in localStorage,
// pick up the renewal schedule immediately, rather than leaving it
// unscheduled until something else happens to touch auth state.
if (browser && state.accessToken) {
	scheduleRefresh(state.accessToken);
}

export const auth = {
	get accessToken() {
		return state.accessToken;
	},
	get refreshToken() {
		return state.refreshToken;
	},
	get user() {
		return state.user;
	},
	get isLoggedIn() {
		return state.accessToken !== null;
	},

	login(accessToken: string, refreshToken: string, user: CreatedUser) {
		state.accessToken = accessToken;
		state.refreshToken = refreshToken;
		state.user = user;
		persist();
		scheduleRefresh(accessToken);
	},

	/** Updates just the stored user (after a successful profile edit) -
	 * keeps the Navbar greeting and anything else reading auth.user in
	 * sync immediately, without needing to log in again. */
	updateUser(user: CreatedUser) {
		state.user = user;
		persist();
	},

	/**
	 * Reactive fallback for when a request comes back with
	 * sessionExpired even though the proactive scheduled refresh above
	 * should already have caught it (e.g. a laptop asleep through the
	 * scheduled time). Callers should retry their original request once
	 * if this resolves true.
	 */
	async tryRefresh(): Promise<boolean> {
		return performSilentRefresh();
	},

	logout() {
		clearScheduledRefresh();
		state.accessToken = null;
		state.refreshToken = null;
		state.user = null;
		try {
			localStorage.removeItem(STORAGE_KEY);
		} catch {
			// Nothing meaningful to do if this fails - in-memory state
			// is already cleared either way.
		}
	}
};