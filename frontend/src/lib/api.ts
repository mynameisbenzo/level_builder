import type { LevelContent } from './game/levelContent';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000';

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
	accessToken?: string;
	refreshToken?: string;
	user?: CreatedUser;
	error?: string;
}

/**
 * Calls POST /api/users/verify-email - consumes a verification token
 * (from the link a real verification email now actually contains),
 * marks the owning account's email as verified, and - since clicking a
 * genuine verification link proves the same thing a login-link click
 * does - logs them in too, same shape as login()/exchangeTwitchCode().
 */
export async function verifyEmail(token: string): Promise<VerifyEmailResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/users/verify-email`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token })
		});

		const data = await response.json().catch(() => ({}));

		if (!response.ok) {
			return { success: false, error: data.error ?? 'Verification failed. Please try again.' };
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

export interface ResendVerificationEmailResult {
	success: boolean;
	error?: string;
	sessionExpired?: boolean;
	/** True specifically for a 429 - lets the caller show "you've
	 * already asked for this a few times" rather than a generic error,
	 * without the caller needing to know the actual rate-limit numbers
	 * (those live server-side in app/api/users.py). */
	rateLimited?: boolean;
}

/**
 * Calls POST /api/users/resend-verification-email - authenticated,
 * self-only (see the backend docstring: there's no target user in the
 * request at all, just the caller's own JWT). Issues a fresh token
 * without invalidating whatever token the original signup email still
 * carries, so an older unread email keeps working too.
 */
export async function resendVerificationEmail(
	accessToken: string
): Promise<ResendVerificationEmailResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/users/resend-verification-email`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${accessToken}` }
		});

		if (response.ok) {
			return { success: true };
		}

		const data = await response.json().catch(() => ({}));

		return {
			success: false,
			sessionExpired: response.status === 401,
			rateLimited: response.status === 429,
			error: data.error ?? 'Could not send the verification email. Please try again.'
		};
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

export interface LevelSummary {
	id: string;
	title: string;
	visibility_state: 'draft' | 'testing' | 'published' | 'unpublished';
	/** False until a level's first publish - which is also the one moment
	 * it gets named (see publishLevel). True from then on, even if a
	 * later edit demotes visibility_state back to 'testing'. */
	has_been_published: boolean;
	/** Set only by deleteLevel, and only for a level that had already
	 * been published (a never-published draft is hard-deleted instead,
	 * so there's no row left to carry this flag). Terminal - no restore
	 * action exists. visibility_state moves to 'unpublished' at the same
	 * time this becomes true. */
	is_deleted: boolean;
	draft_content: LevelContent | null;
	draft_beaten_at: string | null;
	created_at: string | null;
}

export interface LevelResult {
	success: boolean;
	level?: LevelSummary;
	error?: string;
	sessionExpired?: boolean;
}

/** Calls POST /api/levels - creates a new level, owned by the caller. */
export async function createLevel(title: string, accessToken: string): Promise<LevelResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/levels`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`
			},
			body: JSON.stringify({ title })
		});

		const data = await response.json().catch(() => ({}));

		if (!response.ok) {
			return {
				success: false,
				sessionExpired: response.status === 401,
				error: data.error ?? 'Could not create the level. Please try again.'
			};
		}

		return { success: true, level: data };
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}

/** Calls GET /api/levels/<slug> - how /edit/[slug] resumes an
 * existing level, draft content included. Owner-only. */
export async function getLevel(slug: string, accessToken: string): Promise<LevelResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/levels/${slug}`, {
			headers: { Authorization: `Bearer ${accessToken}` }
		});

		const data = await response.json().catch(() => ({}));

		if (!response.ok) {
			return {
				success: false,
				sessionExpired: response.status === 401,
				error: data.error ?? 'Could not load the level. Please try again.'
			};
		}

		return { success: true, level: data };
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}

/** Calls PATCH /api/levels/<slug> - saves the editor's current
 * in-progress content. title is optional; content is always sent. */
export async function saveLevel(
	slug: string,
	content: LevelContent,
	accessToken: string,
	title?: string
): Promise<LevelResult> {
	try {
		const body: Record<string, unknown> = { content };
		if (title !== undefined) {
			body.title = title;
		}

		const response = await fetch(`${API_BASE_URL}/api/levels/${slug}`, {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`
			},
			body: JSON.stringify(body)
		});

		const data = await response.json().catch(() => ({}));

		if (!response.ok) {
			return {
				success: false,
				sessionExpired: response.status === 401,
				error: data.error ?? 'Could not save the level. Please try again.'
			};
		}

		return { success: true, level: data };
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}

/** Calls POST /api/levels/<slug>/beat - records that a real
 * test-playthrough of the current draft just reached the win condition. */
export async function beatLevel(slug: string, accessToken: string): Promise<LevelResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/levels/${slug}/beat`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${accessToken}` }
		});

		const data = await response.json().catch(() => ({}));

		if (!response.ok) {
			return {
				success: false,
				sessionExpired: response.status === 401,
				error: data.error ?? 'Could not record the win. Please try again.'
			};
		}

		return { success: true, level: data };
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}

/** Calls POST /api/levels/<slug>/publish - requires the level to have
 * been beaten since its last save; turns the draft into a real,
 * permanent LevelVersion.
 *
 * title is required for a level's FIRST publish (this is the one place
 * it gets named) and must be omitted for every later one - a published
 * level's name can't be changed. The backend applies it in the same
 * transaction as the publish itself, so a rejected publish never names
 * anything. */
export async function publishLevel(
	slug: string,
	accessToken: string,
	title?: string
): Promise<LevelResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/levels/${slug}/publish`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`
			},
			body: JSON.stringify(title === undefined ? {} : { title })
		});

		const data = await response.json().catch(() => ({}));

		if (!response.ok) {
			return {
				success: false,
				sessionExpired: response.status === 401,
				error: data.error ?? 'Could not publish the level. Please try again.'
			};
		}

		return { success: true, level: data };
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}

export interface DeleteLevelResult {
	success: boolean;
	error?: string;
	sessionExpired?: boolean;
}

/**
 * Calls DELETE /api/levels/<slug>. What actually happens depends on the
 * level's own state, entirely server-side - this function doesn't need
 * to know which: a never-published draft is hard-deleted outright
 * (gone, frees a draft-cap slot), while an already-published level is
 * soft-deleted instead (stays in the caller's own list marked deleted,
 * disappears from everyone else's view, no restore). Either way this
 * resolves the same way - true on success - so the caller's job is
 * just to refresh whatever level list it's showing afterward.
 */
export async function deleteLevel(slug: string, accessToken: string): Promise<DeleteLevelResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/levels/${slug}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${accessToken}` }
		});

		if (response.status === 204) {
			return { success: true };
		}

		const data = await response.json().catch(() => ({}));

		return {
			success: false,
			sessionExpired: response.status === 401,
			error: data.error ?? 'Could not delete the level. Please try again.'
		};
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}

export interface PlayLevelResult {
	success: boolean;
	title?: string;
	content?: LevelContent;
	/** Who published this level - the result modal's "Leave" action
	 * (see /play/[slug]/+page.svelte) routes back to this person's
	 * public profile. */
	ownerUsername?: string;
	error?: string;
}

/** Calls GET /api/levels/<slug>/play - public, no auth. What
 * /play/[slug] loads: a published level's frozen, live content. */
export async function getLevelForPlay(slug: string): Promise<PlayLevelResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/levels/${slug}/play`);
		const data = await response.json().catch(() => ({}));

		if (!response.ok) {
			return { success: false, error: data.error ?? 'This level could not be found.' };
		}

		return {
			success: true,
			title: data.title,
			content: data.content,
			ownerUsername: data.owner_username
		};
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}

export interface RateLevelResult {
	success: boolean;
	error?: string;
	sessionExpired?: boolean;
}

/**
 * Calls POST /api/levels/<slug>/rate - the thumbs-up/thumbs-down from
 * the result modal shown after a playthrough ends. Authenticated;
 * idempotent AND switchable on the backend (rating again, even with
 * the opposite value, updates the same row), so the caller doesn't
 * need to track whether this is a first rating or a changed mind
 * before sending it.
 */
export async function rateLevel(
	slug: string,
	isLike: boolean,
	accessToken: string
): Promise<RateLevelResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/levels/${slug}/rate`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`
			},
			body: JSON.stringify({ is_like: isLike })
		});

		if (response.ok) {
			return { success: true };
		}

		const data = await response.json().catch(() => ({}));

		return {
			success: false,
			sessionExpired: response.status === 401,
			error: data.error ?? 'Could not send your rating. Please try again.'
		};
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}

export interface GetLevelRatingResult {
	success: boolean;
	/** null means the level's fine but this caller hasn't rated it yet -
	 * not an error, just "no existing rating to show". Undefined only
	 * when success is false. */
	isLike?: boolean | null;
	error?: string;
	sessionExpired?: boolean;
}

/**
 * Calls GET /api/levels/<slug>/rating - the result modal's own previous
 * rating for this level, if any, so it can open with that button already
 * shown as selected instead of looking unset for a returning rater.
 * Authenticated, same as rateLevel.
 */
export async function getLevelRating(
	slug: string,
	accessToken: string
): Promise<GetLevelRatingResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/levels/${slug}/rating`, {
			headers: { Authorization: `Bearer ${accessToken}` }
		});

		const data = await response.json().catch(() => ({}));

		if (!response.ok) {
			return {
				success: false,
				sessionExpired: response.status === 401,
				error: data.error ?? 'Could not load your rating.'
			};
		}

		return { success: true, isLike: data.is_like };
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}


/**
 * The lean shape GET /api/levels and GET /api/levels/by-user/<username>
 * both return - deliberately missing draft_content, unlike LevelSummary
 * above (which is what GET /api/levels/<slug> returns for a single
 * level) - a list of many levels doesn't need each one's full content
 * blob just to show a title and status.
 */
export interface LevelListItem {
	id: string;
	title: string;
	visibility_state: 'draft' | 'testing' | 'published' | 'unpublished';
	has_been_published: boolean;
	is_deleted: boolean;
	draft_beaten_at: string | null;
	created_at: string | null;
}

export interface ListLevelsResult {
	success: boolean;
	levels?: LevelListItem[];
	error?: string;
	sessionExpired?: boolean;
}

/** Calls GET /api/levels - every level the caller owns, drafts and
 * testing included. Owner-only. */
export async function listMyLevels(accessToken: string): Promise<ListLevelsResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/levels`, {
			headers: { Authorization: `Bearer ${accessToken}` }
		});

		const data = await response.json().catch(() => ({}));

		if (!response.ok) {
			return {
				success: false,
				sessionExpired: response.status === 401,
				error: data.error ?? 'Could not load your levels. Please try again.'
			};
		}

		return { success: true, levels: data };
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}

export interface ListLevelsByUserResult {
	success: boolean;
	levels?: LevelListItem[];
	error?: string;
}

/** Calls GET /api/levels/by-user/<username> - public, no auth. Only
 * that creator's genuinely published levels, never drafts/testing. */
export async function listLevelsByUser(username: string): Promise<ListLevelsByUserResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/levels/by-user/${username}`);
		const data = await response.json().catch(() => ({}));

		if (!response.ok) {
			return { success: false, error: data.error ?? 'Could not load these levels.' };
		}

		return { success: true, levels: data };
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}

export interface PublicUser {
	id: string;
	username: string;
	role: string;
	created_at: string | null;
	email?: string;
	twitch_display_name?: string;
}

export interface GetPublicUserResult {
	success: boolean;
	user?: PublicUser;
	error?: string;
}

/** Calls GET /api/users/by-username/<username> - public, no auth. What
 * /u/[username] loads for the "who is this" half of a public profile.
 * Respects hide_email/hide_twitch - see user_to_public_dict. */
export async function getUserByUsername(username: string): Promise<GetPublicUserResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/users/by-username/${username}`);
		const data = await response.json().catch(() => ({}));

		if (!response.ok) {
			return { success: false, error: data.error ?? 'This user could not be found.' };
		}

		return { success: true, user: data };
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}