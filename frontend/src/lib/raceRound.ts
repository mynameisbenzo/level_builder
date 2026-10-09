// The parts of a race round the screen needs worked out: what to show during
// the countdown, how the tie-break spin plays, how long until an idle
// player is removed. Pure functions of server-clock times, so they are
// unit-tested and the Svelte component only draws their answers.

/** What the countdown overlay shows, given the time left until go (ms). */
export type CountdownFace = null | 3 | 2 | 1 | 'go';

/** How long the tie-break spin plays; matches SPIN_MS in race-server/src/config.ts. */
export const SPIN_MS = 3500;

/** How long "GO!" stays on screen after the start. */
export const GO_SHOW_MS = 900;

export function countdownFace(msUntilGo: number): CountdownFace {
	if (msUntilGo > 3000) return null; // the 800 ms margin: "get ready"
	if (msUntilGo > 2000) return 3;
	if (msUntilGo > 1000) return 2;
	if (msUntilGo > 0) return 1;
	if (msUntilGo > -GO_SHOW_MS) return 'go';
	return null;
}

export interface SpinFrame {
	/** ms after the spin began that this level lights up. */
	at: number;
	slug: string;
}

/**
 * The highlight's journey over the tied levels: quick at first, slowing
 * down, and landing on `chosen` as the very last frame, a little before
 * `durationMs` is up. Deterministic, so every client draws the same spin.
 */
export function spinFrames(tied: string[], chosen: string, durationMs: number): SpinFrame[] {
	if (tied.length === 0) return [];
	const chosenIndex = Math.max(0, tied.indexOf(chosen));
	if (tied.length === 1) return [{ at: 0, slug: tied[0] }];

	const times: number[] = [];
	let t = 0;
	let gap = 70;
	const stop = durationMs - 350;
	while (t <= stop) {
		times.push(t);
		t += gap;
		gap = Math.round(gap * 1.16);
	}
	const last = times.length - 1;
	return times.map((at, i) => ({
		at,
		// Count back from the final frame so the last one is `chosen`.
		slug: tied[(((chosenIndex - (last - i)) % tied.length) + tied.length) % tied.length]
	}));
}

/** The level lit up `elapsedMs` into the spin, or the final one once it's over. */
export function spinSlugAt(frames: SpinFrame[], elapsedMs: number): string | null {
	if (frames.length === 0) return null;
	let current = frames[0].slug;
	for (const f of frames) {
		if (f.at <= elapsedMs) current = f.slug;
		else break;
	}
	return current;
}

/** Whole seconds until a server-time deadline, never negative; null if there is none. */
export function secondsLeft(deadline: number | null, serverNow: number): number | null {
	if (deadline === null) return null;
	return Math.max(0, Math.ceil((deadline - serverNow) / 1000));
}