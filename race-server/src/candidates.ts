// Asking the Flask backend for the levels a vote can offer. The Worker has
// no database, and the backend is the only thing that knows which levels
// are published and what their difficulty labels are.

import { CANDIDATES, DRAW_TIMEOUT_MS, type Category } from "./config";
import type { Env } from "./env";
import type { Candidate } from "./room";
import { signInternalToken } from "./ticket";

const str = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : null;

/** Turns the backend's JSON into candidates, dropping anything malformed. */
export function parseCandidates(json: unknown): Candidate[] | null {
  if (!json || typeof json !== "object") return null;
  const levels = (json as { levels?: unknown }).levels;
  if (!Array.isArray(levels)) return null;
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const raw of levels) {
    if (!raw || typeof raw !== "object") continue;
    const l = raw as Record<string, unknown>;
    const slug = str(l.slug, 100);
    const title = str(l.title, 200);
    if (!slug || !title || seen.has(slug)) continue;
    seen.add(slug);
    const thumb = str(l.thumbnail_url, 500);
    out.push({
      slug,
      title,
      owner: str(l.owner_username, 100) ?? "unknown",
      difficulty: str(l.difficulty, 20),
      // Only ever shown as an <img>; refuse anything that isn't plain https.
      thumbnailUrl: thumb && /^https:\/\//.test(thumb) ? thumb : null,
    });
    if (out.length >= CANDIDATES) break;
  }
  return out;
}

/** The candidates, [] if the category has none, or null if the backend couldn't be reached. */
export async function fetchCandidates(
  env: Env,
  category: Category,
  fetchFn: typeof fetch = fetch,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<Candidate[] | null> {
  if (!env.BACKEND_URL || !env.RACE_TICKET_SECRET) return null;
  try {
    const token = await signInternalToken(env.RACE_TICKET_SECRET, nowSeconds);
    const res = await fetchFn(`${env.BACKEND_URL.replace(/\/+$/, "")}/api/race/candidates`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ category, count: CANDIDATES }),
      signal: AbortSignal.timeout(DRAW_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return parseCandidates(await res.json());
  } catch {
    return null;
  }
}