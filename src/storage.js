/* window.storage: the key/value bridge the game engine (App.jsx) reads and
   writes through. Personal keys (shared = false) stay in this browser's
   localStorage. Shared state is the open game's document on the games API:
   setActiveGame(id) points the bridge at it, and every game is isolated from
   every other. With no game open there is no shared state. */
import { api } from "./api.js";

let activeGameId = null;
export function setActiveGame(gameId) { activeGameId = gameId || null; }
export function getActiveGame() { return activeGameId; }

// A game has exactly one shared key: the engine's consolidated `${P}-doc`.
function docPath(k) {
  if (!activeGameId) throw new Error("storage: no game is open");
  if (!k.endsWith("-doc")) throw new Error(`storage: "${k}" is not stored per game`);
  return `/games/${encodeURIComponent(activeGameId)}/doc`;
}

window.storage = {
  async get(k, shared) {
    if (!shared) { const v = localStorage.getItem(k); return v == null ? null : { value: v }; }
    return api("GET", docPath(k));
  },
  async set(k, v, shared) {
    if (!shared) { localStorage.setItem(k, v); return true; }
    await api("PUT", docPath(k), v);
    return true;
  },
  async delete(k, shared) {
    if (!shared) { localStorage.removeItem(k); return true; }
    throw new Error("storage: game state can't be deleted from the browser");
  },
};
