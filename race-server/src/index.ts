import { raceCost } from "./config";
import { budgetStub, type Env } from "./env";
import { verifyTicket, type Ticket } from "./ticket";

export { Budget } from "./budgetObject";
export { Room } from "./roomObject";

// No 0/O/1/I/L: easy to read out loud on stream.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_PATTERN = /^[A-HJKMNP-Z2-9]{6}$/;

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function allowedOrigins(env: Env): string[] {
  return (env.FRONTEND_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

function reply(request: Request, env: Env, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(request, env) },
  });
}

async function ticketFrom(token: string | null, env: Env): Promise<Ticket | null> {
  if (!token) return null;
  return verifyTicket(token, env.RACE_TICKET_SECRET, Math.floor(Date.now() / 1000));
}

const bearer = (request: Request) => request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? null;

function internalHeaders(request: Request, ticket: Ticket | null): Headers {
  const headers = new Headers(request.headers);
  // Never trust identity headers a client sent; set our own from the ticket.
  headers.delete("x-user-id");
  headers.delete("x-username");
  headers.delete("x-paid");
  if (ticket) {
    headers.set("x-user-id", ticket.userId);
    headers.set("x-username", ticket.username);
    headers.set("x-paid", ticket.paid ? "1" : "0");
  }
  return headers;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (path === "/health") return reply(request, env, { ok: true });
    if (!env.RACE_TICKET_SECRET) return reply(request, env, { error: "races_unavailable" }, 503);

    // GET /api/budget - "Races today: n" and the at-capacity state, public.
    if (path === "/api/budget" && request.method === "GET") {
      const status = await budgetStub(env).status();
      return reply(request, env, { ...status, costPerRace: raceCost("ghost") });
    }

    // POST /api/rooms - create a room. Paid accounts only.
    if (path === "/api/rooms" && request.method === "POST") {
      const ticket = await ticketFrom(bearer(request), env);
      if (!ticket) return reply(request, env, { error: "unauthorized" }, 401);
      if (!ticket.paid) return reply(request, env, { error: "host_must_be_paid" }, 403);
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newCode();
        const stub = env.ROOM.get(env.ROOM.idFromName(code));
        const res = await stub.fetch("https://room/init", {
          method: "POST",
          body: JSON.stringify({ code, host: ticket }),
        });
        if (res.status === 200) return reply(request, env, { code }, 201);
      }
      return reply(request, env, { error: "could_not_create_room" }, 503);
    }

    // GET /api/rooms/:code            - what anyone may know about a room
    // GET /api/rooms/:code/ws?ticket= - the live socket
    const match = path.match(/^\/api\/rooms\/([A-Za-z0-9]+)(\/ws)?$/);
    if (match && request.method === "GET") {
      const code = match[1].toUpperCase();
      if (!CODE_PATTERN.test(code)) return reply(request, env, { exists: false }, 404);
      const stub = env.ROOM.get(env.ROOM.idFromName(code));

      if (!match[2]) {
        const ticket = await ticketFrom(bearer(request), env);
        const res = await stub.fetch("https://room/info", { headers: internalHeaders(request, ticket) });
        return reply(request, env, await res.json(), res.status);
      }

      const origin = request.headers.get("Origin");
      if (origin && !allowedOrigins(env).includes(origin)) return reply(request, env, { error: "bad_origin" }, 403);
      const ticket = await ticketFrom(url.searchParams.get("ticket"), env);
      if (!ticket) return reply(request, env, { error: "unauthorized" }, 401);
      return stub.fetch(new Request(`https://room/ws`, { headers: internalHeaders(request, ticket) }));
    }

    return reply(request, env, { error: "not_found" }, 404);
  },
} satisfies ExportedHandler<Env>;