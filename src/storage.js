/* window.storage: the key/value bridge the game engine (App.jsx) reads and
   writes through. Personal keys (shared = false) stay in this browser's
   localStorage. Shared keys go to:
   - the open game's state document on the games API, once setActiveGame(id)
     has been called — each game is isolated from every other;
   - otherwise the old storage Lambda, scoped by ?s= (the access-code path). */
import { api } from "./api.js";

const LEGACY_API = import.meta.env.VITE_STORAGE_URL || "https://7q2pijegeat4couj46ksjk45wi0ixdtc.lambda-url.us-east-2.on.aws/";
const LEGACY_SESSION = new URLSearchParams(location.search).get("s") || "default";
const legacyUrl = (k) => `${LEGACY_API}?s=${encodeURIComponent(LEGACY_SESSION)}&k=${encodeURIComponent(k)}`;

let activeGameId = null;
export function setActiveGame(gameId) { activeGameId = gameId || null; }
export function getActiveGame() { return activeGameId; }

// A game has exactly one shared key: the engine's consolidated `${P}-doc`.
function docPath(k) {
  if (!k.endsWith("-doc")) throw new Error(`storage: "${k}" is not stored per game`);
  return `/games/${encodeURIComponent(activeGameId)}/doc`;
}

window.storage = {
  async get(k, shared) {
    if (!shared) { const v = localStorage.getItem(k); return v == null ? null : { value: v }; }
    if (activeGameId) return api("GET", docPath(k));
    const r = await fetch(legacyUrl(k), { cache: "no-store" });
    if (!r.ok) throw new Error("storage");
    return await r.json();
  },
  async set(k, v, shared) {
    if (!shared) { localStorage.setItem(k, v); return true; }
    if (activeGameId) { await api("PUT", docPath(k), v); return true; }
    const r = await fetch(legacyUrl(k), { method: "PUT", body: v });
    if (!r.ok) throw new Error("storage");
    return true;
  },
  async delete(k, shared) {
    if (!shared) { localStorage.removeItem(k); return true; }
    if (activeGameId) throw new Error("storage: game state can't be deleted from the browser");
    await fetch(legacyUrl(k), { method: "DELETE" });
    return true;
  },
};
