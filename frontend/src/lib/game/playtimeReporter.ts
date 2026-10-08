/**
 * Sends a player's playtime to the server for a page that tears its game
 * down between attempts (endless mode boots a brand-new game after every
 * death, so unlike /play it can't hand unsent time back to a scene).
 *
 * Everything goes out one request at a time, in order, so a win is always
 * the last word after the heartbeats that came before it. Time that could
 * not be delivered (offline, logged out) is carried per level and added to
 * the next report for that same level - nothing a player really played is
 * dropped just because a request failed.
 */

export interface PlaytimeTransport {
	/** Reports playtime; resolves to whether the server took it. */
	heartbeat(slug: string, elapsedMs: number): Promise<boolean>;
	/** Reports the final stretch with a win; null means the request could not be made. */
	win(slug: string, elapsedMs: number): Promise<WinReport | null>;
}

export interface WinReport {
	success: boolean;
	totalMs?: number;
	isRecord?: boolean;
}

export class PlaytimeReporter {
	private chain: Promise<unknown> = Promise.resolve();
	private carried = new Map<string, number>();

	constructor(private transport: PlaytimeTransport) {}

	/** Unsent time held back for a level because an earlier report failed. */
	carriedMs(slug: string): number {
		return this.carried.get(slug) ?? 0;
	}

	/** Reports playtime for a level. Never throws. */
	report(slug: string, elapsedMs: number): Promise<void> {
		return this.enqueue(async () => {
			const total = Math.max(0, Math.floor(elapsedMs)) + this.carriedMs(slug);
			if (total <= 0) return;
			const delivered = await this.transport.heartbeat(slug, total).catch(() => false);
			this.settle(slug, total, delivered);
		});
	}

	/** Reports the last stretch with a win. Resolves to the server's answer, or null if it never got one. */
	win(slug: string, elapsedMs: number): Promise<WinReport | null> {
		return this.enqueue(async () => {
			const total = Math.max(0, Math.floor(elapsedMs)) + this.carriedMs(slug);
			const result = await this.transport.win(slug, total).catch(() => null);
			this.settle(slug, total, result?.success === true);
			return result;
		});
	}

	/** Resolves once everything reported so far has been sent. */
	idle(): Promise<void> {
		return this.enqueue(async () => undefined);
	}

	private settle(slug: string, total: number, delivered: boolean) {
		if (delivered) {
			this.carried.delete(slug);
		} else if (total > 0) {
			this.carried.set(slug, total);
		}
	}

	private enqueue<T>(job: () => Promise<T>): Promise<T> {
		const next = this.chain.then(job, job);
		this.chain = next.catch(() => undefined);
		return next;
	}
}