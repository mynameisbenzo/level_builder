import { describe, expect, it } from "vitest";
import { BURST, CLOSE_AFTER_DROPPED, RATE_PER_SEC } from "../src/config";
import { newBucket, take } from "../src/rateLimit";

describe("per-socket cap", () => {
  it("allows a burst, then drops the excess", () => {
    const b = newBucket(0);
    let ok = 0;
    for (let i = 0; i < BURST + 10; i++) if (take(b, 0) === "ok") ok++;
    expect(ok).toBe(BURST);
  });

  it("refills at the sustained rate", () => {
    const b = newBucket(0);
    for (let i = 0; i < BURST; i++) take(b, 0);
    expect(take(b, 0)).toBe("drop");
    let ok = 0;
    for (let i = 0; i < RATE_PER_SEC * 2; i++) if (take(b, 1000) === "ok") ok++;
    expect(ok).toBe(RATE_PER_SEC);
  });

  it("holds a 20 Hz sender steady", () => {
    const b = newBucket(0);
    for (let i = 0; i < 20 * 60; i++) expect(take(b, i * 50)).toBe("ok");
  });

  it("closes the socket after sustained abuse", () => {
    const b = newBucket(0);
    let last = "ok";
    for (let i = 0; i < BURST + CLOSE_AFTER_DROPPED + 5; i++) last = take(b, 0);
    expect(last).toBe("close");
  });
});