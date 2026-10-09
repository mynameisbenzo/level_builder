// What the race lobby knows and shows, as plain data plus one pure
// function that folds each server message into it. No network, no
// Svelte: everything here is unit-tested.

export type JoinMode = 'host' | 'party' | 'public';

export interface RoomPlayer {
	userId: string;
	username: string;
	paid: boolean;
	isHost: boolean;
	joinedAt: number;
	away: boolean;
}

export interface RoomSnapshot {
	code: string;
	joinMode: JoinMode;
	phase: 'lobby' | 'racing';
	maxPlayers: number;
	hostId: string;
	closing: boolean;
	players: RoomPlayer[];
	invites: string[];
}

export type LobbyStatus =
	| 'connecting'
	| 'in'
	| 'reconnecting'
	| 'denied'
	| 'kicked'
	| 'closed'
	| 'replaced'
	| 'left'
	| 'disconnected';

/** Statuses after which the lobby must not try to reconnect. */
export const TERMINAL_STATUSES: readonly LobbyStatus[] = ['denied', 'kicked', 'closed', 'replaced', 'left'];

export interface Notice {
	id: number;
	text: string;
}

export interface LobbyState {
	status: LobbyStatus;
	you: { userId: string; username: string } | null;
	room: RoomSnapshot | null;
	notices: Notice[];
	nextNoticeId: number;
	deniedCode: string | null;
	closedReason: string | null;
	/** The server dropped some of our messages for being too fast. */
	limited: boolean;
	/** The last rejected action, for a one-line message under the controls. */
	lastError: string | null;
}

const MAX_NOTICES = 5;

export function initialLobby(): LobbyState {
	return {
		status: 'connecting',
		you: null,
		room: null,
		notices: [],
		nextNoticeId: 1,
		deniedCode: null,
		closedReason: null,
		limited: false,
		lastError: null
	};
}

export function isTerminal(state: LobbyState): boolean {
	return TERMINAL_STATUSES.includes(state.status);
}

export function amHost(state: LobbyState): boolean {
	return !!state.you && !!state.room && state.room.hostId === state.you.userId;
}

/** Whether this account may send invites right now (host always, anyone in party mode). */
export function canInvite(state: LobbyState): boolean {
	if (!state.room || !state.you) return false;
	if (state.room.joinMode === 'public') return false;
	return amHost(state) || state.room.joinMode === 'party';
}

// ---- wording ----------------------------------------------------------

export const JOIN_MODE_LABELS: Record<JoinMode, { title: string; hint: string }> = {
	host: { title: 'Host invites only', hint: 'Only you can invite people, by username.' },
	party: { title: 'Party invites', hint: 'Anyone in the room can invite people, by username.' },
	public: { title: 'Public', hint: 'Anyone with the link can join.' }
};

export function describeDenied(code: string | null): string {
	switch (code) {
		case 'not_invited':
			return "You haven't been invited to this room. Ask the host to invite your username, then open the link again.";
		case 'full':
			return 'This room is full.';
		case 'banned':
			return 'The host removed you from this room, so you cannot rejoin.';
		case 'closed':
			return 'This room has closed.';
		case 'race_in_progress':
			return 'A race is under way. You can join between races if a slot is free.';
		case 'unauthorized':
			return 'Your session could not be verified. Log in again and retry.';
		default:
			return 'You could not join this room.';
	}
}

export function describeClosed(reason: string | null): string {
	switch (reason) {
		case 'paid_host_left':
			return 'Paid host left. Every room needs a paid host, and no paid player was left to take over.';
		case 'expired':
			return 'This room closed after sitting empty for a while.';
		case 'host_closed':
			return 'The host closed the room.';
		default:
			return 'This room has closed.';
	}
}

const ERROR_TEXT: Record<string, string> = {
	not_host: 'Only the host can do that.',
	not_allowed: "You can't do that in this room.",
	public_room: 'Anyone with the link can already join, so there is nothing to invite.',
	bad_username: "That isn't a valid username.",
	already_here: 'That player is already in the room.',
	too_many_invites: 'The invite list is full.',
	cannot_kick_self: "You can't remove yourself. Use Leave race instead.",
	not_in_room: 'That player is no longer in the room.',
	bad_mode: 'Unknown join mode.',
	bad_message: 'The server could not read that action.',
	unknown_message: 'The server did not recognise that action.',
	closed: 'This room has closed.'
};

export function describeError(code: string): string {
	return ERROR_TEXT[code] ?? 'That did not work.';
}

// ---- folding server messages into state --------------------------------

export interface ServerMessage {
	t: string;
	[key: string]: unknown;
}

function addNotice(state: LobbyState, text: string): LobbyState {
	const notices = [...state.notices, { id: state.nextNoticeId, text }].slice(-MAX_NOTICES);
	return { ...state, notices, nextNoticeId: state.nextNoticeId + 1 };
}

function noticeForEvent(event: { kind?: string; username?: string; reason?: string }, youName: string | null): string | null {
	const name = event.username ?? 'Someone';
	const isYou = youName !== null && name === youName;
	switch (event.kind) {
		case 'joined':
			return isYou ? null : `${name} joined`;
		case 'reconnected':
			return isYou ? null : `${name} is back`;
		case 'away':
			return isYou ? null : `${name} lost connection`;
		case 'left':
			if (isYou) return null;
			return event.reason === 'timeout' ? `${name} dropped out` : `${name} left`;
		case 'kicked':
			return `${name} was removed by the host`;
		case 'hostChanged':
			return `${name} is now the host`;
		case 'closing':
			return 'The host left. The room will close when the current race ends.';
		default:
			return null;
	}
}

export function applyServerMessage(state: LobbyState, msg: ServerMessage): LobbyState {
	switch (msg.t) {
		case 'welcome': {
			const you = msg.you as { userId: string; username: string };
			return {
				...state,
				status: 'in',
				you: { userId: you.userId, username: you.username },
				room: msg.room as RoomSnapshot,
				lastError: null
			};
		}
		case 'roomState':
			return { ...state, room: msg.room as RoomSnapshot };
		case 'event': {
			const text = noticeForEvent(msg.event as never, state.you?.username ?? null);
			return text ? addNotice(state, text) : state;
		}
		case 'denied':
			return { ...state, status: 'denied', deniedCode: String(msg.code ?? '') };
		case 'kicked':
			return { ...state, status: 'kicked' };
		case 'replaced':
			return { ...state, status: 'replaced' };
		case 'closed':
			return { ...state, status: 'closed', closedReason: String(msg.reason ?? '') };
		case 'limited':
			return { ...state, limited: true };
		case 'error': {
			const code = String(msg.code ?? '');
			return { ...state, lastError: describeError(code) };
		}
		default:
			return state;
	}
}