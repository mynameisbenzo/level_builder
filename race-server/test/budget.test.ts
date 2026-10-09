import { describe, expect, it } from "vitest";
import { Budget, dayKey, nextReset } from "../src/budget";
import { RESERVATION_TTL_MS, raceCost } from "../src/config";

const NOON = Date.parse("2026-10-09T12:00:00Z");

describe("budget", () => {
  it("starts empty with its soft limit at 70% of the quota", () => {
    const b = Budget.fresh(NOON);
    expect(b.softLimit).toBe(70_000);
    expect(b.status(NOON)).toMatchObject({ racesToday: 0, usedUnits: 0, atCapacity: false });
  });

  it("lets a race start only while it fits under the soft limit", () => {
    const b = Budget.fresh(NOON);
    const cost = raceCost("ghost");
    const fits = Math.floor(70_000 / cost);
    for (let i = 0; i < fits; i++) expect(b.tryReserve(`r${i}`, "ghost", NOON)).toBe(true);
    expect(b.tryReserve("one-more", "ghost", NOON)).toBe(false);
    expect(b.status(NOON)).toMatchObject({ racesToday: fits, atCapacity: true });
  });

  it("counts real usage against the same limit", () => {
    const b = Budget.fresh(NOON);
    b.addUsage(70_000 - raceCost("ghost") + 1, NOON);
    expect(b.canStart("ghost", NOON)).toBe(false);
  });

  it("never touches a race that is already running", () => {
    const b = Budget.fresh(NOON);
    expect(b.tryReserve("live", "ghost", NOON)).toBe(true);
    b.addUsage(500_000, NOON); // the day blows way past the limit mid-race
    expect(b.state.reservations["live"]).toBeDefined();
    expect(b.canStart("ghost", NOON)).toBe(false);
  });

  it("freeing a reservation makes room again", () => {
    const b = Budget.fresh(NOON);
    const fits = Math.floor(70_000 / raceCost("ghost"));
    for (let i = 0; i < fits; i++) b.tryReserve(`r${i}`, "ghost", NOON);
    b.release("r0", NOON);
    expect(b.canStart("ghost", NOON)).toBe(true);
  });

  it("drops reservations that were never released", () => {
    const b = Budget.fresh(NOON);
    b.tryReserve("lost", "ghost", NOON);
    b.status(NOON + RESERVATION_TTL_MS);
    expect(b.state.reservations["lost"]).toBeUndefined();
  });

  it("resets at 00:00 UTC", () => {
    const b = Budget.fresh(NOON);
    b.addUsage(60_000, NOON);
    b.tryReserve("a", "ghost", NOON);
    const nextDay = Date.parse("2026-10-10T00:00:01Z");
    expect(b.status(nextDay)).toMatchObject({ usedUnits: 0, racesToday: 0, atCapacity: false });
    expect(dayKey(nextDay)).toBe("2026-10-10");
  });

  it("tells clients when it resets", () => {
    expect(new Date(nextReset(NOON)).toISOString()).toBe("2026-10-10T00:00:00.000Z");
    expect(Budget.fresh(NOON).status(NOON).resetsAt).toBe("2026-10-10T00:00:00.000Z");
  });

  it("ignores nonsense usage numbers", () => {
    const b = Budget.fresh(NOON);
    b.addUsage(-5, NOON);
    b.addUsage(Number.NaN, NOON);
    expect(b.state.used).toBe(0);
  });
});