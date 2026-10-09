import { describe, expect, it } from 'vitest';
import { RaceSession, RECONNECT_DELAYS_MS, type SessionDeps } from './raceSession';
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
	const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
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
			timers.push(t);
			return t;
		},
		clearTimer: (h) => {
			(h as { cleared: boolean }).cleared = true;
		}
	};
	const states: LobbyState[] = [];
	const session = new RaceSession('ABC234', deps, (s) => states.push(s));
	return { session, sockets, timers, tickets, states };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const welcome = {
	t: 'welcome',
	you: { userId: 'g', username: 'Guest' },
	room: { code: 'ABC234', joinMode: 'public', phase: 'lobby', maxPlayers: 4, hostId: 'h', closing: false, players: [], invites: [] }
};

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
		expect(h.sockets[0].sent.map((s) => JSON.parse(s))).toEqual([{ t: 'invite', username: 'bob' }, { t: 'leave' }]);
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
});