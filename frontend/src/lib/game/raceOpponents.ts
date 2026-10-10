import { GHOST_SAMPLE_INTERVAL_MS } from './ghost';

/**
 * The Phaser-free half of live racing: the registry keys and events the
 * scene and the race page agree on, and the buffer that turns the other
 * racers' 20 Hz position messages into smooth movement.
 */

/** Registry: true in a live race (set by createGameConfig's `race` option). */
export const RACE_MODE_KEY = 'raceMode';
/** Registry: true until GO. The scene freezes the player and the enemies while it is set. */
export const RACE_LOCKED_KEY = 'raceLocked';
/** Registry: the OpponentBuffer the page fills and the scene draws from. */
export const RACE_OPPONENTS_KEY = 'raceOpponents';
/** Registry: who is in the race (RosterEntry[]), kept up to date by the page. */
export const RACE_ROSTER_KEY = 'raceRoster';

/** Emitted once, on the scene's first frame: the level is on screen and playable. */
export const RACE_READY_EVENT = 'race-ready';
/** Emitted the instant the player reaches the goal (before any result animation). */
export const RACE_FINISHED_EVENT = 'race-finished';

export interface RosterEntry {
	slot: number;
	username: string;
	status: 'racing' | 'finished' | 'dnf';
}

/** The tint each slot's opponent is drawn in. */
// Lighter than the HUD colours below: a tint multiplies the sprite's own colours,
// so the strong ones would turn every character dark.
export const SLOT_TINTS = [0xff9a9a, 0x8ae0ff, 0xffe580, 0xd2b8ff] as const;
export const SLOT_CSS = ['#ff6b6b', '#4ecbff', '#ffd23f', '#b48cff'] as const;

/** Opponents are drawn this far behind real time, so there is always a next sample to move towards. */
export const INTERP_DELAY_MS = 120;
/** A jump bigger than this between two samples is a respawn: snap instead of gliding across the level. */
export const SNAP_DISTANCE_PX = 250;
/** Samples kept per opponent. */
const MAX_SAMPLES = 40;

/** How often a racer's position is sent. Matches the ghost sample interval. */
export const POSITION_SEND_MS = GHOST_SAMPLE_INTERVAL_MS;

export interface OpponentSample {
	at: number;
	x: number;
	y: number;
	state: number;
}

export interface OpponentPose {
	x: number;
	y: number;
	state: number;
}

/**
 * Where to draw an opponent at time `t`, from its samples (oldest first).
 * Before the first sample it waits there, after the last it holds; between
 * two it glides, except across a respawn jump, where it stays put until
 * the later sample's time and then snaps.
 */
export function interpolateSamples(samples: OpponentSample[], t: number): OpponentPose | null {
	if (samples.length === 0) return null;
	const first = samples[0];
	const last = samples[samples.length - 1];
	if (t <= first.at) return { x: first.x, y: first.y, state: first.state };
	if (t >= last.at) return { x: last.x, y: last.y, state: last.state };

	let i = 1;
	while (samples[i].at < t) i += 1;
	const a = samples[i - 1];
	const b = samples[i];
	if (Math.hypot(b.x - a.x, b.y - a.y) > SNAP_DISTANCE_PX) {
		return { x: a.x, y: a.y, state: a.state };
	}
	const span = b.at - a.at;
	const f = span <= 0 ? 1 : (t - a.at) / span;
	return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, state: f < 0.5 ? a.state : b.state };
}

export class OpponentBuffer {
	private tracks = new Map<number, OpponentSample[]>();

	/** `at` is when the message arrived, on our own clock. */
	push(slot: number, x: number, y: number, state: number, at: number): void {
		let track = this.tracks.get(slot);
		if (!track) {
			track = [];
			this.tracks.set(slot, track);
		}
		// Out-of-order arrival (rare) just gets dropped.
		if (track.length > 0 && at < track[track.length - 1].at) return;
		track.push({ at, x, y, state });
		if (track.length > MAX_SAMPLES) track.splice(0, track.length - MAX_SAMPLES);
	}

	/** The opponent's pose for drawing at our-clock time `now`, or null if nothing has arrived. */
	sample(slot: number, now: number): OpponentPose | null {
		const track = this.tracks.get(slot);
		return track ? interpolateSamples(track, now - INTERP_DELAY_MS) : null;
	}

	clear(): void {
		this.tracks.clear();
	}
}