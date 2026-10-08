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
/** The level's playtime record: the lowest total anyone has needed to clear it. */
export interface PlaytimeRecord {
	username: string;
	totalMs: number;
}

function parseRecord(raw: unknown): PlaytimeRecord | null {
	if (!raw || typeof raw !== 'object') return null;
	const { username, total_ms } = raw as { username?: unknown; total_ms?: unknown };
	if (typeof username !== 'string' || typeof total_ms !== 'number') return null;
	return { username, totalMs: total_ms };
}

export interface GetLevelRecordResult {
	success: boolean;
	/** null when nobody has cleared the level yet. */
	record?: PlaytimeRecord | null;
	error?: string;
}

/** Calls GET /api/levels/<slug>/record - public, no login needed. */
export async function getLevelRecord(slug: string): Promise<GetLevelRecordResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/levels/${slug}/record`);
		const data = await response.json().catch(() => ({}));
		if (!response.ok) {
			return { success: false, error: data.error ?? 'Could not load the level record.' };
		}
		return { success: true, record: parseRecord(data.record) };
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}

export interface SubmitWinResult {
	success: boolean;
	/** The player's total playtime for this clear, across every try, in ms. */
	totalMs?: number;
	/** True when that total just became the level's record. */
	isRecord?: boolean;
	/** The record standing afterwards. */
	record?: PlaytimeRecord | null;
	error?: string;
	code?: string;
	sessionExpired?: boolean;
}

/**
 * Calls POST /api/levels/<slug>/record - reports the player's last stretch
 * of playtime along with a win. The server adds it to the running total,
 * ends that total (the next try starts from zero) and compares it with the
 * level's record.
 */
export async function submitLevelWin(
	slug: string,
	accessToken: string,
	elapsedMs: number
): Promise<SubmitWinResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/levels/${slug}/record`, {
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
				error: data.error ?? 'Could not submit your clear.'
			};
		}
		return {
			success: true,
			totalMs: data.total_ms,
			isRecord: data.is_record === true,
			record: parseRecord(data.record)
		};
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}