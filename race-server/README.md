# race-server

The live-race server for Pixel Maker: a Cloudflare Worker plus one Durable
Object per room (raw WebSockets). The Flask backend stays the source of truth
for accounts and levels; this server only trusts a short-lived **ticket** the
backend signs (`POST /api/race/ticket`).

Stage 1 covers rooms only: create, join modes, invites, kick/ban, leave, host
handover, the 4-player cap, idle expiry, a per-socket message cap, and the
daily request budget. Stage 3a adds the race itself; the shared race checkpoint and the sanity checks on positions are stage 3b.

## Layout

- `src/room.ts`, `src/budget.ts`, `src/rateLimit.ts`, `src/ticket.ts` - the rules.
  No I/O, no clock of their own, fully unit-tested.
- `src/roomObject.ts`, `src/budgetObject.ts`, `src/index.ts` - the Cloudflare
  plumbing around them.
- `src/config.ts` - every tunable number (player cap, grace periods, rates,
  `WS_BILLING_RATIO`, per-mode race cost).
- `scripts/smoke.mjs` - end-to-end check against a running server.

## Commands

```
npm install          # no wrangler/esbuild here on purpose, so it installs on older Macs
npm run check        # type-check + unit tests
```

Smoke test (needs the same secret the server has):

```
RACE_TICKET_SECRET=... node scripts/smoke.mjs https://<your-worker>.workers.dev
```

## Settings

| Name | Where | What |
| --- | --- | --- |
| `RACE_TICKET_SECRET` | Worker secret **and** backend env var, same value | signs/verifies tickets |
| `FRONTEND_ORIGINS` | `wrangler.jsonc` vars | browser origins allowed to call the Worker |
| `BACKEND_URL` | `wrangler.jsonc` vars | the Flask backend the Worker asks for candidate levels (`POST /api/race/candidates`, signed with the same secret, audience `race-internal`) |

Make a secret with `python3 -c "import secrets; print(secrets.token_hex(32))"`.

## HTTP + WebSocket API

- `GET  /health`
- `GET  /api/budget` - races today, estimate left, at-capacity flag, reset time
- `POST /api/rooms` (Bearer ticket, paid only) -> `{ code }`
- `GET  /api/rooms/:code` (optional Bearer ticket) -> public room info, plus `canJoin` when signed in
- `GET  /api/rooms/:code/ws?ticket=...` - the socket

Client -> server messages: `setMode`, `invite`, `uninvite`, `kick`, `closeRoom`, `leave`,
and for a round `ready {ready}`, `setCategory {category}`, `vote {slug}`, `loaded {slug}`,
`sync {c}` (answered with `sync {c, s}`, the server's clock, for the client's offset estimate).
Server -> client: `welcome`, `roomState`, `event`, `kicked`, `removed`, `closed`, `denied`,
`replaced`, `limited`, `error`, `sync`. Every message carries `v` (protocol version).
Close codes: 4000 replaced, 4001 unauthorized, 4003 kicked, 4005 denied, 4007 closed,
4008 removed (not ready in a minute, or the level didn't load in 15 s).

A round runs `lobby` (ready-up) -> `drawing` (asking the backend) -> `voting` -> `loading`
-> `countdown` -> `racing`. Until the real race exists, `racing` just holds for
`PLACEHOLDER_RACE_MS` and the room returns to ready-up. Every timer is in `src/config.ts`.