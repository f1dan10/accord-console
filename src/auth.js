/* Accounts: a thin client for the Cognito user pool's public JSON API (no SDK).
   Sessions live in localStorage so a refresh or a new tab stays signed in; the
   1-hour ID token is renewed from the 30-day refresh token when needed. The ID
   token carries the `role` claim (professor | student) set by the backend. */

const CLIENT_ID = import.meta.env?.VITE_COGNITO_CLIENT_ID || "";
const REGION = (import.meta.env?.VITE_COGNITO_USER_POOL_ID || "").split("_")[0];
const SESSION_KEY = "accord-session";
const REFRESH_EARLY_MS = 60 * 1000;

export const authConfigured = !!(CLIENT_ID && REGION);

const FRIENDLY = {
  UsernameExistsException: "An account with this email already exists. Sign in instead.",
  NotAuthorizedException: "Incorrect email or password.",
  UserNotFoundException: "Incorrect email or password.",
  CodeMismatchException: "That code isn't right. Check the email and try again.",
  ExpiredCodeException: "That code has expired. Send a new one.",
  LimitExceededException: "Too many attempts. Wait a few minutes and try again.",
  TooManyRequestsException: "Too many attempts. Wait a few minutes and try again.",
  TooManyFailedAttemptsException: "Too many attempts. Wait a few minutes and try again.",
};

export class AuthError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function cognito(action, body) {
  if (!authConfigured) throw new AuthError("Config", "Sign-in isn't configured (VITE_COGNITO_* missing).");
  let r, data;
  try {
    r = await fetch(`https://cognito-idp.${REGION}.amazonaws.com/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}` },
      body: JSON.stringify({ ClientId: CLIENT_ID, ...body }),
    });
    data = await r.json();
  } catch {
    throw new AuthError("Network", "Can't reach the sign-in service. Check your connection.");
  }
  if (!r.ok) {
    const code = String(data.__type || "").split("#").pop();
    // InvalidPassword/InvalidParameter messages from Cognito are already readable.
    throw new AuthError(code, FRIENDLY[code] || (data.message || "Something went wrong.").replace(/^.*?: /, ""));
  }
  return data;
}

/* ---- session storage ---- */
let memory = null; // fallback when localStorage is blocked
function readSession() {
  try { const v = localStorage.getItem(SESSION_KEY); return v ? JSON.parse(v) : null; } catch { return memory; }
}
function writeSession(s) {
  memory = s;
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* memory only */ }
  listeners.forEach((fn) => fn());
}
const listeners = new Set();
export function onAuthChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function claimsOf(idToken) {
  const b64 = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(decodeURIComponent(escape(atob(b64))));
}
function sessionFrom(result, previousRefresh) {
  const claims = claimsOf(result.IdToken);
  return { idToken: result.IdToken, refreshToken: result.RefreshToken || previousRefresh, expiresAt: claims.exp * 1000 };
}

/* The signed-in user, or null. Read from the stored token; the token may be
   expired, getIdToken() renews it before any API call. */
export function currentUser() {
  const s = readSession();
  if (!s) return null;
  const c = claimsOf(s.idToken);
  return { userId: c.sub, email: c.email, name: c.name || c.email, role: c.role === "professor" ? "professor" : "student" };
}

/* ---- flows ---- */
export async function signUp({ email, password, name }) {
  await cognito("SignUp", {
    Username: email.trim(), Password: password,
    UserAttributes: [{ Name: "email", Value: email.trim() }, { Name: "name", Value: name.trim() }],
  });
}
export const confirmSignUp = (email, code) => cognito("ConfirmSignUp", { Username: email.trim(), ConfirmationCode: code.trim() });
export const resendCode = (email) => cognito("ResendConfirmationCode", { Username: email.trim() });
export const forgotPassword = (email) => cognito("ForgotPassword", { Username: email.trim() });
export const resetPassword = (email, code, password) =>
  cognito("ConfirmForgotPassword", { Username: email.trim(), ConfirmationCode: code.trim(), Password: password });

export async function signIn(email, password) {
  const r = await cognito("InitiateAuth", { AuthFlow: "USER_PASSWORD_AUTH", AuthParameters: { USERNAME: email.trim(), PASSWORD: password } });
  if (!r.AuthenticationResult) throw new AuthError("Challenge", "This account needs an extra sign-in step that isn't supported yet.");
  writeSession(sessionFrom(r.AuthenticationResult));
  return currentUser();
}

export function signOut() {
  const s = readSession();
  writeSession(null);
  if (s?.refreshToken) cognito("RevokeToken", { Token: s.refreshToken }).catch(() => {});
}

/* A valid ID token for the games API, renewing it if it is about to expire.
   A dead refresh token signs the user out (listeners send them to login). */
let refreshing = null;
export async function getIdToken() {
  const s = readSession();
  if (!s) throw new AuthError("SignedOut", "Please sign in again.");
  if (Date.now() < s.expiresAt - REFRESH_EARLY_MS) return s.idToken;
  refreshing ||= cognito("InitiateAuth", { AuthFlow: "REFRESH_TOKEN_AUTH", AuthParameters: { REFRESH_TOKEN: s.refreshToken } })
    .then((r) => { const next = sessionFrom(r.AuthenticationResult, s.refreshToken); writeSession(next); return next.idToken; })
    .catch((e) => {
      if (e.code !== "Network") writeSession(null);
      throw e.code === "Network" ? e : new AuthError("SignedOut", "Your session expired. Please sign in again.");
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}
