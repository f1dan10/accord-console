/* Games API client (backend/games). Every call carries the signed-in user's
   ID token; errors surface the API's own readable message. */
import { getIdToken } from "./auth.js";

const API = (import.meta.env?.VITE_API_URL || "").replace(/\/$/, "");

/* VITE_API_URL deliberately has no default: CloudFormation assigns the API
   Gateway URL when the stack is first created, so it differs per deployment
   and there is nothing stable to hardcode. Unset, every call would resolve
   against the page's own origin and fail in ways that are easy to miss —
   statement scoring in particular degrades silently. Callers check this and
   say so instead. */
export const API_CONFIGURED = /^https?:\/\//.test(API);
if (!API_CONFIGURED) {
  console.error(
    "[accord] VITE_API_URL is not set to a URL. The games API and statement scoring are DISABLED. " +
    "Copy .env.example to .env.local, set VITE_API_URL to the ApiUrl output from `sam deploy`, " +
    "then RESTART the dev server — Vite only reads env files at startup."
  );
}

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
