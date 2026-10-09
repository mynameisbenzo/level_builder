// The room rules, with no I/O and no clock of its own: every method takes
// `now` and returns what happened, so it is all unit-testable and the
// Durable Object is only plumbing around it.

import { AWAY_GRACE_MS, MAX_INVITES, MAX_PLAYERS, ROOM_IDLE_MS } from "./config";

export type JoinMode = "host" | "party" | "public";
export type Phase = "lobby" | "racing";
export type CloseReason = "paid_host_left" | "expired" | "host_closed";

export interface Member {
  userId: string;
  username: string;
  paid: boolean;
  joinedAt: number;
  awayUntil: number | null;
}

export interface RoomState {
  code: string;
  hostId: string;
  hostName: string;
  joinMode: JoinMode;
  phase: Phase;
  members: Member[];
  invites: string[]; // lower-cased usernames
  banned: string[]; // user ids
  closing: boolean; // close as soon as the current race ends
  closed: CloseReason | null;
  lastActivity: number;
}

export interface Who {
  userId: string;
  username: string;
  paid: boolean;
}

export type RoomEvent =
  | { kind: "joined"; userId: string; username: string }
  | { kind: "reconnected"; userId: string; username: string }
  | { kind: "away"; userId: string; username: string }
  | { kind: "left"; userId: string; username: string; reason: "left" | "timeout" }
  | { kind: "kicked"; userId: string; username: string }
  | { kind: "hostChanged"; userId: string; username: string }
  | { kind: "closing"; reason: CloseReason }
  | { kind: "closed"; reason: CloseReason };

export type Result = { ok: true; events: RoomEvent[] } | { ok: false; code: string };

const norm = (username: string) => username.trim().toLowerCase();
const fail = (code: string): Result => ({ ok: false, code });

export class RoomLogic {
  constructor(public state: RoomState) {}

  static create(code: string, host: Who, now: number): RoomLogic {
    return new RoomLogic({
      code,
      hostId: host.userId,
      hostName: host.username,
      joinMode: "host",
      phase: "lobby",
      members: [],
      invites: [],
      banned: [],
      closing: false,
      closed: null,
      lastActivity: now,
    });
  }

  // ---- reading ------------------------------------------------------
  member(userId: string): Member | undefined {
    return this.state.members.find((m) => m.userId === userId);
  }

  get isClosed(): boolean {
    return this.state.closed !== null;
  }

  isHost(userId: string): boolean {
    return this.state.hostId === userId;
  }

  /** What every client in the room may see. */
  snapshot() {
    const s = this.state;
    return {
      code: s.code,
      joinMode: s.joinMode,
      phase: s.phase,
      maxPlayers: MAX_PLAYERS,
      hostId: s.hostId,
      closing: s.closing,
      players: s.members.map((m) => ({
        userId: m.userId,
        username: m.username,
        paid: m.paid,
        isHost: m.userId === s.hostId,
        joinedAt: m.joinedAt,
        away: m.awayUntil !== null,
      })),
      invites: [...s.invites],
    };
  }

  /** What anyone with the code may learn before logging in or joining. */
  publicInfo() {
    const s = this.state;
    return {
      exists: true,
      closed: s.closed !== null,
      joinMode: s.joinMode,
      hostName: s.hostName,
      playerCount: s.members.length,
      maxPlayers: MAX_PLAYERS,
      phase: s.phase,
    };
  }

  /** Would this account be let in right now? (No state change.) */
  canJoin(who: Who): { ok: true } | { ok: false; code: string } {
    const s = this.state;
    if (s.closed) return { ok: false, code: "closed" };
    if (s.banned.includes(who.userId)) return { ok: false, code: "banned" };
    if (this.member(who.userId)) return { ok: true };
    const isHost = who.userId === s.hostId;
    if (!isHost && s.phase === "racing") return { ok: false, code: "race_in_progress" };
    if (s.members.length >= MAX_PLAYERS) return { ok: false, code: "full" };
    if (!isHost && s.joinMode !== "public" && !s.invites.includes(norm(who.username))) {
      return { ok: false, code: "not_invited" };
    }
    return { ok: true };
  }

  // ---- joining and leaving -----------------------------------------
  join(who: Who, now: number): Result {
    const verdict = this.canJoin(who);
    if (!verdict.ok) return fail(verdict.code);
    const s = this.state;
    s.lastActivity = now;

    const existing = this.member(who.userId);
    if (existing) {
      existing.awayUntil = null;
      existing.username = who.username;
      return { ok: true, events: [{ kind: "reconnected", userId: who.userId, username: who.username }] };
    }
    s.members.push({
      userId: who.userId,
      username: who.username,
      paid: who.paid,
      joinedAt: now,
      awayUntil: null,
    });
    if (who.userId === s.hostId) s.hostName = who.username;
    return { ok: true, events: [{ kind: "joined", userId: who.userId, username: who.username }] };
  }

  /** The socket dropped: keep the slot for a short grace period. */
  disconnect(userId: string, now: number): Result {
    const m = this.member(userId);
    if (!m || this.isClosed) return fail("not_in_room");
    m.awayUntil = now + AWAY_GRACE_MS;
    this.state.lastActivity = now;
    return { ok: true, events: [{ kind: "away", userId, username: m.username }] };
  }

  /** Leave for good (the Leave button, or the grace period ran out). */
  leave(userId: string, now: number, reason: "left" | "timeout" = "left"): Result {
    const s = this.state;
    const m = this.member(userId);
    if (!m || this.isClosed) return fail("not_in_room");
    s.members = s.members.filter((x) => x.userId !== userId);
    s.lastActivity = now;
    const events: RoomEvent[] = [{ kind: "left", userId, username: m.username, reason }];
    if (userId === s.hostId) events.push(...this.passHost());
    return { ok: true, events };
  }

  kick(actorId: string, targetId: string, now: number): Result {
    const s = this.state;
    if (this.isClosed) return fail("closed");
    if (actorId !== s.hostId) return fail("not_host");
    if (targetId === actorId) return fail("cannot_kick_self");
    const m = this.member(targetId);
    if (!m) return fail("not_in_room");
    s.members = s.members.filter((x) => x.userId !== targetId);
    if (!s.banned.includes(targetId)) s.banned.push(targetId);
    s.invites = s.invites.filter((u) => u !== norm(m.username));
    s.lastActivity = now;
    return { ok: true, events: [{ kind: "kicked", userId: targetId, username: m.username }] };
  }

  /** The host left: longest-present paid player takes over, else the room ends. */
  private passHost(): RoomEvent[] {
    const s = this.state;
    if (s.members.length === 0) return []; // empty room keeps its host's seat until it expires
    const next = [...s.members].filter((m) => m.paid).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (next) {
      s.hostId = next.userId;
      s.hostName = next.username;
      return [{ kind: "hostChanged", userId: next.userId, username: next.username }];
    }
    return this.closeOrFlag("paid_host_left");
  }

  private closeOrFlag(reason: CloseReason): RoomEvent[] {
    const s = this.state;
    if (s.phase === "racing") {
      s.closing = true;
      return [{ kind: "closing", reason }];
    }
    s.closed = reason;
    return [{ kind: "closed", reason }];
  }

  // ---- host controls -----------------------------------------------
  setMode(actorId: string, mode: JoinMode, now: number): Result {
    if (this.isClosed) return fail("closed");
    if (actorId !== this.state.hostId) return fail("not_host");
    if (mode !== "host" && mode !== "party" && mode !== "public") return fail("bad_mode");
    this.state.joinMode = mode;
    this.state.lastActivity = now;
    return { ok: true, events: [] };
  }

  invite(actorId: string, username: string, now: number): Result {
    const s = this.state;
    if (this.isClosed) return fail("closed");
    const isHost = actorId === s.hostId;
    const isMember = !!this.member(actorId);
    if (!(isHost || (s.joinMode === "party" && isMember))) return fail("not_allowed");
    if (s.joinMode === "public") return fail("public_room");
    const name = norm(username ?? "");
    if (!name || name.length > 40) return fail("bad_username");
    if (s.members.some((m) => norm(m.username) === name)) return fail("already_here");
    if (!s.invites.includes(name)) {
      if (s.invites.length >= MAX_INVITES) return fail("too_many_invites");
      s.invites.push(name);
    }
    s.lastActivity = now;
    return { ok: true, events: [] };
  }

  uninvite(actorId: string, username: string, now: number): Result {
    if (this.isClosed) return fail("closed");
    if (actorId !== this.state.hostId) return fail("not_host");
    this.state.invites = this.state.invites.filter((u) => u !== norm(username ?? ""));
    this.state.lastActivity = now;
    return { ok: true, events: [] };
  }

  /** The host closes the room outright. */
  closeByHost(actorId: string): Result {
    if (this.isClosed) return fail("closed");
    if (actorId !== this.state.hostId) return fail("not_host");
    this.state.closed = "host_closed";
    return { ok: true, events: [{ kind: "closed", reason: "host_closed" }] };
  }

  // ---- race phase (used from stage 2) ------------------------------
  beginRace(): Result {
    if (this.isClosed || this.state.phase === "racing") return fail("cannot_start");
    this.state.phase = "racing";
    return { ok: true, events: [] };
  }

  endRace(now: number): Result {
    const s = this.state;
    if (s.phase !== "racing") return fail("no_race");
    s.phase = "lobby";
    s.lastActivity = now;
    if (s.closing) {
      s.closed = "paid_host_left";
      return { ok: true, events: [{ kind: "closed", reason: "paid_host_left" }] };
    }
    return { ok: true, events: [] };
  }

  // ---- time ----------------------------------------------------------
  /** Apply everything that is due by `now`: expired grace periods, idle expiry. */
  tick(now: number): RoomEvent[] {
    const s = this.state;
    if (this.isClosed) return [];
    const events: RoomEvent[] = [];
    for (const m of [...s.members]) {
      if (m.awayUntil !== null && m.awayUntil <= now) {
        const r = this.leave(m.userId, now, "timeout");
        if (r.ok) events.push(...r.events);
        if (this.isClosed) return events;
      }
    }
    const connected = s.members.some((m) => m.awayUntil === null);
    if (!connected && now - s.lastActivity >= ROOM_IDLE_MS) {
      s.closed = "expired";
      events.push({ kind: "closed", reason: "expired" });
    }
    return events;
  }

  /** When tick() next has work to do, or null if only a new event can change anything. */
  nextWake(): number | null {
    const s = this.state;
    if (this.isClosed) return null;
    const times: number[] = [];
    for (const m of s.members) if (m.awayUntil !== null) times.push(m.awayUntil);
    if (!s.members.some((m) => m.awayUntil === null)) times.push(s.lastActivity + ROOM_IDLE_MS);
    return times.length ? Math.min(...times) : null;
  }
}