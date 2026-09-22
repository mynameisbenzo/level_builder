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