import { API_BASE_URL } from './api';
import {
	emptyGhostSet,
	GHOST_KINDS,
	type GhostFrame,
	type GhostKind,
	type GhostRun,
	type GhostSet
} from './game/ghost';

export interface GetLevelGhostResult {
	success: boolean;
	/** The full ghost; null means the level's fine but nobody has cleared it yet. */
	ghost?: GhostRun | null;
	/** Every kind of ghost the level holds (each null until someone clears that stretch). */
	ghosts?: GhostSet;
	error?: string;
}

interface RawGhost {
	username: string;
	duration_ms: number;
	sample_interval_ms: number;
	frames: unknown;
}

function mapGhost(raw: RawGhost | null | undefined): GhostRun | null {
	if (!raw) {
		return null;
	}
	return {
		username: raw.username,
		durationMs: raw.duration_ms,
		sampleIntervalMs: raw.sample_interval_ms,
		frames: raw.frames as GhostFrame[]
	};
}

/**
 * Calls GET /api/levels/<slug>/ghost - public, no auth. The fastest
 * recorded clears of the level (a full ghost, plus before and after
 * ghosts on a level with a checkpoint). Best-effort for the caller: a
 * level plays fine without a ghost, so a failure here should just mean
 * "no ghost this time".
 */
export async function getLevelGhost(slug: string): Promise<GetLevelGhostResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/levels/${slug}/ghost`);
		const data = await response.json().catch(() => ({}));

		if (!response.ok) {
			return { success: false, error: data.error ?? 'Could not load the ghost.' };
		}

		// An older backend sends only `ghost` (the full one); a current one
		// sends `ghosts` with every kind.
		const ghosts = emptyGhostSet();
		for (const kind of GHOST_KINDS) {
			ghosts[kind] = mapGhost(data.ghosts?.[kind]);
		}
		if (!data.ghosts) {
			ghosts.full = mapGhost(data.ghost);
		}

		return { success: true, ghost: ghosts.full, ghosts };
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
	/** True if this stretch is now the level's ghost of its kind. */
	isRecord?: boolean;
	/** The level's record afterwards (fastest route; a pair is credited to both holders). */
	record?: LevelRecord;
	error?: string;
	/** Backend error code, e.g. "invalid_ghost". */
	code?: string;
	sessionExpired?: boolean;
}

/**
 * Calls POST /api/levels/<slug>/ghost - offers a just-cleared stretch as
 * the level's ghost of the given kind ("full" unless it's one half of a
 * run through a checkpoint). Authenticated; the backend keeps it only if
 * it's strictly faster than the current ghost of that kind.
 */
export async function submitLevelGhost(
	slug: string,
	accessToken: string,
	run: { durationMs: number; frames: GhostFrame[] },
	kind: GhostKind = 'full'
): Promise<SubmitLevelGhostResult> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/levels/${slug}/ghost`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`
			},
			body: JSON.stringify({
				duration_ms: run.durationMs,
				frames: run.frames,
				kind
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