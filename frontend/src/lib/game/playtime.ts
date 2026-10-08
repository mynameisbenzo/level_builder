/**
 * The browser half of "total playtime": a clock that counts the time the
 * player is really playing a level, which the play page reports to the
 * server in small chunks (a heartbeat about every 5 seconds - see
 * backend/app/services/playtime.py, which keeps the running total and
 * never trusts the number it is sent).
 *
 * Pure and Phaser-free, so it can be unit tested directly. The scene calls
 * advance() once per frame it is updating normally - which is exactly when
 * the player can move: update() returns early while they are dying or have
 * won, and Phaser stops calling it while the tab is hidden.
 */

/** About how often the play page reports the unsent time. */
export const PLAYTIME_HEARTBEAT_INTERVAL_MS = 5000;

/**
 * The most one frame can add. A frame is normally ~16ms; a much longer one
 * is the game catching up after the tab was in the background, which is
 * not time spent playing.
 */
export const PLAYTIME_MAX_FRAME_MS = 100;

export class PlaytimeClock {
	private hasControl = false;
	private unsentMs = 0;

	/**
	 * Called on every (re)start of the level: the clock then waits for the
	 * player's first control again, so a respawn screen left sitting there
	 * doesn't count. Time already counted but not yet sent is kept.
	 */
	resetControl(): void {
		this.hasControl = false;
	}

	/**
	 * Advances the clock by one frame. Nothing counts until the player has
	 * given their first control (a direction, a jump, a duck or a dash);
	 * from then on every frame counts.
	 */
	advance(deltaMs: number, controlHeld: boolean): void {
		if (!this.hasControl && controlHeld) {
			this.hasControl = true;
		}
		if (!this.hasControl) {
			return;
		}
		this.unsentMs += Math.min(Math.max(deltaMs, 0), PLAYTIME_MAX_FRAME_MS);
	}

	/** Whole milliseconds counted but not yet reported. */
	get pendingMs(): number {
		return Math.floor(this.unsentMs);
	}

	/** Hands over the unsent time to report, and starts counting it afresh. */
	take(): number {
		const ms = Math.floor(this.unsentMs);
		this.unsentMs -= ms;
		return ms;
	}

	/** A report failed: put its time back so the next one carries it. */
	giveBack(ms: number): void {
		this.unsentMs += Math.max(ms, 0);
	}
}