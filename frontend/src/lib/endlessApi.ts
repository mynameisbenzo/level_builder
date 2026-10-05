import { API_BASE_URL } from './api';

/** Mirrors ENDLESS_DIFFICULTIES in backend/app/services/endless.py ("any" is the no-filter choice). */
export const ENDLESS_DIFFICULTY_CHOICES = ['any', 'easy', 'normal', 'hard', 'very_hard', 'tas'] as const;
export type EndlessDifficulty = (typeof ENDLESS_DIFFICULTY_CHOICES)[number];

export const ENDLESS_DIFFICULTY_LABELS: Record<EndlessDifficulty, string> = {
	any: 'Any',
	easy: 'Easy',
	normal: 'Normal',
	hard: 'Hard',
	very_hard: 'Very Hard',
	tas: 'TAS!?!?'
};

/** Standing of a free account's daily lives pool. Null on a paid account's run/status. */
export interface EndlessPool {
	daily_limit: number;
	remaining: number;
	/** ISO timestamp (naive UTC from the backend - see parseServerTime). */
	resets_at: string;
}

export interface EndlessCurrentLevel {
	slug: string;
	title: string;
	owner_username: string;
	player_starting_color: string;
	position: number;
	attempts: number;
	attempt_in_progress: boolean;
}

export interface EndlessRun {
	difficulty: string | null;
	is_active: boolean;
	end_reason: 'out_of_lives' | 'forfeited' | 'expired' | null;
	starting_lives: number;
	lives_remaining: number;
	levels_cleared: number;
	deaths: number;
	skips: number;
	current_level: EndlessCurrentLevel | null;
	pool: EndlessPool | null;
}

export interface EndlessStatus {
	is_paid: boolean;
	lives: { adjustable: boolean; default: number; min: number; max: number };
	pool: EndlessPool | null;
	/** How many levels each difficulty choice could serve right now. */
	difficulties: Record<string, number>;
	active_run: EndlessRun | null;
}

export interface EndlessResult<T> {
	success: boolean;
	data?: T;
	error?: string;
	/** Backend error code (e.g. "daily_pool_exhausted", "active_run_exists"). */
	code?: string;
	status?: number;
	sessionExpired?: boolean;
	/** Extras some errors carry: the pool on daily_pool_exhausted, the run on active_run_exists. */
	pool?: EndlessPool | null;
	activeRun?: EndlessRun | null;
}

/**
 * The backend stores naive-UTC timestamps and serializes them with no
 * timezone suffix - `new Date('2026-10-06T12:00:00')` would read that as
 * LOCAL time and be off by the viewer's UTC offset. Appends the "Z" the
 * string is missing so it parses as the UTC instant it actually is.
 */
export function parseServerTime(iso: string): Date {
	const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso);
	return new Date(hasZone ? iso : `${iso}Z`);
}

/** "3h 12m", "12m", or "under a minute" - for "your lives refresh in ...". */
export function formatTimeUntil(target: Date, now: Date = new Date()): string {
	const totalMinutes = Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 60000));
	if (totalMinutes < 1) return 'under a minute';
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	if (hours === 0) return `${minutes}m`;
	return `${hours}h ${minutes}m`;
}

async function call<T>(
	method: 'GET' | 'POST',
	path: string,
	accessToken: string,
	body: Record<string, unknown> | undefined,
	pick: (data: any) => T,
	fallbackError: string
): Promise<EndlessResult<T>> {
	try {
		const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
		if (body !== undefined) {
			headers['Content-Type'] = 'application/json';
		}

		const response = await fetch(`${API_BASE_URL}/api/endless${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body)
		});

		const data = await response.json().catch(() => ({}));

		if (!response.ok) {
			return {
				success: false,
				status: response.status,
				sessionExpired: response.status === 401,
				error: data.error ?? fallbackError,
				code: data.code,
				pool: data.pool,
				activeRun: data.active_run
			};
		}

		return { success: true, data: pick(data) };
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}

const runOf = (data: { run: EndlessRun }) => data.run;

/** GET /api/endless/status - everything the entry screen needs in one call. */
export function getEndlessStatus(accessToken: string) {
	return call<EndlessStatus>('GET', '/status', accessToken, undefined, (d) => d, 'Could not load endless mode.');
}

/**
 * POST /api/endless/runs. `difficulty` null/'any' means no filter;
 * `startingLives` only for paid accounts; `replace` forfeits an existing
 * active run first (without it, that case is an `active_run_exists` error
 * carrying `activeRun` for the resume-or-start-over prompt).
 */
export function startEndlessRun(
	accessToken: string,
	options: { difficulty?: EndlessDifficulty | null; startingLives?: number; replace?: boolean } = {}
) {
	const body: Record<string, unknown> = {};
	if (options.difficulty) body.difficulty = options.difficulty;
	if (options.startingLives !== undefined) body.starting_lives = options.startingLives;
	if (options.replace) body.replace = true;
	return call<EndlessRun>('POST', '/runs', accessToken, body, runOf, 'Could not start a run.');
}

/** The level has loaded and play is starting - from here an abandoned attempt costs a life. */
export function beginEndlessAttempt(accessToken: string) {
	return call<EndlessRun>('POST', '/runs/current/begin', accessToken, undefined, runOf, 'Could not start this level.');
}

/** Sent right after begin, then every ~10 seconds while the level is being played. */
export function sendEndlessHeartbeat(accessToken: string) {
	return call<boolean>('POST', '/runs/current/heartbeat', accessToken, undefined, () => true, 'Heartbeat failed.');
}

export function reportEndlessDeath(accessToken: string) {
	return call<EndlessRun>('POST', '/runs/current/death', accessToken, undefined, runOf, 'Could not record your death.');
}

export function reportEndlessClear(accessToken: string) {
	return call<EndlessRun>('POST', '/runs/current/clear', accessToken, undefined, runOf, 'Could not record your clear.');
}

/** Skips the current level - costs a life. */
export function skipEndlessLevel(accessToken: string) {
	return call<EndlessRun>('POST', '/runs/current/skip', accessToken, undefined, runOf, 'Could not skip this level.');
}

export function quitEndlessRun(accessToken: string) {
	return call<EndlessRun>('POST', '/runs/current/quit', accessToken, undefined, runOf, 'Could not quit the run.');
}