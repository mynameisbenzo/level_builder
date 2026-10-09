import { describe, expect, it } from 'vitest';
import {
	amHost,
	applyServerMessage,
	canInvite,
	describeClosed,
	describeDenied,
	describeError,
	initialLobby,
	isTerminal,
	type LobbyState,
	type RoomSnapshot
} from './raceView';

const room = (overrides: Partial<RoomSnapshot> = {}): RoomSnapshot => ({
	code: 'ABC234',
	joinMode: 'host',
	phase: 'lobby',
	maxPlayers: 4,
	hostId: 'h',
	closing: false,
	players: [
		{ userId: 'h', username: 'Hosty', paid: true, isHost: true, joinedAt: 1, away: false },
		{ userId: 'g', username: 'Guest', paid: false, isHost: false, joinedAt: 2, away: false }
	],
	invites: [],
	...overrides
});

const welcomed = (userId: string, username: string, r = room()): LobbyState =>
	applyServerMessage(initialLobby(), { t: 'welcome', you: { userId, username }, room: r });

describe('applyServerMessage', () => {
	it('welcome puts us in the room', () => {
		const s = welcomed('h', 'Hosty');
		expect(s.status).toBe('in');
		expect(s.you).toEqual({ userId: 'h', username: 'Hosty' });
		expect(s.room?.players).toHaveLength(2);
	});

	it('roomState replaces the room snapshot', () => {
		const s = applyServerMessage(welcomed('h', 'Hosty'), { t: 'roomState', room: room({ joinMode: 'public' }) });
		expect(s.room?.joinMode).toBe('public');
	});

	it('turns events into short notices, hiding our own', () => {
		let s = welcomed('h', 'Hosty');
		s = applyServerMessage(s, { t: 'event', event: { kind: 'joined', userId: 'x', username: 'Newbie' } });
		s = applyServerMessage(s, { t: 'event', event: { kind: 'joined', userId: 'h', username: 'Hosty' } });
		s = applyServerMessage(s, { t: 'event', event: { kind: 'left', userId: 'x', username: 'Newbie', reason: 'timeout' } });
		expect(s.notices.map((n) => n.text)).toEqual(['Newbie joined', 'Newbie dropped out']);
	});

	it('keeps only the latest few notices with unique ids', () => {
		let s = welcomed('h', 'Hosty');
		for (let i = 0; i < 8; i++) {
			s = applyServerMessage(s, { t: 'event', event: { kind: 'joined', userId: `u${i}`, username: `P${i}` } });
		}
		expect(s.notices).toHaveLength(5);
		expect(new Set(s.notices.map((n) => n.id)).size).toBe(5);
		expect(s.notices.at(-1)?.text).toBe('P7 joined');
	});

	it('announces a new host and a closing room', () => {
		let s = welcomed('g', 'Guest');
		s = applyServerMessage(s, { t: 'event', event: { kind: 'hostChanged', userId: 'g', username: 'Guest' } });
		s = applyServerMessage(s, { t: 'event', event: { kind: 'closing', reason: 'paid_host_left' } });
		expect(s.notices[0].text).toBe('Guest is now the host');
		expect(s.notices[1].text).toMatch(/close when the current race ends/);
	});

	it('records why we were denied, kicked, replaced or closed', () => {
		expect(applyServerMessage(initialLobby(), { t: 'denied', code: 'full' })).toMatchObject({ status: 'denied', deniedCode: 'full' });
		expect(applyServerMessage(welcomed('g', 'Guest'), { t: 'kicked' }).status).toBe('kicked');
		expect(applyServerMessage(welcomed('g', 'Guest'), { t: 'replaced' }).status).toBe('replaced');
		expect(applyServerMessage(welcomed('g', 'Guest'), { t: 'closed', reason: 'paid_host_left' })).toMatchObject({
			status: 'closed',
			closedReason: 'paid_host_left'
		});
	});

	it('shows a rejected action as plain words', () => {
		const s = applyServerMessage(welcomed('g', 'Guest'), { t: 'error', code: 'not_host', for: 'kick' });
		expect(s.lastError).toBe('Only the host can do that.');
	});

	it('flags rate limiting and ignores unknown messages', () => {
		const s = welcomed('g', 'Guest');
		expect(applyServerMessage(s, { t: 'limited' }).limited).toBe(true);
		expect(applyServerMessage(s, { t: 'mystery' })).toBe(s);
	});
});

describe('who can do what', () => {
	it('knows when we are the host', () => {
		expect(amHost(welcomed('h', 'Hosty'))).toBe(true);
		expect(amHost(welcomed('g', 'Guest'))).toBe(false);
		expect(amHost(initialLobby())).toBe(false);
	});

	it('host can invite unless the room is public; guests only in party mode', () => {
		expect(canInvite(welcomed('h', 'Hosty'))).toBe(true);
		expect(canInvite(welcomed('g', 'Guest'))).toBe(false);
		expect(canInvite(welcomed('g', 'Guest', room({ joinMode: 'party' })))).toBe(true);
		expect(canInvite(welcomed('h', 'Hosty', room({ joinMode: 'public' })))).toBe(false);
	});

	it('terminal statuses stop reconnecting; others do not', () => {
		for (const status of ['denied', 'kicked', 'closed', 'replaced', 'left'] as const) {
			expect(isTerminal({ ...initialLobby(), status })).toBe(true);
		}
		for (const status of ['connecting', 'in', 'reconnecting', 'disconnected'] as const) {
			expect(isTerminal({ ...initialLobby(), status })).toBe(false);
		}
	});
});

describe('wording', () => {
	it('explains every refusal the server can give', () => {
		for (const code of ['not_invited', 'full', 'banned', 'closed', 'race_in_progress', 'unauthorized']) {
			expect(describeDenied(code)).not.toBe(describeDenied('something_else'));
		}
	});

	it('uses the paid-host-left wording from the design', () => {
		expect(describeClosed('paid_host_left')).toMatch(/^Paid host left/);
		expect(describeClosed('host_closed')).toMatch(/host closed/);
	});

	it('has a fallback for unknown error codes', () => {
		expect(describeError('nope')).toBe('That did not work.');
	});
});