import { describe, expect, it } from "vitest";
import { AFTER_FIRST_FINISH_MS, POINTS, RACE_CAP_MS, RESULTS_MS } from "../src/config";
import {
  dropRacer,
  finalizeRace,
  newRace,
  pointsFor,
  raceDeadline,
  raceOver,
  recordDeath,
  recordFinish,
} from "../src/race";
import { RoomLogic, type Candidate, type Who } from "../src/room";

const people = ["a", "b", "c"].map((id) => ({ userId: id, username: id.toUpperCase() }));

describe("race module", () => {
  it("places finishers by arrival and measures time from the start", () => {
    const race = newRace(people, 1000);
    expect(recordFinish(race, "b", 6000)?.place).toBe(1);
    expect(recordFinish(race, "a", 7000)?.place).toBe(2);
    expect(race.racers.find((r) => r.userId === "b")?.finishMs).toBe(5000);
    expect(race.firstFinishAt).toBe(6000);
  });

  it("ignores a second finish and finishes by someone who already dropped", () => {
    const race = newRace(people, 0);
    recordFinish(race, "a", 10);
    expect(recordFinish(race, "a", 20)).toBeNull();
    dropRacer(race, "b");
    expect(recordFinish(race, "b", 30)).toBeNull();
    expect(recordFinish(race, "nobody", 30)).toBeNull();
  });

  it("counts deaths while racing and stops once someone has finished", () => {
    const race = newRace(people, 0);
    recordDeath(race, "a");
    recordDeath(race, "a");
    recordFinish(race, "a", 5);
    expect(recordDeath(race, "a")).toBeNull();
    expect(race.racers[0].deaths).toBe(2);
  });

  it("the deadline is 30 s after the first finish but never past the 2-minute cap", () => {
    const race = newRace(people, 0);
    expect(raceDeadline(race)).toBe(RACE_CAP_MS);
    recordFinish(race, "a", 10_000);
    expect(raceDeadline(race)).toBe(10_000 + AFTER_FIRST_FINISH_MS);
    const late = newRace(people, 0);
    recordFinish(late, "a", RACE_CAP_MS - 5_000);
    expect(raceDeadline(late)).toBe(RACE_CAP_MS);
  });

  it("is over when nobody is still running, or at the deadline", () => {
    const race = newRace(people, 0);
    expect(raceOver(race, 1000)).toBe(false);
    expect(raceOver(race, RACE_CAP_MS)).toBe(true);
    for (const p of people) recordFinish(race, p.userId, 100);
    expect(raceOver(race, 101)).toBe(true);
  });

  it("scores 4/3/2/1 by place and 0 for a DNF", () => {
    expect(POINTS).toEqual([4, 3, 2, 1]);
    expect([1, 2, 3, 4].map(pointsFor)).toEqual([4, 3, 2, 1]);
    expect(pointsFor(null)).toBe(0);
    const race = newRace(people, 0);
    recordFinish(race, "c", 1);
    finalizeRace(race);
    expect(race.racers.map((r) => [r.userId, r.status, r.points])).toEqual([
      ["a", "dnf", 0],
      ["b", "dnf", 0],
      ["c", "finished", 4],
    ]);
  });
});

// ---- inside a room ------------------------------------------------------
const T0 = 1_000_000;
const host: Who = { userId: "h", username: "Hosty", paid: true };
const p2: Who = { userId: "p2", username: "Two", paid: false };
const p3: Who = { userId: "p3", username: "Three", paid: false };
const cand = (slug: string): Candidate => ({ slug, title: slug, owner: "o", difficulty: null, thumbnailUrl: null });

/** A room whose race has just started (GO has passed). */
function racing(who: Who[] = [host, p2, p3]) {
  const r = RoomLogic.create("ABC234", host, T0, () => 0);
  r.setMode("h", "public", T0);
  for (const w of who) r.join(w, T0);
  for (const m of r.state.members) r.setReady(m.userId, true, T0 + 1);
  r.finishDraw([cand("a")], T0 + 2); // one candidate: straight to loading
  const t = T0 + 5_000;
  for (const m of r.state.members) r.loaded(m.userId, "a", t);
  const goAt = r.state.round!.goAt!;
  r.tick(goAt);
  expect(r.state.phase).toBe("racing");
  return { r, goAt };
}

describe("a race in a room", () => {
  it("gives each player a slot in join order", () => {
    const { r } = racing();
    expect(r.racingSlot("h")).toBe(0);
    expect(r.racingSlot("p2")).toBe(1);
    expect(r.racingSlot("p3")).toBe(2);
    expect(r.racingSlot("stranger")).toBeNull();
  });

  it("only relays positions while racing, and stops for someone who finished", () => {
    const { r, goAt } = racing();
    r.finish("p2", goAt + 1000);
    expect(r.racingSlot("p2")).toBeNull();
    expect(r.racingSlot("h")).toBe(0);
  });

  it("first finish starts a 30 s clock; the others are DNF when it runs out", () => {
    const { r, goAt } = racing();
    const events = r.finish("p2", goAt + 5000);
    expect(events.ok && events.events).toContainEqual({
      kind: "finished",
      userId: "p2",
      username: "Two",
      place: 1,
      ms: 5000,
    });
    expect(r.nextWake()).toBe(goAt + 5000 + AFTER_FIRST_FINISH_MS);
    r.tick(goAt + 5000 + AFTER_FIRST_FINISH_MS);
    expect(r.state.phase).toBe("results");
    const racers = r.state.round!.race!.racers;
    expect(racers.map((x) => [x.userId, x.status, x.points])).toEqual([
      ["h", "dnf", 0],
      ["p2", "finished", 4],
      ["p3", "dnf", 0],
    ]);
  });

  it("ends as soon as everyone has finished or dropped, and awards points by arrival", () => {
    const { r, goAt } = racing();
    r.finish("p3", goAt + 4000);
    r.finish("h", goAt + 6000);
    expect(r.state.phase).toBe("racing");
    r.leave("p2", goAt + 7000);
    expect(r.state.phase).toBe("results");
    const snap = r.snapshot(goAt + 7000);
    expect(snap.scores.map((s) => [s.userId, s.points, s.wins, s.races])).toEqual([
      ["p3", 4, 1, 1],
      ["h", 3, 0, 1],
      ["p2", 0, 0, 1],
    ]);
  });

  it("deaths are counted but never knock anyone out", () => {
    const { r, goAt } = racing();
    r.death("h", goAt + 1000);
    r.death("h", goAt + 2000);
    expect(r.state.round!.race!.racers[0]).toMatchObject({ deaths: 2, status: "racing" });
    expect(r.racingSlot("h")).toBe(0);
  });

  it("a stale finish or death (before or after the race) is ignored, not an error", () => {
    const { r, goAt } = racing();
    r.finish("h", goAt + 1000);
    expect(r.finish("h", goAt + 1100).ok).toBe(true);
    expect(r.state.round!.race!.racers[0].place).toBe(1);
    r.tick(goAt + RACE_CAP_MS);
    expect(r.state.phase).toBe("results");
    expect(r.death("p2", goAt + RACE_CAP_MS + 5).ok).toBe(true);
    expect(r.state.round!.race!.racers[1].deaths).toBe(0);
  });

  it("a kicked racer is a DNF", () => {
    const { r, goAt } = racing();
    r.kick("h", "p3", goAt + 1000);
    expect(r.state.round!.race!.racers[2].status).toBe("dnf");
  });

  it("the 2-minute cap ends a race nobody finishes, and the total carries to the next race", () => {
    const { r, goAt } = racing([host, p2]);
    r.tick(goAt + RACE_CAP_MS);
    expect(r.state.phase).toBe("results");
    const t = goAt + RACE_CAP_MS + 1000;
    r.setReady("h", true, t);
    expect(r.state.phase).toBe("results"); // still waiting for the other player
    r.setReady("p2", true, t + 1);
    expect(r.state.phase).toBe("drawing");
    expect(r.state.scores.every((s) => s.races === 1)).toBe(true);
  });

  it("after 30 s a player who hasn't clicked Next Race is removed, and a lone player goes back to the lobby", () => {
    const { r, goAt } = racing([host, p2]);
    r.tick(goAt + RACE_CAP_MS);
    const t = goAt + RACE_CAP_MS;
    r.setReady("h", true, t + 5000);
    const events = r.tick(t + RESULTS_MS);
    expect(events).toContainEqual({ kind: "left", userId: "p2", username: "Two", reason: "idle" });
    expect(r.state.phase).toBe("lobby");
    expect(r.state.members.map((m) => m.userId)).toEqual(["h"]);
  });

  it("nobody can join while the results are showing", () => {
    const { r, goAt } = racing([host, p2]);
    r.tick(goAt + RACE_CAP_MS);
    expect(r.join({ userId: "late", username: "Late", paid: false }, goAt + RACE_CAP_MS + 5)).toEqual({
      ok: false,
      code: "race_in_progress",
    });
  });

  it("the snapshot carries the race and the leaderboard", () => {
    const { r, goAt } = racing();
    r.finish("h", goAt + 3000);
    const snap = r.snapshot(goAt + 3000);
    expect(snap.round?.race?.startedAt).toBe(goAt);
    expect(snap.round?.race?.firstFinishAt).toBe(goAt + 3000);
    expect(snap.round?.race?.endsAt).toBe(goAt + 3000 + AFTER_FIRST_FINISH_MS);
    expect(snap.round?.race?.racers).toHaveLength(3);
    expect(snap.scores).toEqual([]);
  });
});