import { API_BASE_URL } from './api';
import type { GhostFrame, GhostRun } from './game/ghost';

export interface GetLevelGhostResult {
	success: boolean;
	/** null means the level's fine but nobody has cleared this version yet. */
	ghost?: GhostRun | null;
	error?: string;
}

/**
 * Calls GET /api/levels/<slug>/ghost - public, no auth. The fastest
 * recorded clear of the level's current version. Best-effort for the
 * caller: a level plays fine without a ghost, so a failure here should
 * just mean "no ghost this time".
 */
export async function getLevelGhost(slug: string): Promise<GetLevelGhostResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/levels/${slug}/ghost`);
		const data = await response.json().catch(() => ({}));

		if (!response.ok) {
			return { success: false, error: data.error ?? 'Could not load the ghost.' };
		}

		if (!data.ghost) {
			return { success: true, ghost: null };
		}

		return {
			success: true,
			ghost: {
				username: data.ghost.username,
				durationMs: data.ghost.duration_ms,
				sampleIntervalMs: data.ghost.sample_interval_ms,
				version: data.ghost.version,
				frames: data.ghost.frames as GhostFrame[]
			}
		};
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}

export interface LevelRecord {
	username: string;
	durationMs: number;
}

export interface SubmitLevelGhostResult {
	success: boolean;
	/** True if this clear is now the level's ghost. */
	isRecord?: boolean;
	/** Whoever holds the record afterwards - this player if isRecord. */
	record?: LevelRecord;
	error?: string;
	/** Backend error code, e.g. "stale_version" or "invalid_ghost". */
	code?: string;
	sessionExpired?: boolean;
}

/**
 * Calls POST /api/levels/<slug>/ghost - offers a just-cleared run as the
 * level's ghost. `version` is the version number the player was playing
 * (from getLevelForPlay). Authenticated; the backend keeps it only if
 * it's strictly faster than the current record.
 */
export async function submitLevelGhost(
	slug: string,
	accessToken: string,
	run: { version: number; durationMs: number; frames: GhostFrame[] }
): Promise<SubmitLevelGhostResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/levels/${slug}/ghost`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`
			},
			body: JSON.stringify({
				version: run.version,
				duration_ms: run.durationMs,
				frames: run.frames
			})
		});

		const data = await response.json().catch(() => ({}));

		if (!response.ok) {
			return {
				success: false,
				sessionExpired: response.status === 401,
				code: data.code,
				error: data.error ?? 'Could not submit your run.'
			};
		}

		return {
			success: true,
			isRecord: data.is_record,
			record: { username: data.record.username, durationMs: data.record.duration_ms }
		};
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}