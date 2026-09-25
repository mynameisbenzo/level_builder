const LOGIN_STATE_STORAGE_KEY = 'pixelmaker_twitch_oauth_state';
const LINK_STATE_STORAGE_KEY = 'pixelmaker_twitch_link_oauth_state';

const LOGIN_CALLBACK_PATH = '/auth/twitch/callback';
const LINK_CALLBACK_PATH = '/profile/link-twitch/callback';

function buildRedirectUri(path: string): string {
	return `${window.location.origin}${path}`;
}

/**
 * Shared by both the login/signup flow and the link-to-existing-account
 * flow - they differ only in which page Twitch redirects back to and
 * which sessionStorage key holds the CSRF state, so this takes both as
 * parameters rather than duplicating the whole redirect/state dance
 * twice.
 */
function startTwitchAuthorize(path: string, stateStorageKey: string): void {
	const clientId = import.meta.env.VITE_TWITCH_CLIENT_ID;
	if (!clientId) {
		throw new Error('VITE_TWITCH_CLIENT_ID is not set');
	}

	const state = crypto.randomUUID();
	sessionStorage.setItem(stateStorageKey, state);

	const params = new URLSearchParams({
		response_type: 'code',
		client_id: clientId,
		redirect_uri: buildRedirectUri(path),
		scope: '',
		state
	});

	window.location.href = `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
}

function checkTwitchState(stateStorageKey: string, returnedState: string | null): boolean {
	const storedState = sessionStorage.getItem(stateStorageKey);
	sessionStorage.removeItem(stateStorageKey);
	return storedState !== null && returnedState !== null && storedState === returnedState;
}

// --- login/signup flow ---

/**
 * Sends the browser to Twitch's own consent screen for the login/signup
 * flow - lands on /auth/twitch/callback, which either logs an existing
 * account in or starts a new-account username picker. No email scope
 * is requested - Twitch's own OAuth already confirms the account is
 * real, matching how Twitch-only signup already works on the backend.
 */
export function redirectToTwitchAuthorize(): void {
	startTwitchAuthorize(LOGIN_CALLBACK_PATH, LOGIN_STATE_STORAGE_KEY);
}

/** Called once, from /auth/twitch/callback, with Twitch's returned state. */
export function verifyTwitchState(returnedState: string | null): boolean {
	return checkTwitchState(LOGIN_STATE_STORAGE_KEY, returnedState);
}

export function getTwitchRedirectUri(): string {
	return buildRedirectUri(LOGIN_CALLBACK_PATH);
}

// --- link-to-existing-account flow ---

/**
 * Sends the browser to Twitch's own consent screen for linking a
 * Twitch identity onto the currently logged-in account - lands on
 * /profile/link-twitch/callback instead, a separate route (and a
 * separate registered Twitch redirect URL) from the login/signup one,
 * since the two need genuinely different backend endpoints and
 * post-conditions, not just different UI on the same page.
 */
export function redirectToTwitchLink(): void {
	startTwitchAuthorize(LINK_CALLBACK_PATH, LINK_STATE_STORAGE_KEY);
}

/** Called once, from /profile/link-twitch/callback, with Twitch's returned state. */
export function verifyTwitchLinkState(returnedState: string | null): boolean {
	return checkTwitchState(LINK_STATE_STORAGE_KEY, returnedState);
}

export function getTwitchLinkRedirectUri(): string {
	return buildRedirectUri(LINK_CALLBACK_PATH);
}