import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fetchCandidates, parseCandidates } from "../src/candidates";
import type { Env } from "../src/env";
import { INTERNAL_AUDIENCE, signInternalToken, verifyTicket } from "../src/ticket";

const env = { BACKEND_URL: "https://api.example.com/", RACE_TICKET_SECRET: "s3cret" } as Env;
const level = (n: number, extra: object = {}) => ({
  slug: `lvl-${n}`,
  title: `Level ${n}`,
  owner_username: "maker",
  difficulty: "easy",
  thumbnail_url: "https://cdn.example.com/t.png",
  ...extra,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("signInternalToken", () => {
  it("is a valid HS256 JWT for the internal audience, good for 60 seconds", async () => {
    const token = await signInternalToken("s3cret", 1_000);
    const [head, body, sig] = token.split(".");
    const expected = createHmac("sha256", "s3cret").update(`${head}.${body}`).digest("base64url");
    expect(sig).toBe(expected);
    expect(JSON.parse(Buffer.from(body, "base64url").toString())).toEqual({
      aud: INTERNAL_AUDIENCE,
      iss: "race-worker",
      iat: 1_000,
      exp: 1_060,
    });
  });

  it("is not accepted as a player ticket", async () => {
    const token = await signInternalToken("s3cret", 1_000);
    expect(await verifyTicket(token, "s3cret", 1_001)).toBeNull();
  });
});

describe("parseCandidates", () => {
  it("keeps well-formed levels, at most four, no duplicates", () => {
    const levels = [1, 2, 2, 3, 4, 5].map((n) => level(n));
    expect(parseCandidates({ levels })?.map((c) => c.slug)).toEqual(["lvl-1", "lvl-2", "lvl-3", "lvl-4"]);
  });

  it("drops malformed entries and non-https thumbnails", () => {
    const out = parseCandidates({
      levels: [level(1, { thumbnail_url: "javascript:alert(1)" }), { slug: "x" }, null, level(2, { difficulty: null })],
    });
    expect(out).toHaveLength(2);
    expect(out?.[0].thumbnailUrl).toBeNull();
    expect(out?.[1].difficulty).toBeNull();
  });

  it("returns null for the wrong shape and [] for none", () => {
    expect(parseCandidates({ nope: 1 })).toBeNull();
    expect(parseCandidates(null)).toBeNull();
    expect(parseCandidates({ levels: [] })).toEqual([]);
  });
});

describe("fetchCandidates", () => {
  it("posts the category with a bearer token and returns the levels", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return json({ levels: [level(1), level(2)] });
    }) as unknown as typeof fetch;
    const out = await fetchCandidates(env, "hard", fake, 5_000);
    expect(out?.map((c) => c.slug)).toEqual(["lvl-1", "lvl-2"]);
    expect(seen!.url).toBe("https://api.example.com/api/race/candidates");
    expect(JSON.parse(String(seen!.init.body))).toEqual({ category: "hard", count: 4 });
    const auth = String((seen!.init.headers as Record<string, string>).authorization);
    expect(auth.startsWith("Bearer ")).toBe(true);
  });

  it("returns null on a backend error, a network failure, or missing config", async () => {
    expect(await fetchCandidates(env, "any", (async () => json({}, 500)) as unknown as typeof fetch)).toBeNull();
    expect(
      await fetchCandidates(env, "any", (async () => {
        throw new Error("boom");
      }) as unknown as typeof fetch),
    ).toBeNull();
    expect(await fetchCandidates({ ...env, BACKEND_URL: "" } as Env, "any")).toBeNull();
  });
});