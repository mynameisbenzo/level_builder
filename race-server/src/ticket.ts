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