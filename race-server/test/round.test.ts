import { describe, expect, it } from "vitest";
import {
  COUNTDOWN_MS,
  LOAD_TIMEOUT_MS,
  PLACEHOLDER_RACE_MS,
  READY_TIMEOUT_MS,
  REVEAL_MS,
  SPIN_MS,
  START_BUFFER_MS,
  VOTE_MS,
} from "../src/config";
import { RoomLogic, type Candidate, type Who } from "../src/room";

const T0 = 1_000_000;
const host: Who = { userId: "h", username: "Hosty", paid: true };
const p2: Who = { userId: "p2", username: "Two", paid: false };
const p3: Who = { userId: "p3", username: "Three", paid: false };

const cand = (slug: string): Candidate => ({
  slug,
  title: `Level ${slug}`,
  owner: "someone",
  difficulty: null,
  thumbnailUrl: null,
});
const four = ["a", "b", "c", "d"].map(cand);

function lobby(rng: () => number = () => 0, extra: Who[] = [p2]) {
  const r = RoomLogic.create("ABC234", host, T0, rng);
  r.setMode("h", "public", T0);
  r.join(host, T0);
  for (const w of extra) r.join(w, T0);
  return r;
}

function everyoneReady(r: RoomLogic, now = T0 + 100) {
  for (const m of r.state.members) r.setReady(m.userId, true, now);
}

/** Lobby -> drawing -> voting, returning the time the vote began. */
function toVoting(r: RoomLogic, cands = four, now = T0 + 100) {
  everyoneReady(r, now);
  expect(r.state.phase).toBe("drawing");
  r.finishDraw(cands, now + 50);
  return now + 50;
}

describe("ready-up", () => {
  it("starts the draw only when everyone is ready and there are at least two", () => {
    const solo = lobby(() => 0, []);
    solo.setReady("h", true, T0 + 1);
    expect(solo.state.phase).toBe("lobby");

    const r = lobby();
    r.setReady("h", true, T0 + 1);
    expect(r.state.phase).toBe("lobby");
    r.setReady("p2", true, T0 + 2);
    expect(r.state.phase).toBe("drawing");
    expect(r.needsDraw).toBe(true);
  });

  it("un-readying before the last player readies keeps it in the lobby", () => {
    const r = lobby();
    r.setReady("h", true, T0 + 1);
    r.setReady("h", false, T0 + 2);
    r.setReady("p2", true, T0 + 3);
    expect(r.state.phase).toBe("lobby");
  });

  it("removes a player who is not ready after a minute, only while two are present", () => {
    const r = lobby();
    r.setReady("h", true, T0 + 10); // p2 stays unready
    const wake = r.nextWake();
    expect(wake).toBe(T0 + READY_TIMEOUT_MS); // p2's clock started when the second player arrived
    const events = r.tick(T0 + READY_TIMEOUT_MS);
    expect(events).toContainEqual(expect.objectContaining({ kind: "left", userId: "p2", reason: "idle" }));
    expect(r.state.members.map((m) => m.userId)).toEqual(["h"]);
  });

  it("a lone player is never kicked for being idle", () => {
    const r = lobby(() => 0, []);
    r.tick(T0 + READY_TIMEOUT_MS * 5);
    expect(r.state.members).toHaveLength(1);
    expect(r.state.members[0].readyBy).toBeNull();
  });

  it("only the host sets the category, and only between rounds", () => {
    const r = lobby();
    expect(r.setCategory("p2", "hard", T0)).toEqual({ ok: false, code: "not_host" });
    expect(r.setCategory("h", "nope", T0)).toEqual({ ok: false, code: "bad_category" });
    expect(r.setCategory("h", "hard", T0).ok).toBe(true);
    expect(r.state.category).toBe("hard");
    everyoneReady(r);
    expect(r.setCategory("h", "easy", T0 + 200)).toEqual({ ok: false, code: "not_now" });
  });

  it("readying is refused outside the lobby", () => {
    const r = lobby();
    toVoting(r);
    expect(r.setReady("p2", false, T0 + 500)).toEqual({ ok: false, code: "not_now" });
  });
});

describe("the draw", () => {
  it("opens a vote when candidates arrive", () => {
    const r = lobby();
    const t = toVoting(r);
    expect(r.state.phase).toBe("voting");
    expect(r.state.round?.deadline).toBe(t + VOTE_MS);
    expect(r.snapshot(t).round?.candidates).toHaveLength(4);
  });

  it("skips the vote when only one level is available", () => {
    const r = lobby();
    everyoneReady(r);
    r.finishDraw([cand("only")], T0 + 200);
    expect(r.state.phase).toBe("loading");
    expect(r.state.round?.chosen).toBe("only");
    expect(r.state.round?.tied).toEqual([]);
  });

  it("no levels in the category sends everyone back to ready-up", () => {
    const r = lobby();
    everyoneReady(r);
    const res = r.finishDraw([], T0 + 200);
    expect(res.ok && res.events).toContainEqual({ kind: "roundAborted", reason: "no_levels" });
    expect(r.state.phase).toBe("lobby");
    expect(r.state.members.every((m) => !m.ready)).toBe(true);
  });

  it("a failed fetch aborts the same way", () => {
    const r = lobby();
    everyoneReady(r);
    const res = r.finishDraw(null, T0 + 200);
    expect(res.ok && res.events).toContainEqual({ kind: "roundAborted", reason: "draw_failed" });
    expect(r.state.phase).toBe("lobby");
  });

  it("a draw that never answers times out", () => {
    const r = lobby();
    everyoneReady(r);
    const deadline = r.state.round!.deadline!;
    expect(r.nextWake()).toBe(deadline);
    r.tick(deadline);
    expect(r.state.phase).toBe("lobby");
  });

  it("a late answer for an aborted draw is ignored", () => {
    const r = lobby();
    everyoneReady(r);
    r.abortRound("at_capacity", T0 + 150);
    expect(r.state.phase).toBe("lobby");
    r.finishDraw(four, T0 + 300);
    expect(r.state.phase).toBe("lobby");
  });
});

describe("the vote", () => {
  it("ends early once everyone present has voted", () => {
    const r = lobby();
    const t = toVoting(r);
    r.vote("h", "b", t + 10);
    expect(r.state.phase).toBe("voting");
    r.vote("p2", "b", t + 20);
    expect(r.state.phase).toBe("loading");
    expect(r.state.round).toMatchObject({ chosen: "b", tied: [] });
  });

  it("lets a player change their vote", () => {
    const r = lobby(() => 0);
    const t = toVoting(r);
    r.vote("h", "a", t + 1);
    r.vote("h", "c", t + 2);
    expect(r.state.round?.votes).toEqual({ h: "c" });
  });

  it("rejects a vote for a level that isn't a candidate", () => {
    const r = lobby();
    const t = toVoting(r);
    expect(r.vote("h", "zzz", t + 1)).toEqual({ ok: false, code: "bad_level" });
  });

  it("a tie spins and gives the room the spin time before the countdown", () => {
    const r = lobby(() => 0.99);
    const t = toVoting(r);
    r.vote("h", "a", t + 1);
    const res = r.vote("p2", "d", t + 2);
    expect(res.ok && res.events).toContainEqual({ kind: "chosen", slug: "d", title: "Level d", spin: true });
    expect(r.state.round?.tied).toEqual(["a", "d"]);
    expect(r.state.round?.revealUntil).toBe(t + 2 + SPIN_MS);
  });

  it("nobody voting picks at random when the timer runs out", () => {
    const r = lobby(() => 0.5);
    const t = toVoting(r);
    expect(r.nextWake()).toBe(t + VOTE_MS);
    r.tick(t + VOTE_MS);
    expect(r.state.phase).toBe("loading");
    expect(r.state.round).toMatchObject({ chosen: "c", tied: [] });
  });

  it("a vote after the vote ended is quietly ignored", () => {
    const r = lobby();
    const t = toVoting(r);
    r.vote("h", "a", t + 1);
    r.vote("p2", "a", t + 2);
    expect(r.vote("p2", "b", t + 3)).toEqual({ ok: true, events: [] });
    expect(r.state.round?.chosen).toBe("a");
  });

  it("a player who leaves mid-vote doesn't hold it up", () => {
    const r = lobby(() => 0, [p2, p3]);
    const t = toVoting(r);
    r.vote("h", "a", t + 1);
    r.vote("p2", "a", t + 2);
    expect(r.state.phase).toBe("voting");
    r.leave("p3", t + 3);
    expect(r.state.phase).toBe("loading");
  });

  it("an away player is not waited for", () => {
    const r = lobby(() => 0, [p2, p3]);
    const t = toVoting(r);
    r.vote("h", "a", t + 1);
    r.vote("p2", "a", t + 2);
    r.disconnect("p3", t + 3);
    expect(r.state.phase).toBe("loading");
  });

  it("the round is abandoned if only one player is left", () => {
    const r = lobby();
    const t = toVoting(r);
    const res = r.leave("p2", t + 1);
    expect(res.ok && res.events).toContainEqual({ kind: "roundAborted", reason: "not_enough_players" });
    expect(r.state.phase).toBe("lobby");
  });
});

describe("loading and the countdown", () => {
  function toLoading(rng: () => number = () => 0, extra: Who[] = [p2]) {
    const r = lobby(rng, extra);
    const t = toVoting(r);
    const members = r.state.members.map((m) => m.userId);
    for (const id of members) r.vote(id, "a", t + 1);
    expect(r.state.phase).toBe("loading");
    return { r, t: t + 1 };
  }

  it("waits for every client to report loaded", () => {
    const { r, t } = toLoading();
    r.loaded("h", "a", t + REVEAL_MS + 10);
    expect(r.state.phase).toBe("loading");
    const res = r.loaded("p2", "a", t + REVEAL_MS + 20);
    expect(r.state.phase).toBe("countdown");
    const goAt = t + REVEAL_MS + 20 + COUNTDOWN_MS + START_BUFFER_MS;
    expect(r.state.round?.goAt).toBe(goAt);
    expect(res.ok && res.events).toContainEqual({ kind: "countdown", goAt });
  });

  it("never starts the countdown before the reveal is over, even if everyone loaded", () => {
    const { r, t } = toLoading();
    r.loaded("h", "a", t + 100);
    r.loaded("p2", "a", t + 200);
    expect(r.state.phase).toBe("loading");
    expect(r.nextWake()).toBe(t + REVEAL_MS);
    r.tick(t + REVEAL_MS);
    expect(r.state.phase).toBe("countdown");
  });

  it("a tie holds the countdown for the longer spin", () => {
    const r = lobby(() => 0);
    const t = toVoting(r);
    r.vote("h", "a", t + 1);
    r.vote("p2", "b", t + 2);
    r.loaded("h", "a", t + 100);
    r.loaded("p2", "a", t + 100);
    expect(r.state.phase).toBe("loading");
    r.tick(t + 2 + SPIN_MS);
    expect(r.state.phase).toBe("countdown");
  });

  it("ignores a loaded report for the wrong level", () => {
    const { r, t } = toLoading();
    r.loaded("h", "b", t + REVEAL_MS + 1);
    expect(r.member("h")?.loaded).toBe(false);
  });

  it("drops anyone who hasn't loaded in 15 seconds and starts without them", () => {
    const { r, t } = toLoading(() => 0, [p2, p3]);
    r.loaded("h", "a", t + 2000);
    r.loaded("p2", "a", t + 2000);
    expect(r.state.phase).toBe("loading");
    expect(r.nextWake()).toBe(t + LOAD_TIMEOUT_MS);
    const events = r.tick(t + LOAD_TIMEOUT_MS);
    expect(events).toContainEqual(expect.objectContaining({ kind: "left", userId: "p3", reason: "unloaded" }));
    expect(r.state.phase).toBe("countdown");
    expect(r.state.members.map((m) => m.userId)).toEqual(["h", "p2"]);
  });

  it("aborts if the load timeout leaves fewer than two", () => {
    const { r, t } = toLoading();
    r.loaded("h", "a", t + 2000);
    r.tick(t + LOAD_TIMEOUT_MS);
    expect(r.state.phase).toBe("lobby");
    expect(r.state.members.map((m) => m.userId)).toEqual(["h"]);
  });

  it("turns away someone who tries to join once loading has begun", () => {
    const { r } = toLoading();
    expect(r.join({ userId: "late", username: "Late", paid: false }, T0 + 9999)).toEqual({
      ok: false,
      code: "race_in_progress",
    });
  });

  it("goes to racing at the go time, and the placeholder race then returns everyone to ready-up", () => {
    const { r, t } = toLoading();
    const tl = t + REVEAL_MS;
    r.loaded("h", "a", tl);
    r.loaded("p2", "a", tl);
    const goAt = r.state.round!.goAt!;
    expect(r.nextWake()).toBe(goAt);
    r.tick(goAt - 1);
    expect(r.state.phase).toBe("countdown");
    r.tick(goAt);
    expect(r.state.phase).toBe("racing");
    expect(r.nextWake()).toBe(goAt + PLACEHOLDER_RACE_MS);
    const events = r.tick(goAt + PLACEHOLDER_RACE_MS);
    expect(events).toContainEqual({ kind: "roundEnded", n: 1 });
    expect(r.state.phase).toBe("lobby");
    expect(r.state.members.every((m) => !m.ready && !m.loaded)).toBe(true);
  });

  it("every client gets the same go time from the same snapshot", () => {
    const { r, t } = toLoading();
    r.loaded("h", "a", t + REVEAL_MS);
    r.loaded("p2", "a", t + REVEAL_MS);
    const snap = r.snapshot(t + REVEAL_MS);
    expect(snap.phase).toBe("countdown");
    expect(snap.round?.chosen).toBe("a");
    expect(snap.round?.goAt).toBe(t + REVEAL_MS + COUNTDOWN_MS + START_BUFFER_MS);
  });
});

describe("rounds and the paid-host rule", () => {
  it("a second round numbers up and clears the first round's votes", () => {
    const r = lobby();
    let t = toVoting(r);
    r.vote("h", "a", t + 1);
    r.vote("p2", "a", t + 1);
    const tl = t + 1 + REVEAL_MS;
    r.loaded("h", "a", tl);
    r.loaded("p2", "a", tl);
    const goAt = r.state.round!.goAt!;
    r.tick(goAt);
    r.tick(goAt + PLACEHOLDER_RACE_MS);
    t = goAt + PLACEHOLDER_RACE_MS + 100;
    everyoneReady(r, t);
    expect(r.state.round?.n).toBe(2);
    expect(r.state.round?.votes).toEqual({});
  });

  it("when the host (the only paid player) leaves mid-countdown, the room closes after the round", () => {
    const r = lobby(() => 0, [p2, p3]);
    const t = toVoting(r);
    for (const id of ["h", "p2", "p3"]) r.vote(id, "a", t + 1);
    const tl = t + 1 + REVEAL_MS;
    for (const id of ["h", "p2", "p3"]) r.loaded(id, "a", tl);
    expect(r.state.phase).toBe("countdown");
    r.leave("h", tl + 10);
    expect(r.state.closing).toBe(true);
    expect(r.isClosed).toBe(false);
    const goAt = r.state.round!.goAt!;
    r.tick(goAt);
    r.tick(goAt + PLACEHOLDER_RACE_MS);
    expect(r.state.closed).toBe("paid_host_left");
  });

  it("when the host leaves during the vote the room closes at once (no race under way)", () => {
    const r = lobby();
    toVoting(r);
    r.leave("h", T0 + 500);
    expect(r.state.closed).toBe("paid_host_left");
  });

  it("an old saved room without round fields still loads", () => {
    const r = lobby();
    const old = JSON.parse(JSON.stringify(r.state));
    delete old.category;
    delete old.round;
    delete old.roundCount;
    delete old.lastTick;
    for (const m of old.members) {
      delete m.ready;
      delete m.readyBy;
      delete m.loaded;
    }
    const revived = new RoomLogic(old);
    expect(revived.state.category).toBe("any");
    expect(revived.state.members[0].ready).toBe(false);
  });
});