import { describe, expect, it } from "vitest";
import { AWAY_GRACE_MS, MAX_PLAYERS, ROOM_IDLE_MS } from "../src/config";
import { RoomLogic, type Who } from "../src/room";

const T0 = 1_000_000;
const host: Who = { userId: "h", username: "Hosty", paid: true };
const paid2: Who = { userId: "p2", username: "PaidTwo", paid: true };
const paid3: Who = { userId: "p3", username: "PaidThree", paid: true };
const free1: Who = { userId: "f1", username: "FreeOne", paid: false };
const free2: Who = { userId: "f2", username: "FreeTwo", paid: false };
const free3: Who = { userId: "f3", username: "FreeThree", paid: false };

function room(mode: "host" | "party" | "public" = "public") {
  const r = RoomLogic.create("ABC234", host, T0);
  r.setMode("h", mode, T0);
  expect(r.join(host, T0).ok).toBe(true);
  return r;
}

describe("joining", () => {
  it("lets the host in first and marks them host", () => {
    const r = room();
    expect(r.snapshot().players[0]).toMatchObject({ userId: "h", isHost: true });
  });

  it("admits anyone in public mode, free accounts included", () => {
    const r = room("public");
    expect(r.join(free1, T0 + 1).ok).toBe(true);
    expect(r.snapshot().players).toHaveLength(2);
  });

  it("refuses an uninvited account in host-invite mode, even with the link", () => {
    const r = room("host");
    expect(r.join(free1, T0 + 1)).toEqual({ ok: false, code: "not_invited" });
  });

  it("admits an invited username regardless of capitalisation", () => {
    const r = room("host");
    r.invite("h", "  freeONE ", T0);
    expect(r.join(free1, T0 + 1).ok).toBe(true);
  });

  it("only the host can invite in host mode, any member in party mode", () => {
    const r = room("host");
    r.setMode("h", "public", T0);
    r.join(free1, T0);
    r.setMode("h", "host", T0);
    expect(r.invite("f1", "someone", T0)).toEqual({ ok: false, code: "not_allowed" });
    r.setMode("h", "party", T0);
    expect(r.invite("f1", "someone", T0).ok).toBe(true);
    expect(r.invite("stranger", "x", T0)).toEqual({ ok: false, code: "not_allowed" });
  });

  it("does not need invites in public mode", () => {
    expect(room("public").invite("h", "x", T0)).toEqual({ ok: false, code: "public_room" });
  });

  it("caps the room at four players and a full room can't be entered", () => {
    const r = room("public");
    expect(MAX_PLAYERS).toBe(4);
    r.join(free1, T0);
    r.join(free2, T0);
    r.join(free3, T0);
    expect(r.join(paid2, T0)).toEqual({ ok: false, code: "full" });
  });

  it("lets someone back in after a slot frees up", () => {
    const r = room("public");
    r.join(free1, T0);
    r.join(free2, T0);
    r.join(free3, T0);
    r.leave("f2", T0);
    expect(r.join(paid2, T0).ok).toBe(true);
  });

  it("nobody joins a race under way, but a free slot reopens afterwards", () => {
    const r = room("public");
    r.join(free1, T0);
    r.beginRace();
    expect(r.join(free2, T0)).toEqual({ ok: false, code: "race_in_progress" });
    r.endRace(T0);
    expect(r.join(free2, T0).ok).toBe(true);
  });

  it("changing the mode never kicks anyone already inside", () => {
    const r = room("public");
    r.join(free1, T0);
    r.setMode("h", "host", T0);
    expect(r.snapshot().players).toHaveLength(2);
  });

  it("only the host changes the join mode", () => {
    const r = room("public");
    r.join(free1, T0);
    expect(r.setMode("f1", "host", T0)).toEqual({ ok: false, code: "not_host" });
    expect(r.setMode("h", "bogus" as never, T0)).toEqual({ ok: false, code: "bad_mode" });
  });

  it("caps the invite list", () => {
    const r = room("host");
    for (let i = 0; i < 20; i++) expect(r.invite("h", `user${i}`, T0).ok).toBe(true);
    expect(r.invite("h", "one-too-many", T0)).toEqual({ ok: false, code: "too_many_invites" });
  });

  it("host can withdraw an invite", () => {
    const r = room("host");
    r.invite("h", "freeone", T0);
    r.uninvite("h", "FreeOne", T0);
    expect(r.join(free1, T0)).toEqual({ ok: false, code: "not_invited" });
  });
});

describe("kicking", () => {
  it("removes the player, bans them and drops their invite", () => {
    const r = room("host");
    r.invite("h", "freeone", T0);
    r.join(free1, T0);
    const res = r.kick("h", "f1", T0);
    expect(res).toMatchObject({ ok: true, events: [{ kind: "kicked", userId: "f1" }] });
    expect(r.join(free1, T0)).toEqual({ ok: false, code: "banned" });
    r.setMode("h", "public", T0);
    expect(r.join(free1, T0)).toEqual({ ok: false, code: "banned" });
  });

  it("is host-only and never on yourself", () => {
    const r = room("public");
    r.join(free1, T0);
    r.join(free2, T0);
    expect(r.kick("f1", "f2", T0)).toEqual({ ok: false, code: "not_host" });
    expect(r.kick("h", "h", T0)).toEqual({ ok: false, code: "cannot_kick_self" });
    expect(r.kick("h", "nobody", T0)).toEqual({ ok: false, code: "not_in_room" });
  });
});

describe("host handover", () => {
  it("passes to the longest-present paid player, skipping free ones", () => {
    const r = room("public");
    r.join(free1, T0 + 1);
    r.join(paid3, T0 + 2);
    r.join(paid2, T0 + 3);
    const res = r.leave("h", T0 + 10);
    expect(res).toMatchObject({ ok: true });
    expect(r.state.hostId).toBe("p3");
    expect(r.isClosed).toBe(false);
  });

  it("closes the room when only free players remain", () => {
    const r = room("public");
    r.join(free1, T0 + 1);
    const res = r.leave("h", T0 + 10);
    expect(res).toMatchObject({ ok: true });
    expect(r.state.closed).toBe("paid_host_left");
    expect(r.join(free2, T0 + 11)).toEqual({ ok: false, code: "closed" });
  });

  it("mid-race it waits for the race to end before closing", () => {
    const r = room("public");
    r.join(free1, T0 + 1);
    r.beginRace();
    const res = r.leave("h", T0 + 10);
    expect(res).toMatchObject({ ok: true, events: [{ kind: "left" }, { kind: "closing", reason: "paid_host_left" }] });
    expect(r.isClosed).toBe(false);
    expect(r.state.closing).toBe(true);
    const end = r.endRace(T0 + 20);
    expect(end).toMatchObject({ ok: true, events: [{ kind: "closed" }] });
    expect(r.isClosed).toBe(true);
  });

  it("a solo host who leaves keeps their seat so they can come back", () => {
    const r = room("host");
    r.leave("h", T0 + 1);
    expect(r.isClosed).toBe(false);
    expect(r.join(host, T0 + 2).ok).toBe(true);
    expect(r.state.hostId).toBe("h");
  });

  it("a former host rejoining after handover is an ordinary player again", () => {
    const r = room("public");
    r.join(paid2, T0 + 1);
    r.leave("h", T0 + 2);
    r.setMode("p2", "host", T0 + 3);
    expect(r.join(host, T0 + 4)).toEqual({ ok: false, code: "not_invited" });
  });
});

describe("dropped connections", () => {
  it("keeps the slot through the grace period and restores it on reconnect", () => {
    const r = room("public");
    r.join(free1, T0);
    r.disconnect("f1", T0 + 100);
    expect(r.tick(T0 + 100 + AWAY_GRACE_MS - 1)).toEqual([]);
    expect(r.join(free1, T0 + 100 + AWAY_GRACE_MS - 1)).toMatchObject({ ok: true, events: [{ kind: "reconnected" }] });
    expect(r.tick(T0 + 100 + AWAY_GRACE_MS + 5)).toEqual([]);
    expect(r.snapshot().players).toHaveLength(2);
  });

  it("removes the player once the grace period runs out", () => {
    const r = room("public");
    r.join(free1, T0);
    r.disconnect("f1", T0 + 100);
    const events = r.tick(T0 + 100 + AWAY_GRACE_MS);
    expect(events).toEqual([{ kind: "left", userId: "f1", username: "FreeOne", reason: "timeout" }]);
  });

  it("a host refresh doesn't hand over the room", () => {
    const r = room("public");
    r.join(paid2, T0);
    r.disconnect("h", T0 + 1);
    r.join(host, T0 + 2);
    r.tick(T0 + AWAY_GRACE_MS * 2);
    expect(r.state.hostId).toBe("h");
  });

  it("a host who stays away loses the seat to the next paid player", () => {
    const r = room("public");
    r.join(paid2, T0);
    r.disconnect("h", T0 + 1);
    r.tick(T0 + 1 + AWAY_GRACE_MS);
    expect(r.state.hostId).toBe("p2");
  });
});

describe("idle expiry", () => {
  it("deletes a room nobody is connected to after ten minutes", () => {
    const r = room("public");
    r.leave("h", T0);
    expect(r.tick(T0 + ROOM_IDLE_MS - 1)).toEqual([]);
    expect(r.tick(T0 + ROOM_IDLE_MS)).toEqual([{ kind: "closed", reason: "expired" }]);
  });

  it("never expires a room people are connected to", () => {
    const r = room("public");
    expect(r.tick(T0 + ROOM_IDLE_MS * 5)).toEqual([]);
    expect(r.nextWake()).toBeNull();
  });

  it("reports when to wake next", () => {
    const r = room("public");
    r.join(free1, T0);
    r.disconnect("f1", T0 + 50);
    expect(r.nextWake()).toBe(T0 + 50 + AWAY_GRACE_MS);
    r.leave("f1", T0 + 60);
    r.leave("h", T0 + 70);
    expect(r.nextWake()).toBe(T0 + 70 + ROOM_IDLE_MS);
  });
});

describe("closing", () => {
  it("only the host can close the room", () => {
    const r = room("public");
    r.join(free1, T0);
    expect(r.closeByHost("f1")).toEqual({ ok: false, code: "not_host" });
    expect(r.closeByHost("h").ok).toBe(true);
    expect(r.isClosed).toBe(true);
  });

  it("public info never reveals the invite list", () => {
    const r = room("host");
    r.invite("h", "secret", T0);
    expect(JSON.stringify(r.publicInfo())).not.toContain("secret");
  });
});