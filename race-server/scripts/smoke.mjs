// End-to-end check of a RUNNING race server (local `wrangler dev` or deployed).
//   RACE_TICKET_SECRET=<same secret as the server> node scripts/smoke.mjs <base-url>
// e.g. node scripts/smoke.mjs http://127.0.0.1:8787
import { createHmac } from "node:crypto";
import WebSocket from "ws";

const base = (process.argv[2] ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const secret = process.env.RACE_TICKET_SECRET;
if (!secret) throw new Error("set RACE_TICKET_SECRET to the server's secret");

const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
function ticket(userId, username, paid, { expIn = 120 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: userId, username, paid, aud: "race", iat: now, exp: now + expIn })}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + extra}`);
  if (!ok) failures++;
}

async function api(path, { method = "GET", token } = {}) {
  const res = await fetch(`${base}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
}

class Client {
  constructor(code, who) {
    this.who = who;
    this.messages = [];
    this.closed = null;
    this.ws = new WebSocket(`${base.replace(/^http/, "ws")}/api/rooms/${code}/ws?ticket=${encodeURIComponent(who.ticket)}`);
    this.ws.on("message", (d) => this.messages.push(JSON.parse(d.toString())));
    this.opened = new Promise((resolve) => this.ws.on("open", resolve));
    this.done = new Promise((resolve) =>
      this.ws.on("close", (code, reason) => {
        this.closed = { code, reason: reason.toString() };
        resolve();
      }),
    );
    this.ws.on("error", () => {});
  }
  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }
  async waitFor(pred, ms = 3000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = this.messages.find(pred);
      if (hit) return hit;
      await sleep(25);
    }
    return null;
  }
  last(type) {
    return [...this.messages].reverse().find((m) => m.t === type);
  }
}

const person = (id, name, paid) => ({ id, name, paid, ticket: ticket(id, name, paid) });
const host = person("u-host", "Hosty", true);
const paid2 = person("u-paid2", "PaidTwo", true);
const free1 = person("u-free1", "FreeOne", false);
const free2 = person("u-free2", "FreeTwo", false);
const free3 = person("u-free3", "FreeThree", false);
const free4 = person("u-free4", "FreeFour", false);

console.log(`smoke test against ${base}\n`);

const health = await api("/health");
check("health answers", health.status === 200 && health.body?.ok === true);

const budget = await api("/api/budget");
check("budget status is public", budget.status === 200 && typeof budget.body?.racesToday === "number" && budget.body.atCapacity === false, JSON.stringify(budget.body));
console.log(`      races today ${budget.body?.racesToday}, about ${budget.body?.racesPerDayEstimate}/day allowed, resets ${budget.body?.resetsAt}`);

check("no ticket -> 401", (await api("/api/rooms", { method: "POST" })).status === 401);
check("expired ticket -> 401", (await api("/api/rooms", { method: "POST", token: ticket("x", "x", true, { expIn: -60 }) })).status === 401);
check("forged ticket -> 401", (await api("/api/rooms", { method: "POST", token: ticket("x", "x", true).slice(0, -3) + "AAA" })).status === 401);
check("free account can't host -> 403", (await api("/api/rooms", { method: "POST", token: free1.ticket })).status === 403);

const created = await api("/api/rooms", { method: "POST", token: host.ticket });
check("paid account creates a room", created.status === 201 && /^[A-Z2-9]{6}$/.test(created.body?.code ?? ""), JSON.stringify(created.body));
const code = created.body.code;

const info = await api(`/api/rooms/${code}`);
check("room info is public and hides invites", info.status === 200 && info.body.joinMode === "host" && info.body.hostName === "Hosty" && !("invites" in info.body));
check("unknown room -> 404", (await api("/api/rooms/ZZZZZZ")).status === 404);
check("malformed code -> 404", (await api("/api/rooms/abc")).status === 404);

const noTicketWs = new Client(code, { ticket: "garbage" });
await noTicketWs.done.catch(() => {});
check("socket without a valid ticket never opens", noTicketWs.closed === null || noTicketWs.closed.code !== 1000);

const h = new Client(code, host);
await h.opened;
const hWelcome = await h.waitFor((m) => m.t === "welcome");
check("host gets welcome as host", hWelcome?.you?.isHost === true && hWelcome.room.players.length === 1);

// host-invite-only: an uninvited free guest is refused
const g1 = new Client(code, free1);
await g1.opened;
await g1.done;
check("uninvited guest refused (4005 not_invited)", g1.closed?.code === 4005 && g1.last("denied")?.code === "not_invited", JSON.stringify(g1.closed));

h.send({ t: "invite", username: "freeone" });
await sleep(200);
const g1b = new Client(code, free1);
await g1b.opened;
check("invited free guest gets in", !!(await g1b.waitFor((m) => m.t === "welcome")));
const twoPlayers = await h.waitFor((m) => m.t === "roomState" && m.room.players.length === 2);
check("host sees the guest arrive", !!twoPlayers);

g1b.send({ t: "setMode", mode: "public" });
check("guest can't change the mode", !!(await g1b.waitFor((m) => m.t === "error" && m.code === "not_host")));
g1b.send({ t: "kick", userId: "u-host" });
check("guest can't kick", !!(await g1b.waitFor((m) => m.t === "error" && m.for === "kick")));

h.send({ t: "setMode", mode: "public" });
const g2 = new Client(code, free2);
await g2.opened;
check("public mode admits anyone with the link", !!(await g2.waitFor((m) => m.t === "welcome")));
const g3 = new Client(code, free3);
await g3.opened;
check("fourth player admitted", !!(await g3.waitFor((m) => m.t === "welcome")));
const g4 = new Client(code, free4);
await g4.opened;
await g4.done;
check("fifth player refused: room is full", g4.last("denied")?.code === "full");

// a second tab replaces the first
const g3b = new Client(code, free3);
await g3b.opened;
await g3b.waitFor((m) => m.t === "welcome");
await g3.done;
check("a second tab replaces the first (4000)", g3.closed?.code === 4000);
await sleep(300);
check("replacing a tab doesn't drop the player", h.last("roomState")?.room.players.length === 4);

// kick + ban
h.send({ t: "kick", userId: "u-free2" });
await g2.done;
check("kicked player is closed (4003)", g2.closed?.code === 4003 && !!g2.last("kicked"));
const g2b = new Client(code, free2);
await g2b.opened;
await g2b.done;
check("kicked player can't rejoin through the link", g2b.last("denied")?.code === "banned");

// explicit leave
g3b.send({ t: "leave" });
await g3b.done;
await sleep(200);
check("leaving removes the player", h.last("roomState")?.room.players.length === 2);

// flood protection
const flood = new Client(code, paid2);
h.send({ t: "setMode", mode: "public" });
await flood.opened;
await flood.waitFor((m) => m.t === "welcome");
for (let i = 0; i < 300; i++) flood.send({ t: "nope" });
check("flooding a socket gets 'limited'", !!(await flood.waitFor((m) => m.t === "limited")));
await sleep(500);

// host handover to the longest-present paid player
h.send({ t: "leave" });
await h.done;
const hostChanged = await flood.waitFor((m) => m.t === "event" && m.event.kind === "hostChanged");
check("host leaving hands the room to the paid player", hostChanged?.event.userId === "u-paid2");
await sleep(150); // the roomState follows the event
check("room stays open", flood.last("roomState")?.room.hostId === "u-paid2");

// paid host leaves, only a free player is left -> room closes
flood.send({ t: "leave" });
await flood.done;
await sleep(300);
const g1Closed = await g1b.waitFor((m) => m.t === "closed");
check("when no paid player is left the room closes for free players", g1Closed?.reason === "paid_host_left", JSON.stringify(g1b.messages.slice(-3)));

const budgetAfter = await api("/api/budget");
check("room traffic is counted against the daily budget", budgetAfter.body.usedUnits > 0, JSON.stringify(budgetAfter.body));
console.log(`      usage counted so far: ${budgetAfter.body.usedUnits} units`);

// ---- a round: clock sync, ready-up, the draw (Worker -> Flask), vote, load, countdown ----
console.log("\n-- round (needs BACKEND_URL on the Worker to reach a backend with published levels) --");
const r2 = await api("/api/rooms", { method: "POST", token: host.ticket });
const code2 = r2.body.code;
const rh = new Client(code2, host);
await rh.opened;
await rh.waitFor((m) => m.t === "welcome");
rh.send({ t: "setMode", mode: "public" });
await rh.waitFor((m) => m.t === "roomState" && m.room.joinMode === "public"); // before the guest knocks
const rg = new Client(code2, free1);
await rg.opened;
await rg.waitFor((m) => m.t === "welcome");

const sentAt = Date.now();
rg.send({ t: "sync", c: sentAt });
const syncReply = await rg.waitFor((m) => m.t === "sync");
check("sync echoes our timestamp and adds the server's clock", syncReply?.c === sentAt && Math.abs(syncReply.s - Date.now()) < 5000, JSON.stringify(syncReply));

rh.send({ t: "ready", ready: true });
await sleep(200);
check("one player ready does not start the draw", rh.last("roomState")?.room.phase === "lobby");
rg.send({ t: "ready", ready: true });
const voting = await rh.waitFor((m) => m.t === "roomState" && m.room.phase === "voting", 30000);
const aborted = rh.messages.find((m) => m.t === "event" && m.event.kind === "roundAborted");
if (!voting && aborted?.event.reason === "no_levels") {
  console.log("WARN  the backend answered but has no published levels; publish some and run again");
} else {
  check("everyone ready -> the Worker got candidates from the backend and opened a vote", !!voting, JSON.stringify(aborted ?? rh.messages.slice(-2)));
}
if (voting) {
  const cands = voting.room.round.candidates;
  check("1-4 candidates, each with slug and title", cands.length >= 1 && cands.length <= 4 && cands.every((c) => c.slug && c.title), JSON.stringify(cands));
  const pick = cands[0].slug;
  rh.send({ t: "vote", slug: pick });
  rg.send({ t: "vote", slug: pick });
  const loading = await rh.waitFor((m) => m.t === "roomState" && m.room.phase === "loading");
  check("everyone voting ends the vote at once and picks the winner", loading?.room.round.chosen === pick, JSON.stringify(loading?.room.round));
  rh.send({ t: "loaded", slug: pick });
  rg.send({ t: "loaded", slug: pick });
  const countdown = await rh.waitFor((m) => m.t === "roomState" && m.room.phase === "countdown", 6000);
  check("everyone loaded -> countdown with a go time in the future", !!countdown && countdown.room.round.goAt > countdown.room.serverNow, JSON.stringify(countdown?.room.round));
  const racing = await rh.waitFor((m) => m.t === "roomState" && m.room.phase === "racing", 8000);
  check("the room reaches racing at the go time", !!racing);

  if (racing) {
    const slots = racing.room.round.race.racers.map((r) => r.slot).sort();
    check("every racer gets a slot 0-1 and starts with no deaths", JSON.stringify(slots) === "[0,1]" && racing.room.round.race.racers.every((r) => r.deaths === 0 && r.status === "racing"), JSON.stringify(racing.room.round.race));

    rh.send({ t: "pos", x: 100, y: 200, s: 5 });
    const relayed = await rg.waitFor((m) => m.t === "pos" && m.i === 0);
    check("a position reaches the other racer tagged with the sender's slot", relayed?.x === 100 && relayed?.y === 200 && relayed?.s === 5, JSON.stringify(relayed));
    await sleep(200);
    check("positions are not echoed back to the sender", !rh.messages.some((m) => m.t === "pos"));
    const seen = rg.messages.filter((m) => m.t === "pos").length;
    rh.send({ t: "pos", x: 1e9, y: 0, s: 0 });
    rh.send({ t: "pos", x: "left", y: 0, s: 0 });
    await sleep(300);
    check("nonsense positions are dropped", rg.messages.filter((m) => m.t === "pos").length === seen);

    rg.send({ t: "death" });
    const died = await rh.waitFor((m) => m.t === "roomState" && m.room.round?.race?.racers.some((r) => r.slot === 1 && r.deaths === 1));
    check("a death is counted and shown to everyone", !!died);

    rh.send({ t: "finish" });
    const first = await rg.waitFor((m) => m.t === "roomState" && m.room.round?.race?.racers.some((r) => r.slot === 0 && r.status === "finished"));
    const firstRacer = first?.room.round.race.racers.find((r) => r.slot === 0);
    check("the first finisher is placed 1st with a server-measured time", firstRacer?.place === 1 && firstRacer?.finishMs > 0, JSON.stringify(firstRacer));
    check("the first finish starts a 30 s clock", first?.room.round.race.endsAt - first?.room.round.race.firstFinishAt === 30000, JSON.stringify(first?.room.round.race));
    const before = rg.messages.filter((m) => m.t === "pos").length;
    rh.send({ t: "pos", x: 300, y: 300, s: 1 });
    await sleep(300);
    check("a finished racer's positions are no longer relayed", rg.messages.filter((m) => m.t === "pos").length === before);

    rg.send({ t: "finish" });
    const results = await rh.waitFor((m) => m.t === "roomState" && m.room.phase === "results", 4000);
    const racers = results?.room.round.race.racers ?? [];
    check("everyone finished -> results, 4 points for 1st and 3 for 2nd", racers.find((r) => r.slot === 0)?.points === 4 && racers.find((r) => r.slot === 1)?.points === 3, JSON.stringify(racers));
    check("the room leaderboard has both players, best first", results?.room.scores.length === 2 && results.room.scores[0].points === 4 && results.room.scores[0].wins === 1, JSON.stringify(results?.room.scores));

    rh.send({ t: "ready", ready: true });
    await sleep(200);
    check("one Next Race click waits for the other player", rh.last("roomState")?.room.phase === "results");
    rg.send({ t: "ready", ready: true });
    const again = await rh.waitFor((m) => m.t === "roomState" && m.room.phase === "drawing" && m.room.round?.n === 2, 4000);
    check("both clicking Next Race starts round 2 with no lobby in between", !!again);
  }
}
rh.send({ t: "closeRoom" });
await rh.done;

console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);