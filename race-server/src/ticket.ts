// Verifies the short-lived ticket the Flask backend signs (POST /api/race/ticket).
// HS256 with the shared RACE_TICKET_SECRET; uses WebCrypto, so it runs
// the same in a Worker and in Node.

export interface Ticket {
    userId: string;
    username: string;
    paid: boolean;
  }
  
  const LEEWAY_SECONDS = 10;
  const encoder = new TextEncoder();
  
  function b64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  
  function parseJson(bytes: Uint8Array): unknown {
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
  }
  
  /** Returns the ticket's claims, or null for anything wrong with it. */
  export async function verifyTicket(token: string, secret: string, nowSeconds: number): Promise<Ticket | null> {
    if (!secret) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [head, body, sig] = parts;
  
    let header: unknown;
    let claims: unknown;
    let signature: Uint8Array<ArrayBuffer>;
    try {
      header = parseJson(b64urlToBytes(head));
      claims = parseJson(b64urlToBytes(body));
      signature = b64urlToBytes(sig);
    } catch {
      return null;
    }
    if (!header || typeof header !== "object" || (header as { alg?: unknown }).alg !== "HS256") return null;
  
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "verify",
    ]);
    const valid = await crypto.subtle.verify("HMAC", key, signature, encoder.encode(`${head}.${body}`));
    if (!valid) return null;
  
    if (!claims || typeof claims !== "object") return null;
    const c = claims as Record<string, unknown>;
    if (c.aud !== "race") return null;
    if (typeof c.exp !== "number" || c.exp + LEEWAY_SECONDS < nowSeconds) return null;
    if (typeof c.iat === "number" && c.iat - LEEWAY_SECONDS > nowSeconds) return null;
    if (typeof c.sub !== "string" || !c.sub) return null;
    if (typeof c.username !== "string" || !c.username) return null;
    if (typeof c.paid !== "boolean") return null;
    return { userId: c.sub, username: c.username, paid: c.paid };
  }


// ---- the other direction: the Worker proves itself to the backend -------

function bytesToB64url(bytes: Uint8Array): string {
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  
  const jsonB64 = (value: unknown) => bytesToB64url(encoder.encode(JSON.stringify(value)));
  
  export const INTERNAL_AUDIENCE = "race-internal";
  
  /**
   * A 60-second HS256 token for the Worker's calls to the Flask backend
   * (asking for candidate levels). Same shared secret as the tickets, but a
   * different audience, so a player's ticket can't be used to call the
   * backend's internal route and vice versa.
   */
  export async function signInternalToken(secret: string, nowSeconds: number): Promise<string> {
    const head = jsonB64({ alg: "HS256", typ: "JWT" });
    const body = jsonB64({ aud: INTERNAL_AUDIENCE, iss: "race-worker", iat: nowSeconds, exp: nowSeconds + 60 });
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
    ]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${head}.${body}`)));
    return `${head}.${body}.${bytesToB64url(sig)}`;
  }