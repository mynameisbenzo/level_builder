import { DurableObject } from "cloudflare:workers";
import { CLOSED_LINGER_MS, MAX_MESSAGE_BYTES, PROTOCOL_VERSION, USAGE_FLUSH_MESSAGES, WS_BILLING_RATIO } from "./config";
import { budgetStub, type Env } from "./env";
import { newBucket, take, type Bucket } from "./rateLimit";
import { RoomLogic, type RoomEvent, type RoomState, type Who } from "./room";

// WebSocket close codes (4000+ are ours).
const CLOSE = {
  replaced: 4000,
  unauthorized: 4001,
  kicked: 4003,
  notFound: 4004,
  denied: 4005,
  closed: 4007,
} as const;

interface Attachment {
  userId: string;
  username: string;
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

/** One instance per room code. */
export class Room extends DurableObject<Env> {
  private room: RoomLogic | null = null;
  private buckets = new WeakMap<WebSocket, Bucket>();
  private pendingUnits = 0;
  private pendingMessages = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<RoomState>("room");
      if (saved) this.room = new RoomLogic(saved);
    });
  }

  // ---- HTTP (always arrives through the Worker, never from a browser) ---
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.meter(1, true);

    if (url.pathname === "/init" && request.method === "POST") {
      if (this.room) return json({ error: "exists" }, 409);
      const { code, host } = (await request.json()) as { code: string; host: Who };
      this.room = RoomLogic.create(code, host, Date.now());
      await this.persist();
      return json({ code });
    }

    if (!this.room) return json({ exists: false }, 404);

    if (url.pathname === "/info") {
      const who = whoFromHeaders(request.headers);
      const info = this.room.publicInfo();
      return json(who ? { ...info, canJoin: this.room.canJoin(who) } : info);
    }

    if (url.pathname === "/ws") return this.acceptSocket(request);
    return json({ error: "not_found" }, 404);
  }

  private acceptSocket(request: Request): Response {
    const who = whoFromHeaders(request.headers);
    if (request.headers.get("Upgrade") !== "websocket") return json({ error: "expected_websocket" }, 426);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    const refuse = (code: number, reason: string) => {
      server.send(JSON.stringify({ v: PROTOCOL_VERSION, t: "denied", code: reason }));
      server.close(code, reason);
      return new Response(null, { status: 101, webSocket: client });
    };

    if (!who) return refuse(CLOSE.unauthorized, "unauthorized");
    const room = this.room!;
    const joined = room.join(who, Date.now());
    if (!joined.ok) return refuse(joined.code === "closed" ? CLOSE.closed : CLOSE.denied, joined.code);

    // One live socket per account: a second tab replaces the first.
    for (const other of this.ctx.getWebSockets()) {
      if (other === server) continue;
      if (this.attachmentOf(other)?.userId === who.userId) {
        this.safeSend(other, { t: "replaced" });
        other.close(CLOSE.replaced, "replaced");
      }
    }

    server.serializeAttachment({ userId: who.userId, username: who.username } satisfies Attachment);
    this.buckets.set(server, newBucket(Date.now()));
    this.safeSend(server, {
      t: "welcome",
      you: { userId: who.userId, username: who.username, isHost: room.isHost(who.userId) },
      room: room.snapshot(),
    });
    this.ctx.waitUntil(this.afterChange(joined.events));
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- hibernation callbacks ------------------------------------------
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    this.meter(1, false);

    const bucket = this.buckets.get(ws) ?? newBucket(Date.now());
    this.buckets.set(ws, bucket);
    const verdict = take(bucket, Date.now());
    if (verdict === "close") return ws.close(1008, "rate limit");
    if (verdict === "drop") {
      if (bucket.dropped === 1) this.safeSend(ws, { t: "limited" });
      return;
    }

    const who = this.attachmentOf(ws);
    const room = this.room;
    if (!who || !room) return;
    if (typeof message !== "string" || message.length > MAX_MESSAGE_BYTES) {
      return this.safeSend(ws, { t: "error", code: "bad_message" });
    }

    let msg: { t?: string; [key: string]: unknown };
    try {
      msg = JSON.parse(message);
    } catch {
      return this.safeSend(ws, { t: "error", code: "bad_message" });
    }

    const now = Date.now();
    let result: ReturnType<RoomLogic["leave"]> | null = null;
    switch (msg.t) {
      case "setMode":
        result = room.setMode(who.userId, msg.mode as never, now);
        break;
      case "invite":
        result = room.invite(who.userId, String(msg.username ?? ""), now);
        break;
      case "uninvite":
        result = room.uninvite(who.userId, String(msg.username ?? ""), now);
        break;
      case "kick":
        result = room.kick(who.userId, String(msg.userId ?? ""), now);
        break;
      case "closeRoom":
        result = room.closeByHost(who.userId);
        break;
      case "leave":
        result = room.leave(who.userId, now);
        if (result.ok) ws.close(1000, "left");
        break;
      default:
        return this.safeSend(ws, { t: "error", code: "unknown_message" });
    }

    if (!result.ok) return this.safeSend(ws, { t: "error", code: result.code, for: msg.t });
    await this.afterChange(result.events);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const who = this.attachmentOf(ws);
    await this.flushUsage();
    if (!who || !this.room) return;
    // A replaced socket closes after its successor arrived: ignore it.
    const successor = this.ctx.getWebSockets().some((o) => o !== ws && this.attachmentOf(o)?.userId === who.userId);
    if (successor) return;
    const res = this.room.disconnect(who.userId, Date.now());
    if (res.ok) await this.afterChange(res.events);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  async alarm(): Promise<void> {
    const room = this.room;
    if (!room) return;
    if (room.isClosed) {
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }
    const events = room.tick(Date.now());
    await this.flushUsage();
    await this.afterChange(events);
  }

  // ---- internals --------------------------------------------------------
  private attachmentOf(ws: WebSocket): Attachment | null {
    return (ws.deserializeAttachment() as Attachment | null) ?? null;
  }

  private safeSend(ws: WebSocket, payload: object): void {
    try {
      ws.send(JSON.stringify({ v: PROTOCOL_VERSION, ...payload }));
    } catch {
      // the socket is already gone
    }
  }

  private broadcast(payload: object): void {
    for (const ws of this.ctx.getWebSockets()) this.safeSend(ws, payload);
  }

  /** Save, tell everyone, deliver kicks and closes, and schedule the next wake-up. */
  private async afterChange(events: RoomEvent[]): Promise<void> {
    const room = this.room;
    if (!room) return;

    for (const ev of events) {
      this.broadcast({ t: "event", event: ev });
      if (ev.kind === "kicked") {
        for (const ws of this.ctx.getWebSockets()) {
          if (this.attachmentOf(ws)?.userId === ev.userId) {
            this.safeSend(ws, { t: "kicked" });
            ws.close(CLOSE.kicked, "kicked");
          }
        }
      }
    }

    if (room.isClosed) {
      const reason = room.state.closed;
      this.broadcast({ t: "closed", reason });
      for (const ws of this.ctx.getWebSockets()) ws.close(CLOSE.closed, String(reason));
      await this.persist();
      await this.ctx.storage.setAlarm(Date.now() + CLOSED_LINGER_MS);
      return;
    }

    this.broadcast({ t: "roomState", room: room.snapshot() });
    await this.persist();
    const wake = room.nextWake();
    if (wake !== null) await this.ctx.storage.setAlarm(wake);
    else await this.ctx.storage.deleteAlarm();
  }

  private async persist(): Promise<void> {
    if (this.room) await this.ctx.storage.put("room", this.room.state);
  }

  /** Counts what this room costs; reported to the global budget in batches. */
  private meter(count: number, isRequest: boolean): void {
    this.pendingUnits += isRequest ? count : count / WS_BILLING_RATIO;
    this.pendingMessages += 1;
    if (this.pendingMessages >= USAGE_FLUSH_MESSAGES) this.ctx.waitUntil(this.flushUsage());
  }

  private async flushUsage(): Promise<void> {
    const units = Math.ceil(this.pendingUnits);
    this.pendingUnits = 0;
    this.pendingMessages = 0;
    if (units > 0) await budgetStub(this.env).addUsage(units);
  }
}

function whoFromHeaders(headers: Headers): Who | null {
  const userId = headers.get("x-user-id");
  const username = headers.get("x-username");
  if (!userId || !username) return null;
  return { userId, username, paid: headers.get("x-paid") === "1" };
}