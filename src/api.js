/* Games API client (backend/games). Every call carries the signed-in user's
   ID token; errors surface the API's own readable message. */
import { getIdToken } from "./auth.js";

const API = (import.meta.env?.VITE_API_URL || "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(method, path, body) {
  const token = await getIdToken();
  const raw = typeof body === "string";
  let r;
  try {
    r = await fetch(API + path, {
      method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined && { "Content-Type": raw ? "text/plain" : "application/json" }),
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection.");
  }
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(r.status, data?.error || "Something went wrong. Try again.");
  return data;
}
