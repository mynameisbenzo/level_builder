import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTicket } from "../src/ticket";

const SECRET = "a-shared-secret-that-is-long-enough";
const NOW = 1_800_000_000;

const b64 = (value: unknown) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

function sign(claims: Record<string, unknown>, secret = SECRET, header: Record<string, unknown> = { alg: "HS256", typ: "JWT" }) {
  const body = `${b64(header)}.${b64(claims)}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

const good = { sub: "u1", username: "Lorenzo", paid: true, aud: "race", iat: NOW, exp: NOW + 120 };

describe("verifyTicket", () => {
  it("accepts a good ticket", async () => {
    expect(await verifyTicket(sign(good), SECRET, NOW)).toEqual({ userId: "u1", username: "Lorenzo", paid: true });
  });

  it("rejects a wrong secret, a tampered body and junk", async () => {
    expect(await verifyTicket(sign(good, "other-secret"), SECRET, NOW)).toBeNull();
    const [h, , s] = sign(good).split(".");
    expect(await verifyTicket(`${h}.${b64({ ...good, paid: true, sub: "admin" })}.${s}`, SECRET, NOW)).toBeNull();
    expect(await verifyTicket("not a token", SECRET, NOW)).toBeNull();
    expect(await verifyTicket("a.b.c", SECRET, NOW)).toBeNull();
    expect(await verifyTicket("", SECRET, NOW)).toBeNull();
  });

  it("rejects expired tickets but forgives a few seconds of clock skew", async () => {
    expect(await verifyTicket(sign(good), SECRET, NOW + 120 + 11)).toBeNull();
    expect(await verifyTicket(sign(good), SECRET, NOW + 120 + 5)).not.toBeNull();
  });

  it("rejects tickets from the future", async () => {
    expect(await verifyTicket(sign({ ...good, iat: NOW + 60, exp: NOW + 180 }), SECRET, NOW)).toBeNull();
  });

  it("rejects a ticket meant for something else", async () => {
    expect(await verifyTicket(sign({ ...good, aud: "login" }), SECRET, NOW)).toBeNull();
  });

  it("rejects alg none and other algorithms", async () => {
    expect(await verifyTicket(sign(good, SECRET, { alg: "none" }), SECRET, NOW)).toBeNull();
    expect(await verifyTicket(`${b64({ alg: "none" })}.${b64(good)}.`, SECRET, NOW)).toBeNull();
    expect(await verifyTicket(sign(good, SECRET, { alg: "HS512" }), SECRET, NOW)).toBeNull();
  });

  it("rejects missing or mistyped claims", async () => {
    for (const bad of [{ sub: "" }, { username: "" }, { paid: "yes" }, { exp: "soon" }]) {
      expect(await verifyTicket(sign({ ...good, ...bad }), SECRET, NOW)).toBeNull();
    }
  });

  it("refuses everything when no secret is configured", async () => {
    expect(await verifyTicket(sign(good, ""), "", NOW)).toBeNull();
  });
});