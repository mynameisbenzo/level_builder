// The room rules, with no I/O and no clock of its own: every method takes
// `now` and returns what happened, so it is all unit-testable and the
// Durable Object is only plumbing around it.

import {
    AWAY_GRACE_MS,
    CATEGORIES,
    COUNTDOWN_MS,
    DRAW_TIMEOUT_MS,
    LOAD_TIMEOUT_MS,
    MAX_INVITES,
    MAX_PLAYERS,
    PLACEHOLDER_RACE_MS,
    READY_TIMEOUT_MS,
    REVEAL_MS,
    ROOM_IDLE_MS,
    SPIN_MS,
    START_BUFFER_MS,
    VOTE_MS,
    type Category,
  } from "./config";
  import { tallyVotes } from "./vote";
  
  export type JoinMode = "host" | "party" | "public";
  // lobby   = ready-up; drawing = asking the backend for candidates;
  // voting  = the 20 s vote; loading = everyone loads the winner;
  // countdown = 3-2-1; racing = the race itself.
  export type Phase = "lobby" | "drawing" | "voting" | "loading" | "countdown" | "racing";
  export type CloseReason = "paid_host_left" | "expired" | "host_closed";
  export type AbortReason = "not_enough_players" | "draw_failed" | "no_levels" | "at_capacity";
  export type LeaveReason = "left" | "timeout" | "idle" | "unloaded";
  
  /** Phases in which a round is under way and nobody new may join. */
  const NO_JOIN: readonly Phase[] = ["loading", "countdown", "racing"];
  /** Phases that need at least two people to make sense. */
  const NEEDS_TWO: readonly Phase[] = ["drawing", "voting", "loading", "countdown"];
  
  export interface Candidate {
    slug: string;
    title: string;
    owner: string;
    difficulty: string | null;
    thumbnailUrl: string | null;
  }
  
  export interface Round {
    n: number;
    candidates: Candidate[];
    votes: Record<string, string>; // userId -> slug
    deadline: number | null; // end of the current step
    chosen: string | null; // slug
    tied: string[]; // slugs the spin runs over (empty = no spin)
    revealUntil: number;
    goAt: number | null;
  }
  
  export interface Member {
    userId: string;
    username: string;
    paid: boolean;
    joinedAt: number;
    awayUntil: number | null;
    ready: boolean;
    /** When an unready player is removed; null while the clock isn't running. */
    readyBy: number | null;
    loaded: boolean;
  }
  
  export interface RoomState {
    code: string;
    hostId: string;
    hostName: string;
    joinMode: JoinMode;
    phase: Phase;
    members: Member[];
    category: Category;
    round: Round | null;
    roundCount: number;
    /** The `now` of the last advance(), so nextWake() can ignore times already handled. */
    lastTick: number;
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
    | { kind: "left"; userId: string; username: string; reason: LeaveReason }
    | { kind: "voteStarted" }
    | { kind: "chosen"; slug: string; title: string; spin: boolean }
    | { kind: "countdown"; goAt: number }
    | { kind: "roundAborted"; reason: AbortReason }
    | { kind: "roundEnded"; n: number }
    | { kind: "kicked"; userId: string; username: string }
    | { kind: "hostChanged"; userId: string; username: string }
    | { kind: "closing"; reason: CloseReason }
    | { kind: "closed"; reason: CloseReason };
  
  export type Result = { ok: true; events: RoomEvent[] } | { ok: false; code: string };
  
  const norm = (username: string) => username.trim().toLowerCase();
  const fail = (code: string): Result => ({ ok: false, code });
  const ok = (events: RoomEvent[] = []): Result => ({ ok: true, events });
  
  export class RoomLogic {
    constructor(
      public state: RoomState,
      private rng: () => number = Math.random,
    ) {
      // Rooms saved by an older version lack the round fields.
      const s = this.state;
      s.category ??= "any";
      s.round ??= null;
      s.roundCount ??= 0;
      s.lastTick ??= 0;
      for (const m of s.members) {
        m.ready ??= false;
        m.readyBy ??= null;
        m.loaded ??= false;
      }
    }
  
    static create(code: string, host: Who, now: number, rng?: () => number): RoomLogic {
      return new RoomLogic(
        {
          code,
          hostId: host.userId,
          hostName: host.username,
          joinMode: "host",
          phase: "lobby",
          members: [],
          category: "any",
          round: null,
          roundCount: 0,
          lastTick: now,
          invites: [],
          banned: [],
          closing: false,
          closed: null,
          lastActivity: now,
        },
        rng,
      );
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
    snapshot(now: number = Date.now()) {
      const s = this.state;
      const r = s.round;
      return {
        code: s.code,
        joinMode: s.joinMode,
        phase: s.phase,
        category: s.category,
        maxPlayers: MAX_PLAYERS,
        hostId: s.hostId,
        closing: s.closing,
        serverNow: now,
        players: s.members.map((m) => ({
          userId: m.userId,
          username: m.username,
          paid: m.paid,
          isHost: m.userId === s.hostId,
          joinedAt: m.joinedAt,
          away: m.awayUntil !== null,
          ready: m.ready,
          readyBy: m.readyBy,
          loaded: m.loaded,
        })),
        invites: [...s.invites],
        round:
          r && s.phase !== "lobby"
            ? {
                n: r.n,
                candidates: r.candidates,
                votes: { ...r.votes },
                deadline: r.deadline,
                chosen: r.chosen,
                tied: [...r.tied],
                revealUntil: r.revealUntil,
                goAt: r.goAt,
              }
            : null,
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
      if (!isHost && NO_JOIN.includes(s.phase)) return { ok: false, code: "race_in_progress" };
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
        return ok([
          { kind: "reconnected", userId: who.userId, username: who.username },
          ...this.advance(now),
        ]);
      }
      s.members.push({
        userId: who.userId,
        username: who.username,
        paid: who.paid,
        joinedAt: now,
        awayUntil: null,
        ready: false,
        readyBy: null,
        loaded: false,
      });
      if (who.userId === s.hostId) s.hostName = who.username;
      return ok([{ kind: "joined", userId: who.userId, username: who.username }, ...this.advance(now)]);
    }
  
    /** The socket dropped: keep the slot for a short grace period. */
    disconnect(userId: string, now: number): Result {
      const m = this.member(userId);
      if (!m || this.isClosed) return fail("not_in_room");
      m.awayUntil = now + AWAY_GRACE_MS;
      this.state.lastActivity = now;
      return ok([{ kind: "away", userId, username: m.username }, ...this.advance(now)]);
    }
  
    /** Leave for good (the Leave button, or the grace period ran out). */
    leave(userId: string, now: number, reason: LeaveReason = "left"): Result {
      if (!this.member(userId) || this.isClosed) return fail("not_in_room");
      const events = this.removeMember(userId, now, reason);
      return ok([...events, ...this.advance(now)]);
    }
  
    /** Removes a member and passes the host seat on; callers run advance() after. */
    private removeMember(userId: string, now: number, reason: LeaveReason): RoomEvent[] {
      const s = this.state;
      const m = this.member(userId)!;
      s.members = s.members.filter((x) => x.userId !== userId);
      if (s.round) delete s.round.votes[userId];
      s.lastActivity = now;
      const events: RoomEvent[] = [{ kind: "left", userId, username: m.username, reason }];
      if (userId === s.hostId) events.push(...this.passHost());
      return events;
    }
  
    kick(actorId: string, targetId: string, now: number): Result {
      const s = this.state;
      if (this.isClosed) return fail("closed");
      if (actorId !== s.hostId) return fail("not_host");
      if (targetId === actorId) return fail("cannot_kick_self");
      const m = this.member(targetId);
      if (!m) return fail("not_in_room");
      s.members = s.members.filter((x) => x.userId !== targetId);
      if (s.round) delete s.round.votes[targetId];
      if (!s.banned.includes(targetId)) s.banned.push(targetId);
      s.invites = s.invites.filter((u) => u !== norm(m.username));
      s.lastActivity = now;
      return ok([{ kind: "kicked", userId: targetId, username: m.username }, ...this.advance(now)]);
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
      if (NO_JOIN.includes(s.phase)) {
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
      return ok();
    }
  
    setCategory(actorId: string, category: string, now: number): Result {
      const s = this.state;
      if (this.isClosed) return fail("closed");
      if (actorId !== s.hostId) return fail("not_host");
      if (!(CATEGORIES as readonly string[]).includes(category)) return fail("bad_category");
      if (s.phase !== "lobby") return fail("not_now");
      s.category = category as Category;
      s.lastActivity = now;
      return ok();
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
      return ok();
    }
  
    uninvite(actorId: string, username: string, now: number): Result {
      if (this.isClosed) return fail("closed");
      if (actorId !== this.state.hostId) return fail("not_host");
      this.state.invites = this.state.invites.filter((u) => u !== norm(username ?? ""));
      this.state.lastActivity = now;
      return ok();
    }
  
    /** The host closes the room outright. */
    closeByHost(actorId: string): Result {
      if (this.isClosed) return fail("closed");
      if (actorId !== this.state.hostId) return fail("not_host");
      this.state.closed = "host_closed";
      return ok([{ kind: "closed", reason: "host_closed" }]);
    }
  
    // ---- a round: ready, vote, load, countdown -------------------------
    setReady(userId: string, ready: boolean, now: number): Result {
      const s = this.state;
      if (this.isClosed) return fail("closed");
      const m = this.member(userId);
      if (!m) return fail("not_in_room");
      if (s.phase !== "lobby") return fail("not_now");
      m.ready = !!ready;
      m.readyBy = null; // advance() re-arms the clock for an unready player
      s.lastActivity = now;
      return ok(this.advance(now));
    }
  
    vote(userId: string, slug: string, now: number): Result {
      const s = this.state;
      if (this.isClosed) return fail("closed");
      if (!this.member(userId)) return fail("not_in_room");
      // A vote that arrives just after the vote ended is not an error.
      if (s.phase !== "voting" || !s.round) return ok();
      if (!s.round.candidates.some((c) => c.slug === slug)) return fail("bad_level");
      s.round.votes[userId] = slug;
      s.lastActivity = now;
      return ok(this.advance(now));
    }
  
    /** A client finished loading the winning level. */
    loaded(userId: string, slug: string, now: number): Result {
      const s = this.state;
      if (this.isClosed) return fail("closed");
      const m = this.member(userId);
      if (!m) return fail("not_in_room");
      if (s.phase !== "loading" || !s.round || s.round.chosen !== slug) return ok(); // stale
      m.loaded = true;
      s.lastActivity = now;
      return ok(this.advance(now));
    }
  
    /**
     * The Worker got (or failed to get) the candidates for a draw. Only
     * acts if the room is still waiting for them.
     */
    finishDraw(candidates: Candidate[] | null, now: number): Result {
      const s = this.state;
      if (this.isClosed || s.phase !== "drawing" || !s.round) return ok();
      if (candidates === null) return ok(this.abort("draw_failed", now));
      const list = candidates.slice(0, 4);
      if (list.length === 0) return ok(this.abort("no_levels", now));
      s.round.candidates = list;
      s.round.votes = {};
      if (list.length === 1) {
        // Nothing to vote on.
        return ok(this.choose({ chosen: list[0].slug, tied: [] }, now));
      }
      s.phase = "voting";
      s.round.deadline = now + VOTE_MS;
      return ok([{ kind: "voteStarted" }, ...this.advance(now)]);
    }
  
    /** Give up on the round (e.g. the daily budget has no room for it). */
    abortRound(reason: AbortReason, now: number): Result {
      if (this.isClosed || !NEEDS_TWO.includes(this.state.phase)) return ok();
      return ok(this.abort(reason, now));
    }
  
    /** True while the Worker owes this room a candidate draw. */
    get needsDraw(): boolean {
      return this.state.phase === "drawing" && !!this.state.round && this.state.round.candidates.length === 0;
    }
  
    private choose(tally: { chosen: string; tied: string[] }, now: number): RoomEvent[] {
      const s = this.state;
      const r = s.round!;
      r.chosen = tally.chosen;
      r.tied = tally.tied;
      r.revealUntil = now + (tally.tied.length > 1 ? SPIN_MS : REVEAL_MS);
      r.deadline = now + LOAD_TIMEOUT_MS;
      s.phase = "loading";
      for (const m of s.members) m.loaded = false;
      const title = r.candidates.find((c) => c.slug === tally.chosen)?.title ?? tally.chosen;
      return [{ kind: "chosen", slug: tally.chosen, title, spin: tally.tied.length > 1 }, ...this.advance(now)];
    }
  
    /** Back to ready-up. Closes the room if it was waiting for the round to end. */
    private toLobby(now: number): RoomEvent[] {
      const s = this.state;
      const n = s.round?.n ?? 0;
      s.phase = "lobby";
      s.round = null;
      s.lastActivity = now;
      for (const m of s.members) {
        m.ready = false;
        m.readyBy = null;
        m.loaded = false;
      }
      const events: RoomEvent[] = [{ kind: "roundEnded", n }];
      if (s.closing) {
        s.closed = "paid_host_left";
        events.push({ kind: "closed", reason: "paid_host_left" });
      }
      return events;
    }
  
    private abort(reason: AbortReason, now: number): RoomEvent[] {
      return [{ kind: "roundAborted", reason }, ...this.toLobby(now)];
    }
  
    /**
     * Moves the round forward by everything that is due or complete at
     * `now`. Idempotent: every mutating method ends by calling it, and so
     * does the alarm.
     */
    advance(now: number): RoomEvent[] {
      const s = this.state;
      const events: RoomEvent[] = [];
      for (let guard = 0; guard < 10 && !this.isClosed; guard++) {
        const before = `${s.phase}|${s.members.length}|${s.round?.goAt ?? ""}|${s.round?.chosen ?? ""}`;
        this.step(now, events);
        const after = `${s.phase}|${s.members.length}|${s.round?.goAt ?? ""}|${s.round?.chosen ?? ""}`;
        if (before === after) break;
      }
      s.lastTick = now;
      return events;
    }
  
    private step(now: number, events: RoomEvent[]): void {
      const s = this.state;
  
      if (NEEDS_TWO.includes(s.phase) && s.members.length < 2) {
        events.push(...this.abort("not_enough_players", now));
        return;
      }
  
      switch (s.phase) {
        case "lobby": {
          // The idle clock only runs while there is someone to be ready with.
          for (const m of [...s.members]) {
            if (s.members.length < 2 || m.ready) {
              m.readyBy = null;
            } else if (m.readyBy === null) {
              m.readyBy = now + READY_TIMEOUT_MS;
            } else if (m.readyBy <= now) {
              events.push(...this.removeMember(m.userId, now, "idle"));
            }
          }
          if (this.isClosed) return;
          if (s.members.length >= 2 && s.members.every((m) => m.ready)) {
            s.roundCount += 1;
            s.phase = "drawing";
            s.round = {
              n: s.roundCount,
              candidates: [],
              votes: {},
              deadline: now + DRAW_TIMEOUT_MS + 2_000,
              chosen: null,
              tied: [],
              revealUntil: 0,
              goAt: null,
            };
            for (const m of s.members) m.readyBy = null;
          }
          return;
        }
        case "drawing": {
          if (s.round && s.round.deadline !== null && now >= s.round.deadline) {
            events.push(...this.abort("draw_failed", now));
          }
          return;
        }
        case "voting": {
          const r = s.round!;
          const present = s.members.filter((m) => m.awayUntil === null);
          const allVoted = present.length > 0 && present.every((m) => r.votes[m.userId] !== undefined);
          if (allVoted || (r.deadline !== null && now >= r.deadline)) {
            const tally = tallyVotes(
              r.candidates.map((c) => c.slug),
              r.votes,
              this.rng,
            );
            events.push(...this.choose(tally, now));
          }
          return;
        }
        case "loading": {
          const r = s.round!;
          if (r.deadline !== null && now >= r.deadline) {
            for (const m of [...s.members]) {
              if (!m.loaded) events.push(...this.removeMember(m.userId, now, "unloaded"));
            }
            if (this.isClosed) return;
            if (s.members.length < 2) return; // the next step aborts
          }
          if (now >= r.revealUntil && s.members.every((m) => m.loaded)) {
            r.goAt = now + COUNTDOWN_MS + START_BUFFER_MS;
            r.deadline = null;
            s.phase = "countdown";
            events.push({ kind: "countdown", goAt: r.goAt });
          }
          return;
        }
        case "countdown": {
          const r = s.round!;
          if (r.goAt !== null && now >= r.goAt) {
            s.phase = "racing";
            r.deadline = r.goAt + PLACEHOLDER_RACE_MS;
          }
          return;
        }
        case "racing": {
          const r = s.round;
          if (r && r.deadline !== null && now >= r.deadline) events.push(...this.toLobby(now));
          return;
        }
      }
    }
  
    // ---- race phase ------------------------------------------------------
    // Stage 3 replaces the placeholder timer in step() with the real race;
    // these two stay as the way in and out.
    beginRace(): Result {
      const s = this.state;
      if (this.isClosed || (s.phase !== "lobby" && s.phase !== "countdown")) return fail("cannot_start");
      s.phase = "racing";
      return ok();
    }
  
    endRace(now: number): Result {
      const s = this.state;
      if (s.phase !== "racing") return fail("no_race");
      return ok(this.toLobby(now));
    }
  
    // ---- time ----------------------------------------------------------
    /** Apply everything that is due by `now`: expired grace periods, idle expiry, round timers. */
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
      events.push(...this.advance(now));
      if (this.isClosed) return events;
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
  
      // Round timers. Anything at or before lastTick was already handled.
      const later = (t: number | null | undefined) => {
        if (typeof t === "number" && t > s.lastTick) times.push(t);
      };
      if (s.phase === "lobby") for (const m of s.members) later(m.readyBy);
      const r = s.round;
      if (r && s.phase !== "lobby") {
        later(r.deadline);
        if (s.phase === "loading") later(r.revealUntil);
        if (s.phase === "countdown") later(r.goAt);
      }
      return times.length ? Math.min(...times) : null;
    }
  }