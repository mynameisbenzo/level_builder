import { describe, expect, it } from 'vitest';
import {
	amHost,
	applyServerMessage,
	canInvite,
	describeAbort,
	describeClosed,
	describeDenied,
	describeError,
	initialLobby,
	isTerminal,
	formatRaceTime,
	me,
	ordinal,
	resultsOrder,
	voteCounts,
	type RacerView,
	type LobbyState,
	type RoomSnapshot
} from './raceView';

const player = { away: false, ready: false, readyBy: null, loaded: false };

const room = (overrides: Partial<RoomSnapshot> = {}): RoomSnapshot => ({
	code: 'ABC234',
	joinMode: 'host',
	phase: 'lobby',
	category: 'any',
	maxPlayers: 4,
	hostId: 'h',
	closing: false,
	serverNow: 1000,
	players: [
		{ ...player, userId: 'h', username: 'Hosty', paid: true, isHost: true, joinedAt: 1 },
		{ ...player, userId: 'g', username: 'Guest', paid: false, isHost: false, joinedAt: 2 }
	],
	invites: [],
	round: null,
	scores: [],
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


describe('round helpers', () => {
	const round = {
		n: 1,
		candidates: ['a', 'b', 'c'].map((slug) => ({ slug, title: slug, owner: 'o', difficulty: null, thumbnailUrl: null })),
		votes: { h: 'a', g: 'a', x: 'zzz' },
		deadline: 5000,
		chosen: null,
		tied: [],
		revealUntil: 0,
		goAt: null,
		race: null
	};

	it('counts votes per candidate, including zeros, ignoring unknown levels', () => {
		expect(voteCounts(round)).toEqual({ a: 2, b: 0, c: 0 });
	});

	it('finds our own player row', () => {
		const s = welcomedAs('g');
		expect(me(s)?.username).toBe('Guest');
		expect(me(initialLobby())).toBeNull();
	});

	it('being removed is final, with its own wording', () => {
		const s = applyServerMessage(welcomedAs('g'), { t: 'removed', reason: 'idle' });
		expect(s.status).toBe('removed');
		expect(s.removedReason).toBe('idle');
		expect(isTerminal(s)).toBe(true);
	});

	it('turns an aborted round into a notice that says why', () => {
		let s = welcomedAs('g');
		s = applyServerMessage(s, { t: 'event', event: { kind: 'roundAborted', reason: 'no_levels' } });
		expect(s.notices.at(-1)?.text).toBe(describeAbort('no_levels'));
		expect(describeAbort('draw_failed')).toMatch(/try again/i);
		expect(describeAbort('at_capacity')).toMatch(/capacity/i);
	});

	it('explains idle and unloaded removals of other players', () => {
		let s = welcomedAs('g');
		s = applyServerMessage(s, { t: 'event', event: { kind: 'left', userId: 'h', username: 'Hosty', reason: 'idle' } });
		s = applyServerMessage(s, { t: 'event', event: { kind: 'left', userId: 'h', username: 'Hosty', reason: 'unloaded' } });
		expect(s.notices.map((n) => n.text)).toEqual([
			'Hosty was removed for not readying up',
			"Hosty was dropped (level didn't load in time)"
		]);
	});
});

function welcomedAs(userId: string) {
	return welcomed(userId, userId === 'g' ? 'Guest' : 'Hosty');
}


describe('race helpers', () => {
	const racer = (over: Partial<RacerView>): RacerView => ({
		userId: 'u',
		username: 'U',
		slot: 0,
		status: 'racing',
		deaths: 0,
		place: null,
		finishMs: null,
		points: null,
		...over
	});

	it('writes places as ordinals', () => {
		expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual([
			'1st',
			'2nd',
			'3rd',
			'4th',
			'11th',
			'12th',
			'13th',
			'21st',
			'22nd'
		]);
	});

	it('formats race times as m:ss.t', () => {
		expect(formatRaceTime(0)).toBe('0:00.0');
		expect(formatRaceTime(34_250)).toBe('0:34.2');
		expect(formatRaceTime(125_900)).toBe('2:05.9');
		expect(formatRaceTime(-5)).toBe('0:00.0');
	});

	it('orders results: finishers by arrival, then the rest by fewest deaths', () => {
		const order = resultsOrder([
			racer({ userId: 'a', slot: 0, status: 'dnf', deaths: 5 }),
			racer({ userId: 'b', slot: 1, status: 'finished', place: 2, finishMs: 9000 }),
			racer({ userId: 'c', slot: 2, status: 'dnf', deaths: 1 }),
			racer({ userId: 'd', slot: 3, status: 'finished', place: 1, finishMs: 8000 })
		]);
		expect(order.map((r) => r.userId)).toEqual(['d', 'b', 'c', 'a']);
	});

	it('announces a finish for everyone, including us', () => {
		let s = welcomed('h', 'Hosty');
		s = applyServerMessage(s, {
			t: 'event',
			event: { kind: 'finished', userId: 'g', username: 'Guest', place: 2, ms: 1 }
		});
		expect(s.notices.at(-1)?.text).toBe('Guest finished 2nd');
	});

	it('does not tell a race position to the reducer: positions bypass state', () => {
		const s = welcomed('h', 'Hosty');
		expect(applyServerMessage(s, { t: 'pos', i: 1, x: 1, y: 2, s: 3 })).toBe(s);
	});
});