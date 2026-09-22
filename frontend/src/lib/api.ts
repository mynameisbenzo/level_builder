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
	id: number;
	username: string;
	email?: string;
	twitch_display_name?: string;
	role: string;
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
	user?: CreatedUser;
	error?: string;
}

/** Calls POST /api/auth/login - consumes a login token and, on success, returns a real JWT. */
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

		return { success: true, accessToken: data.access_token, user: data.user };
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
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