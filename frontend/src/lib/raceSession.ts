import { openRoomSocket, type RaceResult, type SocketLike } from './raceApi';
import {
	applyServerMessage,
	initialLobby,
	isTerminal,
	type LobbyState,
	type ServerMessage
} from './raceView';

export interface SessionDeps {
	/** Gets a fresh race ticket (they live 2 minutes, so one per connection). */
	getTicket(): Promise<RaceResult<{ ticket: string }>>;
	openSocket(code: string, ticket: string): SocketLike;
	/** Injectable so tests need no real waiting. */
	setTimer(fn: () => void, ms: number): unknown;
	clearTimer(handle: unknown): void;
	/** Our clock in ms; defaults to Date.now. Injectable for the clock-sync tests. */
	now?(): number;
}

export const defaultDeps = (getTicket: SessionDeps['getTicket']): SessionDeps => ({
	getTicket,
	openSocket: openRoomSocket,
	setTimer: (fn, ms) => setTimeout(fn, ms),
	clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
	now: () => Date.now()
});

/** How many ping/pong samples a clock sync takes, and how far apart. */
export const SYNC_SAMPLES = 6;
export const SYNC_SPACING_MS = 150;

export interface SyncSample {
	rtt: number;
	/** Server clock minus ours. */
	offset: number;
}

/**
 * The offset from the sample with the shortest round trip: that one has
 * the least room for the two directions to have been unequal, so it is the
 * most trustworthy. Null if there are no samples.
 */
export function bestOffset(samples: SyncSample[]): number | null {
	if (samples.length === 0) return null;
	return samples.reduce((best, s) => (s.rtt < best.rtt ? s : best)).offset;
}

/** How long to wait before each reconnect attempt. The server holds a dropped slot for 20 s. */
export const RECONNECT_DELAYS_MS = [500, 1500, 3000, 5000, 8000];

// Close codes from the race server that mean "do not try again".
const NO_RETRY_CODES = new Set([1008, 4000, 4001, 4003, 4005, 4007, 4008]);

/**
 * One person's connection to one room: gets a ticket, opens the socket,
 * folds every server message into a LobbyState, and quietly reconnects if
 * the socket drops (a refresh, a phone going to the background) until the
 * server says it is final.
 */
export class RaceSession {
	state: LobbyState = initialLobby();
	private socket: SocketLike | null = null;
	private attempt = 0;
	private timer: unknown = null;
	private syncTimer: unknown = null;
	private samples: SyncSample[] = [];
	private stopped = false;
	/** Set by the race page: called for every opponent position that arrives. */
	onPosition: ((p: { slot: number; x: number; y: number; state: number }) => void) | null = null;

	constructor(
		private code: string,
		private deps: SessionDeps,
		private onChange: (state: LobbyState) => void
	) {}

	start(): void {
		void this.connect();
	}

	private set(next: LobbyState): void {
		this.state = next;
		this.onChange(next);
	}

	private async connect(): Promise<void> {
		if (this.stopped) return;
		const ticket = await this.deps.getTicket();
		if (this.stopped) return;
		if (!ticket.success || !ticket.data) {
			this.set({
				...this.state,
				status: 'disconnected',
				lastError: ticket.error ?? 'Could not get a race ticket.'
			});
			return;
		}

		const socket = this.deps.openSocket(this.code, ticket.data.ticket);
		this.socket = socket;

		socket.onopen = () => {
			this.attempt = 0;
		};

		socket.onmessage = (ev) => {
			if (this.socket !== socket) return;
			let msg: ServerMessage;
			try {
				msg = JSON.parse(String(ev.data));
			} catch {
				return;
			}
			if (msg.t === 'sync') {
				this.onSync(msg);
				return;
			}
			if (msg.t === 'pos') {
				// Twenty a second per opponent: straight to the game, never through state.
				this.onPosition?.({
					slot: Number(msg.i),
					x: Number(msg.x),
					y: Number(msg.y),
					state: Number(msg.s)
				});
				return;
			}
			const before = this.state.room?.phase;
			const next = applyServerMessage(this.state, msg);
			this.set(next);
			if (msg.t === 'welcome' || (next.room?.phase === 'voting' && before !== 'voting')) {
				// Measure the clock on connecting, and again just before a race
				// starts so the countdown lines up on every screen.
				this.startSync();
			}
		};

		socket.onclose = (ev) => {
			if (this.socket !== socket) return;
			this.socket = null;
			if (this.syncTimer !== null) this.deps.clearTimer(this.syncTimer);
			this.syncTimer = null;
			if (this.stopped || isTerminal(this.state)) return;
			if (NO_RETRY_CODES.has(ev.code)) {
				this.set({ ...this.state, status: 'disconnected' });
				return;
			}
			this.scheduleReconnect();
		};

		socket.onerror = () => {
			// The close event that follows decides what happens next.
		};
	}

	private scheduleReconnect(): void {
		if (this.attempt >= RECONNECT_DELAYS_MS.length) {
			this.set({ ...this.state, status: 'disconnected' });
			return;
		}
		const delay = RECONNECT_DELAYS_MS[this.attempt];
		this.attempt += 1;
		this.set({ ...this.state, status: 'reconnecting' });
		this.timer = this.deps.setTimer(() => {
			this.timer = null;
			void this.connect();
		}, delay);
	}

	/** Sends one action to the room (setMode, invite, ready, vote, ...). */
	send(message: Record<string, unknown>): void {
		this.socket?.send(JSON.stringify(message));
	}

	setReady(ready: boolean): void {
		this.send({ t: 'ready', ready });
	}

	setCategory(category: string): void {
		this.send({ t: 'setCategory', category });
	}

	vote(slug: string): void {
		this.send({ t: 'vote', slug });
	}

	/** Tell the room the winning level has finished loading here. */
	loaded(slug: string): void {
		this.send({ t: 'loaded', slug });
	}

	/** Our position, packed like a ghost sample. Only counts while racing. */
	sendPosition(x: number, y: number, state: number): void {
		this.send({ t: 'pos', x: Math.round(x), y: Math.round(y), s: state });
	}

	/** We reached the goal. */
	finish(): void {
		this.send({ t: 'finish' });
	}

	/** We died (and are respawning). */
	death(): void {
		this.send({ t: 'death' });
	}

	/** Our best guess at the server's clock right now, in ms. */
	serverNow(): number {
		return this.clock() + (this.state.clockOffset ?? 0);
	}

	private clock(): number {
		return this.deps.now ? this.deps.now() : Date.now();
	}

	private startSync(): void {
		if (this.syncTimer !== null) this.deps.clearTimer(this.syncTimer);
		this.syncTimer = null;
		this.samples = [];
		this.sendSync(SYNC_SAMPLES);
	}

	private sendSync(remaining: number): void {
		this.syncTimer = null;
		if (this.stopped || !this.socket || remaining <= 0) return;
		this.send({ t: 'sync', c: this.clock() });
		if (remaining > 1) {
			this.syncTimer = this.deps.setTimer(() => this.sendSync(remaining - 1), SYNC_SPACING_MS);
		}
	}

	private onSync(msg: ServerMessage): void {
		const sent = Number(msg.c);
		const server = Number(msg.s);
		if (!Number.isFinite(sent) || !Number.isFinite(server)) return;
		const received = this.clock();
		const rtt = received - sent;
		if (rtt < 0) return;
		this.samples.push({ rtt, offset: server + rtt / 2 - received });
		this.set({ ...this.state, clockOffset: bestOffset(this.samples) });
	}

	/** The Leave race button: tell the server, then stop for good. */
	leave(): void {
		this.send({ t: 'leave' });
		this.stop('left');
	}

	/** Navigating away: close quietly. The server keeps the slot for its grace period. */
	stop(status: LobbyState['status'] | null = null): void {
		this.stopped = true;
		if (this.timer !== null) this.deps.clearTimer(this.timer);
		this.timer = null;
		if (this.syncTimer !== null) this.deps.clearTimer(this.syncTimer);
		this.syncTimer = null;
		const socket = this.socket;
		this.socket = null;
		if (status) this.set({ ...this.state, status });
		socket?.close(1000, 'bye');
	}
}