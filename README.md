# Pyrsis Accord Console

A browser-based multiplayer negotiation simulation. Delegations table draft
agreements, endorse or object to each other's texts, and file press
communiqués that are scored by Claude for rhetorical quality. A facilitator
runs the clock, fires news events, and can hand any seat over to an AI player.

Engine v1.5. React + Vite frontend, AWS Lambda backend.

---

## Contents

- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Access codes and roles](#access-codes-and-roles)
- [Running a session](#running-a-session)
- [Project structure](#project-structure)
- [Changing the game (cartridges)](#changing-the-game-cartridges)
- [Deploying the backend](#deploying-the-backend)
- [Building for production](#building-for-production)
- [Errors you may encounter](#troubleshooting)

---

## Quick start

**Requirements:** Node.js `^20.19.0` or `>=22.12.0` (Vite 8 enforces this).
Check with `node --version`.

```bash
npm install
cp .env.example .env.local     # then edit .env.local — see Configuration
npm run dev
```

Open the `http://localhost:5173` URL printed in the terminal and enter an
access code.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload. Edit `src/App.jsx` and the browser updates without losing state. |
| `npm run build` | Production build into `dist/`. |
| `npm run preview` | Serve the built `dist/` locally to check it before deploying. |
| `npm run lint` | Run Oxlint. |

---

## Configuration

Two environment variables, both set **once** on each machine that builds the
app. Players never set anything.

Vite only exposes variables prefixed `VITE_` to browser code, and it
**substitutes them into the bundle at build time** — they are not read when
the page loads. Two consequences:

- Editing `.env.local` while `npm run dev` is running does nothing until you
  **restart the dev server**. Refreshing the browser is not enough.
- Changing either value in production requires a **rebuild and redeploy** of
  the frontend.

Because these values ship to every browser, never put a secret in one. That is
why the AWS credentials live in the Lambda's IAM role and not here.

### `VITE_API_URL` — required

The base URL of the backend API Gateway that fronts the Claude/Bedrock Lambda.
Get it from the `ApiUrl` output of `sam deploy` (see
[Deploying the backend](#deploying-the-backend)). No trailing slash.

```
VITE_API_URL=https://a1b2c3d4e5.execute-api.us-east-2.amazonaws.com
```

There is deliberately **no default**. CloudFormation assigns this URL when the
stack is first created, so it differs per deployment and there is nothing
stable to hardcode. Once your stack exists the URL stays the same across
redeploys — you will normally set this once and never touch it again. It only
changes if you delete and recreate the stack, deploy under a new stack name,
or make a change that forces CloudFormation to replace the API resource.

**If it is missing, statement scoring silently degrades.** Every communiqué
receives a flat placeholder score and credibility never moves, while the UI
otherwise looks fine. The facilitator console shows a red warning banner when
this happens — do not start a session with that banner visible.

### `VITE_STORAGE_URL` — optional

The shared game-state endpoint. Defaults to an existing Lambda Function URL, so
you can leave it unset unless you are running your own storage backend.

`.env.local` is gitignored and stays on your machine. `.env.example` is the
committed template that documents which variables exist.

---

## Access codes and roles

Everyone enters the same page and types a code. The code determines the role.
Codes are case-insensitive and whitespace is trimmed.

| Role | What they see and do |
|---|---|
| **Delegation** | Full player console: table and amend drafts, endorse rivals' texts, file communiqués during press windows, read the wire, private GM chat, scoring calculator. |
| **Observer** | Everything their delegation sees, read-only. Safe to share with a whole class or with guests. Exists only where the cartridge defines a `viewAccess` / `viewHash`. |
| **Facilitator (GM)** | Clock, news injects, press windows, moods, announcements, credibility and endorsement overrides, Human/AI seat toggles, pause/resume, export/restore. |
| **Projector** | Read-only room display: clock, live drafts, endorsement tallies, the wire. Meant for a screen at the front of the room. |
| **Designer** | Not a separate login. Entering the designer key once from any account unlocks raw scoring detail (E/L/P/relevance per filing) on that account, and flips it to the facilitator view. Toggle it off from the button in the console header. |

Codes for the cartridge currently in the repo (the empty template):

```
ALPHA-0001      Alpha delegation
BETA-0001       Beta delegation
TMPL-CONTROL    Facilitator
TMPL-SCREEN     Projector
```

### Important: the facilitator console must stay open

AI-controlled seats are driven by the facilitator's browser tab — it is the
host that evaluates and executes their moves roughly every 12 seconds. If the
GM closes that tab, AI delegations stop playing. Human seats are unaffected.

### Generating hashed codes for a release build

A cartridge can carry either plain codes (`access`, `facilitatorCode`,
`projectorCode`) or salted SHA-256 hashes (`accessHash`, `viewHash`,
`facilitatorHash`, `projectorHash`, `designerHash`). Use hashes for anything
students could inspect — plain codes are readable in the shipped bundle.

```bash
node -e 'const c=require("crypto");console.log(c.createHash("sha256").update("pyrsis-accord-1"+process.argv[1].trim().toUpperCase()).digest("hex"))' YOUR-CODE-HERE
```

Paste the result into the matching `*Hash` field. Keep a private record of the
plain codes — the hash is one-way and cannot be reversed.

---

## Running a session

All shared state (drafts, endorsements, clock, injects, communiqués,
credibility) is written to the storage backend continuously. Nothing depends
on exporting, and players can close and reopen their browser without losing
their place — they just re-enter their code.

### Multiple simultaneous games

Append `?s=<name>` to the URL to namespace a session. Each distinct value gets
its own independent game state, so two classes can run the same scenario at
the same time with the same access codes:

```
https://your-site/?s=fall2026-section1
https://your-site/?s=fall2026-section2
```

With no `?s=` parameter the session is named `default`. Everyone in a given
game — players, GM, projector — must use the same value.

### Typical run

1. GM opens the facilitator console and confirms no red configuration banner.
2. Players enter their delegation codes; projector goes up on the room screen.
3. GM starts the clock.
4. Play proceeds; GM fires injects, opens press windows, shifts the public mood.
5. Pause at any time — team consoles lock and the clock holds its remaining
   time, so a game can span two class meetings.
6. Export the full session as JSON at the end for debrief or research. Restore
   lands paused so the GM can set up before resuming.

---

## Project structure

```
src/App.jsx           The entire application (~3,200 lines)
  lines  73–162       SCENARIO CONFIG — the cartridge. Replace this to change the game.
  lines 164+          Engine. Scoring, storage, AI seats, all three views. Scenario-agnostic.
src/main.jsx          Storage shim (window.storage) and React entry point
index.html            Page shell; loads Tailwind from CDN
backend/template.yaml AWS SAM template for the Claude proxy
backend/ai/index.mjs  Lambda handler — calls Claude on Amazon Bedrock
```

Fonts are embedded as base64 woff2 directly in `App.jsx`. This is intentional:
Safari blocks local font files, so every face has to ship in-file. It accounts
for most of the file's size.

---

## Changing the game (cartridges)

All scenario content lives between these two markers in `src/App.jsx`:

```js
/* ================= BEGIN SCENARIO CONFIG ================= */
...
/* ================= END SCENARIO CONFIG ================= */
```

Everything below `END` is engine and should not be edited per scenario. To run
a different game, replace the block between the markers with the contents of a
`*.scenario.js` file (drop its `export default` line).

### Keeping your version separate from the template

The cartridge currently in `main` is the **empty template** — two delegations,
two issues, one inject. It is deliberately minimal so the console runs as-is.
Treat it as the starting point, not as a game.

Recommended workflow so your scenario never collides with the template:

1. Keep `main` holding the template cartridge, unmodified.
2. Make a branch per scenario: `git checkout -b scenario/istanbul`.
3. Edit only the cartridge block on that branch.
4. When the engine improves on `main`, merge `main` into your scenario branch.
   Because engine and content are separated by the markers, those merges
   usually touch only engine lines and resolve cleanly.

Deploy from the scenario branch, not from `main`.

### Required cartridge fields

`meta.id` must be unique — it prefixes every storage key, so two cartridges
sharing an id will overwrite each other's games.

| Field | Purpose |
|---|---|
| `meta` | id, title, clock label, deadline minutes, banner text |
| `delegations[]` | id, name, flag, ministry, access code, priority issue, no-deal value, red lines, domestic audience |
| `issues[]` | id, label, ranked options, short pill labels |
| `matrixB64` | base64 JSON of each delegation's preference ranking per issue |
| `scoring` | deal/credibility weights, mediator closure share, starting credibility, priority weight |
| `publicDiplomacy` | postures, press windows, moods, baseline, revision window |
| `injects[]` | the news events the GM can fire, each optionally shifting the mood |
| `mechanics` | amendment policy, inject acknowledgement, max live drafts, red-line mode |

The authoritative field-by-field spec, including every optional field the
engine reads, is the comment block immediately above the cartridge in
`src/App.jsx` (around lines 74–108).

### Check your design before you run it

The facilitator console includes a **Scenario Integrity** panel that validates
the cartridge automatically and flags:

- missing or malformed matrix entries (hard error)
- two delegations sharing a first-choice option (advisory)
- an issue where every middle option is somebody's worst outcome (hard error —
  it means there is no compromise available and the negotiation cannot close)

Open the facilitator console and read that panel before running a new
scenario with real players.

---

## Deploying the backend

Requires the [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html),
AWS credentials, and Bedrock model access enabled in your account and region.

```bash
cd backend
sam build
sam deploy --guided      # first time only; answers are saved to samconfig.toml
```

Copy the `ApiUrl` output into `VITE_API_URL` in `.env.local`, then rebuild the
frontend.

The Lambda calls Claude on Amazon Bedrock using its own IAM role, so no API
key is ever present in the browser. Model and CORS origin are stack
parameters (`ModelId`, `AllowedOrigin`).

**Before running with real students:** set `AllowedOrigin` to your actual
frontend URL rather than the `*` default, and note that the `/ai` endpoint is
currently unauthenticated, anyone who discovers the URL can invoke it against
your AWS bill. Request throttling (10 rps, burst 20) is the only control in
place today.

`samconfig.toml` and `.aws-sam/` are gitignored.

---

## Building for production

```bash
npm run build       # outputs dist/
npm run preview     # check it locally before uploading
```

Serve `dist/` from any static host (S3 + CloudFront, Netlify, GitHub Pages).
Make sure the environment variables are set **on the machine that runs the
build,** and that they are baked into the output, not read by the server.

---

## Troubleshooting

**Statements aren't being scored / everyone's credibility is stuck at 50.**
`VITE_API_URL` is missing or wrong. Check the facilitator console for the red
banner and the browser console for `[accord]` messages. Fix `.env.local` and
restart the dev server, or rebuild for production.

**I changed `.env.local` and nothing happened.**
Restart the dev server. Vite reads env files only at startup.

**AI seats stopped making moves.**
The facilitator console tab was closed or the browser put it to sleep. Reopen
it and keep it in the foreground.

**Two groups are seeing each other's drafts.**
They are on the same session. Give each group a distinct `?s=` value.

**Players see "Code not recognized."**
Check the cartridge's `access` / `accessHash` fields. If using hashes, confirm
you hashed the exact code including any dashes, and that the salt matches.

**The build fails with an engine warning.**
Node is too old. Vite 8 requires `^20.19.0 || >=22.12.0`.

---
