import { API_BASE_URL } from './api';

export interface PostPlaytimeResult {
	success: boolean;
	/** The player's running total for the level afterwards, in ms. */
	totalMs?: number;
	/** True once the total has reached the 99:59.999 ceiling. */
	atCeiling?: boolean;
	error?: string;
	/** Backend error code, e.g. "invalid_playtime". */
	code?: string;
	sessionExpired?: boolean;
}

/**
 * Calls POST /api/levels/<slug>/playtime - reports how long the player
 * has been playing since the last report. Authenticated; the backend
 * clamps the number (it never trusts it) and answers with the running
 * total it keeps.
 */
export async function postLevelPlaytime(
	slug: string,
	accessToken: string,
	elapsedMs: number
): Promise<PostPlaytimeResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/levels/${slug}/playtime`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`
			},
			body: JSON.stringify({ elapsed_ms: elapsedMs })
		});

		const data = await response.json().catch(() => ({}));

		if (!response.ok) {
			return {
				success: false,
				sessionExpired: response.status === 401,
				code: data.code,
				error: data.error ?? 'Could not report your playtime.'
			};
		}

		return { success: true, totalMs: data.total_ms, atCeiling: data.at_ceiling === true };
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}