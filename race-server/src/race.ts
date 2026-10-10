// The race itself, with no I/O and no clock: who is still running, who
// finished in what order, how many times each player died, and when the
// race is over. room.ts owns one of these while the phase is "racing" and
// keeps it for the results screen.

import { AFTER_FIRST_FINISH_MS, POINTS, RACE_CAP_MS } from "./config";

export type RacerStatus = "racing" | "finished" | "dnf";

export interface Racer {
  userId: string;
  username: string;
  /** 0-3: which colour the others see this player as. */
  slot: number;
  status: RacerStatus;
  deaths: number;
  /** Arrival order among finishers (1 = first), or null. */
  place: number | null;
  /** Server-measured time from the start to arriving, or null. */
  finishMs: number | null;
  /** Filled in when the race ends. */
  points: number | null;
}

export interface RaceState {
  /** The server time of GO. */
  startedAt: number;
  firstFinishAt: number | null;
  racers: Racer[];
}

export function newRace(players: { userId: string; username: string }[], startedAt: number): RaceState {
  return {
    startedAt,
    firstFinishAt: null,
    racers: players.map((p, slot) => ({
      userId: p.userId,
      username: p.username,
      slot,
      status: "racing",
      deaths: 0,
      place: null,
      finishMs: null,
      points: null,
    })),
  };
}

export function racerOf(race: RaceState, userId: string): Racer | undefined {
  return race.racers.find((r) => r.userId === userId);
}

/** The first finish message to reach the server takes the next place. */
export function recordFinish(race: RaceState, userId: string, now: number): Racer | null {
  const racer = racerOf(race, userId);
  if (!racer || racer.status !== "racing") return null;
  racer.status = "finished";
  racer.place = race.racers.filter((r) => r.status === "finished").length;
  racer.finishMs = Math.max(0, now - race.startedAt);
  if (race.firstFinishAt === null) race.firstFinishAt = now;
  return racer;
}

export function recordDeath(race: RaceState, userId: string): Racer | null {
  const racer = racerOf(race, userId);
  if (!racer || racer.status !== "racing") return null;
  racer.deaths += 1;
  return racer;
}

/** A racer who left (or was kicked) mid-race did not finish. */
export function dropRacer(race: RaceState, userId: string): void {
  const racer = racerOf(race, userId);
  if (racer && racer.status === "racing") racer.status = "dnf";
}

/** When the race ends at the latest, given what has happened so far. */
export function raceDeadline(race: RaceState): number {
  const cap = race.startedAt + RACE_CAP_MS;
  return race.firstFinishAt === null ? cap : Math.min(cap, race.firstFinishAt + AFTER_FIRST_FINISH_MS);
}

export function raceOver(race: RaceState, now: number): boolean {
  return race.racers.every((r) => r.status !== "racing") || now >= raceDeadline(race);
}

export function pointsFor(place: number | null): number {
  return place === null ? 0 : (POINTS[place - 1] ?? 0);
}

/** Ends the race: anyone still running is a DNF, and everyone gets their points. */
export function finalizeRace(race: RaceState): void {
  for (const r of race.racers) {
    if (r.status === "racing") r.status = "dnf";
    r.points = pointsFor(r.status === "finished" ? r.place : null);
  }
}