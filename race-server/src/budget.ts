// The daily request budget, pure and clock-free like room.ts.

import { DAILY_QUOTA, RESERVATION_TTL_MS, SOFT_LIMIT_FRACTION, raceCost, type GameMode } from "./config";

export interface BudgetState {
  day: string; // UTC date, e.g. "2026-10-09"
  used: number; // request units counted so far today
  races: number; // races started today
  reservations: Record<string, { cost: number; at: number }>;
}

export const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);

/** The next 00:00 UTC (when Cloudflare resets the free quota). */
export const nextReset = (now: number) => Date.parse(`${dayKey(now)}T00:00:00Z`) + 24 * 3600 * 1000;

export class Budget {
  constructor(
    public state: BudgetState,
    private quota = DAILY_QUOTA,
    private softFraction = SOFT_LIMIT_FRACTION,
  ) {}

  static fresh(now: number): Budget {
    return new Budget({ day: dayKey(now), used: 0, races: 0, reservations: {} });
  }

  get softLimit(): number {
    return Math.floor(this.quota * this.softFraction);
  }

  private roll(now: number): void {
    if (this.state.day !== dayKey(now)) {
      this.state = { day: dayKey(now), used: 0, races: 0, reservations: {} };
    }
    for (const [id, r] of Object.entries(this.state.reservations)) {
      if (now - r.at >= RESERVATION_TTL_MS) delete this.state.reservations[id];
    }
  }

  private reserved(): number {
    return Object.values(this.state.reservations).reduce((sum, r) => sum + r.cost, 0);
  }

  addUsage(units: number, now: number): void {
    this.roll(now);
    if (Number.isFinite(units) && units > 0) this.state.used += Math.ceil(units);
  }

  /** Can another race of this mode start right now? */
  canStart(mode: GameMode, now: number): boolean {
    this.roll(now);
    return this.state.used + this.reserved() + raceCost(mode) <= this.softLimit;
  }

  /** Reserve room for a race. Races already running are never touched. */
  tryReserve(id: string, mode: GameMode, now: number): boolean {
    if (!this.canStart(mode, now)) return false;
    this.state.reservations[id] = { cost: raceCost(mode), at: now };
    this.state.races += 1;
    return true;
  }

  release(id: string, now: number): void {
    this.roll(now);
    delete this.state.reservations[id];
  }

  status(now: number) {
    this.roll(now);
    const cost = raceCost("ghost");
    const room = this.softLimit - this.state.used - this.reserved();
    const left = Math.max(0, Math.floor(room / cost));
    return {
      racesToday: this.state.races,
      racesLeftEstimate: left,
      racesPerDayEstimate: Math.floor(this.softLimit / cost),
      usedUnits: this.state.used,
      softLimit: this.softLimit,
      quota: this.quota,
      atCapacity: left === 0,
      resetsAt: new Date(nextReset(now)).toISOString(),
    };
  }
}