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
}

export const defaultDeps = (getTicket: SessionDeps['getTicket']): SessionDeps => ({
	getTicket,
	openSocket: openRoomSocket,
	setTimer: (fn, ms) => setTimeout(fn, ms),
	clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
});

/** How long to wait before each reconnect attempt. The server holds a dropped slot for 20 s. */
export const RECONNECT_DELAYS_MS = [500, 1500, 3000, 5000, 8000];

// Close codes from the race server that mean "do not try again".
const NO_RETRY_CODES = new Set([1008, 4000, 4001, 4003, 4005, 4007]);

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
	private stopped = false;

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
			this.set(applyServerMessage(this.state, msg));
		};

		socket.onclose = (ev) => {
			if (this.socket !== socket) return;
			this.socket = null;
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

	/** Sends one action to the room (setMode, invite, uninvite, kick, closeRoom). */
	send(message: Record<string, unknown>): void {
		this.socket?.send(JSON.stringify(message));
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
		const socket = this.socket;
		this.socket = null;
		if (status) this.set({ ...this.state, status });
		socket?.close(1000, 'bye');
	}
}