const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000';

export async function checkBackendHealth(): Promise<boolean> {
	try {
		const response = await fetch(`${API_BASE_URL}/health`);
		if (!response.ok) return false;

		const data = await response.json();
		return data.status === 'ok';
	} catch {
		return false;
	}
}

export interface CreatedUser {
	id: string;
	username: string;
	email?: string;
	email_verified_at?: string | null;
	twitch_id?: string;
	twitch_display_name?: string;
	role: string;
	hide_email: boolean;
	hide_twitch: boolean;
	created_at: string;
}

export interface CreateUserResult {
	success: boolean;
	user?: CreatedUser;
	error?: string;
}

/**
 * Calls the real POST /api/users endpoint - creates an account directly,
 * not the eventual magic-link/Twitch signup flow (Twitch OAuth isn't
 * wired up yet). Email verification IS real now - signing up with an
 * email address triggers an actual verification email via Resend.
 */
export async function createUser(payload: {
	username: string;
	email: string;
}): Promise<CreateUserResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/users`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});

		const data = await response.json();

		if (!response.ok) {
			return { success: false, error: data.error ?? 'Something went wrong. Please try again.' };
		}

		return { success: true, user: data };
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}

export interface RequestLoginLinkResult {
	success: boolean;
	message?: string;
	error?: string;
	devLoginToken?: string;
}

/**
 * Calls POST /api/auth/request-login-link. Accepts either a username or
 * an email as the identifier - the backend tries both. Deliberately
 * enumeration-safe on the backend (identical response whether or not
 * the identifier matches a real account), so this just relays whatever
 * message the backend sends rather than having its own separate copy -
 * a second, hand-written message here could drift out of sync with
 * that guarantee.
 */
export async function requestLoginLink(identifier: string): Promise<RequestLoginLinkResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/auth/request-login-link`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ identifier })
		});

		const data = await response.json();

		if (!response.ok) {
			return { success: false, error: data.error ?? 'Something went wrong. Please try again.' };
		}

		return { success: true, message: data.message, devLoginToken: data.dev_login_token };
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}

export interface LoginResult {
	success: boolean;
	accessToken?: string;
	refreshToken?: string;
	user?: CreatedUser;
	error?: string;
}

/** Calls POST /api/auth/login - consumes a login token and, on success, returns an access+refresh token pair. */
export async function loginWithToken(token: string): Promise<LoginResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token })
		});

		const data = await response.json();

		if (!response.ok) {
			return { success: false, error: data.error ?? 'Login failed. Please try again.' };
		}

		return {
			success: true,
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			user: data.user
		};
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}

export interface RefreshResult {
	success: boolean;
	accessToken?: string;
	refreshToken?: string;
	error?: string;
}

/**
 * Calls POST /api/auth/refresh - exchanges a still-valid refresh token
 * for a new access+refresh pair. The backend rotates on every use, so
 * the refresh token in a successful result must replace whatever was
 * stored before; the one that was sent won't work again.
 */
export async function refreshAccessToken(refreshToken: string): Promise<RefreshResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ refresh_token: refreshToken })
		});

		const data = await response.json().catch(() => ({}));

		if (!response.ok) {
			return { success: false, error: data.error ?? 'Session refresh failed.' };
		}

		return { success: true, accessToken: data.access_token, refreshToken: data.refresh_token };
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}

/**
 * Calls POST /api/auth/logout - revokes the refresh token server-side,
 * so a copy that leaked somewhere can't keep minting new sessions after
 * the person believes they've logged out. Best-effort: failures aren't
 * surfaced to the caller, since the client clears its own local state
 * regardless (see auth.logout()) - a failed call here just means the
 * server-side token lingers until it naturally expires instead of
 * being actively revoked, not something worth interrupting logout for.
 */
export async function logoutServer(refreshToken: string): Promise<void> {
	try {
		await fetch(`${API_BASE_URL}/api/auth/logout`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ refresh_token: refreshToken })
		});
	} catch {
		// See docstring above - deliberately swallowed.
	}
}

export interface VerifyEmailResult {
	success: boolean;
	error?: string;
}

/**
 * Calls POST /api/users/verify-email - consumes a verification token
 * (from the link a real verification email now actually contains) and
 * marks the owning account's email as verified.
 */
export async function verifyEmail(token: string): Promise<VerifyEmailResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/users/verify-email`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token })
		});

		if (!response.ok) {
			const data = await response.json().catch(() => ({}));
			return { success: false, error: data.error ?? 'Verification failed. Please try again.' };
		}

		return { success: true };
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}

export interface UpdateProfileResult {
	success: boolean;
	user?: CreatedUser;
	error?: string;
	/** True specifically when the JWT itself was missing/expired/invalid
	 * (a 401) - distinct from other failures (e.g. a 409 for a taken
	 * username), since only this case should trigger logging the user
	 * out and sending them back to /login. */
	sessionExpired?: boolean;
}

/** Calls PATCH /api/users/<public_id> - self-only, per the backend's ownership check. */
export async function updateProfile(
	userId: string,
	token: string,
	payload: { username?: string; hide_email?: boolean; hide_twitch?: boolean }
): Promise<UpdateProfileResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/users/${userId}`, {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`
			},
			body: JSON.stringify(payload)
		});

		const data = await response.json().catch(() => ({}));

		if (!response.ok) {
			return {
				success: false,
				sessionExpired: response.status === 401,
				error: data.error ?? 'Update failed. Please try again.'
			};
		}

		return { success: true, user: data };
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}

export interface DeleteAccountResult {
	success: boolean;
	error?: string;
	sessionExpired?: boolean;
}

/** Calls DELETE /api/users/<public_id> - self-only, soft-deletes the account. */
export async function deleteAccount(userId: string, token: string): Promise<DeleteAccountResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/users/${userId}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${token}` }
		});

		if (!response.ok) {
			const data = await response.json().catch(() => ({}));
			return {
				success: false,
				sessionExpired: response.status === 401,
				error: data.error ?? 'Delete failed. Please try again.'
			};
		}

		return { success: true };
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}

export interface TwitchCallbackResult {
	success: boolean;
	/** True when this is a brand-new Twitch identity - no account
	 * exists for it yet, so a username needs to be chosen via
	 * finishTwitchSignup() before an account is actually created. */
	needsUsername?: boolean;
	signupToken?: string;
	suggestedUsername?: string;
	accessToken?: string;
	refreshToken?: string;
	user?: CreatedUser;
	error?: string;
}

/**
 * Calls POST /api/auth/twitch/callback - the one point where the
 * backend actually exchanges the OAuth code with Twitch's own servers
 * (requires the client secret, so this can never happen client-side).
 */
export async function exchangeTwitchCode(code: string, redirectUri: string): Promise<TwitchCallbackResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/auth/twitch/callback`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ code, redirect_uri: redirectUri })
		});

		const data = await response.json().catch(() => ({}));

		if (!response.ok) {
			return { success: false, error: data.error ?? 'Twitch login failed. Please try again.' };
		}

		if (data.needs_username) {
			return {
				success: true,
				needsUsername: true,
				signupToken: data.signup_token,
				suggestedUsername: data.suggested_username
			};
		}

		return {
			success: true,
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			user: data.user
		};
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}

export interface TwitchFinishSignupResult {
	success: boolean;
	accessToken?: string;
	refreshToken?: string;
	user?: CreatedUser;
	error?: string;
}

/**
 * Calls POST /api/auth/twitch/finish-signup - consumes the signup
 * token from exchangeTwitchCode() plus the chosen username to actually
 * create the account. The real twitch_id/twitch_display_name never
 * pass through this call at all - they live only in the signup token
 * itself, server-side.
 */
export async function finishTwitchSignup(
	signupToken: string,
	username: string
): Promise<TwitchFinishSignupResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/auth/twitch/finish-signup`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ signup_token: signupToken, username })
		});

		const data = await response.json().catch(() => ({}));

		if (!response.ok) {
			return { success: false, error: data.error ?? 'Could not create your account. Please try again.' };
		}

		return {
			success: true,
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			user: data.user
		};
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}

export interface LinkTwitchResult {
	success: boolean;
	user?: CreatedUser;
	error?: string;
	sessionExpired?: boolean;
}

/**
 * Calls POST /api/auth/twitch/link - attaches a verified Twitch
 * identity to the currently authenticated account. Unlike
 * exchangeTwitchCode(), this never returns a new access/refresh pair
 * or a different user - it's authenticated, and always operates on
 * whichever account the given token already represents.
 */
export async function linkTwitchAccount(
	code: string,
	redirectUri: string,
	accessToken: string
): Promise<LinkTwitchResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/auth/twitch/link`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`
			},
			body: JSON.stringify({ code, redirect_uri: redirectUri })
		});

		const data = await response.json().catch(() => ({}));

		if (!response.ok) {
			return {
				success: false,
				sessionExpired: response.status === 401,
				error: data.error ?? 'Could not link your Twitch account. Please try again.'
			};
		}

		return { success: true, user: data };
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}