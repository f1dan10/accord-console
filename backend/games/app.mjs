/* Games API: routing and permission rules. Storage is injected (db.mjs in
   Lambda, an in-memory store in test.mjs), so everything here runs without AWS.

   Who may do what:
   - professors create games; every game has one owner
   - anyone signed in joins a lobby/live game by its word code
   - members read a game and its state document; the owner also sees members
   - students write the state only while the game is lobby/live AND they have
     been assigned a delegation; the owner may also write while paused
   - only the owner assigns delegations and changes status
   - any professor invites or revokes professors; bootstrap professors
     (PROFESSOR_EMAILS) can't be revoked, and nobody revokes themselves
   - professors share one scenario library; only the uploader replaces or
     deletes a scenario. A game copies its scenario when it is created, so
     later changes to the library never reach a running game. */

export const TRANSITIONS = {
  lobby: ["live", "completed"],
  live: ["paused", "completed"],
  paused: ["live", "completed"],
  completed: [],
};
const JOINABLE = new Set(["lobby", "live"]);
const DELEGATION_RE = /^[A-Za-z0-9_-]{1,40}$/;
const CODE_RE = /^[a-z]{2,20}[0-9]{0,2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 254;
const MAX_TITLE = 80;
const MAX_SETUP_CHARS = 4000;
export const MAX_SCENARIO_CHARS = 200_000; // serialized cartridge JSON (src/cartridge.js uses the same cap)
const MAX_SCENARIO_TITLE = 200;
export const MAX_DOC_CHARS = 2_000_000; // raw JSON; the store also caps the gzipped size

export class CodeTaken extends Error {}
export class DocTooLarge extends Error {}
export class StaleStatus extends Error {}

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const fail = (status, error) => { throw Object.assign(new Error(error), { status }); };

function caller(event) {
  const c = event.requestContext?.authorizer?.jwt?.claims || {};
  // Only ID tokens carry the role/email/name claims the API relies on.
  if (!c.sub || c.token_use !== "id") fail(401, "Please sign in again.");
  return {
    userId: c.sub,
    email: c.email || "",
    name: String(c.name || c.email || "Player").slice(0, 80),
    role: c.role === "professor" ? "professor" : "student",
  };
}

function readBody(event) {
  if (!event.body) return "";
  return event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body;
}
function readJson(event) {
  try { return JSON.parse(readBody(event) || "{}"); } catch { fail(400, "Request body must be JSON."); }
}

const publicGame = (g) => ({
  gameId: g.gameId, title: g.title, code: g.code, status: g.status,
  ownerId: g.ownerId, ownerName: g.ownerName, setup: g.setup || {},
  scenarioId: g.scenarioId ?? null, scenarioTitle: g.scenarioTitle ?? null,
  createdAt: g.createdAt, updatedAt: g.updatedAt,
});
const publicScenario = (s) => ({
  scenarioId: s.scenarioId, title: s.title, summary: s.summary,
  ownerId: s.ownerId, ownerName: s.ownerName, createdAt: s.createdAt, updatedAt: s.updatedAt,
});

/* Structural check of an uploaded cartridge: enough that a game built from it
   can be assigned and opened. The detailed checks (matrix, moods, injects)
   run in the browser before upload (src/cartridge.js). */
function readScenarioBody(event) {
  const { body } = readJson(event);
  if (typeof body !== "object" || body === null || Array.isArray(body)) fail(400, "Send the cartridge as { body: { … } }.");
  if (JSON.stringify(body).length > MAX_SCENARIO_CHARS) fail(413, `The cartridge is larger than ${MAX_SCENARIO_CHARS / 1000} KB.`);
  const title = typeof body.meta?.title === "string" ? body.meta.title.trim() : "";
  if (!title || title.length > MAX_SCENARIO_TITLE) fail(400, `The cartridge needs a meta.title (1–${MAX_SCENARIO_TITLE} characters).`);
  const dels = Array.isArray(body.delegations) ? body.delegations : [];
  if (dels.length < 2) fail(400, "The cartridge needs at least two delegations.");
  const ids = dels.map((d) => d?.id);
  if (ids.some((id) => typeof id !== "string" || !DELEGATION_RE.test(id) || id === "observer") || new Set(ids).size !== ids.length) {
    fail(400, "Every delegation needs a unique id of letters, digits, - or _.");
  }
  if (!Array.isArray(body.issues) || !body.issues.length) fail(400, "The cartridge needs at least one issue.");
  const summary = {
    delegations: dels.map((d) => ({ id: d.id, name: String(d.name || d.id).slice(0, 80), flag: String(d.flag || "").slice(0, 16) })),
    issues: body.issues.length,
    injects: Array.isArray(body.injects) ? body.injects.length : 0,
  };
  return { body, title, summary };
}
const delegationIds = (scenario) => new Set((scenario?.delegations || []).map((d) => d.id));
const publicMember = (m) => ({
  userId: m.userId, name: m.name, email: m.email, role: m.role,
  delegation: m.delegation ?? null, joinedAt: m.joinedAt,
});
const publicProfessor = (p) => ({
  email: p.email, status: p.status, root: !!p.root,
  invitedByName: p.invitedByName ?? null, invitedAt: p.invitedAt ?? null,
});
const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

export function makeHandler(store, { randomWord, rootProfessors = [], now = () => new Date().toISOString(), newId = () => crypto.randomUUID() }) {
  const roots = new Set(rootProfessors.map(normalizeEmail).filter(Boolean));
  const requireProfessor = (me, what = "manage professors") => { if (me.role !== "professor") fail(403, `Only professors can ${what}.`); };
  /* Load a game the caller belongs to. Non-members get 404, not 403, so game
     ids can't be probed. */
  async function memberGame(me, gameId) {
    const [game, membership] = await Promise.all([store.getGame(gameId), store.getMember(me.userId, gameId)]);
    if (!game || !membership) fail(404, "Game not found.");
    return { game, membership, isOwner: game.ownerId === me.userId };
  }
  async function ownedGame(me, gameId) {
    const r = await memberGame(me, gameId);
    if (!r.isOwner) fail(403, "Only the professor who created this game can do that.");
    return r;
  }

  const routes = {
    async "POST /games"(me, event) {
      if (me.role !== "professor") fail(403, "Only professors can start a game.");
      const { title, setup = {}, scenarioId = null } = readJson(event);
      const t = typeof title === "string" ? title.trim() : "";
      if (!t || t.length > MAX_TITLE) fail(400, `Give the game a title (1–${MAX_TITLE} characters).`);
      if (typeof setup !== "object" || setup === null || Array.isArray(setup) || JSON.stringify(setup).length > MAX_SETUP_CHARS) {
        fail(400, "Setup must be a small JSON object.");
      }
      // No scenarioId: the built-in template, as before scenarios existed.
      let copy = {};
      if (scenarioId !== null) {
        const sc = typeof scenarioId === "string" && await store.getScenario(scenarioId);
        if (!sc) fail(404, "That scenario isn't in the library anymore. Pick another one.");
        copy = { scenarioId: sc.scenarioId, scenarioTitle: sc.title, scenario: sc.body };
      }
      const ts = now();
      const base = { gameId: newId(), title: t, status: "lobby", ownerId: me.userId, ownerName: me.name, setup, ...copy, createdAt: ts, updatedAt: ts };
      const owner = { userId: me.userId, gameId: base.gameId, name: me.name, email: me.email, role: "professor", delegation: null, joinedAt: ts };
      // A taken word just means another active game has it: draw again, then fall back to word+digits.
      for (let attempt = 0; attempt < 12; attempt++) {
        const word = randomWord();
        const code = attempt < 8 ? word : `${word}${Math.floor(Math.random() * 90) + 10}`;
        try {
          const game = { ...base, code };
          await store.createGame(game, owner);
          return json(201, { game: publicGame(game), membership: publicMember(owner) });
        } catch (e) { if (!(e instanceof CodeTaken)) throw e; }
      }
      fail(503, "Couldn't find a free game code. Try again.");
    },

    async "GET /games"(me) {
      const memberships = await store.listMemberships(me.userId);
      const games = await store.getGames(memberships.map((m) => m.gameId));
      const byId = new Map(games.map((g) => [g.gameId, g]));
      const list = memberships
        .filter((m) => byId.has(m.gameId))
        .map((m) => ({ ...publicGame(byId.get(m.gameId)), membership: publicMember(m) }))
        .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      return json(200, { games: list });
    },

    async "POST /games/join"(me, event) {
      const code = String(readJson(event).code || "").trim().toLowerCase();
      if (!CODE_RE.test(code)) fail(400, "Enter the one-word game code your professor shared.");
      const gameId = await store.lookupCode(code);
      const game = gameId && await store.getGame(gameId);
      if (!game) fail(404, `No active game uses the code "${code}".`);
      if (!JOINABLE.has(game.status)) {
        fail(409, game.status === "paused" ? "This game is paused. Your professor will resume it." : "This game has ended.");
      }
      const membership = game.ownerId === me.userId
        ? await store.getMember(me.userId, game.gameId)
        : await store.joinAsStudent({ userId: me.userId, gameId: game.gameId, name: me.name, email: me.email, joinedAt: now() });
      return json(200, { game: publicGame(game), membership: publicMember(membership) });
    },

    async "GET /games/{gameId}"(me, event) {
      const { game, membership, isOwner } = await memberGame(me, event.pathParameters.gameId);
      // The game's own copy of its cartridge (null: the built-in template).
      const body = { game: publicGame(game), membership: publicMember(membership), scenario: game.scenario ?? null };
      if (isOwner) body.members = (await store.listMembers(game.gameId)).map(publicMember);
      return json(200, body);
    },

    async "GET /games/{gameId}/doc"(me, event) {
      const { game } = await memberGame(me, event.pathParameters.gameId);
      // Same shape the old storage Lambda returned: { value } or null.
      return json(200, await store.getDoc(game.gameId));
    },

    async "PUT /games/{gameId}/doc"(me, event) {
      const { game, membership, isOwner } = await memberGame(me, event.pathParameters.gameId);
      if (game.status === "completed") fail(409, "This game has ended.");
      if (!isOwner) {
        if (game.status === "paused") fail(409, "This game is paused. Your professor will resume it.");
        if (!membership.delegation) fail(403, "Wait for your professor to assign your delegation.");
      }
      const text = readBody(event);
      if (text.length > MAX_DOC_CHARS) fail(413, "Game state is too large.");
      try { JSON.parse(text); } catch { fail(400, "Game state must be JSON."); }
      try {
        const version = await store.putDoc(game.gameId, text, now());
        return json(200, { ok: true, version });
      } catch (e) {
        if (e instanceof DocTooLarge) fail(413, "Game state is too large.");
        throw e;
      }
    },

    async "POST /games/{gameId}/assign"(me, event) {
      const { game } = await ownedGame(me, event.pathParameters.gameId);
      const { userId, delegation = null } = readJson(event);
      if (typeof userId !== "string" || !userId) fail(400, "Pick a student.");
      if (userId === game.ownerId) fail(400, "The professor can't take a delegation.");
      if (delegation !== null && (typeof delegation !== "string" || !DELEGATION_RE.test(delegation))) fail(400, "Unknown delegation.");
      if (delegation !== null && delegation !== "observer" && game.scenario && !delegationIds(game.scenario).has(delegation)) {
        fail(400, `"${delegation}" isn't a delegation in this game's scenario.`);
      }
      const member = await store.setDelegation(game.gameId, userId, delegation);
      if (!member) fail(404, "That student hasn't joined this game.");
      return json(200, { member: publicMember(member) });
    },

    async "POST /games/{gameId}/status"(me, event) {
      const { game } = await ownedGame(me, event.pathParameters.gameId);
      const { status } = readJson(event);
      if (!(TRANSITIONS[game.status] || []).includes(status)) fail(409, `A ${game.status} game can't become ${status}.`);
      try {
        const updated = await store.setStatus(game, status, now());
        return json(200, { game: publicGame(updated) });
      } catch (e) {
        if (e instanceof StaleStatus) fail(409, "The game changed in the meantime. Reload and try again.");
        throw e;
      }
    },

    async "GET /scenarios"(me) {
      requireProfessor(me, "use the scenario library");
      const list = (await store.listScenarios()).map(publicScenario)
        .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      return json(200, { scenarios: list });
    },

    async "GET /scenarios/{scenarioId}"(me, event) {
      requireProfessor(me, "use the scenario library");
      const sc = await store.getScenario(event.pathParameters.scenarioId);
      if (!sc) fail(404, "That scenario isn't in the library anymore.");
      return json(200, { scenario: publicScenario(sc), body: sc.body });
    },

    async "POST /scenarios"(me, event) {
      requireProfessor(me, "upload scenarios");
      const { body, title, summary } = readScenarioBody(event);
      const ts = now();
      const sc = { scenarioId: newId(), title, summary, body, ownerId: me.userId, ownerName: me.name, createdAt: ts, updatedAt: ts };
      await store.putScenario(sc);
      return json(201, { scenario: publicScenario(sc) });
    },

    async "PUT /scenarios/{scenarioId}"(me, event) {
      requireProfessor(me, "upload scenarios");
      const prev = await store.getScenario(event.pathParameters.scenarioId);
      if (!prev) fail(404, "That scenario isn't in the library anymore.");
      if (prev.ownerId !== me.userId) fail(403, `Only ${prev.ownerName || "the professor who uploaded it"} can replace this scenario. Upload it as a new one instead.`);
      const { body, title, summary } = readScenarioBody(event);
      const sc = { ...prev, title, summary, body, updatedAt: now() };
      await store.putScenario(sc);
      return json(200, { scenario: publicScenario(sc) });
    },

    async "DELETE /scenarios/{scenarioId}"(me, event) {
      requireProfessor(me, "delete scenarios");
      const prev = await store.getScenario(event.pathParameters.scenarioId);
      if (!prev) fail(404, "That scenario isn't in the library anymore.");
      if (prev.ownerId !== me.userId) fail(403, `Only ${prev.ownerName || "the professor who uploaded it"} can delete this scenario.`);
      await store.deleteScenario(prev.scenarioId);
      return json(200, { ok: true });
    },

    async "GET /professors"(me) {
      requireProfessor(me);
      const invited = (await store.listProfessors()).filter((p) => !roots.has(p.email));
      const list = [...[...roots].map((email) => ({ email, status: "active", root: true })), ...invited]
        .map(publicProfessor)
        .sort((a, b) => (b.root - a.root) || a.email.localeCompare(b.email));
      return json(200, { professors: list });
    },

    /* Idempotent: inviting someone already on the list returns their row. */
    async "POST /professors"(me, event) {
      requireProfessor(me);
      const email = normalizeEmail(readJson(event).email);
      if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL) fail(400, "Enter a valid email address.");
      if (roots.has(email)) return json(200, { professor: publicProfessor({ email, status: "active", root: true }) });
      const row = { email, status: "invited", invitedBy: me.userId, invitedByName: me.name, invitedAt: now() };
      const existing = await store.addProfessor(row);
      return existing
        ? json(200, { professor: publicProfessor(existing) })
        : json(201, { professor: publicProfessor(row) });
    },

    async "DELETE /professors/{email}"(me, event) {
      requireProfessor(me);
      const email = normalizeEmail(decodeURIComponent(event.pathParameters?.email || ""));
      if (email === normalizeEmail(me.email)) fail(400, "You can't remove yourself.");
      if (roots.has(email)) fail(403, "This professor is set in the deployment config and can't be removed here.");
      if (!(await store.removeProfessor(email))) fail(404, "That email isn't on the professor list.");
      return json(200, { ok: true });
    },
  };

  return async (event) => {
    const route = routes[event.routeKey];
    if (!route) return json(404, { error: "Not found." });
    try {
      return await route(caller(event), event);
    } catch (e) {
      if (e.status) return json(e.status, { error: e.message });
      console.error("games api error", event.routeKey, e);
      return json(500, { error: "Something went wrong. Try again." });
    }
  };
}
