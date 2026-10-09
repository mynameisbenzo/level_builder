import { API_BASE_URL } from './api';

/** The Cloudflare Worker that runs race rooms (see race-server/). */
export const RACE_SERVER_URL = (import.meta.env.VITE_RACE_SERVER_URL ?? 'http://localhost:8787').replace(/\/$/, '');

/** The shape of a room code: 6 characters, no 0/O/1/I/L. */
export const ROOM_CODE_PATTERN = /^[A-HJKMNP-Z2-9]{6}$/;

export interface RaceResult<T> {
	success: boolean;
	data?: T;
	error?: string;
	code?: string;
	status?: number;
	sessionExpired?: boolean;
}

export interface TicketClaims {
	userId: string;
	username: string;
	paid: boolean;
}

export interface BudgetStatus {
	racesToday: number;
	racesLeftEstimate: number;
	racesPerDayEstimate: number;
	atCapacity: boolean;
	/** ISO instant (UTC) when the daily budget resets. */
	resetsAt: string;
}

export interface RoomInfo {
	exists: boolean;
	closed?: boolean;
	joinMode?: string;
	hostName?: string;
	playerCount?: number;
	maxPlayers?: number;
	canJoin?: { ok: boolean; code?: string };
}

/**
 * Reads the claims out of a race ticket for display decisions only (show
 * the Host button or not). Never trusted for access: the race server
 * verifies the signature on every request.
 */
export function decodeTicketClaims(ticket: string): TicketClaims | null {
	try {
		const segment = ticket.split('.')[1];
		const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
		const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
		const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
		const claims = JSON.parse(new TextDecoder().decode(bytes));
		if (typeof claims.sub !== 'string' || typeof claims.username !== 'string') return null;
		return { userId: claims.sub, username: claims.username, paid: claims.paid === true };
	} catch {
		return null;
	}
}

/** Normalises whatever a person typed or pasted into a room code, or null. */
export function parseRoomCode(input: string): string | null {
	const trimmed = input.trim();
	// Accept a whole invite link as well as the bare code.
	const fromLink = trimmed.match(/\/race\/([A-Za-z0-9]{6})(?:[/?#]|$)/);
	const candidate = (fromLink ? fromLink[1] : trimmed).toUpperCase();
	return ROOM_CODE_PATTERN.test(candidate) ? candidate : null;
}

async function readJson(response: Response): Promise<any> {
	return response.json().catch(() => ({}));
}

/** Asks the Flask backend for a short-lived ticket for the race server. */
export async function fetchRaceTicket(accessToken: string): Promise<RaceResult<{ ticket: string; claims: TicketClaims }>> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/race/ticket`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${accessToken}` }
		});
		const data = await readJson(response);
		if (!response.ok) {
			return {
				success: false,
				status: response.status,
				sessionExpired: response.status === 401,
				code: data.code,
				error:
					data.code === 'races_unavailable'
						? 'Races are not available right now.'
						: (data.error ?? 'Could not get a race ticket.')
			};
		}
		const claims = decodeTicketClaims(data.ticket);
		if (!claims) return { success: false, error: 'Could not read the race ticket.' };
		return { success: true, data: { ticket: data.ticket, claims } };
	} catch {
		return { success: false, error: 'Could not reach the server. Please try again.' };
	}
}

async function raceCall<T>(path: string, init: RequestInit, fallbackError: string): Promise<RaceResult<T>> {
	try {
		const response = await fetch(`${RACE_SERVER_URL}${path}`, init);
		const data = await readJson(response);
		if (!response.ok) {
			return { success: false, status: response.status, code: data.error, error: data.error ?? fallbackError, data };
		}
		return { success: true, status: response.status, data };
	} catch {
		return { success: false, error: 'Could not reach the race server. Please try again.' };
	}
}

export function getBudget(): Promise<RaceResult<BudgetStatus>> {
	return raceCall<BudgetStatus>('/api/budget', {}, 'Could not load race availability.');
}

export async function createRoom(ticket: string): Promise<RaceResult<{ code: string }>> {
	const result = await raceCall<{ code: string }>(
		'/api/rooms',
		{ method: 'POST', headers: { Authorization: `Bearer ${ticket}` } },
		'Could not create a room.'
	);
	if (!result.success) {
		if (result.code === 'host_must_be_paid') result.error = 'Hosting a race needs a paid account.';
		else if (result.code === 'races_unavailable') result.error = 'Races are not available right now.';
		else result.error = 'Could not create a room. Please try again.';
	}
	return result;
}

export function getRoomInfo(code: string, ticket?: string): Promise<RaceResult<RoomInfo>> {
	return raceCall<RoomInfo>(
		`/api/rooms/${code}`,
		ticket ? { headers: { Authorization: `Bearer ${ticket}` } } : {},
		'Could not look up that room.'
	);
}

/** The slice of the browser WebSocket the lobby uses (so tests can fake it). */
export interface SocketLike {
	send(data: string): void;
	close(code?: number, reason?: string): void;
	onopen: ((ev: unknown) => void) | null;
	onmessage: ((ev: { data: unknown }) => void) | null;
	onclose: ((ev: { code: number; reason: string }) => void) | null;
	onerror: ((ev: unknown) => void) | null;
}

export function roomSocketUrl(code: string, ticket: string): string {
	return `${RACE_SERVER_URL.replace(/^http/, 'ws')}/api/rooms/${code}/ws?ticket=${encodeURIComponent(ticket)}`;
}

export function openRoomSocket(code: string, ticket: string): SocketLike {
	return new WebSocket(roomSocketUrl(code, ticket)) as unknown as SocketLike;
}

/** "5:00 PM PDT" - when the daily race budget resets, in Pacific time. */
export function formatResetTime(resetsAtIso: string): string {
	return new Date(resetsAtIso).toLocaleTimeString('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		timeZone: 'America/Los_Angeles',
		timeZoneName: 'short'
	});
}