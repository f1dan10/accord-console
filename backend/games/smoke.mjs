/* Live smoke test for the deployed games API. Reads VITE_API_URL and the
   Cognito ids from ../../.env.local. No AWS credentials needed.

     node smoke.mjs signup <email> <password> "<name>"   # then check email
     node smoke.mjs confirm <email> <code>
     PROF_EMAIL=… PROF_PASSWORD=… STUDENT_EMAIL=… STUDENT_PASSWORD=… node smoke.mjs run

   `run` leaves one completed game titled "Smoke test" in both histories. */
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split("\n").map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const API = env.VITE_API_URL.replace(/\/$/, "");
const CLIENT_ID = env.VITE_COGNITO_CLIENT_ID;
const REGION = env.VITE_COGNITO_USER_POOL_ID.split("_")[0];

async function cognito(action, body) {
  const r = await fetch(`https://cognito-idp.${REGION}.amazonaws.com/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}` },
    body: JSON.stringify({ ClientId: CLIENT_ID, ...body }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`${action}: ${data.__type} ${data.message || ""}`);
  return data;
}

async function signIn(email, password) {
  const r = await cognito("InitiateAuth", { AuthFlow: "USER_PASSWORD_AUTH", AuthParameters: { USERNAME: email, PASSWORD: password } });
  const token = r.AuthenticationResult.IdToken;
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  const call = async (method, path, body) => {
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { claims, call };
}

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  →  ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

async function run() {
  const need = ["PROF_EMAIL", "PROF_PASSWORD", "STUDENT_EMAIL", "STUDENT_PASSWORD"].filter((k) => !process.env[k]);
  if (need.length) throw new Error(`set ${need.join(", ")}`);
  const prof = await signIn(process.env.PROF_EMAIL, process.env.PROF_PASSWORD);
  const stu = await signIn(process.env.STUDENT_EMAIL, process.env.STUDENT_PASSWORD);
  check("professor token has role=professor", prof.claims.role === "professor", prof.claims.role);
  check("student token has role=student", stu.claims.role === "student", stu.claims.role);

  check("student cannot create a game", (await stu.call("POST", "/games", { title: "x" })).status === 403);
  const created = await prof.call("POST", "/games", { title: "Smoke test", setup: { note: "smoke" } });
  check("professor creates a game", created.status === 201, created);
  const { gameId, code } = created.body.game;
  console.log(`      game ${gameId}, code "${code}"`);
  const g = `/games/${gameId}`;

  const joined = await stu.call("POST", "/games/join", { code: code.toUpperCase() });
  check("student joins with the code", joined.status === 200 && joined.body.membership.delegation === null, joined);
  check("unassigned student cannot write", (await stu.call("PUT", `${g}/doc`, "{}")).status === 403);
  const info = await prof.call("GET", g);
  check("professor sees the member list", info.body?.members?.length === 2, info);
  const assigned = await prof.call("POST", `${g}/assign`, { userId: stu.claims.sub, delegation: "USA" });
  check("professor assigns a delegation", assigned.status === 200, assigned);

  check("game goes live", (await prof.call("POST", `${g}/status`, { status: "live" })).status === 200);
  const doc = JSON.stringify({ hello: "world", big: "x".repeat(50_000) });
  const put = await stu.call("PUT", `${g}/doc`, doc);
  check("assigned student writes state", put.status === 200 && put.body.version === 1, put);
  const got = await prof.call("GET", `${g}/doc`);
  check("professor reads the same state (gzip round-trip)", got.body?.value === doc, got.status);

  check("professor pauses", (await prof.call("POST", `${g}/status`, { status: "paused" })).status === 200);
  check("student cannot write while paused", (await stu.call("PUT", `${g}/doc`, "{}")).status === 409);
  check("student cannot rejoin while paused", (await stu.call("POST", "/games/join", { code })).status === 409);
  const hist = await stu.call("GET", "/games");
  const mine = hist.body?.games?.find((x) => x.gameId === gameId);
  check("student history shows paused + delegation", mine?.status === "paused" && mine.membership.delegation === "USA", mine);

  check("professor resumes", (await prof.call("POST", `${g}/status`, { status: "live" })).status === 200);
  const rejoin = await stu.call("POST", "/games/join", { code });
  check("student rejoins in the same seat", rejoin.body?.membership?.delegation === "USA", rejoin);

  check("professor ends the game", (await prof.call("POST", `${g}/status`, { status: "completed" })).status === 200);
  check("code no longer joins", (await stu.call("POST", "/games/join", { code })).status === 404);
  check("completed game is read-only", (await prof.call("PUT", `${g}/doc`, "{}")).status === 409);
  check("results still readable", (await stu.call("GET", `${g}/doc`)).body?.value === doc);

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exitCode = failures ? 1 : 0;
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === "signup") {
    const [email, password, name] = args;
    await cognito("SignUp", { Username: email, Password: password, UserAttributes: [{ Name: "email", Value: email }, { Name: "name", Value: name || email }] });
    console.log(`Signed up ${email}. Check the inbox for a code, then: node smoke.mjs confirm ${email} <code>`);
  } else if (cmd === "confirm") {
    await cognito("ConfirmSignUp", { Username: args[0], ConfirmationCode: args[1] });
    console.log(`Confirmed ${args[0]}.`);
  } else if (cmd === "run") {
    await run();
  } else {
    console.log("usage: node smoke.mjs signup|confirm|run (see top of file)");
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
