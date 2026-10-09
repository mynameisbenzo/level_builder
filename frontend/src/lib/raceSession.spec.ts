import { describe, expect, it } from 'vitest';
import {
	bestOffset,
	RaceSession,
	RECONNECT_DELAYS_MS,
	SYNC_SAMPLES,
	SYNC_SPACING_MS,
	type SessionDeps
} from './raceSession';
import type { SocketLike } from './raceApi';
import type { LobbyState } from './raceView';

class FakeSocket implements SocketLike {
	sent: string[] = [];
	closedWith: { code?: number; reason?: string } | null = null;
	onopen: SocketLike['onopen'] = null;
	onmessage: SocketLike['onmessage'] = null;
	onclose: SocketLike['onclose'] = null;
	onerror: SocketLike['onerror'] = null;
	send(data: string) {
		this.sent.push(data);
	}
	close(code?: number, reason?: string) {
		this.closedWith = { code, reason };
	}
	say(msg: object) {
		this.onmessage?.({ data: JSON.stringify(msg) });
	}
	drop(code = 1006) {
		this.onclose?.({ code, reason: '' });
	}
}

function harness(ticketOk = true) {
	const sockets: FakeSocket[] = [];
	// `timers` holds reconnect timers only; clock-sync timers (spaced SYNC_SPACING_MS) go in `syncTimers`.
	const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
	const syncTimers: { fn: () => void; ms: number; cleared: boolean }[] = [];
	const clock = { now: 10_000 };
	const tickets: string[] = [];
	const deps: SessionDeps = {
		getTicket: async () => {
			tickets.push('t');
			return ticketOk ? { success: true, data: { ticket: `ticket-${tickets.length}` } } : { success: false, error: 'nope' };
		},
		openSocket: () => {
			const s = new FakeSocket();
			sockets.push(s);
			return s;
		},
		setTimer: (fn, ms) => {
			const t = { fn, ms, cleared: false };
			(ms === SYNC_SPACING_MS ? syncTimers : timers).push(t);
			return t;
		},
		now: () => clock.now,
		clearTimer: (h) => {
			(h as { cleared: boolean }).cleared = true;
		}
	};
	const states: LobbyState[] = [];
	const session = new RaceSession('ABC234', deps, (s) => states.push(s));
	return { session, sockets, timers, syncTimers, clock, tickets, states };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const welcome = {
	t: 'welcome',
	you: { userId: 'g', username: 'Guest' },
	room: { code: 'ABC234', joinMode: 'public', phase: 'lobby', maxPlayers: 4, hostId: 'h', closing: false, players: [], invites: [], category: 'any', serverNow: 0, round: null }
};

const sentMessages = (socket: FakeSocket) =>
	socket.sent.map((s) => JSON.parse(s) as { t: string }).filter((m) => m.t !== 'sync');

describe('RaceSession', () => {
	it('gets a ticket, connects and folds messages into state', async () => {
		const h = harness();
		h.session.start();
		await flush();
		expect(h.sockets).toHaveLength(1);
		h.sockets[0].say(welcome);
		expect(h.session.state.status).toBe('in');
	});

	it('reports a failed ticket without opening a socket', async () => {
		const h = harness(false);
		h.session.start();
		await flush();
		expect(h.sockets).toHaveLength(0);
		expect(h.session.state.status).toBe('disconnected');
		expect(h.session.state.lastError).toBe('nope');
	});

	it('reconnects with a fresh ticket after an unexpected drop', async () => {
		const h = harness();
		h.session.start();
		await flush();
		h.sockets[0].say(welcome);
		h.sockets[0].drop();
		expect(h.session.state.status).toBe('reconnecting');
		expect(h.timers[0].ms).toBe(RECONNECT_DELAYS_MS[0]);
		h.timers[0].fn();
		await flush();
		expect(h.sockets).toHaveLength(2);
		expect(h.tickets).toHaveLength(2);
		h.sockets[1].say(welcome);
		expect(h.session.state.status).toBe('in');
	});

	it('backs off, then gives up after the last delay', async () => {
		const h = harness();
		h.session.start();
		await flush();
		for (let i = 0; i < RECONNECT_DELAYS_MS.length; i++) {
			h.sockets.at(-1)!.drop();
			expect(h.timers.at(-1)!.ms).toBe(RECONNECT_DELAYS_MS[i]);
			h.timers.at(-1)!.fn();
			await flush();
		}
		h.sockets.at(-1)!.drop();
		expect(h.session.state.status).toBe('disconnected');
	});

	it('a good connection resets the backoff', async () => {
		const h = harness();
		h.session.start();
		await flush();
		h.sockets[0].drop();
		h.timers[0].fn();
		await flush();
		h.sockets[1].onopen?.({});
		h.sockets[1].drop();
		expect(h.timers[1].ms).toBe(RECONNECT_DELAYS_MS[0]);
	});

	it('does not reconnect after being kicked, denied, closed or replaced', async () => {
		for (const [msg, code] of [
			[{ t: 'kicked' }, 4003],
			[{ t: 'denied', code: 'full' }, 4005],
			[{ t: 'closed', reason: 'expired' }, 4007],
			[{ t: 'replaced' }, 4000]
		] as const) {
			const h = harness();
			h.session.start();
			await flush();
			h.sockets[0].say(msg);
			h.sockets[0].drop(code);
			expect(h.timers).toHaveLength(0);
			expect(h.sockets).toHaveLength(1);
		}
	});

	it('does not retry when the server cut us off for flooding', async () => {
		const h = harness();
		h.session.start();
		await flush();
		h.sockets[0].say(welcome);
		h.sockets[0].drop(1008);
		expect(h.timers).toHaveLength(0);
		expect(h.session.state.status).toBe('disconnected');
	});

	it('sends actions as JSON and leave() says goodbye then stops for good', async () => {
		const h = harness();
		h.session.start();
		await flush();
		h.sockets[0].say(welcome);
		h.session.send({ t: 'invite', username: 'bob' });
		h.session.leave();
		expect(sentMessages(h.sockets[0])).toEqual([{ t: 'invite', username: 'bob' }, { t: 'leave' }]);
		expect(h.sockets[0].closedWith?.code).toBe(1000);
		expect(h.session.state.status).toBe('left');
		h.sockets[0].drop(1000);
		expect(h.timers).toHaveLength(0);
	});

	it('stop() cancels a pending reconnect', async () => {
		const h = harness();
		h.session.start();
		await flush();
		h.sockets[0].drop();
		h.session.stop();
		expect(h.timers[0].cleared).toBe(true);
	});

	it('ignores late messages from a socket it already replaced', async () => {
		const h = harness();
		h.session.start();
		await flush();
		const old = h.sockets[0];
		old.drop();
		h.timers[0].fn();
		await flush();
		old.say({ t: 'kicked' });
		expect(h.session.state.status).not.toBe('kicked');
	});

	it('sends the room actions as the right messages', async () => {
		const h = harness();
		h.session.start();
		await flush();
		h.sockets[0].say(welcome);
		h.session.setReady(true);
		h.session.setCategory('hard');
		h.session.vote('lvl-1');
		h.session.loaded('lvl-1');
		expect(sentMessages(h.sockets[0])).toEqual([
			{ t: 'ready', ready: true },
			{ t: 'setCategory', category: 'hard' },
			{ t: 'vote', slug: 'lvl-1' },
			{ t: 'loaded', slug: 'lvl-1' }
		]);
	});
});

describe('clock sync', () => {
	it('bestOffset takes the sample with the shortest round trip', () => {
		expect(bestOffset([])).toBeNull();
		expect(
			bestOffset([
				{ rtt: 80, offset: 500 },
				{ rtt: 20, offset: 442 },
				{ rtt: 50, offset: 470 }
			])
		).toBe(442);
	});

	it('measures on welcome: a burst of pings, one per spacing', async () => {
		const h = harness();
		h.session.start();
		await flush();
		h.sockets[0].say(welcome);
		const pings = () => h.sockets[0].sent.filter((s) => JSON.parse(s).t === 'sync').length;
		expect(pings()).toBe(1);
		for (let i = 1; i < SYNC_SAMPLES; i++) h.syncTimers.at(-1)!.fn();
		expect(pings()).toBe(SYNC_SAMPLES);
		expect(h.syncTimers.at(-1)!.fn).toBeDefined();
	});

	it('works out the server clock offset from the replies', async () => {
		const h = harness();
		h.session.start();
		await flush();
		h.sockets[0].say(welcome);
		// We sent at 10_000; the reply comes 40 ms later; the server's clock said 75_020
		// at the midpoint, so server = ours + 65_000.
		const sent = JSON.parse(h.sockets[0].sent[0]) as { c: number };
		h.clock.now = 10_040;
		h.sockets[0].say({ t: 'sync', c: sent.c, s: 75_020 });
		expect(h.session.state.clockOffset).toBe(75_020 + 20 - 10_040);
		expect(h.session.serverNow()).toBe(10_040 + (75_020 + 20 - 10_040));
	});

	it('keeps the offset from the fastest reply, not the latest', async () => {
		const h = harness();
		h.session.start();
		await flush();
		h.sockets[0].say(welcome);
		h.clock.now = 10_200; // a slow round trip: 200 ms
		h.sockets[0].say({ t: 'sync', c: 10_000, s: 50_000 });
		const slowOffset = h.session.state.clockOffset;
		h.clock.now = 10_410; // a fast one: 10 ms
		h.sockets[0].say({ t: 'sync', c: 10_400, s: 20_405 });
		expect(h.session.state.clockOffset).toBe(20_405 + 5 - 10_410);
		expect(h.session.state.clockOffset).not.toBe(slowOffset);
	});

	it('ignores nonsense replies', async () => {
		const h = harness();
		h.session.start();
		await flush();
		h.sockets[0].say(welcome);
		h.sockets[0].say({ t: 'sync', c: 'x', s: 1 });
		h.sockets[0].say({ t: 'sync', c: 99_999_999, s: 1 }); // from the future: negative round trip
		expect(h.session.state.clockOffset).toBeNull();
	});

	it('measures again when a vote begins', async () => {
		const h = harness();
		h.session.start();
		await flush();
		h.sockets[0].say(welcome);
		const pings = () => h.sockets[0].sent.filter((s) => JSON.parse(s).t === 'sync').length;
		const before = pings();
		h.sockets[0].say({ t: 'roomState', room: { ...welcome.room, phase: 'voting' } });
		expect(pings()).toBe(before + 1);
		h.sockets[0].say({ t: 'roomState', room: { ...welcome.room, phase: 'voting' } });
		expect(pings()).toBe(before + 1); // no re-measure for the same phase
	});

	it('stops measuring when the socket drops', async () => {
		const h = harness();
		h.session.start();
		await flush();
		h.sockets[0].say(welcome);
		h.sockets[0].drop();
		expect(h.syncTimers.at(-1)!.cleared).toBe(true);
	});
});