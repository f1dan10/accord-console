/* Route and permission tests for app.mjs against an in-memory store that
   mirrors db.mjs semantics. Run: npm run check (no AWS needed). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHandler, CodeTaken, StaleStatus } from "./app.mjs";
import { WORDS } from "./words.mjs";

function memoryStore() {
  const games = new Map(), docs = new Map(), members = new Map(), codes = new Map(), professors = new Map();
  const mk = (u, g) => `${u}|${g}`;
  return {
    games, codes, professors,
    async listProfessors() { return [...professors.values()]; },
    async addProfessor(row) {
      if (professors.has(row.email)) return professors.get(row.email);
      professors.set(row.email, { ...row }); return null;
    },
    async removeProfessor(email) { return professors.delete(email); },
    async getGame(id) { return games.get(id) || null; },
    async getMember(u, g) { return members.get(mk(u, g)) || null; },
    async listMembers(g) { return [...members.values()].filter((m) => m.gameId === g); },
    async listMemberships(u) { return [...members.values()].filter((m) => m.userId === u); },
    async getGames(ids) { return ids.map((id) => games.get(id)).filter(Boolean); },
    async lookupCode(c) { return codes.get(c) || null; },
    async createGame(game, owner) {
      if (codes.has(game.code)) throw new CodeTaken();
      codes.set(game.code, game.gameId); games.set(game.gameId, { ...game });
      docs.set(game.gameId, { version: 0 }); members.set(mk(owner.userId, game.gameId), { ...owner });
    },
    async joinAsStudent({ userId, gameId, name, email, joinedAt }) {
      const prev = members.get(mk(userId, gameId));
      const m = { role: "student", delegation: null, joinedAt, ...prev, userId, gameId, name, email };
      members.set(mk(userId, gameId), m); return m;
    },
    async setDelegation(g, u, delegation) {
      const m = members.get(mk(u, g)); if (!m) return null;
      m.delegation = delegation; return m;
    },
    async getDoc(g) { const d = docs.get(g); return d?.doc ? { value: d.doc, version: d.version } : null; },
    async putDoc(g, text) { const d = docs.get(g); d.doc = text; d.version += 1; return d.version; },
    async setStatus(game, status, ts) {
      const cur = games.get(game.gameId);
      if (cur.status !== game.status) throw new StaleStatus();
      Object.assign(cur, { status, updatedAt: ts });
      if (status === "completed" && codes.get(cur.code) === cur.gameId) codes.delete(cur.code);
      return { ...cur };
    },
  };
}

let clock = 0;
function setup(words = ["southern", "maple"]) {
  const store = memoryStore();
  let w = 0, id = 0;
  const handler = makeHandler(store, {
    randomWord: () => words[w++ % words.length],
    rootProfessors: [" X@mit.edu ", ""],
    now: () => new Date(Date.UTC(2026, 9, 15) + ++clock * 1000).toISOString(),
    newId: () => `game-${++id}`,
  });
  const as = (user) => async (routeKey, { gameId, email, body, raw } = {}) => {
    const r = await handler({
      routeKey,
      pathParameters: gameId ? { gameId } : email ? { email } : undefined,
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      requestContext: { authorizer: { jwt: { claims: { token_use: "id", ...user } } } },
    });
    return { status: r.statusCode, body: JSON.parse(r.body) };
  };
  return {
    store,
    profX: as({ sub: "px", email: "x@mit.edu", name: "Prof X", role: "professor" }),
    profY: as({ sub: "py", email: "y@mit.edu", name: "Prof Y", role: "professor" }),
    alice: as({ sub: "sa", email: "a@mit.edu", name: "Alice", role: "student" }),
    bob: as({ sub: "sb", email: "b@mit.edu", name: "Bob", role: "student" }),
    raw: handler,
  };
}

test("word list is clean and large enough", () => {
  assert.ok(WORDS.length >= 400, `only ${WORDS.length} words`);
  for (const w of WORDS) assert.match(w, /^[a-z]{4,10}$/);
});

test("rejects missing or access tokens", async () => {
  const { raw } = setup();
  const r = await raw({ routeKey: "GET /games", requestContext: { authorizer: { jwt: { claims: { sub: "x", token_use: "access" } } } } });
  assert.equal(r.statusCode, 401);
});

test("only professors create games; codes are unique among active games", async () => {
  const t = setup(["southern", "southern", "maple"]);
  assert.equal((await t.alice("POST /games", { body: { title: "Hack" } })).status, 403);
  assert.equal((await t.profX("POST /games", { body: { title: "" } })).status, 400);
  const a = await t.profX("POST /games", { body: { title: "Class A", setup: { seats: { USA: "ai" } } } });
  const b = await t.profY("POST /games", { body: { title: "Class B" } });
  assert.equal(a.status, 201);
  assert.equal(a.body.game.code, "southern");
  assert.equal(a.body.game.status, "lobby");
  assert.equal(b.body.game.code, "maple", "taken word is skipped");
});

test("Thursday → Tuesday: join, assign, play, pause, resume, end", async () => {
  const t = setup();
  const { game } = (await t.profX("POST /games", { body: { title: "Class A" } })).body;
  const g = game.gameId;

  // Join is case-insensitive; an unassigned student can read but not write.
  const j = await t.alice("POST /games/join", { body: { code: " Southern " } });
  assert.equal(j.status, 200);
  assert.equal(j.body.membership.delegation, null);
  assert.equal((await t.alice("PUT /games/{gameId}/doc", { gameId: g, raw: "{}" })).status, 403);
  assert.equal((await t.alice("GET /games/{gameId}/doc", { gameId: g })).body, null);

  // Only the owner sees members and assigns.
  assert.equal((await t.alice("GET /games/{gameId}", { gameId: g })).body.members, undefined);
  const owner = await t.profX("GET /games/{gameId}", { gameId: g });
  assert.deepEqual(owner.body.members.map((m) => m.name).sort(), ["Alice", "Prof X"]);
  assert.equal((await t.alice("POST /games/{gameId}/assign", { gameId: g, body: { userId: "sa", delegation: "USA" } })).status, 403);
  assert.equal((await t.profX("POST /games/{gameId}/assign", { gameId: g, body: { userId: "sb", delegation: "USA" } })).status, 404);
  assert.equal((await t.profX("POST /games/{gameId}/assign", { gameId: g, body: { userId: "sa", delegation: "US A!" } })).status, 400);
  assert.equal((await t.profX("POST /games/{gameId}/assign", { gameId: g, body: { userId: "sa", delegation: "USA" } })).status, 200);

  // Live play: assigned student writes, everyone reads the same doc.
  assert.equal((await t.profX("POST /games/{gameId}/status", { gameId: g, body: { status: "live" } })).status, 200);
  const put = await t.alice("PUT /games/{gameId}/doc", { gameId: g, raw: '{"clock":1}' });
  assert.deepEqual(put.body, { ok: true, version: 1 });
  assert.equal((await t.alice("PUT /games/{gameId}/doc", { gameId: g, raw: "not json" })).status, 400);
  assert.equal((await t.profX("GET /games/{gameId}/doc", { gameId: g })).body.value, '{"clock":1}');

  // Pause for next class: students locked out of writes and of rejoining; owner can still write.
  assert.equal((await t.alice("POST /games/{gameId}/status", { gameId: g, body: { status: "paused" } })).status, 403);
  assert.equal((await t.profX("POST /games/{gameId}/status", { gameId: g, body: { status: "paused" } })).status, 200);
  assert.equal((await t.alice("PUT /games/{gameId}/doc", { gameId: g, raw: "{}" })).status, 409);
  assert.equal((await t.profX("PUT /games/{gameId}/doc", { gameId: g, raw: '{"clock":2}' })).status, 200);
  assert.equal((await t.alice("POST /games/join", { body: { code: "southern" } })).status, 409);
  const hist = (await t.alice("GET /games")).body.games;
  assert.equal(hist.length, 1);
  assert.equal(hist[0].status, "paused");
  assert.equal(hist[0].membership.delegation, "USA");

  // Tuesday: resume; rejoining keeps the delegation.
  assert.equal((await t.profX("POST /games/{gameId}/status", { gameId: g, body: { status: "live" } })).status, 200);
  const rejoin = await t.alice("POST /games/join", { body: { code: "southern" } });
  assert.equal(rejoin.body.membership.delegation, "USA");

  // End: code is freed, nobody writes, history still readable.
  assert.equal((await t.profX("POST /games/{gameId}/status", { gameId: g, body: { status: "completed" } })).status, 200);
  assert.equal((await t.profX("POST /games/{gameId}/status", { gameId: g, body: { status: "live" } })).status, 409);
  assert.equal(t.store.codes.has("southern"), false);
  assert.equal((await t.bob("POST /games/join", { body: { code: "southern" } })).status, 404);
  assert.equal((await t.profX("PUT /games/{gameId}/doc", { gameId: g, raw: "{}" })).status, 409);
  assert.equal((await t.alice("GET /games/{gameId}/doc", { gameId: g })).body.value, '{"clock":2}');
});

test("games are invisible to non-members", async () => {
  const t = setup();
  const g = (await t.profX("POST /games", { body: { title: "Class A" } })).body.game.gameId;
  for (const [route, who] of [["GET /games/{gameId}", t.bob], ["GET /games/{gameId}/doc", t.bob], ["PUT /games/{gameId}/doc", t.bob], ["POST /games/{gameId}/status", t.profY]]) {
    assert.equal((await who(route, { gameId: g, body: { status: "live" } })).status, 404, route);
  }
  assert.deepEqual((await t.bob("GET /games")).body.games, []);
  assert.deepEqual((await t.profY("GET /games")).body.games, []);
});

test("professors invite and revoke professors; bootstrap and self are protected", async () => {
  const t = setup();
  const list = async (who = t.profX) => (await who("GET /professors")).body.professors;

  // Students can't see or change the list.
  assert.equal((await t.alice("GET /professors")).status, 403);
  assert.equal((await t.alice("POST /professors", { body: { email: "a@mit.edu" } })).status, 403);
  assert.equal((await t.alice("DELETE /professors/{email}", { email: "y@mit.edu" })).status, 403);

  // Bootstrap professors come from config, normalized.
  assert.deepEqual(await list(), [{ email: "x@mit.edu", status: "active", root: true, invitedByName: null, invitedAt: null }]);

  // Invite: validated, lowercased, idempotent; re-inviting a bootstrap email is a no-op.
  assert.equal((await t.profX("POST /professors", { body: { email: "not-an-email" } })).status, 400);
  const inv = await t.profX("POST /professors", { body: { email: "  New.Prof@MIT.edu " } });
  assert.equal(inv.status, 201);
  assert.equal(inv.body.professor.email, "new.prof@mit.edu");
  assert.equal(inv.body.professor.status, "invited");
  assert.equal(inv.body.professor.invitedByName, "Prof X");
  t.store.professors.get("new.prof@mit.edu").status = "active"; // as the pre-token trigger would
  const again = await t.profY("POST /professors", { body: { email: "new.prof@mit.edu" } });
  assert.equal(again.status, 200);
  assert.equal(again.body.professor.status, "active", "a second invite doesn't reset the row");
  assert.equal((await t.profX("POST /professors", { body: { email: "x@mit.edu" } })).status, 200);
  assert.equal(t.store.professors.has("x@mit.edu"), false);
  assert.deepEqual((await list()).map((p) => p.email), ["x@mit.edu", "new.prof@mit.edu"]);

  // Revoke: not yourself, not bootstrap, 404 for unknown; path value may arrive encoded.
  await t.profX("POST /professors", { body: { email: "y@mit.edu" } });
  assert.equal((await t.profY("DELETE /professors/{email}", { email: "y@mit.edu" })).status, 400);
  assert.equal((await t.profY("DELETE /professors/{email}", { email: "x@mit.edu" })).status, 403);
  assert.equal((await t.profX("DELETE /professors/{email}", { email: "nobody@mit.edu" })).status, 404);
  assert.equal((await t.profY("DELETE /professors/{email}", { email: "New.Prof%40mit.edu" })).status, 200);
  assert.deepEqual((await list()).map((p) => p.email), ["x@mit.edu", "y@mit.edu"]);
});
