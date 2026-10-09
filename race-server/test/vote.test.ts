import { describe, expect, it } from "vitest";
import { tallyVotes } from "../src/vote";

const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};
const slugs = ["a", "b", "c", "d"];

describe("tallyVotes", () => {
  it("the level with the most votes wins, with no spin", () => {
    expect(tallyVotes(slugs, { u1: "b", u2: "b", u3: "c" }, seq(0))).toEqual({ chosen: "b", tied: [] });
  });

  it("a tie for the top spins over just the tied levels", () => {
    const r = tallyVotes(slugs, { u1: "a", u2: "c", u3: "d" }, seq(0.99));
    // a, c and d each have one vote; b has none and is not in the spin.
    expect(r.tied).toEqual(["a", "c", "d"]);
    expect(r.chosen).toBe("d");
  });

  it("a four-way 1-1-1-1 split spins over all four", () => {
    const r = tallyVotes(slugs, { u1: "a", u2: "b", u3: "c", u4: "d" }, seq(0));
    expect(r.tied).toEqual(slugs);
    expect(r.chosen).toBe("a");
  });

  it("nobody voting picks at random with no spin", () => {
    expect(tallyVotes(slugs, {}, seq(0.5))).toEqual({ chosen: "c", tied: [] });
  });

  it("ignores votes for levels that aren't candidates", () => {
    expect(tallyVotes(slugs, { u1: "zzz", u2: "zzz", u3: "a" }, seq(0))).toEqual({ chosen: "a", tied: [] });
  });

  it("a rng of exactly 1 can't run off the end", () => {
    expect(tallyVotes(slugs, {}, seq(1)).chosen).toBe("d");
  });
});