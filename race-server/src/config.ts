// Every tunable number for the race server lives here.

export const PROTOCOL_VERSION = 1;

// ---- rooms ----------------------------------------------------------
export const MAX_PLAYERS = 4;
export const MAX_INVITES = 20;
// A room nobody is connected to is deleted after this long.
export const ROOM_IDLE_MS = 10 * 60 * 1000;
// A dropped socket keeps its slot this long, so a page refresh or a
// backgrounded phone can come straight back. An explicit Leave is instant.
export const AWAY_GRACE_MS = 20_000;
// After a room closes, how long its closed marker lingers before deletion.
export const CLOSED_LINGER_MS = 60_000;

// ---- per-socket message cap (token bucket) --------------------------
export const RATE_PER_SEC = 25;
export const BURST = 40;
export const CLOSE_AFTER_DROPPED = 500;
export const MAX_MESSAGE_BYTES = 2048;

// ---- daily budget ---------------------------------------------------
// Durable Objects free plan: 100,000 requests/day, reset at 00:00 UTC
// (5:00 PM Pacific during daylight time, 4:00 PM during standard time).
export const DAILY_QUOTA = 100_000;
// Races may only start while they fit under this share of the quota.
export const SOFT_LIMIT_FRACTION = 0.7;

// How many incoming WebSocket messages Cloudflare counts as one request.
// Their docs say 20 for BILLING, and that the dashboard shows raw counts
// (we measured exactly that). Whether the FREE plan's daily limit uses the
// 20:1 ratio is not documented, so this starts at 1 (assume raw, the safe
// side). Once Billing -> Usage shows what a known number of messages
// really cost, set it to 20 and capacity goes up about 20x.
export const WS_BILLING_RATIO = 1;

// What one race is assumed to cost at most, per game mode. A new mode
// (e.g. contact mode) gets its own row here.
export type GameMode = "ghost";
export const RACE_COST_ASSUMPTIONS: Record<GameMode, { players: number; hz: number; maxSeconds: number }> = {
  ghost: { players: 4, hz: 20, maxSeconds: 150 },
};

export function raceCost(mode: GameMode): number {
  const a = RACE_COST_ASSUMPTIONS[mode];
  // + 10 for connects and the handful of non-position messages.
  return Math.ceil((a.players * a.hz * a.maxSeconds) / WS_BILLING_RATIO) + 10;
}

// A reservation nobody released (the room died mid-race) frees itself.
export const RESERVATION_TTL_MS = 20 * 60 * 1000;
// Rooms report usage to the budget in batches this big, not per message.
export const USAGE_FLUSH_MESSAGES = 100;