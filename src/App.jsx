import React, { useState, useEffect, useCallback } from "react";
import {
  authConfigured, currentUser, onAuthChange, signIn, signUp, signOut,
  confirmSignUp, resendCode, forgotPassword, resetPassword,
} from "./auth.js";
import { api } from "./api.js";
import { setActiveGame, getActiveGame } from "./storage.js";
import { normalizeCartridge, designRules, readCartridgeFile, summarize, blankCartridge } from "./cartridge.js";
import ScenarioEditor from "./ScenarioEditor.jsx";
import ScenarioWizard from "./ScenarioWizard.jsx";

/* ============================================================
   PYRSIS ACCORD CONSOLE — engine v1.5 (scenario-agnostic) · the build that ran at Brown, 28 Sep 2026 · cartridge slot holds a runnable template
   Refactored from Nuclear Diplomacy / Islamabad Accord v4.

   v1.1: AI-PLAYED SEATS. Any delegation can be toggled HUMAN or
   AI per session from the facilitator console (Seat Control).
   An AI seat uses the SAME rank matrix, the same scoring, and the
   same actions a human in that seat would have: it tables and
   amends drafts, endorses, objects on the record, and files
   communiqués during press windows (which are statement-scored exactly
   like human filings). AI seats act only while the facilitator
   console (FL-CONTROL) is open — it is the host that runs them.
   Optional per-delegation config: defaultControl: "ai" | "human"
   (initial toggle state only; the facilitator's choice governs).


   v1.5 — Brown / MIT build (Sep 2026). New, each switchable by cartridge:
     · Session pause / resume: locks team consoles, suspends clock and press
       window, resumes with the same remaining time (multi-session play).
     · Start a new game from a JSON export (professor dashboard). Lands paused.
     · Priority issue per delegation (cartridge `priority`, scoring.priorityWeight).
     · Per-delegation no-deal value (cartridge `noDealPct`) replaces
       universal collapse-to-zero.
     · Hard red lines (cartridge `redLines`): a delegation cannot endorse a
       package containing one; AI seats value such packages below reserve.
     · Two-audience model: hidden international mood (grades filings) and a
       visible per-delegation domestic audience with GM-set domestic moods.
     · statement relevance (0–3) from the grader scales credibility gain and
       sentiment routing for on-/off-subject filings.
     · Typography and controls rebuilt to Pyrsis House Typography v9:
       Ideal Sans body, Decimal for labels/figures, Gotham display, Operator
       Mono machine voice; raised-fill controls with gold reserved for the
       selected state; the Screen carries no affordance signals.
   v1.4 — Stage 1 post-Singapore revision (Sep 2026). Fixes to observed
   defects; no negotiation mechanics changed.
     · Communiqué file button always pressable; names what is missing;
       live readiness checklist above it.
     · Universal button feedback: pressed state, disabled treatment, busy lock.
     · Audio unlocked on first gesture (chimes were silent on some devices).
     · Teams may withdraw their own draft.
     · Draft cap defaults to 4 when the cartridge leaves maxLiveDrafts null.
     · Inject IDs (W1…) shown on the console to match run sheets.
     · Console: credibility override, endorsement override (GM-logged),
       per-seat AI capability toggles, full-session JSON export.
     · Act-as-delegation failsafe: GM may table/amend/file for any team;
       every substituted action is logged as GM-attributed.
     · AI seats: reservation floor raised 0.40→0.60 (was endorsing ~90% of
       packages in the final quarter); actions filtered by capability.
     · Mood shifts are first-class wire events: red card on wire and
       projector, full-screen acknowledgment on every phone, projector
       panel flashes on change, pulse pinned to team view during windows.
     · Proposal alerts: chime + toast when another team tables/amends/
       withdraws.

   ALL scenario content lives in the SCENARIO block below.
   To run a different scenario, replace everything between
   the BEGIN/END SCENARIO CONFIG markers with the contents of
   another *.scenario.js file (drop the `export default` line).

   Engine mechanics (do not edit per scenario):
   - Proposal / endorsement / unanimous adoption / collapse
   - Amendment policy: "clear" or "reconfirm" (pending endorsements)
   - Public diplomacy: press windows, statement auto-scoring (hidden,
     mood-weighted), credibility, sentiment, calibration exemplars
   - Inject library + custom injects + mood control
   - Inject acknowledgement interstitial (configurable)
   - GM chat, announcements, audio cues, toasts
   - Scenario Integrity panel (design-rule checks) in facilitator
   ============================================================ */

/* ================= BEGIN SCENARIO CONFIG ================= */
/* ---------------------------------------------------------------------------
   EMPTY CARTRIDGE SLOT — TEMPLATE
   Everything scenario-specific lives between the BEGIN/END markers. To build a
   game, replace this block with a scenario file's contents (see
   istanbul_scenario.js / singapore_scenario.js for complete examples).
   The template below is deliberately minimal so the console runs as-is:
   two delegations, two issues, one mood, one inject.

   Fields read by engine v1.5 (all optional unless marked):
     meta.id (required, unique storage prefix), meta.title, meta.gateTagline,
       meta.projectorSubtitle, meta.clockLabel, meta.deadlineMinutes,
       meta.adoptedBanner, meta.collapseBanner, meta.collapseNote
     delegations[] (required): id, name, flag, mediator, ministry{wire,title,speaker},
       access (plain code, authoring builds only) or accessHash (release builds),
       viewAccess / viewHash (optional observer code),
       priority (issue id counted at scoring.priorityWeight),
       noDealPct (0–100 value of no agreement),
       redLines { issueId: [optionIdx, ...] },
       domestic { label, dispatch, moods { key: text } }
     facilitatorCode / facilitatorHash, projectorCode / projectorHash, designerHash
     scoring: dealWeight, credWeight, mediatorClosureShare, startCred, priorityWeight
     issues[] (required): id, label, short, type ("ranked"), options[], pillOptions[]
     matrixB64 (required): base64 JSON { delegationId: { issueId: [rank of option 1..n] } }
     publicDiplomacy: enabled, scoringContext, pressRoomTag, postures[],
       windows { total, minutes, missedPenalty }, hideInternationalMood,
       baseline, posturePenalty, revision { seconds, factor },
       moods { KEY: { dispatch, we, wl, wp, favored[], penalized[] } }, defaultMood
     injects[]: id, tag, title, body, reaction, mood (optional mood shift)
     synthesis: enabled, pairs[]
     mechanics: amendmentPolicy, injectAckRequired, maxLiveDrafts, redLineMode
   --------------------------------------------------------------------------- */
const TEMPLATE_RANKS = {
  Alpha: { i1: [1, 2, 3], i2: [3, 2, 1] },
  Beta:  { i1: [3, 2, 1], i2: [1, 2, 3] },
};
const _b64 = (o) => (typeof btoa === "function" ? btoa : (s) => Buffer.from(s).toString("base64"))(JSON.stringify(o));
const SCENARIO = {
  meta: {
    id: "tmpl01",
    brand: { a: "pyrsis", b: "" },
    title: "TEMPLATE SCENARIO",
    projectorSubtitle: "TEMPLATE SCENARIO · REPLACE THIS CARTRIDGE",
    gateTagline: "TEMPLATE SCENARIO",
    clockLabel: "TIME TO CLOSE",
    deadlineMinutes: 30,
    adoptedBanner: "✦ AGREEMENT ADOPTED ✦",
    collapseBanner: "✦ NO AGREEMENT ✦",
    collapseNote: "The session closed without an agreement.",
  },
  mode: "accord",
  delegations: [
    { id: "Alpha", name: "Alpha", flag: "🅰️", mediator: false, access: "ALPHA-0001",
      ministry: { wire: "ALPHA — FOREIGN MINISTRY", title: "Foreign Ministry", speaker: "The Foreign Ministry of Alpha" },
      priority: "i1", noDealPct: 30, redLines: {},
      domestic: { label: "Alpha public", dispatch: "Baseline domestic mood text.", moods: {} } },
    { id: "Beta", name: "Beta", flag: "🅱️", mediator: false, access: "BETA-0001",
      ministry: { wire: "BETA — FOREIGN MINISTRY", title: "Foreign Ministry", speaker: "The Foreign Ministry of Beta" },
      priority: "i2", noDealPct: 30, redLines: {},
      domestic: { label: "Beta public", dispatch: "Baseline domestic mood text.", moods: {} } },
  ],
  facilitatorCode: "TMPL-CONTROL",
  projectorCode: "TMPL-SCREEN",
  scoring: { dealWeight: 0.8, credWeight: 0.2, mediatorClosureShare: 0.5, startCred: 50, priorityWeight: 2 },
  issues: [
    { id: "i1", label: "ISSUE ONE", short: "Issue one", type: "ranked",
      options: ["First option", "Second option", "Third option"], pillOptions: ["First", "Second", "Third"] },
    { id: "i2", label: "ISSUE TWO", short: "Issue two", type: "ranked",
      options: ["First option", "Second option", "Third option"], pillOptions: ["First", "Second", "Third"] },
  ],
  matrixB64: _b64(TEMPLATE_RANKS),
  publicDiplomacy: {
    enabled: true,
    scoringContext: "a template negotiation simulation",
    pressRoomTag: "PRESS ROOM",
    postures: ["Reassure", "Pressure", "Defend", "Condemn", "Signal flexibility"],
    windows: { total: 2, minutes: 6, missedPenalty: 4 },
    hideInternationalMood: false,
    baseline: 0.40, posturePenalty: 2,
    revision: { seconds: 90, factor: 1.0 },
    moods: { NEUTRAL: { dispatch: "Public attention is steady.", we: 1.0, wl: 1.0, wp: 1.0, favored: [], penalized: [] } },
    defaultMood: "NEUTRAL",
  },
  injects: [
    { id: "W1", tag: "WIRE", title: "Talks open", body: "The talks have opened.", reaction: "Coverage is limited so far." },
  ],
  synthesis: { enabled: false, pairs: [] },
  mechanics: { amendmentPolicy: "reconfirm", injectAckRequired: true, maxLiveDrafts: 4, redLineMode: "hard" },
};
/* ================= END SCENARIO CONFIG ================= */

/* ============ ENGINE — nothing below is scenario-specific ============ */

const GOLD = "#F8BB04";
const LIGHTGOLD = "#FDE7B6";
const CHARCOAL = "#25292a";
const DEEP = "#191d1e";
const PAPER = "#FAF7F0";
const RED = "#C1442E";
const GREEN = "#367C60";        // v9: resolved/positive on light grounds (4.66:1)
const GREEN_DARK = "#46A07C";   // v9: resolved/positive on dark grounds (4.60:1)
const PLATE = "#FFFDF8";        // v9: resting control surface

let S;
/* Draft cap. Cartridges may set mechanics.maxLiveDrafts; when they leave it null
   the engine defaults to 4. Singapore ran uncapped and the table drowned. */
let MAX_LIVE_DRAFTS;
let TEAMS;
let N_TEAMS;
let DELEG;
let FLAGS;
let MEDIATORS;
let MINISTRY;
/* Sign-in is by account (auth.js); delegation access codes in older cartridges
   (access / accessHash / viewAccess / facilitatorCode / projectorCode …) are
   ignored. The designer key is still checked against its salted SHA-256 hash,
   so reading the source does not reveal it. */
const CODE_SALT = "pyrsis-accord-1";
async function codeHash(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(CODE_SALT + s.trim().toUpperCase()));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
/* Designer view: scoring detail is shown only in a browser where the designer
   key was entered once (professor dashboard, Settings). The flag is per browser. */
let DESIGNER_HASH;
async function readDesigner() {
  try { const r = await window.storage.get("pz-designer", false); return !!(r && r.value === "1"); } catch { return false; }
}

let MATRIX;
let ISSUES;
const issueWeight = (iss) => (iss.type === "ranked" ? iss.options.length : (iss.weight ?? 2));
/* v1.5 — Priority issue. A delegation's `priority` issue (cartridge field on the
   delegation) counts at scoring.priorityWeight (default 2×). Everything else is 1×.
   MAX_SCORE is therefore per-team. */
let PRIORITY_W;
const issueWeightFor = (team, iss) => issueWeight(iss) * ((DELEG[team] && DELEG[team].priority === iss.id) ? PRIORITY_W : 1);
const maxScoreFor = (team) => ISSUES.reduce((s, i) => s + issueWeightFor(team, i), 0);
let MAX_SCORE; // legacy: unweighted total
/* v1.5 — Per-delegation no-deal value: the deal-score a delegation is treated as
   holding if talks collapse (cartridge `noDealPct` on the delegation, 0–100).
   Replaces the universal collapse-to-zero. */
const noDealPct = (team) => Math.max(0, Math.min(100, (DELEG[team] && DELEG[team].noDealPct) || 0));
/* v1.5 — Red lines. cartridge delegation.redLines = { issueId: [optionIdx,...] }.
   mechanics.redLineMode "hard" (default when redLines exist): the delegation
   cannot endorse a package containing its red line; the console says why.
   This replaces the old red-line-as-cheap-concession calibration. */
let RED_LINE_MODE;
function crossedRedLines(team, terms) {
  const rl = (DELEG[team] && DELEG[team].redLines) || {};
  const out = [];
  for (const iss of ISSUES) {
    const v = terms && terms[iss.id];
    if (v != null && Array.isArray(rl[iss.id]) && rl[iss.id].includes(v)) out.push(`${shortLabel(iss)}: ${iss.pillOptions ? iss.pillOptions[v] : iss.options[v]}`);
  }
  return out;
}
let TERM_FIELDS;
const complete = (t) => TERM_FIELDS.every((f) => t && t[f] !== null && t[f] !== undefined);
let EMPTY_TERMS;
const shortLabel = (iss) => iss.short || (iss.label.charAt(0) + iss.label.slice(1).toLowerCase().replace(/\?$/, ""));

/* ---- Deal scoring (generic) ---- */
function scoreTerms(team, t) {
  const m = MATRIX[team];
  const parts = [];
  for (const iss of ISSUES) {
    const w = issueWeightFor(team, iss);
    const v = t[iss.id];
    let pts = 0;
    if (v != null) {
      if (iss.type === "ranked") pts = (iss.options.length + 1 - m[iss.id][v]) * (w / issueWeight(iss));
      else pts = v === m[iss.id] ? w : 0;
    }
    parts.push([shortLabel(iss), pts, w]);
  }
  const total = parts.reduce((s2, p) => s2 + p[1], 0);
  return { total, parts };
}
function dealPct(team, terms, adopted) {
  const base = scoreTerms(team, terms).total / maxScoreFor(team);
  const share = S.scoring.mediatorClosureShare;
  if (MEDIATORS.includes(team)) return Math.round(base * 100 * (1 - share) + (adopted ? share * 100 : 0));
  return Math.round(base * 100);
}
function blendedPct(team, terms, adopted, cred) {
  return Math.round(S.scoring.dealWeight * dealPct(team, terms, adopted) + S.scoring.credWeight * (cred ?? S.scoring.startCred));
}
let DEAL_W_PCT;
let CRED_W_PCT;

function termsLabel(t) {
  return ISSUES.map((iss) => {
    const v = t[iss.id];
    if (iss.pillOptions) return iss.pillOptions[v];
    return (iss.pillPrefix || "") + iss.options[v] + (iss.pillSuffix || "");
  });
}

/* ---- Public diplomacy (from config) ---- */
let PD;
/* v1.5 — Two-audience model. The international mood (PD.moods) grades every
   filing and, when PD.hideInternationalMood is true, its dispatch is shown only
   on the GM console: players must infer it from the wire and from how rivals'
   statements are received. Each delegation also has a visible domestic
   audience (cartridge delegation.domestic: { label, dispatch, moods }) shown
   only to that delegation. The GM sets each delegation's domestic mood key
   (pub.domestic[team]); the label/description is what the team reads. */
let HIDE_INTL_MOOD;
const domesticOf = (team) => (DELEG[team] && DELEG[team].domestic) || null;
const domesticMoodText = (team, key) => { const d = domesticOf(team); if (!d) return ""; return (key && d.moods && d.moods[key]) || d.dispatch; };
let POSTURES;
let MOODS;
let DEFAULT_MOOD;
let TOTAL_WINDOWS;
let WINDOW_MINUTES;
let MISSED_FILING_PENALTY;

function computeNet(sx, posture, moodKey) {
  const m = MOODS[moodKey] || MOODS[DEFAULT_MOOD];
  if (sx.ad_hominem) return { net: -10, backfire: true };
  const maxRaw = 5 * (m.we + m.wl + m.wp);
  const raw = sx.e * m.we + sx.l * m.wl + sx.p * m.wp;
  /* v1.5 — baseline and posture penalty are cartridge-tunable (publicDiplomacy.baseline,
     publicDiplomacy.posturePenalty). Defaults reproduce v1.4 (0.45 / 3). */
  let net = Math.round((raw / maxRaw - (PD.baseline ?? 0.45)) * 20);
  if (m.favored.includes(posture)) net += 2;
  if (m.penalized.includes(posture)) net -= (PD.posturePenalty ?? 3);
  if (sx.e <= 1 && sx.l <= 1 && sx.p <= 1) net = Math.min(net, -5);
  if (net > 0) net = Math.round(net * relFactor(sx));   // v1.5: off-subject praise/attack earns less
  net = Math.max(-10, Math.min(10, net));
  return { net, backfire: net <= -5 };
}
function explainNet(sx, posture, moodKey) {
  const m = MOODS[moodKey] || MOODS[DEFAULT_MOOD];
  const steps = [];
  if (sx.ad_hominem) {
    return { net: -10, steps: [["Ad hominem / trolling detected", "automatic floor", -10]], weights: m };
  }
  const maxRaw = 5 * (m.we + m.wl + m.wp);
  const raw = sx.e * m.we + sx.l * m.wl + sx.p * m.wp;
  const base = Math.round((raw / maxRaw - 0.45) * 20);
  steps.push([`${RUBRIC_LABELS[0]} ${sx.e}/5 \u00d7 weight ${m.we}`, "", +(sx.e * m.we).toFixed(2)]);
  steps.push([`${RUBRIC_LABELS[1]} ${sx.l}/5 \u00d7 weight ${m.wl}`, "", +(sx.l * m.wl).toFixed(2)]);
  steps.push([`${RUBRIC_LABELS[2]} ${sx.p}/5 \u00d7 weight ${m.wp}`, "", +(sx.p * m.wp).toFixed(2)]);
  steps.push([`Weighted total ${raw.toFixed(2)} of max ${maxRaw.toFixed(2)}`, `(ratio \u2212 0.45) \u00d7 20`, base]);
  let net = base;
  if (m.favored.includes(posture)) { net += 2; steps.push([`Posture "${posture}" favored by this mood`, "bonus", +2]); }
  if (m.penalized.includes(posture)) { net -= 3; steps.push([`Posture "${posture}" mismatched to this mood`, "penalty", -3]); }
  if (sx.e <= 1 && sx.l <= 1 && sx.p <= 1) {
    const capped = Math.min(net, -5);
    if (capped !== net) steps.push(["All three dimensions \u2264 1", "quality-floor backfire, capped at \u22125", capped - net]);
    net = capped;
  }
  const clamped = Math.max(-10, Math.min(10, net));
  if (clamped !== net) steps.push(["Clamped to \u00b110", "", clamped - net]);
  return { net: clamped, steps, weights: m };
}
/* v1.5 — Press read. A short newsroom reaction assembled from the scores the
   grader already returned. It describes observable properties of the text (was
   a source named, was there an argument, did it engage its subject, did the tone
   fit the room) and never names the rubric or the mood. Deterministic; no API call. */
function pressRead(sx, posture, moodKey, subjectLabel) {
  const m = MOODS[moodKey] || MOODS[DEFAULT_MOOD];
  if (sx.ad_hominem) return "Correspondents fixed on the personal attack and reported nothing else. The statement was quoted as an example of the tone at the conference.";
  const lines = [];
  const rel = sx.rel == null ? 3 : sx.rel;
  if (rel <= 1) lines.push(`Readers could not tell what the statement had to say about ${subjectLabel}; it was reported as a restatement of the ministry's own position.`);
  else if (rel === 2) lines.push(`The statement was reported as addressing ${subjectLabel} only in general terms.`);
  if (sx.e <= 1) lines.push("No source or authority was cited, so the claims ran unattributed.");
  else if (sx.e >= 4) lines.push("The named authority was picked up and quoted alongside the statement.");
  if (sx.l <= 1) lines.push("Commentators described it as assertion rather than argument.");
  else if (sx.l >= 4) lines.push("The reasoning was reported intact: editors could follow what would follow from what.");
  if (sx.p >= 4) lines.push("One concrete image from the text led several bulletins.");
  else if (sx.p <= 1 && m.wp >= 1.2) lines.push("The public was looking for something to feel and found stock phrasing.");
  if (m.penalized.includes(posture)) lines.push(`A ${posture.toLowerCase()} tone struck the press pool as out of step with the moment.`);
  else if (m.favored.includes(posture)) lines.push(`The ${posture.toLowerCase()} tone suited the moment.`);
  if (!lines.length) lines.push("A competent statement; nothing in it was singled out either way.");
  return lines.slice(0, 3).join(" ");
}
function receptionLabel(net) {
  if (net >= 6) return "The press pool is visibly impressed.";
  if (net >= 2) return "A solid reception in the press room.";
  if (net >= -1) return "The statement lands flat.";
  if (net >= -4) return "A poor reception; commentators are unkind.";
  return "The statement backfires — the press pool reacts with derision.";
}

/* SCORING RUBRIC — PLACEHOLDER.
   The production rubric is proprietary to Pyrsis and is not included in this file.
   It is inserted into release builds from a private file. The placeholder keeps the
   grader working end to end: three dimensions, each scored 0–5, plus relevance 0–3. */
const RUBRIC_TEXT = "DIMENSION A (placeholder): 0-5, how well the statement is supported.\nDIMENSION B (placeholder): 0-5, how well the statement is argued.\nDIMENSION C (placeholder): 0-5, how well the statement resonates with its audience.";
/* Claude calls go through our backend (Lambda -> Amazon Bedrock); the model is chosen server-side. */
const AI_URL = `${import.meta.env.VITE_API_URL}/ai`;
const RUBRIC_LABELS = ["Dimension A", "Dimension B", "Dimension C"];
async function scoreCommunique({ team, posture, subjectLabel, text, moodKey, exemplars }) {
  const exBlock = exemplars && exemplars.length
    ? `\n\nCALIBRATION EXAMPLES \u2014 these were graded by the head facilitator. Match this standard exactly.\n` +
      exemplars.map((x, i) =>
        `Example ${i + 1}: "${x.text}"\nGraded: e=${x.e}, l=${x.l}, p=${x.p}, ad_hominem=${x.ad ? "true" : "false"}` +
        (x.note ? `\nReason: ${x.note}` : "")).join("\n\n")
    : "";
  const prompt = `You are the press-pool scoring engine for ${PD.scoringContext}. Score this official communiqué on three rhetorical dimensions, each an integer 0-5.

${RUBRIC_TEXT}

Context: Issuing party: ${team}. Declared posture: ${posture}. Subject: ${subjectLabel}. Current global public mood: ${moodKey}.

Communiqué text:
"""${text}"""${exBlock}

Respond ONLY with a JSON object, no preamble, no markdown fences: {"e": n, "l": n, "p": n, "ad_hominem": bool, "relevance": n}`;
  const response = await fetch(AI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, max_tokens: 1000 }),
  });
  const data = await response.json();
  const txt = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const clean = txt.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);
  return {
    e: Math.max(0, Math.min(5, parsed.e | 0)),
    l: Math.max(0, Math.min(5, parsed.l | 0)),
    p: Math.max(0, Math.min(5, parsed.p | 0)),
    ad_hominem: !!parsed.ad_hominem,
    rel: parsed.relevance == null ? 3 : Math.max(0, Math.min(3, parsed.relevance | 0)),
  };
}
/* v1.5 — Relevance. Off-subject filings earn less and move the target less.
   relFactor: 0→0.25, 1→0.5, 2→0.8, 3→1.0. Applied to net credibility change and
   to sentiment routing. Cartridge may disable with publicDiplomacy.relevance: false. */
let REL_ON;
const relFactor = (sx) => (!REL_ON || sx.rel == null) ? 1 : [0.25, 0.5, 0.8, 1.0][sx.rel];

let INJECT_LIB;

/* Scenario integrity checks: designRules() in cartridge.js. */
let INTEGRITY;

/* ---- Storage (keys prefixed by scenario id) ---- */
let P;
const gmKey = (team) => `${P}-gm-${team}`;
/* v1.5 — The pinned announcement is the latest real announcement (not a GM log
   line, not after a clear marker) that has not expired. Default life 10 min. */
function liveAnnouncement(ann, now) {
  if (!ann || !ann.length) return null;
  let last = null;
  for (const a of ann) { if (a.clear) last = null; else if (!a.gm && a.text) last = a; }
  if (!last) return null;
  if (last.ttlMs != null && now > last.ts + last.ttlMs) return null;
  return last;
}
let K;

/* Seat control: per-session map { teamId: "human" | "ai" }.
   Initial state from optional config defaultControl; facilitator toggles govern. */
let DEFAULT_AI;

/* A hanging storage bridge must never wedge the UI: every storage call
   races a timeout, and callers fall back gracefully. */
function withTimeout(p, ms = 5000) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("storage-timeout")), ms))]);
}

/* ============ CONSOLIDATED STORAGE DOCUMENT ============
   Artifact storage is RATE-LIMITED, and the platform guidance is to
   batch related data into single keys. Polling 9 separate keys every
   few seconds (the v4 layout) trips the limiter, which then breaks
   sync for every client at once. All shared game state therefore
   lives in ONE document under `${P}-doc`; sGet/sSet keep their old
   signatures as a virtual-key layer over it, so game logic is
   unchanged while a full poll costs one request instead of nine.

   - Reads are cached ~1.5s and deduped in flight: a burst of sGets
     (a pull, a host tick) costs one physical get.
   - Writes are read-fresh → mutate → write, serialized per client. */
let DOC_KEY;
const DOC_CACHE_MS = 1500;
const WRITE_PROTECT_MS = 8000; // keys we wrote this recently are immune to stale-read reversion
let docCache = { ts: 0, data: null };
let authoritativeDoc = null;   // in-memory doc threaded through THIS client's writes
let localWrites = {};          // key -> ts of our last local write (propagation guard)
let docInflight = null;
let docWriteChain = Promise.resolve();
/* Opening a different game drops everything cached for the previous one.
   docGen tags each read/write with the game it started in, so a request still
   in flight for the old game can neither land in the cache nor be written
   into the new game's document. */
let docGen = 0;
function resetDocState() {
  docGen += 1;
  docCache = { ts: 0, data: null };
  authoritativeDoc = null;
  localWrites = {};
  docInflight = null;
  docWriteChain = Promise.resolve();
}

/* Physical read, folded into the authoritative doc. Other clients' changes
   are adopted, EXCEPT keys we ourselves wrote within WRITE_PROTECT_MS —
   those we keep, so storage propagation lag can never revert our own recent
   write (the seat-toggle-revert bug). After the window, physical wins, so
   legitimate changes by other clients still come through. */
async function readDoc(force) {
  if (!force && docCache.data && Date.now() - docCache.ts < DOC_CACHE_MS) return docCache.data;
  if (!force && docInflight) return docInflight;
  const gen = docGen;
  const p = (async () => {
    try {
      const r = await withTimeout(window.storage.get(DOC_KEY, true));
      if (gen !== docGen) return {};
      const physical = r ? JSON.parse(r.value) : {};
      const now = Date.now();
      const merged = { ...physical };
      for (const k of Object.keys(localWrites)) {
        if (now - localWrites[k] < WRITE_PROTECT_MS && authoritativeDoc && authoritativeDoc[k] !== undefined) {
          merged[k] = authoritativeDoc[k];
        }
      }
      authoritativeDoc = merged;
      docCache = { ts: now, data: merged };
    } catch {
      if (gen !== docGen) return {};
      if (!docCache.data) docCache = { ts: Date.now(), data: authoritativeDoc || {} };
      if (!authoritativeDoc) authoritativeDoc = docCache.data;
    } finally { if (gen === docGen) docInflight = null; }
    return docCache.data;
  })();
  if (!force) docInflight = p;
  return p;
}
/* Serialized writes that thread through authoritativeDoc IN MEMORY — no
   physical re-read between our own writes, so two writes from this client
   (e.g. a seat toggle and an AI-host draft) can never clobber each other. */
function writeDoc(mutate) {
  const gen = docGen;
  const job = docWriteChain.then(async () => {
    if (gen !== docGen) return false;
    /* Always refresh from physical before mutating. writeDoc rebuilds the WHOLE
       document, so a stale base silently drops another client's recent change to
       a different key (team endorses; facilitator opens a press window one second
       later from a stale base; the endorsement vanishes). The forced read costs
       one get per write and is merged under WRITE_PROTECT_MS, so our own recent
       writes are still preserved. */
    await readDoc(true);
    if (gen !== docGen) return false;
    const base = authoritativeDoc || {};
    const next = mutate({ ...base });
    const now = Date.now();
    for (const k of Object.keys(next)) if (next[k] !== base[k]) localWrites[k] = now;
    for (const k of Object.keys(base)) if (!(k in next)) localWrites[k] = now;
    authoritativeDoc = next;
    docCache = { ts: now, data: next };
    try {
      await withTimeout(window.storage.set(DOC_KEY, JSON.stringify(next), true));
      return true;
    } catch { return false; }
  });
  docWriteChain = job.catch(() => {});
  return job;
}
async function sGet(key, fallback) {
  const d = await readDoc(false);
  return d[key] !== undefined ? d[key] : fallback;
}
async function sGetFresh(key, fallback) {
  const d = await readDoc(true);
  return d[key] !== undefined ? d[key] : fallback;
}
async function sSet(key, val) {
  return writeDoc((d) => { d[key] = val; return d; });
}
async function sUpdate(key, fallback, mutate, verify) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await sGetFresh(key, fallback);
    const next = mutate(cur);
    await sSet(key, next);
    await new Promise((r) => setTimeout(r, 250 + Math.random() * 400));
    const check = await sGetFresh(key, fallback);
    if (verify(check)) return check;
  }
  return null;
}

/* Full clock for the open game: the scenario's deadline, unless the professor
   chose another length when creating the game (setup.minutes). Reassigned by
   setGameDeadline() before a game's room mounts; AI pacing and Reset follow it. */
let DEFAULT_CLOCK;
function setGameDeadline(minutes) {
  const m = Number(minutes) > 0 ? Number(minutes) : S.meta.deadlineMinutes;
  DEFAULT_CLOCK = { running: false, remainingMs: m * 60 * 1000, endsAt: null };
}
const deadlineMinutes = () => Math.round(DEFAULT_CLOCK.remainingMs / 60000);
/* v1.5 — Draft ordering everywhere a list of drafts is shown: the draft closest to
   adoption first, the newest breaking ties. A badge says how far each is from adoption. */
function orderDrafts(live, endo) {
  return [...live].sort((a, b) => {
    const na = endorserList(endo, a.id).length, nb = endorserList(endo, b.id).length;
    return nb - na || b.ts - a.ts;
  });
}
function draftBadge(p, endo, newestId) {
  const n = endorserList(endo, p.id).length;
  const need = N_TEAMS - 1;
  if (n >= need) return { text: "ADOPTED", color: GOLD };
  if (n === need - 1) return { text: "ONE SHORT OF ADOPTION", color: RED };
  if (n > 0) return { text: `LEADING · ${n}/${need} endorsed`, color: GREEN };
  return { text: p.id === newestId ? "NEW · no endorsements yet" : "no endorsements yet", color: "#6b6b6b" };
}
/* A session export (Facilitator → Export) as a fresh game document. Lands
   paused, clock stopped, so the professor resumes when the class is ready.
   Only the parts present in the file are carried over. */
function docFromExport(rec) {
  if (!rec || typeof rec !== "object") throw new Error("That file isn't a session export.");
  if (rec.scenario !== S.meta.id) throw new Error(`That export is for scenario "${rec.scenario}", not "${S.meta.id}".`);
  const d = {};
  const c = rec.clock || DEFAULT_CLOCK;
  d[K.clock] = { running: false, endsAt: null, remainingMs: c.running && c.endsAt ? Math.max(0, c.endsAt - Date.now()) : (c.remainingMs ?? DEFAULT_CLOCK.remainingMs) };
  if (rec.props) d[K.props] = rec.props;
  if (rec.endo) d[K.endo] = rec.endo;
  if (rec.injects) d[K.injects] = rec.injects;
  if (rec.comms) d[K.comms] = rec.comms;
  if (rec.ann) d[K.ann] = rec.ann;
  if (rec.seats) d[K.ai] = rec.seats;
  if (rec.pub) d[K.pub] = { ...rec.pub, window: { ...rec.pub.window, endsAt: null } };
  d[K.flags] = { ...DEFAULT_FLAGS, ...(rec.flags || {}), paused: true, pausedAt: Date.now(), winRemMs: null };
  return d;
}
const DEFAULT_FLAGS = { adoptedId: null, revealed: false, collapsed: false, paused: false, pausedAt: null, winRemMs: null };
/* v1.5 — Session pause. flags.paused locks every team view behind a holding
   screen and refuses all player ops; the clock and any open press window are
   suspended and resume with the same remaining time. Built for multi-session
   classroom play (game runs across several class meetings). */
async function assertNotPaused() {
  const f = await sGet(K.flags, DEFAULT_FLAGS);
  if (f.paused) throw Object.assign(new Error("paused"), { friendly: "The session is paused by the facilitator." });
}
let DEFAULT_PUB;

async function probeStorage() {
  /* A game's document is the only shared key, and a paused game or an
     unassigned student may not write it, so reading it is the probe. */
  if (!getActiveGame()) return false;
  try { await withTimeout(window.storage.get(DOC_KEY, true)); return true; } catch { return false; }
}
function useShared(pollMs = 4000) {
  const [sync, setSync] = useState("checking");
  const [clock, setClock] = useState(DEFAULT_CLOCK);
  const [props, setProps] = useState([]);
  const [endo, setEndo] = useState({});
  const [injects, setInjects] = useState([]);
  const [flags, setFlags] = useState(DEFAULT_FLAGS);
  const [pub, setPub] = useState(DEFAULT_PUB);
  const [comms, setComms] = useState([]);
  const [ann, setAnn] = useState([]);
  const [aiCtl, setAiCtl] = useState(DEFAULT_AI);

  const pull = useCallback(async () => {
    const [c, p, e, i, f, pb, cm, an, ac] = await Promise.all([
      sGet(K.clock, DEFAULT_CLOCK), sGet(K.props, []), sGet(K.endo, {}),
      sGet(K.injects, []), sGet(K.flags, DEFAULT_FLAGS),
      sGet(K.pub, DEFAULT_PUB), sGet(K.comms, []), sGet(K.ann, []), sGet(K.ai, DEFAULT_AI),
    ]);
    setClock(c); setProps(p); setEndo(e); setInjects(i); setFlags(f); setPub(pb); setComms(cm); setAnn(an); setAiCtl({ ...DEFAULT_AI, ...ac });
  }, []);

  useEffect(() => {
    pull();
    const t = setInterval(pull, pollMs);
    const onVis = () => { if (document.visibilityState === "visible") pull(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    let misses = 0;
    const doProbe = async () => {
      const ok = await probeStorage();
      if (ok) { misses = 0; setSync("ok"); return; }
      misses += 1;
      /* One miss is almost always transient; only a second consecutive
         failure is reported, so the room never sees a spurious red. */
      if (misses >= 2) setSync("fail");
    };
    doProbe();
    const t2 = setInterval(doProbe, 30000);
    return () => { clearInterval(t); clearInterval(t2); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", onVis); };
  }, [pull, pollMs]);

  return { clock, props, endo, injects, flags, pub, comms, ann, aiCtl, pull, sync };
}

function remainingOf(clock, now) {
  if (clock.running && clock.endsAt) return Math.max(0, clock.endsAt - now);
  return clock.remainingMs;
}
function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/* ---- Endorsement helpers ----
   Value semantics: number = confirmed (ts); {ts, pending:true} = pending reconfirmation. */
function endorserList(endo, propId) {
  return Object.entries(endo[propId] || {}).filter(([, v]) => typeof v === "number").map(([k]) => k);
}
function pendingList(endo, propId) {
  return Object.entries(endo[propId] || {}).filter(([, v]) => v && typeof v === "object" && v.pending).map(([k]) => k);
}
function leadingProposal(props, endo) {
  const live = props.filter((p) => p.active);
  if (!live.length) return null;
  return live.map((p) => ({ p, n: endorserList(endo, p.id).length }))
    .sort((a, b) => b.n - a.n || b.p.ts - a.p.ts)[0];
}

/* ============ SHARED GAME OPS ============
   One code path for humans and AI seats. TeamView and the AI host
   both call these; an AI Iran and a human Iran make identical moves
   through identical machinery. */

async function opSubmitDraft(team, terms) {
  await assertNotPaused();
  const reconfirm = S.mechanics.amendmentPolicy === "reconfirm";
  let result = { ok: true };
  const now = Date.now();
  const id = `${team}-${now}`;
  /* One atomic mutation over props AND endorsements together, on the freshest
     in-chain doc — so a concurrent endorsement or another team's draft can't
     be lost by a stale-base overwrite. */
  await writeDoc((d) => {
    const cur = d[K.props] || [];
    const hadMine = cur.some((p) => p.team === team && p.active);
    if (!hadMine && MAX_LIVE_DRAFTS != null &&
        cur.filter((p) => p.active).length >= MAX_LIVE_DRAFTS) {
      result = { ok: false, reason: "table-full" };
      return d;
    }
    const cleaned = cur.map((p) => (p.team === team ? { ...p, active: false } : p));
    cleaned.push({ id, team, terms, ts: now, active: true });
    const e = { ...(d[K.endo] || {}) };
    const old = cur.find((p) => p.team === team && p.active);
    if (old) {
      if (reconfirm && e[old.id] && Object.keys(e[old.id]).length) {
        e[id] = Object.fromEntries(Object.keys(e[old.id]).map((t) => [t, { ts: now, pending: true }]));
      }
      delete e[old.id];
    }
    d[K.props] = cleaned;
    d[K.endo] = e;
    result = { ok: true, amended: hadMine, id };
    return d;
  });
  return result;
}

async function opWithdrawDraft(team) {
  await assertNotPaused();
  /* A team may pull its own live draft off the table. Endorsements on it are
     discarded. Never touches an adopted draft. */
  let result = { ok: false, reason: "none" };
  await writeDoc((d) => {
    const f = d[K.flags] || DEFAULT_FLAGS;
    const ps = d[K.props] || [];
    const mine = ps.find((p) => p.team === team && p.active);
    if (!mine) return d;
    if (f.adoptedId === mine.id) { result = { ok: false, reason: "adopted" }; return d; }
    d[K.props] = ps.map((p) => (p.id === mine.id ? { ...p, active: false, withdrawnTs: Date.now() } : p));
    const e = { ...(d[K.endo] || {}) }; delete e[mine.id]; d[K.endo] = e;
    result = { ok: true };
    return d;
  });
  return result;
}

async function opEndorse(team, pid, on, gmForce) {
  await assertNotPaused();
  if (on && RED_LINE_MODE === "hard" && !gmForce) {
    const ps = await sGet(K.props, []);
    const p = ps.find((x) => x.id === pid);
    const x = p ? crossedRedLines(team, p.terms) : [];
    if (x.length) throw Object.assign(new Error("redline"), { friendly: `Your capital will not sign this: it crosses your red line on ${x.join("; ")}.` });
  }
  /* Atomic over endo + flags: read-merge-write the endorsement and the
     adoption check in one mutation, so simultaneous endorsements from
     different seats can't clobber each other or miss adoption. */
  await writeDoc((d) => {
    const e = { ...(d[K.endo] || {}) };
    e[pid] = { ...(e[pid] || {}) };
    if (on) e[pid][team] = Date.now(); else delete e[pid][team];
    d[K.endo] = e;
    const ps = d[K.props] || [];
    const p = ps.find((x) => x.id === pid && x.active);
    const confirmed = Object.values(e[pid] || {}).filter((v) => typeof v === "number").length;
    if (p && confirmed >= N_TEAMS - 1) {
      const f = d[K.flags] || DEFAULT_FLAGS;
      if (!f.adoptedId) d[K.flags] = { ...f, adoptedId: pid };
    }
    return d;
  });
  return { ok: true };
}

/* v1.5 — Revision window. publicDiplomacy.revision = { seconds, factor }. After a
   filing is scored, the delegation has `seconds` to file a revised statement on
   the same window. The original's applied effects are reversed and the revision's
   applied (scaled by `factor`, 1.0 = full benefit). The original stays in the
   record, marked superseded. */
let REVISION;
async function opFileCommunique(team, { posture, subject, subjectLabel, text, moodKey, revisionOf }) {
  await assertNotPaused();
  const id = `CM-${team}-${Date.now()}`;
  const rec = { id, team, window: (await sGet(K.pub, DEFAULT_PUB)).window.n, posture, subject, subjectLabel, text, ts: Date.now(), scored: false, revisionOf: revisionOf || null };
  await sUpdate(K.comms, [],
    (cm) => (cm.some((c) => c.id === id) ? cm : [...cm, rec]),
    (cm) => cm.some((c) => c.id === id));
  let sx;
  try {
    const exemplars = await sGet(K.exemplars, []);
    sx = await scoreCommunique({ team, posture, subjectLabel, text, moodKey, exemplars });
  } catch {
    sx = { e: 2, l: 2, p: 2, ad_hominem: false };
  }
  const { net } = computeNet(sx, posture, moodKey);
  /* Atomic over pub (credibility + sentiment) AND comms scoring — computed
     inside the chain from the freshest values, so concurrent filings each
     apply their own delta instead of overwriting a stale cred/sentiment map. */
  const read = pressRead(sx, posture, moodKey, subjectLabel);
  await writeDoc((d) => {
    const p2 = d[K.pub] || DEFAULT_PUB;
    const cred = { ...p2.cred };
    const sentiment = { ...p2.sentiment };
    let cm = d[K.comms] || [];
    const factor = revisionOf && REVISION ? (REVISION.factor ?? 1) : 1;
    // Reverse the original's applied effects when this is a revision
    if (revisionOf) {
      const orig = cm.find((c) => c.id === revisionOf);
      if (orig && orig.applied && !orig.superseded) {
        cred[team] = Math.max(0, Math.min(100, (cred[team] ?? S.scoring.startCred) - orig.applied.cred));
        if (orig.applied.sentId != null) sentiment[orig.applied.sentId] = Math.max(0, Math.min(100, (sentiment[orig.applied.sentId] ?? 50) - orig.applied.sent));
        cm = cm.map((c) => (c.id === revisionOf ? { ...c, superseded: true } : c));
      }
    }
    const credDelta = Math.round(net * factor);
    cred[team] = Math.max(0, Math.min(100, (cred[team] ?? S.scoring.startCred) + credDelta));
    let sentId = null, sentShift = 0;
    if (subject && subject.type === "prop") {
      const cur = sentiment[subject.id] ?? 50;
      const weight = (cred[team] ?? S.scoring.startCred) / 100;
      sentShift = Math.round(net * factor * weight * relFactor(sx) * (subject.stance === "for" ? 1 : -1)); // v1.5: relevance scales routing
      sentiment[subject.id] = Math.max(0, Math.min(100, cur + sentShift)); sentId = subject.id;
    }
    d[K.pub] = { ...p2, cred, sentiment };
    const has = cm.some((c) => c.id === id);
    const base = has ? cm : [...cm, rec];
    d[K.comms] = base.map((c) => (c.id === id ? { ...c, scored: true, scoredAt: Date.now(), sx, net, read, applied: { cred: credDelta, sentId, sent: sentShift } } : c));
    return d;
  });
  return { ok: true, net };
}

/* ============ AI-CORE-BEGIN ============
   Pure decision logic for AI-played seats. No React, no storage —
   takes a state snapshot, returns actions. Same matrix, same
   scoreTerms/dealPct as humans; the only "policy" is when to table,
   concede, endorse, and speak. Deterministic (testable). */

const AI_DEFAULTS = {
  tickMs: 12000,         // host evaluation cadence (rate-limit headroom)
  /* Reservation recalibrated after Singapore. At 0.40 the floor sat below
     ~90% of the package space, so AI seats endorsed almost everything in the
     final quarter. 0.60 keeps them selective to the end. */
  reserveStart: 0.75,    // opening reservation value (fraction of own deal %)
  reserveEnd: 0.60,      // reservation as the clock hits zero
  hysteresis: 0.07,      // withdraw only if value drops this far below reserve
  minAmendGapMs: 90000,  // never amend own draft more often than this
  tableStaggerMs: 20000, // seat i first tables at ~i * this after clock start
  freezeFrac: 0.25,      // below this remaining fraction, stop amending — converge
  desperationFrac: 0.12, // below this, endorse the best draft if it beats collapse…
  collapseFloor: 0.15,   // …by at least this (anything beats zero)
};
let AI_CFG;

/* ============ SCENARIO LOADING ============
   Every value above that is derived from the cartridge is a `let` assigned
   here. The built-in template is loaded at startup; GameEntry loads a game's
   own copy (game.scenario) before its room mounts, and the dashboard returns
   to the template. Engine code reads these values when it runs, so nothing
   else changes per scenario. Only one game is open per tab. */
let loadedScenarioKey = null;
/* key names the cartridge's source ("builtin", "game:<id>", a library entry
   and version), so polling the same game doesn't rebuild everything. */
function applyScenario(s, key) {
  if (key === loadedScenarioKey) return;
  loadedScenarioKey = key;
  S = normalizeCartridge(s);
  MAX_LIVE_DRAFTS = S.mechanics.maxLiveDrafts == null ? 4 : S.mechanics.maxLiveDrafts;
  TEAMS = S.delegations.map((d) => d.id);
  N_TEAMS = TEAMS.length;
  DELEG = Object.fromEntries(S.delegations.map((d) => [d.id, d]));
  FLAGS = Object.fromEntries(S.delegations.map((d) => [d.id, d.flag]));
  MEDIATORS = TEAMS.filter((t) => DELEG[t].mediator);
  MINISTRY = Object.fromEntries(S.delegations.map((d) => [d.id, d.ministry]));
  DESIGNER_HASH = S.designerHash || null;
  MATRIX = S.matrix;
  ISSUES = S.issues;
  PRIORITY_W = (S.scoring && S.scoring.priorityWeight) || 2;
  MAX_SCORE = ISSUES.reduce((s, i) => s + issueWeight(i), 0);
  RED_LINE_MODE = (S.mechanics && S.mechanics.redLineMode) || "hard";
  TERM_FIELDS = ISSUES.map((i) => i.id);
  EMPTY_TERMS = Object.fromEntries(TERM_FIELDS.map((f) => [f, null]));
  DEAL_W_PCT = Math.round(S.scoring.dealWeight * 100);
  CRED_W_PCT = Math.round(S.scoring.credWeight * 100);
  PD = S.publicDiplomacy;
  HIDE_INTL_MOOD = !!PD.hideInternationalMood;
  POSTURES = PD.postures;
  MOODS = PD.moods;
  DEFAULT_MOOD = PD.defaultMood;
  TOTAL_WINDOWS = PD.windows.total;
  WINDOW_MINUTES = PD.windows.minutes;
  MISSED_FILING_PENALTY = PD.windows.missedPenalty;
  REL_ON = PD.relevance !== false;
  INJECT_LIB = S.injects;
  INTEGRITY = designRules(S);
  P = S.meta.id;
  K = {
    ann: `${P}-announce`,
    exemplars: `${P}-exemplars`,
    clock: `${P}-clock`,
    props: `${P}-proposals`,
    endo: `${P}-endorsements`,
    injects: `${P}-injects`,
    flags: `${P}-flags`,
    pub: `${P}-public`,
    comms: `${P}-communiques`,
    ai: `${P}-aicontrol`,
  };
  DEFAULT_AI = Object.fromEntries(
    S.delegations.map((d) => [d.id, d.defaultControl === "ai" ? "ai" : "human"])
  );
  DOC_KEY = `${P}-doc`;
  DEFAULT_CLOCK = { running: false, remainingMs: S.meta.deadlineMinutes * 60 * 1000, endsAt: null };
  DEFAULT_PUB = {
    mood: DEFAULT_MOOD,
    window: { n: 0, open: false, endsAt: null, penalized: [] },
    cred: Object.fromEntries(TEAMS.map((t) => [t, S.scoring.startCred])),
    sentiment: {},
    domestic: {},   // v1.5: { teamId: domesticMoodKey }
  };
  REVISION = PD.revision || null;
  AI_CFG = { ...AI_DEFAULTS, ...(S.mechanics.ai || {}) };
}
const BUILTIN = "builtin";
applyScenario(SCENARIO, BUILTIN);

/* Per-seat capability toggles for AI-controlled delegations. Default: all on.
   The facilitator can restrict a seat to (say) endorse-only mid-session. */
const AI_CAPS_ALL = { table: true, endorse: true, amend: true, speak: true };
function aiCapsFor(team, capsMap) { return { ...AI_CAPS_ALL, ...((capsMap || {})[team] || {}) }; }

function idealTerms(team) {
  const m = MATRIX[team];
  const t = {};
  for (const iss of ISSUES) {
    t[iss.id] = iss.type === "ranked" ? m[iss.id].indexOf(1) : m[iss.id];
  }
  return t;
}
/* Value of a signable deal to this seat, 0..1 — dealPct with adoption
   assumed, so mediators' closure share applies automatically. */
function aiValue(team, terms) {
  if (RED_LINE_MODE === "hard" && crossedRedLines(team, terms).length) return -1; // v1.5: red line → never acceptable
  return dealPct(team, terms, true) / 100;
}
function aiReserve(remFrac, team) {
  const t = AI_CFG.reserveEnd + (AI_CFG.reserveStart - AI_CFG.reserveEnd) * Math.max(0, Math.min(1, remFrac));
  /* v1.5 — an AI seat never accepts less than its no-deal value. */
  return team ? Math.max(t, noDealPct(team) / 100) : t;
}
/* Points this seat loses by moving one issue from its own pick to a target pick. */
function concessionCost(team, issId, fromV, toV) {
  const iss = ISSUES.find((i) => i.id === issId);
  const m = MATRIX[team];
  const pts = (v) => (v == null ? 0 : iss.type === "ranked" ? iss.options.length + 1 - m[issId][v] : (v === m[issId] ? issueWeight(iss) : 0));
  return pts(fromV) - pts(toV);
}
/* Compose this seat's draft: own ideal, conceding toward the leading
   rival draft (public information only), cheapest concessions first,
   deeper as the clock runs down. */
function composeAiDraft(team, snapshot, remFrac) {
  const { props, endo } = snapshot;
  const mineIdeal = idealTerms(team);
  const lead = leadingProposal(props.filter((p) => p.team !== team), endo);
  if (!lead) return mineIdeal;
  const target = lead.p.terms;
  const diffs = ISSUES
    .filter((iss) => mineIdeal[iss.id] !== target[iss.id])
    .map((iss) => ({ id: iss.id, cost: concessionCost(team, iss.id, mineIdeal[iss.id], target[iss.id]) }))
    .sort((a, b) => a.cost - b.cost);
  const depth = Math.round((1 - remFrac) * diffs.length * 0.9);
  const t = { ...mineIdeal };
  diffs.slice(0, depth).forEach((d) => { t[d.id] = target[d.id]; });
  return t;
}
/* The issue where a draft hurts this seat most vs its ideal — for the
   on-record objection line. */
function worstIssueFor(team, terms) {
  let worst = null, worstCost = -1;
  const ideal = idealTerms(team);
  for (const iss of ISSUES) {
    if (terms[iss.id] === ideal[iss.id]) continue;
    const c = concessionCost(team, iss.id, ideal[iss.id], terms[iss.id]);
    if (c > worstCost) { worstCost = c; worst = iss; }
  }
  return worst;
}

/* Main per-tick decision. snapshot: {props, endo, pub, comms, flags, clock};
   mem: host-local per-team memory {lastTableTs, remarked:{draftId:true}}.
   Returns a list of actions the host executes via the shared ops. */
function aiDecide(team, snapshot, now, mem) {
  const { props, endo, pub, comms, flags, clock } = snapshot;
  const actions = [];
  if (flags.adoptedId || flags.collapsed) return actions;
  if (!clock.running) return actions;
  const totalMs = DEFAULT_CLOCK.remainingMs;
  const rem = remainingOf(clock, now);
  if (rem <= 0) return actions;
  const remFrac = rem / totalMs;
  const reserve = aiReserve(remFrac, team);
  const live = props.filter((p) => p.active);
  const others = live.filter((p) => p.team !== team);
  const mine = live.find((p) => p.team === team);

  /* 1 — Endorsements: endorse any rival draft at/above reservation;
     reaffirm pendings the same way; withdraw (with hysteresis) below. */
  for (const p of others) {
    const v = aiValue(team, p.terms);
    const confirmed = endorserList(endo, p.id).includes(team);
    const pending = pendingList(endo, p.id).includes(team);
    if (v >= reserve && (!confirmed || pending)) actions.push({ type: "endorse", pid: p.id });
    else if (confirmed && v < reserve - AI_CFG.hysteresis) actions.push({ type: "withdraw", pid: p.id });
    else if (pending && v < reserve) actions.push({ type: "withdraw", pid: p.id });
  }

  /* 1b — Desperation floor: the collapse rule scores everyone zero, so
     in the last stretch sign the best available draft if it beats nothing. */
  if (remFrac < AI_CFG.desperationFrac && others.length) {
    const best = others.map((p) => ({ p, v: aiValue(team, p.terms) })).sort((a, b) => b.v - a.v)[0];
    if (best.v >= AI_CFG.collapseFloor && !endorserList(endo, best.p.id).includes(team)) {
      actions.push({ type: "endorse", pid: best.p.id });
    }
  }

  /* 2 — Table / amend own draft: staggered opening, concession-composed,
     frozen late so endorsements can accumulate. */
  const seatIdx = TEAMS.indexOf(team);
  const started = clock.endsAt ? clock.endsAt - totalMs : now;
  const mayTable = now - started >= seatIdx * AI_CFG.tableStaggerMs;
  if (!mine && mayTable &&
      (MAX_LIVE_DRAFTS == null || live.length < MAX_LIVE_DRAFTS)) {
    actions.push({ type: "table", terms: composeAiDraft(team, snapshot, remFrac) });
  } else if (mine && remFrac > AI_CFG.freezeFrac) {
    const proposed = composeAiDraft(team, snapshot, remFrac);
    const differs = ISSUES.some((iss) => proposed[iss.id] !== mine.terms[iss.id]);
    const wellEndorsed = endorserList(endo, mine.id).length >= N_TEAMS - 2;
    const cooled = now - (mem.lastTableTs || 0) >= AI_CFG.minAmendGapMs;
    if (differs && !wellEndorsed && cooled) actions.push({ type: "amend", terms: proposed });
  }

  /* 3 — On-record objection: once per rival draft version it declines,
     name the costliest issue on the conference floor. */
  const lead = leadingProposal(others, endo);
  if (lead && aiValue(team, lead.p.terms) < reserve && !mem.remarked[lead.p.id]) {
    const iss = worstIssueFor(team, lead.p.terms);
    if (iss) actions.push({
      type: "floor", draftId: lead.p.id,
      text: `${DELEG[team].name} signals it cannot accept the current ${lead.p.team} text on ${iss.label.toLowerCase().replace(/\?$/, "")}.`,
    });
  }

  /* 4 — Press window: file once per window, like any ministry must. */
  const winOpen = pub.window.open && pub.window.endsAt > now;
  if (winOpen && !comms.some((c) => c.team === team && c.window === pub.window.n)) {
    let subject, stance;
    if (lead) {
      stance = aiValue(team, lead.p.terms) >= reserve ? "for" : "against";
      subject = { type: "prop", id: lead.p.id, stance };
    } else {
      subject = { type: "general" };
    }
    const posture = subject.type === "general" ? "Defend" : (subject.stance === "for" ? "Reassure" : "Pressure");
    actions.push({ type: "file", subject, posture, leadTeam: lead ? lead.p.team : null });
  }
  return actions;
}
/* ============ AI-CORE-END ============ */

/* AI communiqué text: in character via the same Claude API used for statement
   scoring, with a deterministic fallback so a network failure never
   silences a ministry. */
async function composeAiCommunique(team, { subject, posture, leadTeam, moodDispatch, worstIss, subjectLabel }) {
  const fallback = subject.type === "general"
    ? `${MINISTRY[team].speaker} reaffirms its commitment to a responsible outcome at this conference. Our delegation will judge every text by its substance, and we urge all parties to do the same.`
    : subject.stance === "for"
      ? `${MINISTRY[team].speaker} welcomes the ${leadTeam} text as a serious basis for agreement, and calls on all delegations to move from posturing to signature.`
      : `${MINISTRY[team].speaker} cannot accept the ${leadTeam} text as drafted${worstIss ? `, above all on ${worstIss.label.toLowerCase().replace(/\?$/, "")}` : ""}. A durable agreement will not be built on terms our public cannot defend.`;
  try {
    const prompt = `You write one official communiqué (max 380 characters, no quotation marks around it, no preamble) for ${MINISTRY[team].wire} in ${PD.scoringContext}. Posture: ${posture}. Subject: ${subjectLabel}. Current press climate: "${moodDispatch}". Speak in the institutional first-person plural of ${MINISTRY[team].speaker}. Be specific and rhetorically strong — cite a principle or fact, reason clearly, and match the public temperature. Output ONLY the statement text.`;
    const res = await fetch(AI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, max_tokens: 300 }),
    });
    const data = await res.json();
    const txt = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    return txt ? txt.slice(0, 400) : fallback;
  } catch { return fallback; }
}

/* ---- Audio ---- */
let AUDIO_CTX = null;
function ensureAudio() {
  try {
    if (!AUDIO_CTX) AUDIO_CTX = new (window.AudioContext || window.webkitAudioContext)();
    if (AUDIO_CTX.state === "suspended") AUDIO_CTX.resume();
  } catch {}
}
function tone(freq, dur, delay = 0, vol = 0.09) {
  try {
    ensureAudio();
    if (!AUDIO_CTX) return;
    const o = AUDIO_CTX.createOscillator(), g = AUDIO_CTX.createGain();
    o.frequency.value = freq; g.gain.value = vol;
    o.connect(g); g.connect(AUDIO_CTX.destination);
    const t = AUDIO_CTX.currentTime + delay;
    o.start(t); o.stop(t + dur);
  } catch {}
}
const SOUNDS = {
  inject: () => tone(880, 0.18),
  comm: () => { tone(660, 0.12); tone(660, 0.12, 0.18); },
  windowOpen: () => { tone(523, 0.15); tone(784, 0.22, 0.17); },
  windowClose: () => { tone(784, 0.15); tone(523, 0.22, 0.17); },
  announce: () => { tone(587, 0.12); tone(740, 0.12, 0.14); tone(880, 0.2, 0.28); },
  gm: () => tone(1046, 0.14),
};

/* ---- Toasts ---- */
function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((text, color) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, color }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  return [toasts, push];
}
const ToastStack = ({ toasts }) => (
  <div className="fixed top-2 left-2 right-2 z-50 space-y-2 pointer-events-none">
    {toasts.map((t) => (
      <div key={t.id} className="mx-auto max-w-md text-center px-4 py-2 rounded-lg font-bold text-sm"
        style={{ background: t.color || GOLD, color: t.color === RED ? "white" : CHARCOAL }}>
        {t.text}
      </div>
    ))}
  </div>
);


/* ---- Embedded house typography (Safari blocks local fonts; all faces must ship in-file) ---- */
const PYRSIS_FONT_CSS = `/* Pyrsis house fonts.
   Hoefler & Co. Ideal Sans Pro, Decimal Pro, Gotham XNarrow, Operator Mono;
   House Industries Chalet ParisSeventy (wordmark only).
   Subset to Latin, punctuation, figure sets, small caps, and the Decimal icon set.
   Copyright, trademark and licence records retained in every name table.
   Family names match the installed desktop names; italics are styles within
   each family, so font-style: italic selects the drawn italic.
   Chalet is declared under both 'Chalet ParisSeventy' and its internal name
   'Chalet-ParisNineteenSeventy'.
   Generated 24 September 2026. */

@font-face {
  font-family: 'Ideal Sans Light';
  src: url(data:font/woff2;base64,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) format('woff2');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Ideal Sans Light';
  src: url(data:font/woff2;base64,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) format('woff2');
  font-weight: normal;
  font-style: italic;
  font-display: swap;
}

@font-face {
  font-family: 'Ideal Sans Book';
  src: url(data:font/woff2;base64,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) format('woff2');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Ideal Sans Book';
  src: url(data:font/woff2;base64,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) format('woff2');
  font-weight: normal;
  font-style: italic;
  font-display: swap;
}

@font-face {
  font-family: 'Decimal Black';
  src: url(data:font/woff2;base64,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) format('woff2');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Decimal Light';
  src: url(data:font/woff2;base64,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) format('woff2');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Gotham XNarrow Bold';
  src: url(data:font/woff2;base64,d09GMk9UVE8AAGSAAAsAAAAA0YgAAGQvAAMzdQAAAAAAAAAAAAAAAAAAAAAAAAAADYHiKRuBkBgcjnwGYACHKgE2AiQDjgAEBgWIfAcgG8LQJezYK+F2IOZ97jez2YgKNg4Cm5FhREVrR7L/PyepjKFJ55MWBFE3PcmGRbINZbWqLqE6nPvINjsdqBpYZPLZKa+JHE0X9hHq6ne/+qm/d6M1LnQU+8rIdnR48y/96lnISOumpETLdlIhkUlJKVh0f5D3Bm+QRnMlNe2t1aK2h1IoRfp38PxojcTLM8kYcNGDSYZFwouecODIkON1LXxRqDo0OeOpzfT5GTjOR82FiHCz2QtiCdBSMSr2KiIDNGc1k0zGMp7MJJk4IQkWhYYQxCrY0tAWKkhNYGt+LGzFjbbUfLUiSpWaLuynlPb3f9v8/rbviwljxqi1zyh1nQAB0obQhlAZE/0rtaXu/mLvZ//3xv+/HOzc99cWBhxrkARI0T/82LPO3Idq0yZWgndCp9IIOcJu+/+39j/E086sP71rPne+ujfMIoluKXAInZbgH+z2/iUSUER5YlFrbRe4n31PS/3P1NW580rzPu36qH5pyzNGFMYEMgAmsuOAopgUbdBZPStoDLECBiDJSCITS7JM1Hd9xg4YNOd9iYQZGM1WsJyUk7Y/WaA5ToKEoP/fXNmyMCRP2oLz/HyFYXXA2EXIJt1mbwI0k8zfPxBwHCBaz/9/3s2eaZfFecoUVpjf7tTSrCnVrCDasTRIL+pYifmxtFQU09snXTOQENOYfHQcw7gvOcwMWng9f6EJT9gzPT9XVdTWh67Xu3t31GXq+K9kRaRVaDEa8UCaJJA4gR/DWhWLCTFDvaFNx9mZlhXrWX+Zy0xPLADc97/nl/s+XUyTeX1q9lRl1/1C1e3g+l8wiSEaRINYsFiTDI1YeI+IgidEREiDN+ZJEPV1qU3V9/m++8x9c+rs1+ivArIHYKgxKvLbjaReRdTtnJqBbej9ajXY6DGjC9wxY8u4MtVKp3cBaXF2IV4VwbfAWfIt+S6m3vkzrPyV/QXR7AxA7ewCgqEowZAnkJDZJXSq5cqB4hmScjTvDPnGWxCUISipXoB0dwTPWhckb8ILkv84PN5bE4SpDY1NHymZTBi0mJWDIJb1woMFgwQjELgb8cHlqwXswOxn3m5a6YAXi3q9mqb0L60riBmwtMr43+5pdHv759LPpaFWWNJfLqUCkglBNjMMgExSmpQOM2YBNCjmMMt+5l8gQ/SwgyouwBX96lvjJ659+2Jo0uze7P/U7R5nVDQYyrWneSLUS385z8ZH9GOqpiJ6G375O+M19rNbsiwhlLAECSLBDjLYQUREgoSSvm++gkkhIoE/XGEjp5xEnLuDJa9ZkX1/OE7zP0PTwJ9H8vNIfzwx6Uv+5+n/fJZFQn2aQG89/UPvfNbkmReeaRK592YAggUnQbTMogW0kVHW0tYzdMAY08yxyArr7HDICedcccsDz7zxqe9g0cVHK0wEp4DW0qqaNDZmaJeDRptkpqU22m6vw8655akX3vjkX80Dla7CZpx13qWu9RLLrbLW8HrbtQMbuYmbuflbuo3bu8M7t9ur39t92df9J0EhxaRKlRWqSg1qU0wFNWXJ116d0iV1yiGf4hrWtG6qoKYGulco5AXoEIsOEMCppx2VPDUMKIIdHOQy3djpI8EwMyxTpMEAQozYlvEuOjB3k3uccs3Y3Nu9z+d83Q77HfeQp73sotu2HTi1n1hYFTNxatKRbOrBYdmRE7HHn1gmspC7NDKIF5bndRCmUvUWajVo1so2tL1qyzXrdtgDPdOLvVZzPY12tOk5BfL+hKhAShPSfYHfasPa/0vX9gc91f53SiRMiofGvgbBvwCaStMtjvr2fM7/vdcVqXSv4t5tXruDgArkyqckIQg1HDBsgg76j22CNn6OvnhPGK5YuRRYo7+ZPMgQ1nnFFxLGwhTVMJg6AcNM2Rr8likagz9m6tMJU2yzftyUX9hwNd+WPoorY62/EQ1xO1BtIWTUEw8iT1H9ClGjQgh0zOnu6OIxgv4QBxQ6fvpAzd4NNz0HSdMYkQQMOmmumS5FLVf4pGyfWSefvkMLwT9DUnTHVWVdxn/IAg6ddbO5LmeKJ/zmdGwQSpEny9siFp0330JXCBhfOBRoOviGFCiLr6YQt/FhL+S73V9XKWfX4H1RWYxUA2v7j6mm52x/cy0Fvzw8f/celRP2dZGsENf72FS3S16h/hWri61T22Kwl1shSpho26S/eeSRoZiSFOShSFZNIcbZgTBzrDZ4D1gDGgCACpAAALTAwHxnrDZ4D1gDGgCACpAAALTAYGA2Vhu8B6wBDQBABUgABModj+ZpefYlpXHrze603P8Kw5qtrci+Rlj2SK2QWin1J21MRwOCw5AToSL7ErJBII0qMgB8JsLKcTpnaMJGBUgAAFoxdGQ5bYFuzFgyGG1lZEP2tOjqxTaxDqiYzv1eFIZmUkhVCSN2wwCkknVuaBQV8wQXa0PITVqrJeoOJ/ccYhDp2f9LxSKNLK3qrHDOPabIo2VFi06qSGEmgcoS7cQhDBVbB4UtBHPDNpdGGEtG66rsnPV5q88MEY6GPG9wv/sPD1xm81GfEfSbYz56Nu5hmpq+s5DPyLJl4WXYYcS2MVNyySZ3VvkBF21+Qx4rE9js/GxWMPJmy3zfahG5ivQpeblbmvpZK8pcaYuM/rHbrYkFL0iZG+Eh4mKTag6kudL+qjwIH9N9LUZd99IujZjZqgquSqhXxUu/IzINkUcvw6r50pug8d10fLlW3nBHN3m79mDPRvVM3bVX99VSwCMIgXg8kGYu+ZBRntPD8mvve6f3+aInvORb1+2Z+58cdqU5/UmH5GqSWU41aS0EQSikVZvV2umlOuupv/EOdrSTXWyvZp1Ge4qSKLv8yuteeqU1hmaus+5279gur3eO+Zba1JZ3u87Ynu6fg5EYf/3F45vf+8aN97/j+37hnTfd++hTH/7k53/9wmvvvP/R2XF5zyT/UCzK8t/UlNpTd+pDQ8iLRtAkmkPzMS3CO5ffNzJBxr+n4Ay5RginDD+BfAgKI1Dy/Rxw8yEpN39D3XGdH83xD/fD6jVV6+LqKEyI8EBe/T0U8JxAIHGgmRQi4UE1sv3PssDVOiBdwDFTrXdueLvwvuHWzHTwwPetJeiQGlmClXaqYPzDd0fED7V0nD/XThLOM2BLpECv4eBmDZNQbr5mh4XLWuQyIydRcSZ7E1kYwaxYE20fgOrgAJ85q9k1oUdH1vpSTs+pUxY8HHOS5aLLWGkjMhcqvX143bg4Ohou+JE1D52S46uxitW/jp2rd85tv/d9b5Qt3+wdmOyXqPrwgweyvd9vcx+Cwia/zrg3C+32D/p3nnt3lFUjY+dlSssPV48E5bjv/Zp2VCMB9QgakDyFJEg9KeS/BrBVI9skkoTp5ryuJtaR2DRy/CRSY4mDLXTTYIeqHHxRNw36Y+nGOarZ2B2IsxdH9+dXNeiEIlwdz2Q32EwemLGspUljNMjFRK3M1etlcHzWzZteEt61Ls6EnTq9FZ8FQCWj66xlUJikBznBy4KqmUNJZAJGMsjAdqgRA7XIoJkrnGYUaoTfOQbWW4yXscP5Aczq978nRl6w8ThSkJKFcfXQfMcWKG01dkt3njhcdghPZPIefXqVspBwaLXs4yj4jZEewp7MPKYvrm0oJgRMD3h5URKzTxyc7WtVsIHFBqVcYzHr8aJIRu12ULmAAHH9O8CtSYCTA9bpek4M+ZFuavUHyrUsQzJ4APZ6z8y09ZZCaV/IAJksRspamY7SGlvY1HX+XA8GYCfk6a4o4PQRbZpGEprXLi5jFw78ai2UtmPD8OLi2KHCQn7N0YKRmnnvkFuQzR0Kujx+v6tJIeeaVUR5k7T8AyzKdYVOk96ix+JT1e+GCEtnUOYPyv8GAw94YcAE8BpiUKd1+lvQaA7mUxvBo7lV29AcYmQEAigCI0XwYQgYP8/m0EC/DX8JnaZdfForrWfzHUp6ZQAx6kDbfiMiMqRbAiE2fvGei1MxuVWqX7tPxp/52Wql0f8R3o5HlX4/Ju2z5Ipf99icPul33ug1k0nTmpobYEi2qbuFBIYxq1ZG2+Pw4c4D0HlLcbNgUOXDqUWqHhmUn2JC8uypfpvT12fX1tXpDY2EtD4N2WWGtt9CuB6TVWVQKgxGjcZgDQZsNi9R2ZV2X4o9M3IwP79CcFhoV/cZsYLQQyjTaQs4bYYmGhSNVtpFffrAnl7MS9EJVhJAk3ZZQ/LYXOBOqTrKjgPKMR2l2KMV/mkKclcemoihJBEaXnkvfvkqQ7h+j8obUkmI0OLHt5AXb4m0LetSKzYyZAWz3H6yXQfXl93o1JEd+coeNZySK1xnr3M9zBSUdvY64K7lp044yKY1vg4fpGV2ikByHQpInUYVZsMKSqZqTDUD6dt3vVCosmWqP5AUBER2lgpCUNduJrKhgjyox4Wbex9yaDNDQC+9aEVMcDv0pOQE2npFYO90xMGiKQjd/dQhEuPyRAAwhG/3ZJX/mHS8bwH8A+fXBeIJp7IUyz8hAf8gm6eWebG86WdwZ7sJw6VCOa7Jrw8UQb/RkmolYe+xKYhC8pzJpN3W12fXi0UGrZpQnbMIKe2TlOfweuVQ9jmUQQCQb/03EAlsh6Z+hmCd6+Gx6LthN+Ch0qqtFqKAaC6gd9W2MAo0BLLkWwgEMEe7rDvCWz3Gj+blYuHTe37pT5GynfbpZ6zRcwpS7xPvpo4bI65VY3V7z8ZXN0hvoUyl0OMX6JVaQCjWB3+hvGwnxGjJNxHIwm8kTi1JcpxwXERbGbJ++i7j521b/puRXbYKzG9SVLPDT9Q8ddViaeSEV2sj0heve/vwpnlhdDR49IfWPHROiavGZJdXgQWsJF6G8DKJ9+Uhnz5SPNvI44u9UGMOvI54YEUsBxZ5DxyqaoILooLrNWFchwacHy4csuVqz2sAj+0F7jJOvPDzHjUBJXaxH7AT4ld/Q3KLjGdbYHBlb4Cg9hIFUqAXQfQvaWA9X7HV0lm6rj42+S+r1YWVtBSEtVAC8adU/aZQae6Gs9AvA8A53fvUZns0Ssp22GeesMYU0fhV9qh0dZ1ca3cZ8YDHb5nduqC8FaJNTi6dDsxyQAAOQf0fjZGYPgVR0kO69vgyneX+HXOU+PMK00aYZxT5tbmOAMTlmQALNO+rXDP2FMcbXD4ecOODRqSElpGztzOwOPOJ0m1AwQ672LUKgw1yRwit/iOtmoajZZmjmrRjx0lv469N7rGnpo65/2s2OW5/BonXtG+k0iCCEVGr1rv6PXOVdkVDcvmB4+RgIwdW6P410zUHZcyj8GoRbGWXS0S6/JVasW4dNIPFpI3Zr3gSwaRFhi10om1o8R/il0Bk0mkRXU7QCu/BSp8loLGyNSQM41BJsLTDx06TeVAyfQJSrBNwyk+cIAp26zjs6rjScJJU2nZ9AAGKfdZVRXwD1HWM/B2xByZHAwXsFblGYskXQCHY4XnKqNG1dRqs6vaUWEc9d88pGJyIfRKOeg+W7Xd6kUk17DwCpPCGwpMvTitEOFpaaeQuScLFyojfb5Xuw5sxslCqwgojSoXT6nfEZ0IBHSFVTztJXAbp1OFY2KvNVVqSJO0NogEzBsnWN3kB+N0fcyJX22zj11cVfecVyJ2IE9UcjS/cW+I8hc5bAEAd9r+YVhuRaEWQOZuW+9r7IGkYszznVKd8jftsDBw9rAATyr5CalfFpSuW1bduqMQwBbMTBX33iwi/6kDAYEfGzqB26xDsKkEGLQkcWgeU23oKTluQrpYKB9ecx64dPJeFVCMcnM674kAR1PXgVWgC2uUkOr6hKpUEtJHNzgLguG2lW2JgD+p4nIjPgcolV7VQmpTpvU+hjQMmqMswwg5f2Pkg7E6ThD2KJ98jq3ZSnxCvqdrTsYoyNor8/4ocrW1Lt8lDFFxWLfRKNVpBaqjkoAPUQiJQZbRw3NMh8MrPHxeuXB0gKRoFiXvdnxKZn0AhgRFReAe24wQZeViDk2RsrMUpMi7W4TQZf431OEOmxQacJdOvsBHnyJyrbMJ5suiwGRewBRfJMmzFJbLiNttwmWzBdlzBDlwl2zARO3GN7LjLGEwix64Cu3Adu3GDnAHswU3sxS3sw21y7gBjMRn7cYdcug4cwF1y6ypwEPfIA8Ah3MdhPMARPCSPbgJH8Yi8ARzDY/IOcBxPyAfAKEzAOEzBLCzHXCzCVHgP/BQQ9ADcoENEQE/QCVhBQQMQA+gNWoLuoCCwQTfQFbQCPUDrwID2YCQKAA8gL6AusAt5APkAdUA9EAtYRT4DlpKvATPhhA5BF2CGRgLfApqAhsAEnUEzMBrjsRAW6AU0aAFcsAzz4QesQBQgGjCHfH9PTzCbig8sUjAhsGgwj0oMWEwlXQcLFEwXWHDB9K/vxySpfh1mID+gPhBU/RvQtmAL0Bf0AQMwGEOpVidwZICgoePGr0zPWQuccMkV9zz30qeaatbLV456599JVMoNWm87d3izN28XpnOo13LUJUWqYkpooH06KbMCCukTUf4LiqQHikuPjxjmJgY24KDLRg+7ZsdX/ciGwc/z/2lMb442t2u1e7mPa+05Gr/+0R1YqLEM5j96GkYZ7IYThs/YA7w5+dB0slEkZdMBqqfX9Fb7h2qlDdKmaEu1GC1Xexg1PSo0KjqqOOpm1HcyLjogend0TnRR9IHo29Evon+QIKOUpn+SoibGpsaOxr7GKcZw4w5jg/H9rY3/3exWj1un3vrXrSW3Xr71/5WYEAm1wrjAF04Jfwj1Qj/5D/FIHekhFURCOshysp/8RY6Rs2SAvqA29WhGG+kiVVGOXqF/0fPic+KiaBRD4kUxIllSlTQn3ZD+lK5Kg/JTuUEelbVyUH4uDymaEiqDSo1yRnmkPq+OqafUa9rdWqoda8e1k5pPv1tP9UZ9WOfrjfopfUouLxfIp+e354fyTYW48K3wvqgVJ4pdJbTUWnKU+XJl+S+8CZ1QDEJog0E4aYw2Tho1xg9z1pSZdrPGPGX6zEtm2AKLWS3WtCWzTlpLrD3WRctv/8ses1X2dfs/sOf+2v3sXvTu8777Kr/Fv/O7/Iv+teAueBi+Gn4Nm6Od6FKcFi8n9yU7SSoNS0fTY+nFdH16N+WMZVOZMZvMTmaerCcbYDGrZz3sKKtkdewR62YXWR/ejCpamGI9duA+PIoVWI9NeBFXYy0ewhN4CE+gF3tR8XtcyW3ezQ/yEl7LxVzBL/PjHBVRxU5FqOJD5dOVh5Wdlf9XtVPVWXWmCtUX1cHqFzX31mzUOGru1T5TO1/rq31dl1jnqPtWf17f2+Bs+NHobHzf+E9TV9Ngs6N5oiWnZbTl/1urb6nc0hGqhezQrtCdpHIvT9LYKlujrevho53qy0Enddu/jd/+7nJ3/H4/2PkHYZe26yUu3vCFR4AoPv84SVtvd68yVB742Gc2fF7eKR+TTyuf3j4x+dX5Cv+XfaRph1qrmhN1kGUTqNJ0g9Iqhb4e0b0sYHJCRCEMymlGukYuQCgxwEsGygWEQnJdSddIFYoDB7tl3J4D4u4V8iPrBLtEEzuck+W0gJZEi50c3Q0WgWViDY1yJwlKp2M2PMrf1ImGKccBQ6t1B6s6tHBjrgPgsCdMBUvVywc6WbhAMRoUUfZIKvaIqEmG53GfBsPrdaO/PDoZ6QJq/Dyg31LQyGkOkzSInp86X/7aQqNpnGxK1IcgjYAyQ0D3l8bZg+x9mgp22Z+9iM8EBtcCL9ESXZN5GeLaIIMfNPNwFByxRQfwmQGMFILn91JuI8mrAbzbrj44mr8j43VzMXXGsVNSPOZUp3V3OjKbi1rOGqBvd4RGQuIwBGYaQiCODu8N/I4inhwR0X+svnLdiUcS7i7h3XbjwdH8rRmvWwzxDvfLx+RwGi/J+SseoupMFDKVMqYPGCsfWiihVajI5QG/7gPhPShv8fKcmvo4RCucXPo6uGGSgqXpEES0zgCtiPZXc5+2D2ftUBMVCj/jQdDIjbYn0WsB/QECmgEkZk24YmZAlzZ39+9ZQRermXTmWt6qzBt+JkGl2QOXpXivSDvaDbQwFvEA2SHS4c1AslGc1GLSNFC2TkbIh6jaSGNcFjBVKGtHSYNpluRNEYAL61l4Uxbiwga6sZM0Jko3tz9iN4/l8Bp5mAOYhSvi3JoyCDa7L+XUAnGG8R6XD5Ex0lQAQWF8hHd6szcVJ2M/UXvJCWfrgHIZP+1zwO6kkDY3gArRMhFkWhPdCmPQqfgQldeSxsHSlAcl9GBUU2mUdnlcOu3xzQczwrkXOiPuPhgHwaSdf+zXHGimG/vTbDlGTKaAZuSgsEbCoYt3fyB9CVYtKtyCCuUkc2aZdCdDMUWSTM/jquhNm4WX3FRPVXAn9RQLu6MjqWumHUemAvCIA6+aJVM8ZROYcmNiQVxY7atoggiavd1+pOfK88uG+r140G7e2WtyUMbHlBwuNE9SUweleALpO7Rx2PsTe+8ba5J56u7D701BkuTpG1DkWqaxYHoK8eq+0xAtTk155NLGOLBPAut8IVDasXlqaWLIRzi3uYXdUwAFVnPpXeGsPcqnEPeZNzgNm9lFIuj+3JiMRpmoNfUmmk5zSIHiDuvhKOQBeEei0Yj0t1Pw9NaTOri6+EZnKwlubLY3Jk4E4M3V/f+u8RBuap35UpREpmy86A3uV5+lSMzIVD3rpJloV7fRn5QT7ME9Plt/Fiwu5aeGcmsKVvgEtkAxbEHF2ars8dyNBsi2hz+x7FXl8xwfeRGCP6in0M7yVvbDaq0Uq0x1az28llYqJRozuLXe4jIQC/QUIi1QjU7QYUgHsKk0OAl0gSJL8iYVXEUhRSFZUTpTgVOVmtBUf0uuP6cFWigMFrsHhFCraoHzKiQrIjs2CaK51WCyOFWooXcmJgrm1x8zAqFs6I0yoXfkalkAUnwHjgZdqCvNOdRcZsZmuNSDvRrghZqkzNq4OQJwUT1LFLLQYdtAN+Vr0kxKBwNkx7OfWIQ2w9NBHXuKHxdWNRkCYpSxM0VLlFmGdCwKZC0IRc8aodblHLlwlq7AkVFWLJAHxsd7MHa3jCVawJ7ik/daZtNJFb9PHg3ys29kcnSLbXbmOOPN6+hrfTl/piGGi8aW2w/AMal6DZ9U1jXvrEy5huDRHcqDJBS7U5Sd9bDrl8kZuWcH+2rMd4z5Cc+wH/PmuBzesrgUsE+6YBrveQjazZ7iE5An2uzUcSLxNajvxXfmqMtuR8enzAwDjfnwzTYwuwJyuGN59sqMNo2syRV2+aQbwp37YHkt3Tie/FTSrMw2wMZ/Hp0Klm/583RFytu2mEKxKY02JZIgpUjZ0uOb60ZibUqisByv1im2dnPTFFMYYZIdmwS5QbcqS7r8Gm5qP92S5WRi7aHh7q/TtC/QCTnQiXK0XlPFexOxoLdFn4cGyFMK5y7ADUlqkvtKjMgaUE0So34zyCxYUFIHVYT3wzs8JbXQnfWj/bqNhbrVFLABhqdYK6K3tYpWvDbYomPSwC6msuHPtu96eCZTWCUW3kjd7i+n+sZG8oZ9l2VYlNpjcGT0Q8R5C4GoXaeOrwhxah++9US2dnSJfxuUaIGEktHeakhhkWBAM+7yaWKmnu7WJYEMAusDK9hAcfOfKVcomkdJUixo+zjz3OoojFtLJLyejGsYFJ42GUtqiAU+F9+QCuoMROXqzaTyzNscdC8L1EBgrfYHxuFoK0uijGZSF8FVdoU5OA3JoWf9OFfGCCc+2BJTECfLepU/IF9tsPIZXgaF7G4e8o9mVLfiT+VNmZoVXr3ezIONr6uHMsLL9VwLI2dq6ezch4Nf10UvLT8N09jWRjcVW7UdoFDeqjtvb1n68NPL+YCbuBvRJKHEUY+0ViRztFXeh26TmLZ4y8WuzVJrHoRtrfXP5OCUkbZS2iaJoa2Iw+6zMw0Vo7apzrVlkV1ZPRfmUIjakA6slcwl9S1cD4ea1QQ5HcfFe5qwjjcCIcn4vUObXvqgNixwKQnu3vSMytpngtzJ+rvBpeiNnenAzp7iS7gJmvOIyS/9zh4GrupnyHwy8sse6xad3eDDON0HNC274y/luBN3S4oRk7RAPj+HnNxVSHh0n5VOmDuqBV2GmTiyVK/KaudU7Mz2pEHNl65Y8VV7ySx9l5/NWB563RPO28DILMzqWJzM+TJl4zF2Zj/lsj48gVvTTCrx7QLc3wfx2cQ4WEewV6Xws9TA89Ytvdl4gblV8WPAf5N4UOdP13wIT2P+O5HG6t+W1xWIiYXEZ4mh/ogLSgTJEVr0Zphm028vOKS30WogysMPg/kZXY/wX+l/okRwP1azLyD1xQeI+/og9iVauK9jPc/odKsc9KjB0fz+ZxtyA2ckSxo0QZ3gt+klfLh6SSYfkIAcENwOuvVfXTR7z4rG5mALSbNn+3kRU1pNA3KlO8Oc+6G02q7ty1NX98pm7DAP+Wn1K0sf8DNH9YO1aAPSme/8GpjdlGFl1pApdx/eqOfOZMtpsMqRK8hkl+f+QocqjLSlN+2l9XLEgczTOk4MrZp4pngeQuRlVx+svwwrT3huj66e+hM0+ah4EciXWHhQDcZQqPQuCOq3V/JFOYcPBC5fwvjrXWORra274oJpyGYBkOGP+7qRY0HHkzcrF6pp3U8xkulHGmNvgDnfmwlH2r4w0DhyuwLRUZ62bunNkexPg7+AFOBBHdWuKiKft2KOOGID0HSwizbDGzcwtjodB/G8/U0UIjW+Xo/CYzrSFhD+OcQ2hrv3lfAv+zX8Oc5TzpvnUNZEI6kgXpXCKFMzDUnusyAJpA/axBsCfYrWaNqzMtPNeOa6pTdbrky/8QsIo5A0MhOQPs8KAL5DT4aPZ+e6iJB2/lk3cCyupqHp+L+KFnGmwA4dO8FgqDyzivw24yfg2BjGG3QNiMJWnGcgwAXRMsxPCwbyjpCeBWwdgrD+8xcwBGf5E+C6QtL9AE8R8+cE5XAIZ9VZAI4blKG028a4Y65o5KY9JYMRhX10JSPzef1HfV90tknK8risevAKiwzCYOzxFgZzhJc79vhkRlj7VAsja8DjlU2N5/cBaat/XWNJA/3WXvoKcQaCYi6DQnIryvHBJyapg/X7s8ELmzjvPC9QlAaepzXJRUYnVCuJr+wcVYxO8wE3YRo9/TACGg2Kyue0FBuOhNEIPG/FnWjTx/gEEI225QeI//DFcl/fSNzdL8pn65gHHbFZ9DaYasEfq7cgWkhFx6PAEWjnjoSWbGFw4BQ64m4l+HC/MJ0qG2INMfbINjvRIrDY+Use05pes9QnO9WQmG40rgyCLtFRuh2RR9JEBYMYYUbixltRRKW+mQuWQr9INOWKwfmfsgnyW1EjaQ29RoKR4DeFZnLGn+nRTYOETrwO/hyhcdCb+ocU3Uw6gSpheKjqkleOt3g0k5vbLCD2qCKDQrW94OjPmv4wV9rMy2DGpoOeRD4kZ2XHKDCaGoJOy/UI7ZO3fp2mzf0UXyzYS9GjZkTSQRB5O+JRDOCvhFQ5Vl7ZtPFg7xoI+NPAZ5a2snSvxZZgxZaqMYegClrnxRq0TwOOi5/xfeC2HeJc4msglhhOZ+zUyAfEk8V/C050M9ELBLtV98PlXTKTb88eDr/PPrX5kuD1rkYjD05GDwZMWaC9hMtwdRlwWj5G/9+TU/VG9pxZ9qs2uiNv+xoKeAH4nqKtCL2VtbBiM1zR0WkghIVFcV0eUzaioWLhLbTQ8+X3nt2NbyV3Drw96WZu3ogWZmpqFsUqOfRJZ7JvopEaKqfnP4pvQdVJo7rBB2rpaTMKr6Pg5sJA/NHK0kZQU/pVTpfLMebKNDS15pdVEnT3zdxtBd4VcU6tKYGOYKVT8de9ehr8qRL/PL8IcagYbJBkmXNLWd8KEYOQmE5eLy8Cgrz3y/TiKcxnGltasT72ieHqVJ1HoSWpp230872OkcXNYsJjuTXRXKdXoGoK1iq3Qwpqx3H+U6YuE7GtfEUp4XR5hts4srVERavb1V+A1fvKm6AQbcJRbu+hdck5IIEN6JsLxkCzSLQiDm2JTmAe7BuAF4/TK3am5Kuhwd5RCl8C5ho8kkQvqdwFeajLwPkPTT0npPNdye+HE+Ls9z55B1EMoZNvBI9AKA16t40U4l6JSebRTRj+mhfK5IfZopMy3uArvXExRE/jRTq4xp7ieyOjheH4SHzNmF9ZrdmR0NsUraP/eNvjMPfaMYdC0I8nPoAzXnUVjd/P7jNxRFFRfepDbPQV0e9mi/1Yq+9jXI6MzmpvUvjQxmb8JceSbWKf/PzZ11nyGf/FDcE5XVfU2mEDYVIgA+tGJA3IsEyVWMz5pzEamgWft/8mCpZVR383EcjkNOvm9ghatKe2hYeaBsYEpn78+MZ/HqXk/BN/nq5lUM0FThhnLjVv65l2+HMk8opCsqI2fNX6WxDwM3CP313Zbe2eG2PWbbYghQ/X2qW9B2ug0v7qEKjL0foyTh2RUxztxXlzkfF8DvoJo+dJAD2Cz5M4gJ5Dqt7eTT1baj9ZZXbPVJ1zh51pfS+9tZPldvE4h17GrTJHXE4ujhu5fgO5keLXQtQ4p42bAdrIp+mN6Z2gj75dAtZdXPbuzvJz/1jnTy+AyCiXKrmPTcBMZZsj9TUQsDPUtLCVpf4ArNh1LUqnUYtaIBaywFBJWFQ5ucUhYBY0oCgvwFTloJ7SiO4RiojsXoi6/in3q1EASPuzhMDWH+Uss+FJiib9x/vS9tWzUcIN6mBiUfIodC7fM9bnE7NBphXBiSMBvNdFDh2tEcgwV6p+Jd+T3052HVVpCe2pSboG4ZHt8sMIzby0Serrp3u+cjEcV18RLVjuSjkH5PWNkThwjJrs8/X3uU6dsOPY3Guaa9yqS1+6pkmmVULClsYtrfMpuaz0e3sQZ6h632VQaMkSSJQygBdzeJcDEgWy3BhS/NQXl+D2lgHug0cr3ZzqEk1YEaEwpNfBABYppAzH7cYDEfqlkvtRFeGdzw/ORMmk3fPKe0mSbEFY/EXNNi+6f4KyTIKPjC4PHISCN3+QA15PV1SG0E87ANeZz0Z89pfmbjzt9dcg90vR9FQgE59tGBRZismXEuhK1j0M4fsZLYi9IBm2KM9pt14MLvAy4tRnvjqoC2x5Od+psinNyryM7KbuBtjr9cfZ7WVA/JdrQA7lxUehfDcVYF6mpO8lt2lkJU/JunvD24l3DbenpkMHvme1o2NaRDGmFCdHcVCYAPr2M7FvAzu0agEB3yCgu/8Ycd48wN3QJzZ37EcRNUS/G2PCipxb7TWbhg2v2EroWcLnBHKrXDbqU0eetNCP6EsOCSs4D5f+JwR9T2DA1YLSnH7Xs/JzHgynT4LzFuHZ8JmDQcy5R6LxsRU2Ee8+/0BwYTt2ErUbmQrBzLQv1SWHEh5ZGY7ClMxagQpzVlvXkyURYQE7OkN85AymU3bKmIHZx6lDELrjdVWEh7CrIDHaywZGJYIUs1gSmZTRbghk1GUhEe7OJcM/DllCilcFpKz5f65g6HAmpQ1jkXGxxZjEk/d4iWaByJJh4jVa5N+4sYSNXZhhyuYxtGYO5UwplBaOQNs30akEJ8MPewIueji0ueA9PQKV7BFJh3eEu4rxnSZmx5qwfwhWbVdU1eiEh9a7c0upIgqh/Q8OPcBa2JUB0CnCA1f5NfoNCIuethgk45tfmJPF283CfSQSY8aIikrEIWczHt7APLvrjup5iILslEFboEgFE8BWqIWG5n2J4ggPfPllUN48PIub79GHeeDUvPHZj+JjACThkACdVUVFCb7SyJxcE49MQcduZVmRuO5X7haNLhEcqFxxrIhEwW+c6GhFnc+txiMamGduP/D2oxCVOTmqB2I6hrOwF5zC3jhw0JcA6ag6Cqtljd/32++YsVCLGghDjSqSKptW2SmH/qDAgrVOQQYqg1Aa4UFx6xqivPmAp8H+ekElZ8/q8TZqCMPAyiMdzu+KRzE7avs6/fDkRuFeEgXf8TUFfJkjVI996ptnbrmnuReiDDslMAYwtDnBqUU8BJjbhFX2weL038LEJBxpNnNUa5MUQzbXtXQ/VLmz2WgnpyGl4sRyexGUmAaMySpvEyR6sTlRhhdvH9cuhqJIcGz68BMSg/rm4enpcM0OHIVhyTWlmEKdXPoKeKtEKdRZM8waFeYDfYwohMc0m/baqQQ9IEU+wEAjBYHBIgKswBAWCUyN8MCUnwLjLcTLUePFIczBzaHo7JP4BEDS4oxggrV4gyXudAxrLR6XYx4syqyp/EmT6RCmvC0YF5KYGeOT90ksLqxOTUwkhftxJHzHiyoxB3EtZu6kxNLy8nB/f1x26LBELCCUZqcMFIBRDcIqhAA/RIW+kPG4kW6vgozTUpqzo8AwF0LMLWBY5W0Hot+8NXIKl46udBZAwRo/wjZvJsR1revvNsZNnghuMWPw4T2wiJN4SvrIcxKDG80j09Nh/lYchcHJ/FJMyfKQzyJJybJI+/iPhbtvz0Ar+29vW0UyeAa1Y/KH6HdtzCJp7Lu6Jt+MgP1Gq3UINsBRAKxXSbMvxJlUq9i0LBEre0mQFZZ6Du1OMhZVL9bh8HNT1Wx0OofKzPTHXB5VXYjfAfK+NBKneb8/2P6TeWOueevDvJZNVdUnlO2qvMGUUL17bOHj+AS8/vxhfaupu8bwPt3vno5p1dWpI5gD7Utr9v2iyUwIfvntn1c29w0OYe4WjVFy+r6OcEiPSlb4w0GnWoyjMD+nvlaJOTA984JnpCdmSBxKKwdjQfy9OY5WZjW2KiBJ/xnUbn4PB9BbjGD2H9e1qpjS2B0Ge+Z8njRbSv88Lv077AvkSfM7L5Ls//TzIMP9u+GvislLzI4UE3m6MOpngwqEQnbh7q2FOqjjgYgR/Ezv6md435m/H8xDEg+4TY8waQnyqjJc19C8ryoWGYOObYpqEgm/UXVr19X+ezLD/g8/M82WnpMoZbJhD9RR/SntQt9TvMCPER/z6nYuGpsinu9pVX6DtArOGhMcJbE40dG/YsLxDob3fUBTqYdY/4iZ/a1DQgozkniGT78JxjV5OqRPzEYbtqMrsCssM8Y3pQwQ6k1JGyIYsJyGHozONdp8MP0OkBHyp5Kug3k/F+7aMpOMWIYaHbQtTdUW35OqUFozvo39LFmJGwpTxfe6kN6DGwAlyyzDLUnHOtJFVoHqrQzb+gIwhoe8vRvFy/VshD6EtumlX3PTKQQks7pkkrAjFBC/GQGzWP69zrQZpNfvFSrBNAjWfmxV+zGNsRWCbNW0AzPAWfuVeaPcDDbM4HzzZOxGm4ZjhV+xwrPYQ6qEnffAz9UCFclOVgvufV+gyYPBp4S1WrnVagYZEo3jdjcSySfYMhm/oTFSI21Rw6tBaYWRBydWqyyMiJaEsw5BobBXdNz5iBH08DjKIjoe0asjToJ3+a+kS0jzyzilJF5KSowM46ttK4jWxK6AEQmFJXDiMIySjlGWJKvr39UMtMfaDCvR8Rw9HjBIV9aPFOFWlLll1UGu6lhgTLmVYV5kSC+Zoo/NBT9wVYn2V/S6TGkA9hkjrKYOTGQr4iEHBbB6kGfG4T4UM1e9ZLwXNQTmJpyRcZY9h0aP7TLhaz+Mjd1lfU6btZEJ1rks8PA6tr8ksU2L3/sTl2u6/ZiAHTdWVYBtDTKNUy2qI4T96fqVeNedPWjTqbZPogxywIKeLVgwbD/8e688nv1r9QOD7Okl/kWc+X24Hm/x3yTsWWu38ZcD74ntv7a9nfnqtJiyqEIrrdT+Et9zrOrRNOxVWVW1j2XPKKe0gp04Wrn7NCYcFNsapm+p+h3m3KK+tR7lBygI0CjXe7o4Z1Cxse/Ar6k7JGw7E/BdgXE3lEyhoEHPmQQjoUEfFCIAiRjELbbhGulrNdhjjsu2qzbs4NIaKeMKmZICZaQEdnqVdeL2TFtbOoc+2JYKDQYxnxtvjjc8DkF6DHokI0vU8EqeDJUoGSkzPan+nNrEhvYh3lpAT/OyQtfIuO11OEx2LzRft8DCVVxtheGny9LJ+qrWUy2QEB/ZTbliLCim5KobStdS6Sn8lWDZDo5bdnRFg2TBKQrPazmhg/PHJl6RbXjSkkx6Le1tJlx1lsnIUJkEsPcXoRmlVwJhdnV54Tr32AuPUvVRMIaI0nOlkMoR1gF6Pgn5X+Lm/IXhV3r0eMjoeuvj4gYXM9R/oHw5V12r0dQT2451hynF06K6tAzhDQLBQD+Pq5Yap1lF94UPoqikui8+x8aj0h7iXDgzv6FHAAXQN7iAQS3Ul/3XyD/W1CwmJCY0rYVy+b+JZVdWRt2dweGhOc8XEEATf3F/8X3jt/icX5zq8ZX/t6x2tN7X6TduutuQhHtXvJ14uune05Kt+35udaBHfNg2PO4iV581Zxd8yThEwHFKWWqy+/WoOtspwOOM6qe1nT/lpJSe0Bk6OgyELinlHliADNyTEczNvrhwZMNdih4yuVjBRUbNBzXvRWd7LYlFrvLJ9fF5wqsOqz3FEbxk5fEbVnbPgl6319HSYcZctmWW4VWr1bJuGRw3RFxYEWieVpDi4u6TRtZe1cGpVQ6zAS9PYnjv5Ei0PQ7JGeYOWHcO3/cuehOmL3EF+hSTJBf5MmbvvS15vZc0CWf2hWnrcFYujihojMBebQdy/qPBJ9+p+jQoeNLCaxlFqI9IYaSFJ33Hm/TvzNu3Y+U43SqVamYWUk4EWtifBL/yA70eG3LButYir5Cy4j2HBaLowQaKu6DXQijLYe7ru9oX0bhpjM0V6zj2Bx3XrNS9j/7FMoZ80BV/W3cwW6ErunLdzp3XvF148cN82o6iwp9aS9B9+6AnLq27H4MbhK3l0g+Q112bW0PVz8/dVBXUeUy1jkp45NEjfYU3VvFzhxM9wWUdwmN2fb/JbHRxxVFl27uOvWRVyZcPtgvSZZVHK5MpKebPerbbHH1/4q3cPJ7d6JnNj4WQ4MuXfr/z+E58DJ6OXhbguNtzV9iZYovXBccmYkp5ANPaOVQONzC0hWC9hU6VmQ0T5FIKNyzAxHJHFy/yWcx45wLrVRMsWqk1mMmD63RkXIF3L5zRVy+VkAUj9UVb2FbfaWw3++yxGQwV2SkHoLKw8mGIs55Dp4wxUYHd/QX6868gSW9wdGadIa3OvZVt14d+9cN6W1wLn2wAGtqf7x8fJkPe06oitVoI5w31f6gnECvF+reRos+DtVLU9vXqVHgQVq1qNJoIlcyhhfU/7L+Nz6MCKFgM2H2RzmfQfZjWnNsMtM3uluBtzn2nH54fM/R+0LefdEUkPsvEqFvxljrYQmLRiJDPsiaCvKbRMsnO/nAkx0NNx1b3AsUUZj2rfRV0kc3j0ULuLra8ZW6ZG/A9iYy3QVQ7mj3IwJwx8YfmZyLROzcn6YpH83hZ9BsKSdd1qOCk0VP/NM7G910FM3FXc4sJs/U0gMl31RZJZx5lOTnqBoo4oIgJO6erLsqhWvI1Hc5xNITRPeI/7KYPIhVuegP8e/mhDXcVaS5ADcL6F5EYaneAO7WTzrf/ecdDIEFg/r8OZz91EBQ4HWE+RIX5r4FfQZFrMVV7T8d7syCeR5nAc+/ablCqgwJmJoBAM4k0sGfBppEI6lw0cozmY6tiQ7N6dKtP7LsVtflEm4ISSx+bsdIaGxzStNnxiQoqHXHYXgBbfBj3U/dZWFIm9WowB4ZyDbXFbCQG7Xvtr6/gO5n2lkZ2ZZGxQVDrNemxXxvzYveSfjH07druMi8WfHFpe0TjxX12cHjZdYuE+K+U20JsDLLrnF6n9XRLFNcWhQyZ/0dJSJZWg0lScWTHUv7K1NS93AoOlvLjx44HXQyFEGPlxhVmj4UsvYZ8u8IR0trxvmJNpxQuTG9vayZZMcz2Ule3C+avMEjJOiQVGK/p4JTRyj1kC/yaJYOYVYoAjME7ZLDmoX9CEs6v6vGRBOSV97p7TGfOdeGFsOW3NtOQOnsAWQcD5dfyKXO3J3MBok04H9q68Ls7QNmEhe57Ko7+ZBXdNsbfdzkgkmrOyiEcCAinlcVmyHYcH2pUTlKCN2FyQQM2ox5tgJNod9Kq7qHQmZuQaQDu3nP4vvFrfCk43Hbgt2HftE5Bq9093nFvxSzJit4isThfF4lGPdIDOBKjsyQSTOj2MbBJrrRoAl59BLArJrdKuo9EYEShVKkyRu7ibbhQEfFjhMs85hhrHkBfI6Puglssx+cd+f72TBDjP4fImPsxKL/0ojwL8b91D5hEtmohxEEL3v84qst6wR+Y6Tj84BOE5MrjecDMzi+hMJn3GYrqLE3DqUtjrHZUEQlIh8IvOwakEYrFjcAxmvMtRkyelH5r3qmf4QJtY4MtXeQGnxL7J5k/FpiOIUwdVuxW2ueNgOJwCJSFVh+gAnZ25RAOAygxyMJiuBgiMGjN8PZDaVUpkzKysJ+h9E2itCnujxB3AOgBKG0hHUIVf3ZTwRDAiaCxQk4yUD8fakMjwUPEoXRZUJRBYdUonQoBM7s9QeHrtLyPwdL+cKzGa5WpCIV/Qla+dEZoKEGDT+gRmRcEKtP8DdCidPLX2kAm04WcAunl1n5FKyNwnWGxZTowBI1gtn/Xs4tJCPsMcMpOxF0AxTtAAPBpHdMFkyCTYlhzKIx+ICy0hlwZbXCfQdqi/8IdFjE5x7BFDDPdhYTBjuIwAoEwDZ1AAPZ7I2yTkfMeCGmSdR5jCoxsiZTA1wCChT8Sm7PQ3gXs3M1GjpTsqa+T3FwPlK5koZb+/DviAExW7wk4bYhZ7EDwGOaJOEI4IMZwScaSOSCYuWwdauxHrmiLtS9yUQzW0BeBScBmrmupu9lb/hr6AzKCg0+yl1ZYPWgs/lM7O7CPuyMedFHoXlf01LDpybxJxjuUSOmSkDeUC+W4GN8TgSTHJqIWRG0TtSBqDBSeN6OW9EJE6j0F+9PX9tpIz5E0agEYFcq4GEtusU2Mghg3E6MAj000ghgFMeLg/FRiYopY9x4g3oejHcJoQD1PkNQZCvFn2AyEzSm0dwH7V1E1DbxfQN1zoY4kNkSOiQyhjthQJ6CuFnVrBNnwTECdgDocsBF+dZSnohIhBvI49P3XqN9xW5fnpVD0UTP4rzco0sTo+pYkR+Br5ksp9z3SDRmFQRdpnFrIKzN49TrkymnD0KgFPLMnkJpQxaZF3KqzpHhaIT0ILArlCCNHoDwVBQO9XCJhn0jJMIlKMuJmYchAsM+4SYedQN0IzlYfzyMDI1o86PpVQoGDM1zQKLVdv6W/an1RvImqllnY04TLCORZlEsDtXMt6rkfGajEMRxWO+zB1pgR9mGfMw6X0Hp/0nf4E3Cb3Wch4vYhaCShzih78JYnSM7OytSbt5Z55d6ERv59P59SqlblB8vbnoAbnLRovfrBwS+hRRyvPlO/bC/xK0CmFe1nM71+oQ82KaWtybT9bBoqzM+q8fazEqPUhH4yUdGbiH3GjxJPKK05URg+NTtffdiGbYBtSdiIbXIsjbh2LsXSnhFlP6IlsxCYs3hh217GDfZ+9Gn8BEsN18DFVGoQ5i1Tti1jcfa3rMA1cXF8U9bfNqmto5sqdcGEfYCrh0zSt5LQj76y1q+wXR7iTpUuGwFkaxzHCpQC1e6UscvG7U9psdZoUEfTjbwDeJ2F67jFwnPYavlcWtBRv5IPtMozH7H1SXp1rtMvhvVPpJseCFkGXeioHMhMP1vrk03aBg1NO+XCZQjJeZJdVnr1CEAFsoQkJXFCHVZuky2SNpRw1JWqMcStP9PmIlCI4jyWQam6B2gXxdm8eU4d39DVj/D1h8SbTAmWr3s5Xh/5g0Bd0n/6cmkWTukzBnCB+kxzGPnT6p2lO4oMqWxkb4kyredm8fZZ59NipWtyeZcKJlZeDA+Xq7Sn2lti99BYnO1xx2D2+rZTXaTwPJOSruwRQ48fIjM6bzIGVQr8alxto3P6O8JI12xMBq+uW87GfqB/9stpPW7eticLGClv6wljvL9m/xO3CveWBAaB18JIq/1Jel3G1Ce+CvU19GJdV2dPI+0nx8k0+8cydNEWbwoxXtfo/VEf7bDW6oqfxK2Zy4NkN1rlJkvdAMoukogCTtfTWxx0VY5ClaZ+gNcNWrsnWIhGbk3rNRa2Oj4zfCbsCf7LVNNSdznSmz7qiVnOxbksrsQFJGmXknNwDnBQ2+6owjGPK5t2nhE6d0mzUihxayRjSz1TlzHha9ZaY+7J3EMcBsxKyRYzvUDYrKRZKZS4Ndg0yY9Qy8GjCUYJf+ZZHd1oc1C5GQm5lQUlrOAVRuTwoCwBhEovH6jsSKWiFL6ThqTSXQGpLBIpBFd9iHHUV2SyvCBI1uTKqirVBM1yc4Gs+eNjmGxzqMw8D2chFyplZMRBJqh53tRVWnUyZWiw2+l3kWhFZpvSOFMGBYk7ICLvGYWTn20IyKXzV+ZNP2XjAFnbYwK1+XDUhnG176eYC1fGB6dg8U6uTGSoLVjjzmkyiURik81OadMTjIWdUKvuNFQxqHxvZmx0+yKjlZbf/MqcQpYuYZyQr4eG3C1kK0+hAyRoCcq+A4Kq6p+PStNxAPy1y6DKE+aaMWQ+YAkHBRRSGqcui4cmL+e9959SlLIT+/HXWtO1ZJ7pp3wjv6hAJCqoqK0MZGQjMw8IdxBsA+oAYjPyZmhzsagl8wjtxsI4ENDtg6SvKhWXlm5+8bcZiDBGxwBkVmkOgMVmShQBzlwBFDqQ1lkAkD/7gs5J+tZlRD3hPZ6a72i8Iu/0GSPeTjuhHKRc02HccG00s7PaY0pA54r6PTtF1QWCepdfSkbXN/t3PeCWE8OOYlImEaSVAwZe0G31p/USnjZSz6kJoNmuW/dDFdv0LS7ihJQK46p7y6DYE+7nDd4aiOPvHkdS8fLNo7qFELDzQYR75UBM633NrBbdwA/LGn1O4nCjYXR6xs/fgrdicFp1CU6QdOmrUFoVSq6waRqIpbt/lWDU6NHBpsgZ/txsjv+E+j0IdXjMzSMrEEgIIGOMXSTycEbs/BnQ3kI8Gj9T9myt7MZgaPxtNr5CB59AAnV4tewMDGqqHFVs3TlTWPJrnT7/BjBt7iYQMz89sUzicL4+nEr5ZQfwVoxJF9dVI2i+EuNvTT4k8bjSkhgaiojz8d/wtor4OLnsJLiys4BaqaARc2ovQBUf3ml3+UjzGUMO7YEL0s1uCZmopbR887xxCsJ+7WFog7cXcEx+MHICF2TUOA9DwVo8ynavGOI60/t3bhGb+fyNVZvcZ2JAav/SEtXoezgOt+vHZvAwZAijGoTZT9C+oza3mnzW049evh8GPIkXoyu5p+D4iduYpo7ArV/hUqEOxDY3LbtSY26SyaEzN0NWUVQVT9Rjz8b7+080TnTkbdAIPRX843wK0veFp96F5DHyFyOnv97g8qSup8P2frZ8nW9kPKlWhnD93QkJgVPQnXc7j/pyeICiAErrFbTqldLx9xrdxX49LpPpoTSQSyd4YAIqpnvI0kV9VgveMd9yzQwLV+n0DnLrFtWOKfXug1P66+UyMn+4tmgLSzYHpSGtOF7xJERbN6FWaUrNOzKz7fqQH358wRb3vIcbAYS2HLYPj5FRnygsmzPK4fwRwRUjAVnB/N9Gqj4PfIXI7dtV8dAALF6tM9rIuQeyNSPKLVVQwJZvs3NinRFG8AcraPzmSCUaRgXgAxfUWYdFCzjWCiDHiucALPc2Ax4BWPmCqENDOVH34s0p2Iz0Aa0ULPn89O6CbFyrNb8AiisoevFhoIbcb8+Pvf7A12WIeMMs0PtvtuMY5NTuS3o+MYttwg/Mz0XS+YW5495k4pF/7J/JZpM1C+HowZNvyB58O7R1KRZoa/R9MN5+yye1irsAbLoHMHzhaHaEPaqYJNZyGMuCLq7vM62Yh07r1eyj4QxvF2vYQy/FXnjosVitGxsA9xHJOG64CnhgEXFQNxXu6vm6bwNWHyueApECca+2c4B6CrJNR1gArcKCOGijQaG16Kq/q33ebIj3YSbQ3Lt2KPKY8p+v059wfxHqDXI/yN6AOFg5oGI6jwM3D++64sWgrDio8dHxt+O36MisHt0cGv1pZe3RGxR2P5ux1BJI9mvarPh4ORWPLHMWwg6fxf/CfTYWlSu8asyBwToJn5+VZqvkt+PxuUlBverhLGtRiuo0I57U1gz5vTEypZ0PBdhJXLXoTGuI1BSFW6QcqyFs2kZD2zWzHM9ZKbNEuFo5OZ19mGz4+yJ+vZh1rhfOKwrLML8pcgUi3hIASTvXpNMHXQRxp0CQwpdfuzGPeTMyRp7stKhvGhkfD/F38AiHWfmVmGzTnldy9Hjp0OeoLP1Ym7v39p0T09++c5LzU7BJqWgRe47Yl4HXyzoA7koAnnAwDXO9RXvIIxB3ZoDii4CHs4d3WbTymjjGzATku+yogBavEcD3HFUOf29XXvp89WZ3KwY6cjiuw/cOLsCtUp8Lc7NFu8mjPcsCsFuOw7IasrXpRC6gkWPbsIxXg94bpL/c4NMj5eaACWa6jsCljtj36HdrkZkz+lGtD/RwiV4bh52rY/n3BQXLFI2HIHpxrZDrxO/aGOjgFJ0mjtj/zD3k85286MR5AGwzaJR1AJqKDIANcdAgSjRaRkgU68TdAMbTzFqOZ59yt7HkKWX9pYqUURBdyyLV8uo5RZCeVGcdznT2mnQfS/jaN6omoR2rli6oC+qi2XB0HQopDFREmEREk4hOiGJC0GQf5XMAnFWiOGXE4QCD8znh9sUAMK1QiLH7wHE+JwdGuHHz5TjH1SslXyE+HZQ8UBWgrGoFKcNhwhiUDwllG5AM0CXFcKJMhJWvdApPEcUXTgsOBjjY5G4BQRBJmaQ3gQvjZC+3BZgrke2qWWxV44fU2G4wzLaMBYYQJhhB+cGJQig9gzukOqIrbUIIK0tjrGAyVpCQAnFeCIPWITyOEzBajWBQDLw19FiA/EUgm5bMpGTd5yfy/WgSEp3bhQ95PPee2npzvAnx43Z+aVrD/LB9/FpzfK7ushby56rzHWa62PiaWdCsFwWUnvGrIL78hrdHYru20SGxB9xvkxxnXRfy1mqEDgt+2L6I4vmLIu6YL4+XqIK/UqhFf1wChyRO0TQvGfDvOFC02tmq7cO6lLP/Gf9da6fxBoqP2xcWTkjP42jRXaB30S6c9TXEIxdK9QtDEX9KBnr5w9BOeOk0k1t+ntMDnShGdHWLilraJbc5L+jil78i8BjyBQ3Oyn7MQYoUX5uHEBgUaQKdZ6O9IT/RdwaE9QFqGFGhPpihQe+l2SDmBu7mUfZfT/uSG0P5Xrt6UYU4XoqT253X8LX3Xs65i7KvuAS/7Dey/15CeJrzn6i9r3B0EmQXhvYCC2wgCx3YAiKlQLMkv73tbcS1VvrOsy789vj+O14srk7qX+90fQ92WNxsDLJq7IFkUG104VM3qCa+qJcPu3wS+wP3WRjYMfjpaHzx5W5DMxuFoFydVCKzJ4SYR1p9f2zmWqt0bu+7M5Df3uZ3McC30sB+s9Eu90LAvVDRVA8jPzsX/KqJBln0egkP+OK4KDOZtgp/TPmik+HgOFoxvlueuzkIbdbP4mkUKRZiwhc9tEmo/yFn0uVcRH0eGoB/Z4CErAOzruAuBKt24FdK0lehL8WKSu70CL2Df33iI8DPOWH3m2mdPiS7/9mvaesUSpkKUNYRGK7CoIqUn+F6u29hRvbz1OKVj5iARENtOdv2cA9KXDqyLjWAfT/TwglCTggX5ToS/h5XbIjsXkKDk6/PZGL+ODpPpe8vml230z1nrbV/hP3Y5bYALb4aLhLgC/XMuY3JvgFYvEon13RoZCKyZVKmYD5DCK3NpvbTOy5gycUz2tzDJOEEtT+QiC0Jr7MQI23rWyANo5HoMwRQ82/tPw0K5QO2tDAACayN934Cn917EsrZGTIiDYp+d1p4fN1bFBifHSqj3NfugRvziLe0ZPRtknY8w4lfR8IRG3+zNUc6z24x8GWYh6rEIOWMLaczWzQdmEPpcgDloK3aX6nx8Jo//O9jBGHkJ5Yd4j8LIdbUNvnt6WHMy3LPnCZryJKvgOTnYcIcRif77qjxA1gK/drKtOesrqxVlxNqR9lMZEMLqUgAN7bZe0dKcdRIzXgAPGviiQsnYIjqDhFDO0Vyu/6CDMtS1Qmbe8mjL6PXswQoS+yj0xInB3CsMbM6oY/CvI29A27CNSOsIeMQLFp97YaTUK6ags7WRxxXH9UUfqovgDkoDD0XrdCZ2gqahBnlFb8L1PB50IWT2zGDD+xNrZiI70pmib3d2AztZV3dBsKjFmibTFI4Y6hw7bo6l8NMcWmv1Q1Tlp44biPsVE5vWwSSHPha2tjw37lGMaFhe3n937/D/ttmfD25R+NvAI4BauhbQ7Cpharmp2DuvHe2D3TQiA1+GkOYE+vCgOtgRl+V5Uj4kykC5s5Hzq98WTk1GttIuDUbwGFqYBwesKq9kW7AByM/tmCdq5MUmoJbKALpdKI25M7M/oedr4jqaUeb5ar78FoSL1VwzLVt9C3OgGZC78CjKyhCqHFC5lE6KF0HzPrZN1beNMlNj0RNZYtGJA1rllh4N+Kpp+jDBFFueCyMFqLRVyF6rk3VtzgBvQnyCEqpLLO+ho6qrwPLSNKMB2J9HhrbCFurh5wE3b4gve176vzOEMssREcpyGMhOBB++eNf+KuK8TOXegZn9kDIr8IF132k5TfEZ0uzzJ3ZsRmgo1cakC2unxUzhy5sLNDyhFfc80F3etqP8hRmk6QmXSmlHiPf90X1OmUdarF2RXf1kymd/5iz2X97PViwZBu7udhSG9rC7lZbd4MNF4ytuzgw+kP98e8//tvQydDdMNmw0BBoWGmwGzYZdhqSDemGIoPDcNpw1XDD8BmPtbSgPuRJY2kKBdFWiqVttJv2UQ4V0jGqp2f0ib7jT+VKsWbV2mldtV7aQM1bG635adO0AC1Qs2kbtb+0aC1e266la8VahXZAO6qd1M5pDdptHIjwEP1weVX3uYPeuzuX9LRB7yCVTnNnvAW1wzxhx1Top/PYLSmSM2/HA2cVq782fmTt4drjt6ttPj1KX2oPJ2Mc58Wn7lB5/FFbJWz7QeT33WdhUIfg3dH45Bt+o4KNQlgRVy8UeiIiPKapcpoNaPz6FUphfQ4PmrKzSPVG/BSQXNYSale7t3vdb64RD7Fiqq61AS4uMQdPJZ+Zx4JTtR+EiK+5tEv38htWZchT86ZmyOQShYy+IxTcrgZyBijTB3RgNYdKfxgQHZH9sA3qnMAf0WIWVwOWyU/eZohk3eNn21pNF0UqFIYC13zi5advrIBs12ip3nTqwdFNhzMim4R67bV5ga+lMlwTp0RqS7k9Jzf8mUrjl1xOhQ2/Nztdo/dr+vCl41zhwnTe7X3zYnMEn2Sw4Dc4xt5c0ny6Cfb76BJ83s+Aaf+FywURVbMD34CEHD8ece2BkiC4iFIRMuP/QAoGF3mGkIcCmQNvBM34iTMQz37TyeOLY9eMgfGAB0qrRrexfqB31SGXZGm1j39aQKjem/29uZoQqYXGBjrfPnr7k/hENNjmJyRx9ZCDrm1QumiI8p4xZFvO9XXirfki/jaiukrsugfSu20oz5h9egtzJ8rn5VtpSIg4+Ks1spdX2udTcYtUJCIV67SxcpQf5mGudcX1CA/xIBCOHl4G0EPkCBe/xAshMaWHuxLSA3KXEX53jZvY6oNHzo1ZMecOBFhhu83lHKs59UQQq6v56MvTGwb2wz/f989ke39D2hR1+PjgsoFBH/bH4PHSHXUlJqsCB9Qzqx9VIAW5/7W6/+N54P6McG4ptZgAbVBnvl0QLWSeUCBi8sZXW8qgRNVgQQZ7NrRe3r0iBo9tZP4guHR1gglaM9IyDRH1KKTCIC8Tn7JXXllyz9yXyTz/FQfm9nh0BDm4SompVyRC1gbxjgjciYXAGM4E19O79erjBd72JieWXLlKXDo5cC6WYlW6jQ/UCkID3JmUyQkVOkClxm3vRyWOmJxanUSi06lUOkc06nT4iBqz5lk+g9Xje8ZbbfUoaliMpaKdxFU8/pdf7yHuXRnkDH5+8v+3Se0J4RdbOM20F29YIMCa6j55hnGaUTMpjUZL9iZaONgR0LAaZpnjVDsH15d2durI9gJ1byOcmi9aZ69T/w5TuOxGrwvuWnbypIMo7ao+sWW+lHkvOkFgBqME10x1dTyWxpnIm9Y6LzUU268R2+h3FlTRoBhsoWTDFUFqwOYFk//mqkDkKLGROSu3b+u4A9P5O/tnTLx+uWhqZCRS9oseljQ+UXNDUfE41Y6u8CcSblUploZ5sUp7Toz74sgd6iresJUAaHJr8UdKAwVkPKkEO4UEvIbGENT04ox6XZJGGujsZpeZveWKZEyGRdQroL8sAHn9DK08HODj8e3Nr+pyK8PMyuZk+1D1rxbYp/X5SxNH8elrpN7NoRRyK9EGlFU38Y05Faf4qD41+81LtYEMZNCmhfw9LNugBgyrD7/wNdZE5l6rTECbzdkPD/TMuD2jUSuCo53eOv7s9vhQaRdRiPmP95xP+4+oRtlmvAAgBRoFeE6v+JEAyLGlQJ5fWWHaDA4xxy4nqdjYA+rZWyi2puwTQNrx/OF7o01BpY2o0V1HK2Anj4wlW7KQuv3m9plA8qNxlFzZ5epjT4zuLyysqivUdHEWI06ujnksHpme0PMr4i7CKV6o+XLYDT2BlAYSZ+gMD2sHnS1yOUgK7XNm7PlSSqZL+OOv18OBOSI21HzkF9s3/M1otovgr7UX5rQp8ZZJl07DVvqt1T3nvZBGsB7+caQ2Aqs29DU9vDriPl3zb0Y7bIdClKll0Wmwslx42UzQ6mtIPibJ5bmZx2awWD4u8keDL3uJtDJw/cfw7fnfrCdazFhUUkpcOtV6we5gn0gc55Z2WtoIVCil2ILLBh27Hh2Swwsx7WYLJMeBYzMAAYA7EQ9b1K9gePW5a+fL9gdy00EBIcoJZCsgcym8WkPNlUyNJoACQu4IpZVzIlDzM5yxvicFYhMI578gOhrgb3fdmoFC+29cV0uZDkFQChqlbn/0/Hxpl3edhpDxJ3wvKmrV56eAr1qL0Hxbpw9c5TBDcE509c/PpU5jUeFY3e8YKDgwx+nrczoDAae2Ua3VKgnVQXpkb7FV2POiVCGmOeMwQITRBGoHKMdtOVknGpQpAeVogfwMgMzHocxmh7VbhtBmvQpTteHV8f9CkmPKBH0WtEIr5waGnQhUvIwgLc4040qtnF9enlOIdMJQDTmGgHYgqgWkTjJHceIUOJLOh3CxS84khocCJk+hZOYM6sRoOK1a6FSt4piflrfSvNuLHxl/xPei4lZ9f/T/mrUQzbd1/mBOca97KANyj22yTwk0AsCRA4WDCHv0ggYRV7hKTUcSopev1WbsZl9MVdRD7GFV8x613+NeLlsd4S/g6NaLzR+h+FKuNrfo1YuyM2WXyx3tNSlU+67wj10l3jpSg7wLqcYxjRddWqBAvS9VI9ZxXqWlFjl8vnhHatDRho3ZDGAHmGq1L0U9+b5vWsgoVJjqsE5IDsHwtuo5hwBuAnC0fix0xhNyr/c6za3j4OzjgFYABfyclJubghNxtJajGUf2FTsmsGcVNjpH6pIf2oiSgGCshd9hL3Tdmlpy7kIpJtIKu3BrRW4t+5AaDyVe21PP3XNKkK5E2cS6nr9oUejf7r4j/XwZPRfIw2NHY2vm0uqc9UhxUUNG28Mg0CDjT+Y3bojoSP1fQ5ITKbCWU0stQAAHGaSAYv4M98TPiNPh+HLccfyQYBEQqP5TqqbWvziDx37Ql8uEgohDO7SoHezWldn94nrtF0Zr8h88JE9rHN96OGV/+Dxchc65tFU33Pmd2aNTexQD+0FJcgk9OSd/msc4/XP0zDoLzrKMwDl5U0JmMC68OCpaFjYOQ3h8J4w13mQ33XbXU8+98Mprb7z1znsf+tI/NdRYqCYS0cQlbvFS4JmYhbGwm2uiKaalscH3E+l73s5l0GtDjWyMeJzW5q/ABtLcnxLmHYANQem1McjUZJ14g2m5Ho91cDjBhazAxYBhMOLQCEv8D3cRz0xllFqYRjtRJS2r+IwFAMmQBpnQGrIhD9qyY2eu3zG7xm6csFtgd7rrHlYP4GHFxxg1uK0RQloTvbkR3DyghQUk7Y94DBwHC3rJuBpes5hboFHMiVRp/pa0Af3R8/xevZEeuehZTzKvU3kGCkxC1Xv56AqojBXJ9ShQWDOqGvJaeDYh4iRxof5BQe5L3Vqril6QVfnxAcH+VB03fQQaHjZ92XNGXlzZ8+pYsHCMmHsvQBy+IEjgMaw3Ml7XIKeXlDowluSurBrdhNtwN0L0Yu8mAGhVsA+IsU40rs0TQXnoB6qk/GnZ/x+eGcgud8EEA5euOK+X1L0DlYqegStgX+K4yJl2IQkbs4w2hiTIr8dxkp+ye+5f69RPFVA1J6yzS2Eg9ga7AZFAkVoOxKgTZK+xHHF1JGIVrGej7Qq4cbQgHJ5uYznOJQfZWhasZxPa8VhZSRESMiZABXOOAx6kUBaiaYfWCwc8dSMIYechXJAFcaOoSnBwSGBCECZMAEcOBpuvpr2C7vRVU6MiZ43MdiMkD+oZgnQZPa9am3rEBqpJdKLBimAi+DE/IWXqqzgiMdT7HIZL8zi9SqUyN356Y45NshGSPbHh8CPrBtkiLhCIbgPQTrHCRCWInPrzXwjcGCZRDIjE7Z7xAMZ+F5B4mGWKyctl/HP8e1DJ/BI6mAn39iEpd34l4g1bI0Oe4cZCNKFSNholnvi2IAta9iZ5NROQHMbQfcBLwpjHSn+gNlV/lgMPzhlYj3ys4BdnCE+wZoHtj09F0953yhJdN4pot9Zzilcg/fY+3YcAMut0MU0PP3Ia7EC+EXAusHum+3i/qUFilaUSszVKMOm9H8X87uvkbx0roNbgBGi/h0QUpljQURPgWZdiGNJb+yl3CloORMPr5Z+KO8iwqejfFlGIl9LhvbgbhOqwG154zKSzIhalkXt70HWNHGJ/S3EpTBFY0VlgORGS7k2D+NaUS2ZUfwt8y0E9LfPWM3ppIk3zjoQbbU7Zn2lg0+sj6BAphcyxgCnQSIAOXpprshziAWHhHUOcsaavoet6j4NZZf2ZyPVt/ISemq2/KJAzgSNJ2xYn6z5nboCnBeh+yyhcCl5nsBZhlapmSlZDclJK4+IEgJ7ZerOtVBdFHqcCCJJpr1bUjjXaOXfoNH9kUaltXTmJUu48fXel5OYs6xxyADyW/BZwMp8khE+eMZrVcac83a1Hn41I2RleIC/qAKuuLOBINN5EwM0MqdWiLT5zcY37+MS0BvWI5k4scawlOlUle1nIMM542kbDDSVIvuyl1YxpDs4zejlp6J0TxLE7JZj1Jec3CGuIC5HaePIvrqXL0DzKSkQADVIOT3BVelNzUuP7ufO2oweRZ4RVzhW0zHlOuZ+SGnEZrvLUID2Z4JHbKyCQ1NGU3eJZG6JVQtxY6qCEXF4PE5zjjVFbYiR7mlANiW6Iwg1J7fK1mRD9fGdBDxEqJoRrGIQQLRh6YFnfvB+k2E4V7JrMib/hPBXNPxSJq2m4aDtGfKC23plIDz6NWwp+KaYyUzWjer0q8VM2YNlwE5CQJnytuVxATkj271UcHvwwZZ7QT/IythDJ4JmDyHWmqlBplJoEIMONfkvb5ue6WXtFD89WGjJgEv8rLCOnmsHQQVurLMLe413uAyFWAlWJehwhlBCuQmOEGcZGtc0MYWzV5CeXo4b4H0KOc02G3VOAQA5excCVBLdQe4rEu/L3ZJl2VjFZpkHAQrX9l3UbHKOrjYQ55giHmU3D4F0rmGkPTy3R2iUqpTQEnYU+Y63khA2fAojnpQ3meBiK5BqLFm7Mwg/rJ1hZA2jtYzlHOklGLfK4PHh2qUBb97FTPE5S6d6QSiG/FyEuJshecsxWqhxHi92ZAXrie7vVRK9a+e0usIfUaWxacaw7s8xvUVfLwzmGkuml6Kxl6Kg4q2N/V5W4ZE6mrx0BoJTTVM/R+6YUXUa+XAcmzRIT+3P+qrPGXxiWQth4X1F81CJRBzj1CirC2sfFCrXwojhizD3fjUmWEc6qjx57wkxke0csuI1RkyaYgAJ4CU+hbiLgVkyjBRFBTkp394Yki6ipiKscD89RcwlmzAi/7TDpGXss5z2AuEp4DtaWPLpcIT7mloubWftjVFMaxZhbfnRQ+NtT8ksQy0chbLzGg6Lg2hgRBGSuURpqhpLk10rrAnoIssJYBcxO+YhkzE9yEWXJv71/jYc5cbf3p/CBZhJj8PuE5HEK1MhBpzP+I9I4LnFGirFX74pSFVFAogHEsjOK1MVcJddBZU2+ioETOjrVvGHGe8NNLjnCVC+M9Mq76613zweEqfjYp0I98XOwl/7CeR4hOl/RzcF3rKOvFI6a8I6+0RVUMwdn38Xr0f96GVpotinyW9wqFvO17Yr7TixZAPespRIthoMTQHqFSC7j4X0cWqvFAlFk4RPPT0pOAYmStBYXoQJKiTGiqIgrASjOUvuycUlp1UwZWTl5NQtdlu3Ud7HsoWgJoGrp5BQvlbfrgeIKKl3jbwsv95MVAPAx961Kgaqt1rZ4lfziNYJFa3Wp2jp5T7xeOxt1KN6kuDrAyBI4KmZ5lpQAkmKga4iOeGTcsKVzRnuQ9GtlUpGNWEgY1K0Dka+OAFECdrCBZSxgXgqEwh1+9FwDnnHpGW9+xkUHGAgi0NKJoKJmpaBkF44ijOgijU9jIScGLh359qxB3HJDvbQK+HUGENnVtqV0z11NzKrme+7htKx09IwMYHQMYrEoVemFhd1gBoaxApTKhU74IEzENECXZTr11fAOLgCDmKqBt1iK4Vbdx0F3zKqnWADG91RJhre97TQRB0VaiqpZKZ9YT2CgLoYJi0nQ2WAmuCmuuawpKkVEFFDGdKzZkwZWPFyQRtu5U8s3DzE8NoADu2rDbSAdgKUCpEym5WIDPliV+QBI6PCj58rwjDPPOPuMZ6lAQUgmS9GyKAyUYTWfTGErCsRVjkesOGmWSTUS8u1YW77od39She23rUsLrwSKvYPabpIqP2NSBBL/0XGS+rvX12CLV9KJC33LavSs6YKNJr9dB4o3RzrUH2IhMB5Xp9B+fYdD9/sPQf/vNZ8Fdk7CTDg55zLPvfk/du+9pX1j763+/6IT4D3UDb3/23o/vaCIDMQnfVNl4uHNYJlkIZDAjceg2pB38i5e5x28PVcrgSIkqXJsrNy+PRDTd7po1HUt0SF2nEOP2vZhjyrqSS0hMM2Kteqbs8nIhgsfnTARHUlrorWj9F08mAp26LYndlhN4e6P23MkihiklJWUlpGVk1dQVKI/KfHYCy8vQGo7BBGJejn4I9fDJiCfpu+4eXY445lflJyyaI6mAZooqdZJ/rwB613FuzI8NqEmyTVO6FhilRM6E0yrCc3zqevb+zyyj9xrpYLxI49yxBLLHe82wVppQoVcluJlG9nP56+yx477Yf5yuON8+bEVdxwnMLbyjkUmterENxarNUbukzRqzItvn8gIqaGidhbqGppatkE0OoPJRnRQjKurxyP0DQxdloU86dHh3mZT8PdihdMGWmTLqFYH1YpXrFjfao8Q1MTrszLZHC5PKKq16WVbZTMcGK//M4EnA0sxiKtQqUp1qqesN0f46kikHClVRxrsyMRyZNZ2ZOE4suKObPzrILuRnTnsdjeiLW317XbYydZ77IVg5HKvB5ZRkhVd1VAMJ0iKZliOFwzTsh3X80GdUqowS5uD8xN6QUYm2gesyvWScNOhWizXbQPS88Ale35NAxIlSZYiVZrwAOEbUsiEKdMUEaqomHgmvLQvvAZvfQrKTLx0711/ZMXrxutbx0Ekv0Qp0k1SRCWkLUL/0a9HwpyWODACJZhR4m772pvAqSihBgP2LhXMomxLVmiAINNhk6xgwSCYgY2Tr16NSeO6as5FGaQoixbl9IryRLRY0LVWWlhyjKbx/DY81JU7Wl1f32H3ACbpYOd29nXes/Ng099j6WxJuY0pFJQb5qZhUns2Khgzf7jcLZO+NRoA1jG1cypxZLoQIr3pQ9Nl5ez2Vx8aN7lEhe43ewwpKALMp6qAHdKmsXqHkYfxy4ZkVCHb7fbAUquzSsRleOdfj3hZarDdr2Sm66ZbpieQgxKY4AKDeuiUBktjpGojLbTMKmtstKUQAwzTcI3lmdx/QIx0WTWaHe5aarl1OcTPJopPgjxN7VcS03XTTdNj0KAAsDdft81wqcog68xqrIJlooEjx0JCnSbdjkLgjeU9QdPjbs2YHIZlf7ZsKvvXmrCX5pV5Yp5aD558JXu11FpI5btE+zWSSzYOIPUQZtmXWGVaZ1stxGbFk0Lm2eOW12MA9zdgSqhVCizUyJ/h/rq2XxysTKJr4kSLh46rRiifEZmFZJXjSRyvFn3HY5ESYDun7CkyBUp8aq3rt3Bmdn8IFgGSML8zTfLGP4M8ZpWkvvpTDpFk0pKh039lWitZWyFxv6qmrclgOqCHnXb702xLzbXQWovL3HbH7XfYUZc99VwR66QICkv4TXUdLZjloJ522eMvcywzzyLrLCljtU444IhjrnjmhmIUGyTKFpWVU1aRV1BVU9dAObZBbATj0ui6egQf5zlkmF52OGKEAQYZbYzxJhhrnIkmmWyKqaaZaZbpZlhplfkWWG6Fhx5Zb4PNtthok6222WmX7XbYa5/d9jjtjIMOOe+Ck04565yLLrnqmutuuuWue267027rbbQJIqLxr/+mZImlVlguRB928abDkall/rN16u16f9NfVKq9CDh1zu8AOH/tsleWMW3rOR5ov0j9CWgHLrcBtKsJykrSfsxJ9vgSoKLDlUa2XhS/yGBnHR0MzrwiSz+aCjQ9k3LtYD0bLuDVM5vVW5GzgizC4FB/7Zil4BlyD8Kh+SJ32b19C5I7JbWv4F4W48m0/ZpfPfbRItOmkK9KXL10klj9DmE4w/4Komp6ZKumtUEt8m5gD0mGlF0pZb9nqMF52pFjaZRBhYVU7ev7GglvJJQlmgmn1N6bECLhl4S8XGcSH7JXx2h2hMuFiBvhD4twCW2rF0bgU8m7e8uXbhss8ILLruzBpSTEnMSBxJ3YdDRz6YIlrua9BUZjyILEaokUkQmJ4/JAq1fxS41IwINWRnXIj8iiIySSpFLxIJEnkc1yRSJvKruib0EdIZE8kWKHOOQeXv7esoL3vvg9yS8LEhJJJyrxbI9KOy5LSXGdzy/96bIvQ/6m7IyzT/tsfxfX66L6ULSG3HDxftQiJq7pvbV7ivggsoB9QZorpMuld0X4mqu0tivpfJYVFT9sXgtneYuqF/ZvhZovucmXuKJgqCTUMterdWvaNa8xzXjad9ecdeObdSj0U69MjFJuAivuzZwZ8xfe4sr1Sy45PXNtSldzcplSbF/i+73g3hddYzZJZ62sBdtUzN1qpVpWRg9KqivZmgJSQQKkhmwtUxaTqDFdMAfADHrQgBaMfvvyg263Srkr69De2YZSKkmskZCmq9/Eb+jsVdYILsmzrWfoeKEOacFndfu8CsJ9STMEguGLswMTpIIAX5itL6+rnt9TmRzSeN0zNSnpFixlLtwTedhfXzV2P/cLUvqilJrBfFwczr/Jedehp7SkXJff03KtwEvKM4Q0a9ec/slRYz17r1QOA8toL0K+oLI2fsFQVFqQQ4+jsqUYuNmJUu3IW2aUDjpOmG6Q5jCoIHAkMFhHQ0x2YACW7YQkVUzl1mXbaRTw5XYmEjRuZ6ZOr3W2mLazcqjh29kIn6+zHbdzkrBgZdd2uphUl0IMqm3DJri6RjjCYhMkETc9tCAavdydKI5RMAgPZZW7MBMdxFeyCeygZYCrZFfXBi47PorkD43oXFaV0Ev26mQ96RzKIAFCs0vSSVKJm3MNVsqIHsqQre7In7DRGDHXm9gwdle0aorlDKDIPmw4vYSLgTkPWacyx0aToCVwRHlnLGrExiU6IbXZE+7cebOZrDqKDtYt5rKAruvPE+quPJyrHgPmbLoOibM3+QePPKpuJX2w5EQjvdIDRlps7c5CNWKGN8G454oE1P3KAD7asbGTFTyQp6PzPfZ4c9gTSi4IBrgAck+2whiWKKTal/M8M/YKm83pLH7ZMbBwtK67Yq65D9cohgmTB+wJTD3fMsYGWJFPYYA908DBCFEddzHz0mviubsFXDYv1Vu0LO9EzkyjvGfzGFx9c9NMAAAA) format('woff2');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Operator Mono Book';
  src: url(data:font/woff2;base64,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) format('woff2');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Operator Mono Book';
  src: url(data:font/woff2;base64,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) format('woff2');
  font-weight: normal;
  font-style: italic;
  font-display: swap;
}

`;
/* Universal control feedback. Every <button> in the app gets a pressed state,
   an unambiguous disabled treatment, and a busy lock — so a tap is always
   acknowledged and a disabled control reads as unavailable at a glance.
   (Singapore post-mortem: players and the GM pressed repeatedly because
   nothing visibly responded.) */
const CONTROL_CSS = `
/* Pyrsis House Typography v9 — global */
* { font-synthesis-style: none; font-synthesis-weight: none; }
body { font-feature-settings: "tnum" 1, "lnum" 1; }
/* Controls, treatment H: raised fill, no outline; gold appears once per panel on the selected control. */
button { border: 0; transition: transform 80ms ease, filter 80ms ease, opacity 120ms ease, box-shadow 110ms ease, background 110ms ease; -webkit-tap-highlight-color: transparent;
  box-shadow: 0 1px 0 rgba(25,29,30,.16), 0 1px 3px rgba(25,29,30,.10); }
button:not(:disabled):hover { box-shadow: 0 2px 0 rgba(25,29,30,.18), 0 3px 7px rgba(25,29,30,.13); }
button:not(:disabled):active { transform: translateY(1px); filter: brightness(0.94); box-shadow: 0 1px 2px rgba(25,29,30,.12); }
button:focus-visible { outline: 2px solid #C1442E; outline-offset: 2px; }
.pz-screen button { box-shadow: none; }  /* the Screen carries no affordance signals */
.pz-btn { box-shadow: 0 1px 0 rgba(25,29,30,.16), 0 1px 3px rgba(25,29,30,.10); transition: box-shadow 110ms ease, transform 60ms ease; }
.pz-btn:hover { box-shadow: 0 2px 0 rgba(25,29,30,.18), 0 3px 7px rgba(25,29,30,.13); }
.pz-btn:active { transform: translateY(1px); }
input, textarea, select { font-family: inherit; max-width: 100%; }
/* Never scroll sideways: the page fits the viewport; anything wider scrolls inside its own box. */
html, body, #root { max-width: 100vw; overflow-x: hidden; }
* { min-width: 0; }
img, svg, video { max-width: 100%; }
pre, code { white-space: pre-wrap; word-break: break-word; }
.pz-wrap { overflow-wrap: anywhere; }
@media (max-width: 640px) {
  .grid-cols-2, .grid-cols-3 { grid-template-columns: 1fr !important; }
  .text-6xl { font-size: 2.6rem !important; }
  .text-5xl { font-size: 2.2rem !important; }
}
.pz-label { font-family: 'Gotham XNarrow Bold', 'Arial Narrow', Arial, sans-serif; letter-spacing: 0.19em; }
.pz-fig { font-family: 'Decimal Light', system-ui, sans-serif; font-feature-settings: "tnum" 1, "lnum" 1; }
h1, h2, h3 { font-family: 'Gotham XNarrow Bold', 'Arial Narrow', Arial, sans-serif; letter-spacing: 0.06em; }
th { font-family: 'Decimal Black', system-ui, sans-serif; font-weight: normal; }
button:disabled { opacity: 0.38 !important; cursor: not-allowed !important; filter: grayscale(0.6); }
button[aria-busy="true"] { opacity: 0.6 !important; cursor: progress !important; pointer-events: none; }
button[aria-busy="true"]::after { content: " …"; }
`;
/* v1.5 — Per-device text size. Three steps (100 / 115 / 130 %), remembered on
   the device only. Scales the root font-size, so every rem-based size follows. */
const ZOOM_STEPS = [100, 115, 130];
function readZoom() { try { const z = parseInt(localStorage.getItem("pz-zoom") || "100", 10); return ZOOM_STEPS.includes(z) ? z : 100; } catch { return 100; } }
function applyZoom(z) { try { document.documentElement.style.fontSize = z === 100 ? "" : `${z}%`; localStorage.setItem("pz-zoom", String(z)); } catch {} }
function TextSize({ dark }) {
  const [z, setZ] = useState(readZoom);
  useEffect(() => { applyZoom(z); }, [z]);
  const step = (d) => setZ((cur) => ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, ZOOM_STEPS.indexOf(cur) + d))]);
  const st = dark ? { background: "rgba(250,247,240,0.12)", color: PAPER, boxShadow: "none" } : { background: PLATE, color: CHARCOAL };
  return (
    <span className="inline-flex items-center gap-1 text-xs" title="Text size on this device" style={{ fontFamily: MONO_FONT }}>
      <button onClick={() => step(-1)} disabled={z === ZOOM_STEPS[0]} aria-label="Smaller text" className="rounded px-2 py-1" style={st}>A−</button>
      <span style={{ opacity: 0.7 }}>{z}%</span>
      <button onClick={() => step(1)} disabled={z === ZOOM_STEPS[ZOOM_STEPS.length - 1]} aria-label="Larger text" className="rounded px-2 py-1" style={st}>A+</button>
    </span>
  );
}
function useFontEmbed() {
  useEffect(() => {
    /* v1.5 — Mobile layout. Without a viewport meta a phone renders the page at
       ~980px and scales it down, which is what forces horizontal panning. */
    if (!document.querySelector('meta[name="viewport"]')) {
      const m = document.createElement("meta"); m.name = "viewport";
      m.content = "width=device-width, initial-scale=1, viewport-fit=cover"; document.head.appendChild(m);
    }
    if (!document.getElementById("pyrsis-fonts")) {
      const el = document.createElement("style");
      el.id = "pyrsis-fonts";
      el.textContent = PYRSIS_FONT_CSS;
      document.head.appendChild(el);
    }
    if (!document.getElementById("pyrsis-controls")) {
      const el = document.createElement("style");
      el.id = "pyrsis-controls";
      el.textContent = CONTROL_CSS;
      document.head.appendChild(el);
    }
    /* Audio unlock on the first gesture anywhere — chimes were silent on
       devices where the context was never resumed by a user action. */
    const unlock = () => { try { ensureAudio(); } catch {} };
    document.addEventListener("pointerdown", unlock, { once: true, passive: true });
    document.addEventListener("keydown", unlock, { once: true, passive: true });
    return () => { document.removeEventListener("pointerdown", unlock); document.removeEventListener("keydown", unlock); };
  }, []);
}
/* Pyrsis House Typography v9 — role assignment (human / machine / instrument / display) */
const BODY_FONT  = "'Ideal Sans Light', 'Decimal Light', system-ui, sans-serif";   // human voice: prose, option text, injects
const BODY_HI    = "'Ideal Sans Book', 'Decimal Light', system-ui, sans-serif";    // controls that need presence
const LABEL_FONT = "'Decimal Black', system-ui, sans-serif";                       // labels, table headers, openers
const FIG_FONT   = "'Decimal Light', system-ui, sans-serif";                       // figures, clocks, dial glyphs
const MONO_FONT  = "'Operator Mono Book', ui-monospace, monospace";                // machine voice: readouts, dispatch lines
const HEAD_FONT  = "'Gotham XNarrow Bold', 'Arial Narrow', Arial, sans-serif";     // display: headings, eyebrows, source tags
const WORDMARK_DARK = "data:image/png;base64,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";
const WORDMARK_LIGHT = "data:image/png;base64,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";

/* ---- Shared UI ---- */
const Wordmark = ({ light, h }) => (
  <img src={light ? WORDMARK_LIGHT : WORDMARK_DARK} alt="Pyrsis"
       style={{ height: h || "1.6em", width: "auto", display: "inline-block", verticalAlign: "-0.2em" }} />
);
const SyncDot = ({ sync, dark }) => (
  <span className="text-xs font-bold" style={{ fontFamily: MONO_FONT,
    color: sync === "ok" ? "#4caf7d" : sync === "fail" ? "#ff8a70" : (dark ? "#999" : "#888") }}>
    {sync === "ok" ? "● SYNC LIVE" : sync === "fail" ? "○ NOT SYNCING — check Claude login & use the published link" : "◌ connecting…"}
  </span>
);
const GoldRule = () => <div style={{ height: 3, background: GOLD }} />;

function TermPills({ terms, dark }) {
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {termsLabel(terms).map((l, i) => (
        <span key={i} className="text-xs px-2 py-0.5 rounded-full"
          style={{ background: dark ? "#31383a" : LIGHTGOLD, color: dark ? PAPER : CHARCOAL }}>{l}</span>
      ))}
    </div>
  );
}
/* Sliding HUMAN ⇄ AI seat toggle. The knob slides left (Human) or
   right (AI); pressing anywhere on the control flips it. */
function SeatToggle({ team, value, onToggle }) {
  const isAi = value === "ai";
  return (
    <button onClick={onToggle}
      className="flex items-center gap-2 px-2.5 py-1.5 rounded w-full"
      style={{ background: PLATE }}>
      <span className="text-sm font-bold truncate" style={{ color: CHARCOAL }}>{FLAGS[team]} {team}</span>
      <span style={{ marginLeft: "auto", position: "relative", width: 96, height: 26, borderRadius: 999, background: LIGHTGOLD, flexShrink: 0, display: "inline-block" }}>
        <span style={{ position: "absolute", top: 2, left: isAi ? 48 : 2, width: 46, height: 22, borderRadius: 999,
          background: isAi ? CHARCOAL : GOLD,
          transition: "left 0.18s ease, background 0.18s ease" }} />
        <span style={{ position: "absolute", left: 0, width: 48, textAlign: "center", lineHeight: "26px", fontSize: 10,
          fontWeight: 700, fontFamily: MONO_FONT, color: isAi ? "#a89f8d" : CHARCOAL }}>HUMAN</span>
        <span style={{ position: "absolute", right: 0, width: 48, textAlign: "center", lineHeight: "26px", fontSize: 10,
          fontWeight: 700, fontFamily: MONO_FONT, color: isAi ? GOLD : "#a89f8d" }}>◆ AI</span>
      </span>
    </button>
  );
}

function CredBar({ team, val, dark }) {  return (
    <div className="flex items-center gap-2">
      <span className="text-lg w-7">{FLAGS[team]}</span>
      <span className="text-xs w-16 font-bold" style={{ color: dark ? PAPER : CHARCOAL }}>{team}</span>
      <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: dark ? "#31383a" : "#e8e2d4" }}>
        <div className="h-full rounded-full" style={{ width: `${val}%`, background: val >= 50 ? GOLD : RED, transition: "width 0.8s" }} />
      </div>
      <span className="text-xs w-7 text-right tabular-nums font-bold" style={{ color: dark ? PAPER : CHARCOAL }}>{val}</span>
    </div>
  );
}

/* ================= PROJECTOR ================= */
function Projector({ sh }) {
  const { clock, props, endo, injects, flags, pub, comms, ann } = sh;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const lastInjTs = injects.length ? Math.max(...injects.map((j) => j.ts)) : 0;
  const prevInjTs = React.useRef(lastInjTs);
  useEffect(() => { if (lastInjTs > prevInjTs.current) SOUNDS.inject(); prevInjTs.current = lastInjTs; }, [lastInjTs]);
  const scoredComms = comms.filter((c) => c.scored);
  const lastCmTs = scoredComms.length ? Math.max(...scoredComms.map((c) => c.ts)) : 0;
  const prevCmTs = React.useRef(lastCmTs);
  useEffect(() => { if (lastCmTs > prevCmTs.current) SOUNDS.comm(); prevCmTs.current = lastCmTs; }, [lastCmTs]);
  const winState = `${pub.window.n}-${pub.window.open ? "o" : "c"}`;
  const prevWinP = React.useRef(winState);
  useEffect(() => {
    if (prevWinP.current !== winState) {
      const opened = winState.endsWith("o");
      if (opened) SOUNDS.windowOpen(); else SOUNDS.windowClose();
    }
    prevWinP.current = winState;
  }, [winState]);

  const rem = remainingOf(clock, now);
  const winOpen = pub.window.open && pub.window.endsAt > now;
  const winRem = winOpen ? Math.max(0, pub.window.endsAt - now) : 0;
  const live = props.filter((p) => p.active).sort((a, b) => b.ts - a.ts);
  const adopted = flags.adoptedId ? props.find((p) => p.id === flags.adoptedId) : null;
  const collapsed = flags.collapsed || (!adopted && rem === 0 && clock.endsAt);
  const lead = leadingProposal(props, endo);
  const board = (adopted || lead) && (
    TEAMS.map((t) => ({
      t,
      pct: blendedPct(t, (adopted || lead.p).terms, !!adopted, pub.cred[t]),
    })).sort((a, b) => b.pct - a.pct)
  );
  const seenInj = new Set();
  const dedupedInj = injects.filter((j) => {
    const base = String(j.id).split("-")[0];
    if (seenInj.has(base)) return false;
    seenInj.add(base); return true;
  });
  const wire = [
    ...dedupedInj.map((j) => ({ ...j, kind: "inject" })),
    ...comms.filter((c) => c.scored).map((c) => ({ ...c, kind: "comm" })),
  ].sort((a, b) => b.ts - a.ts).slice(0, 14);

  const leadSent = lead ? pub.sentiment[lead.p.id] : null;

  return (
    <div className="min-h-screen pz-screen" style={{ background: DEEP, color: PAPER, fontFamily: BODY_FONT }}>
      <div className="flex items-center justify-between px-8 py-3" style={{ background: CHARCOAL }}>
        <div>
          <Wordmark light h="38px" />
          <div className="text-xs tracking-widest pz-label mt-0.5" style={{ color: GOLD, fontFamily: MONO_FONT }}>
            {S.meta.projectorSubtitle}
          </div>
        </div>
        <div className="flex items-center gap-8">
          {!HIDE_INTL_MOOD && <MoodPanel moodKey={pub.mood} />}
          <div className="text-right">
            <div className="text-6xl tabular-nums" style={{ color: rem < 10 * 60 * 1000 ? RED : GOLD, fontFamily: FIG_FONT }}>{fmt(rem)}</div>
            <div className="text-xs tracking-widest pz-label opacity-80" style={{ fontFamily: LABEL_FONT }}>{S.meta.clockLabel}</div>
            <div className="mt-1"><SyncDot sync={sh.sync} dark /></div>
          </div>
        </div>
      </div>
      <GoldRule />
      {liveAnnouncement(ann, now) && (
        <div className="text-center py-2 text-lg" style={{ background: "#101314", color: PAPER, borderBottom: `2px solid ${GOLD}` }}>
          <span className="font-bold tracking-widest mr-3" style={{ color: GOLD }}>◆ GAMEMASTER ANNOUNCEMENT</span>
          {liveAnnouncement(ann, now).text}
        </div>
      )}

      {winOpen && (
        <div className="text-center py-2 font-bold tracking-widest" style={{ background: LIGHTGOLD, color: CHARCOAL }}>
          ◆ PRESS WINDOW {pub.window.n} OF {TOTAL_WINDOWS} OPEN — FILE YOUR COMMUNIQUÉ — {fmt(winRem)} ◆
        </div>
      )}
      {adopted && (
        <div className="text-center py-5" style={{ background: CHARCOAL, color: PAPER, fontFamily: BODY_HI }}>
          <div className="text-3xl font-bold">{S.meta.adoptedBanner}</div>
          <div className="text-sm mt-1">Proposed by {FLAGS[adopted.team]} {adopted.team} — endorsed by all delegations</div>
        </div>
      )}
      {collapsed && !adopted && (
        <div className="text-center py-5" style={{ background: RED }}>
          <div className="text-3xl font-bold">{S.meta.collapseBanner}</div>
          <div className="text-sm mt-1">{S.meta.collapseNote}</div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-6 p-6">
        {/* Wire */}
        <div>
          <h2 className="text-lg tracking-widest mb-3" style={{ color: GOLD }}>◆ DIPLOMATIC WIRE</h2>
          <div className="space-y-3">
            {wire.length === 0 && <div className="opacity-80 text-sm italic">Awaiting first dispatch…</div>}
            {wire.map((w) => w.kind === "inject" ? (
              <div key={w.id} className="p-3 rounded" style={w.moodShift ? { background: RED, color: PAPER, borderLeft: `4px solid ${PAPER}` } : { background: "white", color: CHARCOAL, borderLeft: `4px solid ${GOLD}` }}>
                <div className="text-xs tracking-widest pz-label font-bold" style={{ color: w.moodShift ? PAPER : "#a07800", fontFamily: MONO_FONT }}>{w.tag}{w.moodShift ? "" : " · NEWS"}</div>
                <div className="font-bold mt-0.5">{w.title}</div>
                <div className="text-sm mt-1" style={{ opacity: 0.9 }}>{w.body}</div>
                {w.reaction && <div className="text-sm mt-1 italic" style={{ color: PAPER, opacity: 0.92 }}><span className="text-xs pz-label not-italic" style={{ letterSpacing: "0.14em", color: GOLD }}>HOW IT'S PLAYING</span> {w.reaction}</div>}
              </div>
            ) : (
              <div key={w.id} className="p-3 rounded" style={{ background: "#101314", color: PAPER, borderLeft: `4px solid ${w.net <= -5 ? RED : GOLD}` }}>
                <div className="text-xs tracking-widest pz-label" style={{ color: GOLD, fontFamily: MONO_FONT }}>
                  {FLAGS[w.team]} {MINISTRY[w.team].wire} · {w.posture.toUpperCase()} · re: {w.subjectLabel}
                </div>
                <div className="text-sm mt-1">“{w.text}”</div>
                <div className="text-xs mt-1 italic" style={{ color: w.net <= -5 ? "#ff8a70" : w.net >= 2 ? GOLD : PAPER, opacity: 0.9 }}>
                  {receptionLabel(w.net)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Proposals */}
        <div>
          <h2 className="text-lg tracking-widest mb-3" style={{ color: GOLD }}>◆ PROPOSALS ON THE TABLE</h2>
          {lead && leadSent != null && (
            <div className="p-3 rounded mb-3" style={{ background: CHARCOAL }}>
              <div className="text-xs tracking-widest pz-label opacity-80">GLOBAL PUBLIC ON THE LEADING DRAFT ({FLAGS[lead.p.team]} {lead.p.team})</div>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 h-4 rounded-full overflow-hidden" style={{ background: RED }}>
                  <div className="h-full" style={{ width: `${leadSent}%`, background: GOLD, transition: "width 0.8s" }} />
                </div>
                <span className="font-bold tabular-nums">{leadSent}% support</span>
              </div>
            </div>
          )}
          <div className="space-y-3">
            {live.length === 0 && <div className="opacity-80 text-sm italic">No proposals tabled yet.</div>}
            {live.map((p) => {
              const es = endorserList(endo, p.id);
              const pend = pendingList(endo, p.id);
              return (
                <div key={p.id} className="p-3 rounded" style={{ background: CHARCOAL, outline: flags.adoptedId === p.id ? `3px solid ${GOLD}` : "none" }}>
                  <div className="flex justify-between items-baseline">
                    <div className="font-bold">{FLAGS[p.team]} {p.team} draft</div>
                    <div className="text-2xl font-bold tabular-nums" style={{ color: es.length >= N_TEAMS - 1 ? GOLD : PAPER }}>
                      {es.length + 1}<span className="text-sm opacity-80">/{N_TEAMS}</span>
                    </div>
                  </div>
                  <TermPills terms={p.terms} dark />
                  <div className="text-xs mt-2 opacity-80">
                    Endorsed by: {es.length ? es.map((t) => FLAGS[t]).join(" ") : "— none yet —"}
                    {pend.length > 0 && <span style={{ color: LIGHTGOLD }}> · awaiting reaffirmation: {pend.map((t) => FLAGS[t]).join(" ")}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Credibility + standings */}
        <div>
          <h2 className="text-lg tracking-widest mb-3" style={{ color: GOLD }}>◆ DELEGATION CREDIBILITY</h2>
          <div className="space-y-2 mb-6">
            {TEAMS.map((t) => <CredBar key={t} team={t} val={pub.cred[t] ?? S.scoring.startCred} dark />)}
          </div>
          <h2 className="text-lg tracking-widest mb-3" style={{ color: GOLD }}>
            ◆ STANDINGS {adopted ? "— FINAL" : lead ? "· vs leading draft" : ""}
          </h2>
          {!board && <div className="opacity-80 text-sm italic">Standings appear once a proposal is tabled.</div>}
          {board && (
            <div className="space-y-2">
              {board.map((r, i) => (
                <div key={r.t} className="flex items-center gap-3 p-2 rounded" style={{ background: i === 0 ? GOLD : CHARCOAL, color: i === 0 ? CHARCOAL : PAPER }}>
                  <div className="w-8 text-xl font-bold">{i + 1}</div>
                  <div className="text-2xl">{FLAGS[r.t]}</div>
                  <div className="font-bold flex-1">{r.t}{MEDIATORS.includes(r.t) && <span className="text-xs opacity-80 ml-1">(mediator)</span>}</div>
                  <div className="text-xl font-bold tabular-nums">{flags.revealed ? `${r.pct}` : "—"}</div>
                </div>
              ))}
              <div className="text-xs opacity-80 mt-1">
                {flags.revealed ? `Final = ${DEAL_W_PCT}% deal outcome + ${CRED_W_PCT}% public credibility.` : "Rank order only — scores sealed until the debrief."}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* Mood shift as a first-class wire event. Emitting it as a non-floor inject
   gives it the ack interstitial, the chime, and the toast for free; the
   moodShift flag drives the red treatment on every surface. */
async function emitMoodWire(moodKey) {
  const mood = MOODS[moodKey]; if (!mood) return;
  const id = `MOOD-${moodKey}-${Date.now()}`;
  await sUpdate(K.injects, [],
    (cur) => (cur.some((x) => x.id === id) ? cur : [...cur, { id, tag: "PUBLIC MOOD HAS SHIFTED", title: `The public pulse is now: ${moodKey}`, body: mood.dispatch, ts: Date.now(), moodShift: true }]),
    (cur) => cur.some((x) => x.id === id));
}
/* Projector pulse panel. Flashes red for ~6s when the mood changes so a
   shift is impossible to miss from across a room. */
function MoodPanel({ moodKey }) {
  const [flash, setFlash] = useState(false);
  const prev = React.useRef(moodKey);
  useEffect(() => {
    if (prev.current !== moodKey) { setFlash(true); const t = setTimeout(() => setFlash(false), 6000); prev.current = moodKey; return () => clearTimeout(t); }
  }, [moodKey]);
  return (
    <div className="px-4 py-2 rounded max-w-xl" style={{ background: flash ? RED : DEEP, transition: "background 400ms ease", outline: flash ? `3px solid ${PAPER}` : "none" }}>
      <div className="text-xs tracking-widest pz-label mb-1" style={{ color: flash ? PAPER : GOLD }}>◆ THE PUBLIC PULSE{flash ? " — JUST CHANGED" : " — READ IT CAREFULLY"}</div>
      <div className="text-sm italic opacity-90" style={{ color: flash ? PAPER : undefined }}>{MOODS[moodKey]?.dispatch}</div>
    </div>
  );
}

/* ================= FACILITATOR ================= */
/* ============ PLAYERS (account games) ============
   Join code, the students who joined, and their delegation. Polls the games
   API; assigning a seat lets a waiting student in within a few seconds. */
const OBSERVER = "observer";
function PlayersPanel({ game, aiCtl }) {
  const [members, setMembers] = useState(null);
  const [pendingSeat, setPendingSeat] = useState({}); // userId -> delegation being saved
  const [err, setErr] = useState("");
  const [spreading, setSpreading] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api("GET", `/games/${encodeURIComponent(game.gameId)}`);
      setMembers((r.members || []).filter((m) => m.userId !== game.ownerId)
        .sort((a, b) => (a.joinedAt || "").localeCompare(b.joinedAt || "")));
    } catch (e) { setErr(e.message); }
  }, [game.gameId, game.ownerId]);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const assign = async (userId, delegation) => {
    setPendingSeat((p) => ({ ...p, [userId]: delegation })); setErr("");
    try {
      const { member } = await api("POST", `/games/${encodeURIComponent(game.gameId)}/assign`, { userId, delegation });
      setMembers((ms) => ms.map((m) => (m.userId === userId ? { ...m, delegation: member.delegation } : m)));
    } catch (e) { setErr(e.message); }
    setPendingSeat((p) => { const n = { ...p }; delete n[userId]; return n; });
  };

  const list = members || [];
  const seatOf = (m) => (m.userId in pendingSeat ? pendingSeat[m.userId] : m.delegation);
  const waiting = list.filter((m) => !seatOf(m));
  const countIn = (t) => list.filter((m) => seatOf(m) === t).length;
  const humanSeats = TEAMS.filter((t) => aiCtl[t] !== "ai");

  // Waiting students go one by one to the human-played delegation with the fewest players.
  const spread = async () => {
    if (!humanSeats.length) { setErr("Every delegation is AI-played. Switch a seat to Human first."); return; }
    setSpreading(true);
    const counts = Object.fromEntries(humanSeats.map((t) => [t, countIn(t)]));
    for (const m of waiting) {
      const t = humanSeats.reduce((a, b) => (counts[b] < counts[a] ? b : a));
      counts[t] += 1;
      await assign(m.userId, t);
    }
    setSpreading(false);
  };

  return (
    <div className="mt-3 p-4 rounded" style={{ background: PLATE, textAlign: "left" }}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-3">
        <h3 className="font-bold tracking-wide" style={{ fontFamily: HEAD_FONT, letterSpacing: "0.06em" }}>
          PLAYERS <span className="font-normal text-xs opacity-60">{game.title}</span>
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs pz-label" style={{ opacity: 0.7 }}>JOIN CODE</span>
          <span className="px-3 py-1 rounded font-bold text-xl" style={{ background: CHARCOAL, color: GOLD, fontFamily: MONO_FONT, letterSpacing: "0.12em" }}>
            {game.code.toUpperCase()}
          </span>
        </div>
        <div className="text-sm" style={{ marginLeft: "auto" }}>
          {members === null ? "Loading players…" : `${list.length} joined`}
          {waiting.length > 0 && <span className="ml-2 px-2 py-0.5 rounded text-xs font-bold" style={{ background: RED, color: PAPER }}>{waiting.length} waiting for a delegation</span>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {TEAMS.map((t) => {
          const n = countIn(t), ai = aiCtl[t] === "ai";
          return (
            <span key={t} className="text-xs px-2 py-1 rounded" style={{ background: "white", fontFamily: MONO_FONT, color: !ai && n === 0 ? RED : CHARCOAL }}>
              {FLAGS[t]} {t} · {n} {ai ? "· AI seat" : n === 0 ? "· nobody yet" : ""}
            </span>
          );
        })}
        <span className="text-xs px-2 py-1 rounded" style={{ background: "white", fontFamily: MONO_FONT }}>Observers · {countIn(OBSERVER)}</span>
        {waiting.length > 0 && (
          <button onClick={spread} disabled={spreading} aria-busy={spreading ? "true" : "false"}
            className="px-3 py-1 rounded font-bold text-xs" style={{ background: CHARCOAL, color: PAPER, fontFamily: BODY_HI }}>
            Spread waiting students across human delegations
          </button>
        )}
      </div>

      {members && list.length === 0 && (
        <div className="text-sm" style={{ opacity: 0.75 }}>No students yet. They sign in, choose <b>Join a game</b> and type <b>{game.code.toUpperCase()}</b>.</div>
      )}
      {list.length > 0 && (
        <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {list.map((m) => {
            const seat = seatOf(m);
            return (
              <div key={m.userId} className="flex items-center gap-2 px-2.5 py-1.5 rounded" style={{ background: "white", border: seat ? "1px solid transparent" : `1px solid ${RED}` }}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate" style={{ fontFamily: BODY_HI }}>{m.name}</div>
                  <div className="text-xs truncate" style={{ opacity: 0.6 }}>{m.email}</div>
                </div>
                <select value={seat || ""} disabled={m.userId in pendingSeat} aria-label={`Delegation for ${m.name}`}
                  onChange={(e) => assign(m.userId, e.target.value || null)}
                  className="text-sm px-2 py-1 rounded" style={{ background: PAPER, color: CHARCOAL, border: "1px solid #c9c4b8", maxWidth: 170 }}>
                  <option value="">— Unassigned —</option>
                  {TEAMS.map((t) => <option key={t} value={t}>{FLAGS[t]} {DELEG[t].name}{aiCtl[t] === "ai" ? " (AI seat)" : ""}</option>)}
                  <option value={OBSERVER}>Observer (projector view)</option>
                </select>
              </div>
            );
          })}
        </div>
      )}
      {err && <div className="mt-2 text-sm font-bold" role="alert" style={{ color: RED }}>{err}</div>}
    </div>
  );
}

function Facilitator({ sh, game, onExit }) {
  const { clock, props, endo, injects, flags, pub, comms, pull, aiCtl } = sh;
  const [now, setNow] = useState(Date.now());
  /* ---- AI seat host: this console runs every seat toggled to AI ---- */
  const aiMem = React.useRef({});
  const aiBusy = React.useRef(false);
  const syncRef = React.useRef(sh.sync);
  useEffect(() => { syncRef.current = sh.sync; }, [sh.sync]);
  /* Seat toggles: optimistic UI + COALESCED writes. Storage is rate-limited,
     so rapid presses (e.g. flipping all seven seats) must become one
     read-modify-write, not seven. Intents accumulate; a short debounce
     flushes them in a single K.ai write. */
  const [seatLocal, setSeatLocal] = useState({});
  const seatIntents = React.useRef({});
  const seatFlushTimer = React.useRef(null);
  const flushSeats = async () => {
    const intents = { ...seatIntents.current };
    seatIntents.current = {};
    if (!Object.keys(intents).length) return;
    let ok = false;
    try {
      /* Atomic merge INSIDE the write chain: apply only the toggled seats
         onto the freshest in-chain doc. Two racing flushes (clicks split
         across debounce cycles) now serialize and each merges its own
         intents — neither can clobber the other's seats from a stale read.
         (The prior read-outside / write-whole-map path is what reverted a
         seat that landed alone in one flush, e.g. China.) */
      ok = await writeDoc((d) => {
        const curAi = { ...DEFAULT_AI, ...(d[K.ai] || {}) };
        Object.assign(curAi, intents);
        d[K.ai] = curAi;
        return d;
      });
      await pull();
    } catch { ok = false; }
    if (ok) {
      setSeatLocal((s) => {
        const n = { ...s };
        Object.keys(intents).forEach((k) => delete n[k]);
        return n;
      });
    } else {
      Object.assign(seatIntents.current, intents);
      if (seatFlushTimer.current) clearTimeout(seatFlushTimer.current);
      seatFlushTimer.current = setTimeout(flushSeats, 1500);
    }
  };
  const toggleSeat = (t) => {
    const target = (seatLocal[t] ?? aiCtl[t]) === "ai" ? "human" : "ai";
    setSeatLocal((s) => ({ ...s, [t]: target }));
    seatIntents.current[t] = target;
    if (seatFlushTimer.current) clearTimeout(seatFlushTimer.current);
    seatFlushTimer.current = setTimeout(flushSeats, 400);
  };
  useEffect(() => {
    const tick = async () => {
      if (aiBusy.current) return;
      if (syncRef.current !== "ok") return; // storage unhealthy — shed load, don't pile on
      aiBusy.current = true;
      try {
        /* ONE snapshot per tick, shared by every AI seat. Storage is
           rate-limited; per-seat refetching (the v1.1.0 bug) multiplied
           request volume ~7× and could trip the limiter, which then
           broke sync for the whole conference. */
        const [ctlRaw, clockS, propsS, endoS, pubS, commsS, flagsS] = await Promise.all([
          sGet(K.ai, DEFAULT_AI), sGet(K.clock, DEFAULT_CLOCK), sGet(K.props, []),
          sGet(K.endo, {}), sGet(K.pub, DEFAULT_PUB), sGet(K.comms, []), sGet(K.flags, DEFAULT_FLAGS),
        ]);
        const ctl = { ...DEFAULT_AI, ...ctlRaw };
        const aiTeams = TEAMS.filter((x) => ctl[x] === "ai");  // __caps key is not a team
        if (!aiTeams.length) return;
        const snapshot = { clock: clockS, props: propsS, endo: endoS, pub: pubS, comms: commsS, flags: flagsS };
        let acted = false;
        for (const t of aiTeams) {
          if (snapshot.flags.adoptedId) break;
          const nowTs = Date.now();
          const mem = (aiMem.current[t] = aiMem.current[t] || { lastTableTs: 0, remarked: {} });
          const caps = aiCapsFor(t, ctl.__caps);
          const actions = aiDecide(t, snapshot, nowTs, mem).filter((a) =>
            (a.type === "endorse" || a.type === "withdraw") ? caps.endorse :
            a.type === "table" ? caps.table :
            a.type === "amend" ? caps.amend :
            (a.type === "file" || a.type === "floor") ? caps.speak : true);
          for (const a of actions) {
            acted = true;
            if (a.type === "endorse") await opEndorse(t, a.pid, true);
            else if (a.type === "withdraw") await opEndorse(t, a.pid, false);
            else if (a.type === "table" || a.type === "amend") {
              const r = await opSubmitDraft(t, a.terms);
              if (r.ok) mem.lastTableTs = nowTs;
            } else if (a.type === "floor") {
              mem.remarked[a.draftId] = true;
              const fid = `FLOOR_${t}_${nowTs}`;
              await sUpdate(K.injects, [],
                (cur) => (cur.some((x) => x.id === fid) ? cur : [...cur, { id: fid, tag: "FROM THE FLOOR", title: a.text, body: "", ts: nowTs, floor: true }]),
                (cur) => cur.some((x) => x.id === fid));
            } else if (a.type === "file") {
              const lead = leadingProposal(snapshot.props.filter((p) => p.active && p.team !== t), snapshot.endo);
              const worstIss = lead ? worstIssueFor(t, lead.p.terms) : null;
              const subjectLabel = a.subject.type === "general" ? "the situation"
                : `${a.subject.stance === "for" ? "IN SUPPORT OF" : "AGAINST"} the ${a.leadTeam} draft`;
              const text = await composeAiCommunique(t, {
                subject: a.subject, posture: a.posture, leadTeam: a.leadTeam,
                moodDispatch: MOODS[snapshot.pub.mood]?.dispatch || "", worstIss, subjectLabel,
              });
              await opFileCommunique(t, { posture: a.posture, subject: a.subject, subjectLabel, text, moodKey: snapshot.pub.mood });
            }
          }
          /* Keep the shared snapshot coherent for the remaining seats this
             tick without refetching: endorse/draft effects are re-read from
             storage only where adoption may have occurred. */
          if (actions.some((a) => a.type === "endorse")) {
            snapshot.flags = await sGet(K.flags, DEFAULT_FLAGS);
            snapshot.endo = await sGet(K.endo, {});
          }
        }
        if (acted) await pull();
      } finally { aiBusy.current = false; }
    };
    const timer = setInterval(tick, AI_CFG.tickMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [customTag, setCustomTag] = useState("FLASH");
  const [customTitle, setCustomTitle] = useState("");
  const [customBody, setCustomBody] = useState("");
  const [busy, setBusy] = useState("");
  const [designer, setDesigner] = useState(false);
  useEffect(() => { readDesigner().then(setDesigner); }, []);
  /* v1.5 — Every GM action acknowledges itself: the button shows a busy state
     while its label matches `busy`, and a confirmation toast appears when it
     completes (or an error if it failed). Singapore post-mortem: repeated
     presses because nothing visibly responded. */
  const [gmNote, setGmNote] = useState(null);
  const noteTimer = React.useRef(null);
  const note = (text, kind) => {
    setGmNote({ text, kind: kind || "ok", at: Date.now() });
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setGmNote(null), kind === "err" ? 6000 : 2500);
  };
  const [exportText, setExportText] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [annText, setAnnText] = useState("");
  const [annMin, setAnnMin] = useState(10);   // minutes pinned; 0 = until cleared
  const [openSx, setOpenSx] = useState(null);
  const [override, setOverride] = useState({});
  const [exemplars, setExemplars] = useState([]);
  const [benchText, setBenchText] = useState("");
  const [benchPosture, setBenchPosture] = useState(POSTURES[1] || POSTURES[0]);
  const [benchResult, setBenchResult] = useState(null);
  const [exForm, setExForm] = useState({ text: "", e: 3, l: 3, p: 3, ad: false, note: "" });
  useEffect(() => { (async () => setExemplars(await sGet(K.exemplars, [])))(); }, []);
  const [gmThreads, setGmThreads] = useState({});
  const [gmReplies, setGmReplies] = useState({});
  const { ann } = sh;
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const entries = await Promise.all(TEAMS.map(async (t) => [t, await sGet(gmKey(t), [])]));
      if (alive) setGmThreads(Object.fromEntries(entries));
    };
    poll();
    const t = setInterval(poll, 6000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const rem = remainingOf(clock, now);
  const winOpen = pub.window.open && pub.window.endsAt > now;

  const GM_OK = { pauseSession: "Session paused — team consoles are locked", resumeSession: "Session resumed",
    reset: "Session reset", reveal: "Scores revealed", collapse: "Talks collapsed" };
  const act = async (label, fn, okMsg) => {
    setBusy(label);
    try { await fn(); await pull(); note(okMsg || GM_OK[label] || `✓ ${label} done`); }
    catch (e) { note(e && e.friendly ? e.friendly : `${label}: something went wrong — try again`, "err"); }
    finally { setBusy(""); }
  };
  const clockSet = (c) => sSet(K.clock, c);
  const start = () => clockSet({ running: true, endsAt: Date.now() + rem, remainingMs: rem });
  const pause = () => clockSet({ running: false, endsAt: null, remainingMs: rem });
  const nudge = (min) => {
    const nr = Math.max(0, rem + min * 60 * 1000);
    return clockSet(clock.running ? { running: true, endsAt: Date.now() + nr, remainingMs: nr } : { running: false, endsAt: null, remainingMs: nr });
  };

  const fire = (j) => act(j.id, async () => {
    const already = (list) => list.some((x) => String(x.id).split("-")[0] === j.id);
    const stamped = { ...j, id: `${j.id}-${Date.now()}`, ts: Date.now() };
    await sUpdate(K.injects, [],
      (cur) => (already(cur) ? cur : [...cur, stamped]),
      (cur) => already(cur));
    if (j.mood) {
      const p = await sGet(K.pub, DEFAULT_PUB);
      if (p.mood !== j.mood) {
        await sSet(K.pub, { ...p, mood: j.mood });
        await emitMoodWire(j.mood);
      }
    }
  });
  const fireCustom = () => {
    if (!customTitle.trim()) return;
    return act("custom", async () => {
      const cid = `C-${Date.now()}`;
      await sUpdate(K.injects, [],
        (cur) => (cur.some((x) => x.id === cid) ? cur : [...cur, { id: cid, tag: customTag || "FLASH", title: customTitle, body: customBody, ts: Date.now() }]),
        (cur) => cur.some((x) => x.id === cid));
      setCustomTitle(""); setCustomBody("");
    });
  };
  /* ---- Stage 1 console additions ---- */
  // Credibility override: absolute set for one delegation.
  const setCredAbs = (t, value) => act(`cred ${t}`, async () => {
    const v = Math.max(0, Math.min(100, Number(value)));
    if (!Number.isFinite(v)) return;
    await writeDoc((d) => {
      const p = { ...(d[K.pub] || DEFAULT_PUB) };
      p.cred = { ...(p.cred || {}), [t]: v };
      d[K.pub] = p; return d;
    });
  });
  // Endorsement override: force on/off for any team on any draft (GM-attributed).
  const gmEndorse = (t, pid, on) => act(`endorse ${t}`, async () => {
    await opEndorse(t, pid, on, true);
    await sUpdate(K.ann, [], (cur) => [...cur, { ts: Date.now(), gm: true, text: `GM ${on ? "set" : "removed"} ${t} endorsement on draft ${pid}` }], () => true);
  });
  // AI per-seat capability toggle (stored beside seat control under __caps).
  const toggleCap = (t, cap) => act(`cap ${t}`, async () => {
    await writeDoc((d) => {
      const ai = { ...DEFAULT_AI, ...(d[K.ai] || {}) };
      const caps = { ...(ai.__caps || {}) };
      const cur = { ...AI_CAPS_ALL, ...(caps[t] || {}) };
      cur[cap] = !cur[cap]; caps[t] = cur; ai.__caps = caps;
      d[K.ai] = ai; return d;
    });
  });
  // Full session export (JSON download). Everything the debrief or a researcher needs.
  const exportSession = () => {
    const rec = {
      scenario: S.meta.id, title: S.meta.title, exportedAt: new Date().toISOString(),
      clock, props, endo, injects, flags, pub, ann: sh.ann || [], seats: aiCtl,
      comms: designer ? comms : comms.map(({ sx, ...rest }) => rest),
      issues: ISSUES.map((i) => ({ id: i.id, label: i.label, type: i.type, options: i.options })),
      delegations: S.delegations.map((d) => ({ id: d.id, name: d.name, mediator: !!d.mediator })),
    };
    const txt = JSON.stringify(rec, null, 1);
    setExportText(txt);
    note("Session export ready below — copy it, or open it in a new tab and save");
  };
  const copyExport = async () => {
    try { await navigator.clipboard.writeText(exportText || ""); note("Copied to clipboard — paste into a text file and save as .json"); }
    catch { note("Copy blocked by the browser — select the text in the box and copy it by hand", "err"); }
  };
  const openExportTab = () => {
    try {
      const blob = new Blob([exportText || ""], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank");
      if (!w) throw new Error("popup");
      note("Opened in a new tab — use the browser's Save Page As… to keep it");
    } catch { note("The browser blocked the new tab — use Copy instead", "err"); }
  };
  // v1.5 — Session pause / resume (one atomic write across clock, window, flags).
  /* Freeze clock and press window into the doc. A no-op if already paused, so
     pausing twice never overwrites the saved window remainder. */
  const freezeDoc = () => writeDoc((d) => {
      const c = d[K.clock] || DEFAULT_CLOCK; const p = d[K.pub] || DEFAULT_PUB; const f = d[K.flags] || DEFAULT_FLAGS;
      if (f.paused) return d;
      const nowT = Date.now();
      const cRem = c.running && c.endsAt ? Math.max(0, c.endsAt - nowT) : c.remainingMs;
      const wRem = p.window.open && p.window.endsAt ? Math.max(0, p.window.endsAt - nowT) : null;
      d[K.clock] = { running: false, endsAt: null, remainingMs: cRem };
      if (wRem != null) d[K.pub] = { ...p, window: { ...p.window, endsAt: null } };
      d[K.flags] = { ...f, paused: true, pausedAt: nowT, winRemMs: wRem };
      return d;
  });
  const pauseSession = () => act("pauseSession", freezeDoc);
  /* Account games only. End of class: freeze the game, mark it paused (students
     can't write or rejoin until Resume on the dashboard), back to the dashboard. */
  const saveFailed = () => Object.assign(new Error("save"), { friendly: "Couldn't save the game. Check your connection and try again." });
  const setGameStatus = async (status) => {
    try { await api("POST", `/games/${encodeURIComponent(game.gameId)}/status`, { status }); }
    catch (e) { throw Object.assign(e, { friendly: e.message }); }
  };
  const pauseForNextClass = () => act("pauseForNextClass", async () => {
    if (!(await freezeDoc())) throw saveFailed();
    await setGameStatus("paused");
    onExit(`"${game.title}" is paused. Choose Resume here when your next class starts.`);
  });
  // End: stop the clock for good, then mark completed (read-only; frees the word).
  const endGame = () => act("endGame", async () => {
    const ok = await writeDoc((d) => {
      const c = d[K.clock] || DEFAULT_CLOCK; const p = d[K.pub] || DEFAULT_PUB; const f = d[K.flags] || DEFAULT_FLAGS;
      const nowT = Date.now();
      d[K.clock] = { running: false, endsAt: null, remainingMs: c.running && c.endsAt ? Math.max(0, c.endsAt - nowT) : c.remainingMs };
      if (p.window.open) d[K.pub] = { ...p, window: { ...p.window, endsAt: null } };
      d[K.flags] = { ...f, paused: false, pausedAt: null, winRemMs: null };
      return d;
    });
    if (!ok) throw saveFailed();
    await setGameStatus("completed");
    onExit(`"${game.title}" has ended. Its results stay available here.`);
  });
  const [confirmEnd, setConfirmEnd] = useState(false);
  const resumeSession = () => act("resumeSession", async () => {
    await writeDoc((d) => {
      const c = d[K.clock] || DEFAULT_CLOCK; const p = d[K.pub] || DEFAULT_PUB; const f = d[K.flags] || DEFAULT_FLAGS;
      const nowT = Date.now();
      d[K.clock] = { running: true, endsAt: nowT + (c.remainingMs || 0), remainingMs: c.remainingMs || 0 };
      if (f.winRemMs != null && p.window.open) d[K.pub] = { ...p, window: { ...p.window, endsAt: nowT + f.winRemMs } };
      d[K.flags] = { ...f, paused: false, pausedAt: null, winRemMs: null };
      return d;
    });
  });
  // Act-as-delegation failsafe. Substituted actions are logged as GM-attributed.
  const [subTeam, setSubTeam] = useState(TEAMS[0]);
  const [subDraft, setSubDraft] = useState({});
  const [subText, setSubText] = useState("");
  const [subPosture, setSubPosture] = useState(POSTURES[0]);
  const [subSubject, setSubSubject] = useState("SITUATION");
  const gmLog = (text) => sUpdate(K.ann, [], (cur) => [...cur, { ts: Date.now(), gm: true, text }], () => true);
  const subTable = () => act(`table as ${subTeam}`, async () => {
    const r = await opSubmitDraft(subTeam, subDraft);
    if (!r.ok) throw Object.assign(new Error("t"), { friendly: r.reason === "table-full" ? "Table is full." : "Could not table." });
    await gmLog(`GM tabled/amended a draft on behalf of ${subTeam}`);
  });
  const subFile = () => act(`file as ${subTeam}`, async () => {
    if (!pub.window.open) throw Object.assign(new Error("w"), { friendly: "No press window is open." });
    if (subText.trim().length < 20) throw Object.assign(new Error("s"), { friendly: "Statement needs at least 20 characters." });
    await opFileCommunique(subTeam, { posture: subPosture, subject: subSubject, subjectLabel: subSubject === "SITUATION" ? "the situation" : subSubject, text: subText.trim().slice(0, 400), moodKey: pub.mood });
    await gmLog(`GM filed a communiqué on behalf of ${subTeam} (window ${pub.window.n})`);
    setSubText("");
  });

  const setDomestic = (t, key) => act("dom-" + t, async () => {

    const p = await sGet(K.pub, DEFAULT_PUB);

    await sSet(K.pub, { ...p, domestic: { ...(p.domestic || {}), [t]: key || undefined } });

  });

  const setMood = (m) => act(m, async () => {
    const p = await sGet(K.pub, DEFAULT_PUB);
    if (p.mood === m) return;
    await sSet(K.pub, { ...p, mood: m });
    await emitMoodWire(m);
  });

  const openWindow = () => act("window", async () => {
    const p = await sGet(K.pub, DEFAULT_PUB);
    if (p.window.n >= TOTAL_WINDOWS) return;
    await sSet(K.pub, { ...p, window: { n: p.window.n + 1, open: true, endsAt: Date.now() + WINDOW_MINUTES * 60000, penalized: p.window.penalized || [] } });
  });
  const closeWindow = () => act("closewin", async () => {
    const p = await sGet(K.pub, DEFAULT_PUB);
    const cm = await sGet(K.comms, []);
    const n = p.window.n;
    const filed = new Set(cm.filter((c) => c.window === n).map((c) => c.team));
    const cred = { ...p.cred };
    const missed = [];
    TEAMS.forEach((t) => {
      if (!filed.has(t)) { cred[t] = Math.max(0, (cred[t] ?? S.scoring.startCred) - MISSED_FILING_PENALTY); missed.push(t); }
    });
    await sSet(K.pub, { ...p, cred, window: { ...p.window, open: false, endsAt: null } });
    if (missed.length) {
      const inj = await sGet(K.injects, []);
      await sSet(K.injects, [...inj, {
        id: `W${n}-${Date.now()}`, tag: PD.pressRoomTag,
        title: `Window ${n} closes — silence noted`,
        body: `${missed.join(", ")} declined to comment. Correspondents read the silence as weakness.`, ts: Date.now(),
      }]);
    }
  });

  const reveal = () => act("reveal", async () => {
    const f = await sGet(K.flags, DEFAULT_FLAGS);
    await sSet(K.flags, { ...f, revealed: !f.revealed });
  });
  const collapse = () => act("collapse", async () => {
    const f = await sGet(K.flags, DEFAULT_FLAGS);
    await sSet(K.flags, { ...f, collapsed: true });
  });
  const applyOverride = (c) => {
    const v = Number(override[c.id]);
    if (!Number.isFinite(v)) return;
    const clamped = Math.max(-10, Math.min(10, Math.round(v)));
    return act("ov-" + c.id, async () => {
      const delta = clamped - c.net;
      await sUpdate(K.comms, [],
        (cm) => cm.map((x) => (x.id === c.id ? { ...x, net: clamped, overridden: true } : x)),
        (cm) => cm.some((x) => x.id === c.id && x.net === clamped));
      const p = await sGet(K.pub, DEFAULT_PUB);
      const cred = { ...p.cred };
      cred[c.team] = Math.max(0, Math.min(100, (cred[c.team] ?? S.scoring.startCred) + delta));
      const sentiment = { ...p.sentiment };
      if (c.subject && c.subject.type === "prop") {
        const cur = sentiment[c.subject.id] ?? 50;
        const w = (cred[c.team] ?? S.scoring.startCred) / 100;
        sentiment[c.subject.id] = Math.max(0, Math.min(100,
          cur + Math.round(delta * w * (c.subject.stance === "for" ? 1 : -1))));
      }
      await sSet(K.pub, { ...p, cred, sentiment });
      setOverride((o) => ({ ...o, [c.id]: "" }));
    });
  };
  const runBench = () => act("bench", async () => {
    setBenchResult({ pending: true });
    try {
      const ex = await sGet(K.exemplars, []);
      const sx = await scoreCommunique({ team: TEAMS[0], posture: benchPosture,
        subjectLabel: "the situation", text: benchText.trim(), moodKey: pub.mood, exemplars: ex });
      setBenchResult({ sx, ...explainNet(sx, benchPosture, pub.mood) });
    } catch (e) { setBenchResult({ error: String(e.message || e) }); }
  });
  const addExemplar = () => act("ex", async () => {
    const id = `X-${Date.now()}`;
    const rec = { id, text: exForm.text.trim(), e: +exForm.e, l: +exForm.l, p: +exForm.p, ad: !!exForm.ad, note: exForm.note.trim() };
    await sUpdate(K.exemplars, [],
      (xs) => (xs.some((x) => x.id === id) ? xs : [...xs, rec].slice(-8)),
      (xs) => xs.some((x) => x.id === id));
    setExemplars(await sGet(K.exemplars, []));
    setExForm({ text: "", e: 3, l: 3, p: 3, ad: false, note: "" });
  });
  const dropExemplar = (id) => act("exdel", async () => {
    await sUpdate(K.exemplars, [], (xs) => xs.filter((x) => x.id !== id), (xs) => !xs.some((x) => x.id === id));
    setExemplars(await sGet(K.exemplars, []));
  });
  const postAnnouncement = () => {
    if (!annText.trim()) return;
    return act("announce", async () => {
      const aid = `A-${Date.now()}`;
      await sUpdate(K.ann, [],
        (a) => (a.some((x) => x.id === aid) ? a : [...a, { id: aid, text: annText.trim(), ts: Date.now(), ttlMs: annMin > 0 ? annMin * 60 * 1000 : null }]),
        (a) => a.some((x) => x.id === aid));
      setAnnText("");
    }, annMin > 0 ? `Announcement pinned for ${annMin} min` : "Announcement pinned until cleared");
  };
  const clearAnnouncement = () => act("clearAnnounce", async () => {
    const cid = `CLR-${Date.now()}`;
    await sUpdate(K.ann, [], (a) => (a.some((x) => x.id === cid) ? a : [...a, { id: cid, clear: true, ts: Date.now() }]), (a) => a.some((x) => x.id === cid));
  }, "Announcement cleared");
  const replyGm = (team) => {
    const text = (gmReplies[team] || "").trim();
    if (!text) return;
    return act("gm-" + team, async () => {
      const mid = `gm-${Date.now()}`;
      await sUpdate(gmKey(team), [],
        (m) => (m.some((x) => x.id === mid) ? m : [...m, { id: mid, from: "gm", text, ts: Date.now() }]),
        (m) => m.some((x) => x.id === mid));
      setGmReplies((r) => ({ ...r, [team]: "" }));
      const entries = await Promise.all(TEAMS.map(async (t) => [t, await sGet(gmKey(t), [])]));
      setGmThreads(Object.fromEntries(entries));
    });
  };
  const resetAll = (confirmed) => {
    if (!confirmed) { setConfirmReset(true); return; }
    setConfirmReset(false);
    return act("reset", async () => {
      /* One atomic write instead of nine sequential ones: fewer requests
         against the rate limiter, and no window in which the game is half-reset. */
      await writeDoc((d) => {
        d[K.clock] = DEFAULT_CLOCK; d[K.props] = []; d[K.endo] = {};
        d[K.injects] = []; d[K.flags] = DEFAULT_FLAGS; d[K.pub] = DEFAULT_PUB;
        d[K.comms] = []; d[K.ann] = []; d[K.ai] = DEFAULT_AI;
        return d;
      });
      aiMem.current = {};
      setSeatLocal({});
      await writeDoc((d) => { for (const t of TEAMS) d[gmKey(t)] = []; return d; });
    });
  };

  const firedIds = new Set(injects.map((j) => String(j.id).split("-")[0]));

  return (
    <div className="min-h-screen p-6" style={{ background: PAPER, color: CHARCOAL, fontFamily: BODY_FONT }}>
      {gmNote && (
        <div className="fixed left-1/2 z-50 px-4 py-2 rounded font-bold text-sm" role="status"
          style={{ top: 12, transform: "translateX(-50%)", background: gmNote.kind === "err" ? RED : CHARCOAL, color: gmNote.kind === "err" ? PAPER : GOLD, fontFamily: BODY_HI, maxWidth: "90vw" }}>
          {gmNote.kind === "err" ? "✕ " : "✓ "}{gmNote.text}
        </div>
      )}
      {busy && (
        <div className="fixed right-4 z-50 px-3 py-1 rounded text-xs" style={{ top: 12, background: LIGHTGOLD, color: CHARCOAL, fontFamily: MONO_FONT }}>working: {busy}…</div>
      )}
      <div className="flex justify-between items-baseline mb-1">
        <div><Wordmark h="24px" /> <span className="text-sm opacity-60 ml-2">Facilitator Console · {S.meta.title}</span></div>
        <div className="text-right">
          <div className="text-3xl font-bold tabular-nums" style={{ color: rem < 600000 ? RED : CHARCOAL }}>{fmt(rem)}</div>
          <span className="inline-flex items-center gap-3">
            {designer && <button onClick={async () => { try { await window.storage.delete("pz-designer", false); } catch {} setDesigner(false); note("Designer view off on this account. Enter the designer key again to restore it."); }}
              className="px-2 py-1 rounded text-xs" style={{ background: PLATE, color: RED, fontFamily: MONO_FONT }} title="Hide scoring detail on this account">designer view · off</button>}
            <TextSize /><SyncDot sync={sh.sync} />
          </span>
        </div>
      </div>
      <GoldRule />
      {game && <PlayersPanel game={game} aiCtl={{ ...aiCtl, ...seatLocal }} />}

      {/* v1.5 — COMMAND PANEL: everything the GM touches during play, above the fold */}
      <div className="mt-3 p-4 rounded" style={{ background: PLATE }}>
        <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
          <div>
            <div className="text-xs pz-label mb-1" style={{ opacity: 0.7 }}>{S.meta.clockLabel}</div>
            <div className="text-5xl tabular-nums pz-fig" style={{ color: rem < 10 * 60 * 1000 ? RED : CHARCOAL, lineHeight: 1 }}>{fmt(rem)}</div>
            <div className="text-xs mt-1" style={{ fontFamily: MONO_FONT, color: clock.running ? GREEN : RED }}>{flags.paused ? "SESSION PAUSED" : clock.running ? "RUNNING" : "STOPPED"}</div>
            {(() => { const n = TEAMS.filter((t) => { const th = gmThreads[t] || []; const lt = [...th].reverse().find((m) => m.from === "team"); return lt && !th.some((m) => m.from === "gm" && m.ts > lt.ts); }).length;
              return n > 0 ? <a href="#pz-messages" className="inline-block mt-2 px-2 py-1 rounded text-xs font-bold" style={{ background: RED, color: PAPER, fontFamily: BODY_HI }}>● {n} delegation{n > 1 ? "s" : ""} awaiting your reply</a> : null; })()}
          </div>
          <div>
      <h3 className="font-bold tracking-wide mb-2" style={{ fontFamily: HEAD_FONT, letterSpacing: "0.06em" }}>CLOCK</h3>
      <div className="flex flex-wrap gap-2">
        {[["Start", start], ["Pause", pause], ["+5 min", () => nudge(5)], ["−5 min", () => nudge(-5)], [`Reset ${deadlineMinutes()}:00`, () => clockSet(DEFAULT_CLOCK)]].map(([l, f]) => (
          <button key={l} onClick={() => act(l, f)} disabled={!!busy}
            className="px-3 py-2 rounded font-bold text-sm" style={{ background: CHARCOAL, color: PAPER }}>{l}</button>
        ))}
      </div>
          </div>
          <div>
      <h3 className="font-bold tracking-wide mt-6 mb-2">PRESS WINDOWS ({pub.window.n}/{TOTAL_WINDOWS} used)</h3>
      <div className="flex gap-2">
        <button onClick={openWindow} disabled={!!busy || winOpen || pub.window.n >= TOTAL_WINDOWS}
          className="px-3 py-2 rounded font-bold text-sm" style={{ background: CHARCOAL, color: PAPER, fontFamily: BODY_HI }}>
          Open window {Math.min(pub.window.n + 1, TOTAL_WINDOWS)}
        </button>
        <button onClick={closeWindow} disabled={!!busy || !pub.window.open}
          className="px-3 py-2 rounded font-bold text-sm" style={{ background: CHARCOAL, color: PAPER }}>
          Close window (penalize non-filers)
        </button>
      </div>
      {winOpen && <div className="text-sm mt-1 font-bold" style={{ color: RED }}>Window {pub.window.n} open — {fmt(pub.window.endsAt - now)} left. Close it manually when time expires.</div>}

          </div>
          <div>
      {/* ---- Session: pause / resume / export / restore ---- */}
      <h3 className="font-bold tracking-wide mb-2" style={{ fontFamily: HEAD_FONT, letterSpacing: "0.06em" }}>SESSION {flags.paused && <span className="text-xs px-2 py-1 rounded ml-2" style={{ background: RED, color: PAPER }}>PAUSED — team consoles locked</span>}</h3>
      <div className="flex flex-wrap gap-2 mb-6 items-center">
        {game?.status === "completed" ? null : flags.paused
          ? <button onClick={resumeSession} disabled={!!busy} aria-busy={busy === "resumeSession" ? "true" : "false"} className="px-3 py-2 rounded font-bold text-sm" style={{ background: GREEN, color: PAPER }}>▶ Resume session</button>
          : <button onClick={pauseSession} disabled={!!busy} aria-busy={busy === "pauseSession" ? "true" : "false"} className="px-3 py-2 rounded font-bold text-sm" style={{ background: RED, color: PAPER }}>❚❚ Pause session (locks all teams)</button>}
        <button onClick={exportSession} disabled={!!busy} className="px-3 py-2 rounded font-bold text-sm" style={{ background: CHARCOAL, color: PAPER, fontFamily: BODY_HI }}>
          Export full session (JSON)
        </button>
        {game && game.status !== "completed" && <>
          <button onClick={pauseForNextClass} disabled={!!busy} aria-busy={busy === "pauseForNextClass" ? "true" : "false"}
            className="px-3 py-2 rounded font-bold text-sm" style={{ background: GOLD, color: CHARCOAL, fontFamily: BODY_HI }}>❚❚ Pause for next class</button>
          <button onClick={() => setConfirmEnd(true)} disabled={!!busy} aria-busy={busy === "endGame" ? "true" : "false"}
            className="px-3 py-2 rounded font-bold text-sm" style={{ background: PLATE, color: RED, fontFamily: BODY_HI, border: `1px solid ${RED}` }}>End game</button>
        </>}
        {game?.status === "completed" && <span className="text-sm font-bold" style={{ color: RED }}>This game has ended — results are read-only.</span>}
      </div>
      {game && game.status !== "completed" && flags.paused && (
        <div className="text-sm mb-4 -mt-4" style={{ color: GREEN }}>Students can rejoin now. Press <b>Resume session</b> when everyone is back in.</div>
      )}
      {exportText != null && (
        <div className="p-3 rounded mb-4" style={{ background: PLATE }}>
          <div className="text-xs pz-label mb-2" style={{ opacity: 0.7 }}>SESSION EXPORT · {S.meta.id} · {new Date().toLocaleString()}</div>
          <div className="flex flex-wrap gap-2 mb-2">
            <button onClick={copyExport} className="px-3 py-2 rounded font-bold text-sm" style={{ background: CHARCOAL, color: PAPER, fontFamily: BODY_HI }}>Copy to clipboard</button>
            <button onClick={openExportTab} className="px-3 py-2 rounded font-bold text-sm" style={{ background: CHARCOAL, color: PAPER, fontFamily: BODY_HI }}>Open in new tab</button>
            <button onClick={() => setExportText(null)} className="px-3 py-2 rounded text-sm" style={{ background: PLATE, color: CHARCOAL }}>Close</button>
          </div>
          <textarea readOnly value={exportText} onFocus={(e) => e.target.select()} className="w-full text-xs p-2 rounded" rows={6}
            style={{ fontFamily: MONO_FONT, background: "white", color: CHARCOAL, border: 0 }} />
          <div className="text-xs opacity-70 mt-1">Paste into any text file and save it as <b>.json</b>. To play on from it later, choose <b>New game</b> on your dashboard and pick this file.</div>
        </div>
      )}
      <div className="text-xs opacity-70 mb-2" style={{ maxWidth: 520 }}>Pause session is for a short break: it locks every team console and suspends the clock and press window. At the end of class use Pause for next class; the game is saved and resumes from your dashboard. Export keeps a copy for the debrief.</div>

          </div>
          <div>
      <h3 className="font-bold tracking-wide mt-6 mb-2">GAME CONTROL</h3>
      <div className="flex flex-wrap gap-2">
        <button onClick={reveal} disabled={!!busy} className="px-3 py-2 rounded font-bold text-sm" style={{ background: CHARCOAL, color: PAPER, fontFamily: BODY_HI }}>
          {flags.revealed ? "Hide scores" : "Reveal scores (debrief)"}
        </button>
        <button onClick={collapse} disabled={!!busy || !!flags.adoptedId} className="px-3 py-2 rounded font-bold text-sm" style={{ background: RED, color: PAPER }}>
          Declare collapse
        </button>
        <button onClick={() => setConfirmReset(true)} disabled={!!busy} className="px-3 py-2 rounded font-bold text-sm"
          style={{ background: PLATE, color: RED, fontFamily: BODY_HI }}>Reset game</button>
        {confirmEnd && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(16,19,20,0.75)" }} onClick={() => setConfirmEnd(false)}>
            <div className="p-5 rounded max-w-md" style={{ background: PAPER, color: CHARCOAL }} onClick={(e) => e.stopPropagation()}>
              <div className="font-bold text-lg mb-2" style={{ fontFamily: HEAD_FONT, letterSpacing: "0.04em" }}>END THIS GAME?</div>
              <div className="text-sm mb-4">The clock stops for good and nobody can make further moves. Students keep read-only access to the results, and the code <b>{game?.code.toUpperCase()}</b> is released. To continue in a later class instead, use <b>Pause for next class</b>.</div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setConfirmEnd(false)} className="px-3 py-2 rounded font-bold text-sm" style={{ background: PLATE, color: CHARCOAL, fontFamily: BODY_HI }}>Cancel</button>
                <button onClick={() => { setConfirmEnd(false); endGame(); }} className="px-3 py-2 rounded font-bold text-sm" style={{ background: RED, color: PAPER, fontFamily: BODY_HI }}>Yes, end the game</button>
              </div>
            </div>
          </div>
        )}
        {confirmReset && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(16,19,20,0.75)" }} onClick={() => setConfirmReset(false)}>
            <div className="p-5 rounded max-w-md" style={{ background: PAPER, color: CHARCOAL }} onClick={(e) => e.stopPropagation()}>
              <div className="font-bold text-lg mb-2" style={{ fontFamily: HEAD_FONT, letterSpacing: "0.04em" }}>RESET THE WHOLE GAME?</div>
              <div className="text-sm mb-4">Every draft, endorsement, filing, score, inject and message will be erased on every device, and the clock returns to the start. This cannot be undone. If you want to keep a record, export the session first.</div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setConfirmReset(false)} className="px-3 py-2 rounded font-bold text-sm" style={{ background: PLATE, color: CHARCOAL, fontFamily: BODY_HI }}>Cancel</button>
                <button onClick={() => { setConfirmReset(false); resetAll(true); }} className="px-3 py-2 rounded font-bold text-sm" style={{ background: RED, color: PAPER, fontFamily: BODY_HI }}>Yes, reset everything</button>
              </div>
            </div>
          </div>
        )}
      </div>

          </div>
        </div>
      </div>

      {INTEGRITY.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer" style={{ color: INTEGRITY.some((f) => f.level === "hard") ? RED : "#a07800" }}>
            ◆ Scenario integrity: {INTEGRITY.filter((f) => f.level === "hard").length} hard, {INTEGRITY.filter((f) => f.level === "advisory").length} advisory — cartridge checks, for authoring; open to read
          </summary>
          <div className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
            {INTEGRITY.map((f, i) => (
              <div key={i}><b style={{ color: f.level === "hard" ? RED : "#a07800" }}>{f.level.toUpperCase()}</b> — {f.text}</div>
            ))}
          </div>
        </details>
      )}

      {(() => {
        const adoptedP = flags.adoptedId ? props.find((p) => p.id === flags.adoptedId) : null;
        const leadP = leadingProposal(props, endo);
        const basis = adoptedP || (leadP && leadP.p);
        const collapsed = flags.collapsed || (!adoptedP && rem === 0 && clock.endsAt);
        const rows = TEAMS.map((t) => {
          const cred = pub.cred[t] ?? S.scoring.startCred;
          const deal = basis ? dealPct(t, basis.terms, !!adoptedP) : 0;
          const final = collapsed && !adoptedP
            ? Math.round(S.scoring.dealWeight * noDealPct(t) + S.scoring.credWeight * cred)
            : basis ? Math.round(S.scoring.dealWeight * deal + S.scoring.credWeight * cred) : 0;
          return { t, cred, deal, final };
        }).sort((a, b) => b.final - a.final || b.cred - a.cred);
        const credRank = [...rows].sort((a, b) => b.cred - a.cred);
        const status = adoptedP ? `ADOPTED — ${adoptedP.team} draft`
          : collapsed ? "COLLAPSED — NO AGREEMENT"
          : basis ? `IN PROGRESS — scored against the leading draft (${basis.team})`
          : "IN PROGRESS — no proposals tabled";
        return (
          <div className="mt-4 p-3 rounded" style={{ background: CHARCOAL, color: PAPER }}>
            <div className="flex justify-between items-baseline mb-2">
              <span className="font-bold tracking-widest text-sm" style={{ color: GOLD }}>◆ STANDINGS</span>
              <span className="text-xs" style={{ color: collapsed && !adoptedP ? "#ff8a70" : PAPER }}>{status}</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs tracking-widest pz-label mb-1" style={{ color: GOLD }}>FINAL SCORE ({DEAL_W_PCT}% deal + {CRED_W_PCT}% credibility)</div>
                {rows.map((r, i) => (
                  <div key={r.t} className="flex items-center gap-2 py-0.5 border-b" style={{ borderColor: "#3a4142" }}>
                    <span className="w-5 font-bold">{i + 1}</span>
                    <span>{FLAGS[r.t]}</span>
                    <span className="flex-1 text-sm">{r.t}{MEDIATORS.includes(r.t) && <span className="opacity-60 text-xs"> (med)</span>}</span>
                    <span className="text-xs opacity-60" style={{ fontFamily: MONO_FONT }}>deal {r.deal} · cred {r.cred}</span>
                    <span className="w-10 text-right font-bold text-lg" style={{ fontFamily: MONO_FONT, color: i === 0 ? GOLD : PAPER }}>{r.final}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-xs tracking-widest pz-label mb-1" style={{ color: GOLD }}>PUBLIC DIPLOMACY (credibility only)</div>
                {credRank.map((r, i) => (
                  <div key={r.t} className="flex items-center gap-2 py-0.5 border-b" style={{ borderColor: "#3a4142" }}>
                    <span className="w-5 font-bold">{i + 1}</span>
                    <span>{FLAGS[r.t]}</span>
                    <span className="flex-1 text-sm">{r.t}</span>
                    <span className="w-10 text-right font-bold text-lg" style={{ fontFamily: MONO_FONT, color: r.cred >= 50 ? GOLD : "#ff8a70" }}>{r.cred}</span>
                  </div>
                ))}
                <div className="text-xs opacity-60 mt-1">Filings: {TEAMS.map((t) => `${t} ${comms.filter((c) => c.team === t).length}`).join(" · ")}</div>
              </div>
            </div>
            {collapsed && !adoptedP && (
              <div className="text-xs mt-2 italic" style={{ color: "#ff8a70" }}>
                No deal: all final scores are zero. The credibility column still shows who won the public argument — use it in the debrief.
              </div>
            )}
          </div>
        );
      })()}

      {/* v1.5 — Play controls, full width: injects and messages are what the GM touches most */}
      <div className="grid md:grid-cols-2 gap-6 mt-5">
        <div id="pz-injects">
          <h3 className="font-bold tracking-wide mb-2" style={{ fontFamily: HEAD_FONT, letterSpacing: "0.06em" }}>FILINGS <span className="font-normal text-xs opacity-60">(newest first{designer ? "; tap one for the scoring detail" : ""})</span></h3>
<div className="space-y-1 max-h-96 overflow-y-auto text-sm pr-1">
            {[...comms].reverse().map((c) => {
              const ex = c.scored && c.sx ? explainNet(c.sx, c.posture, pub.mood) : null;
              const isOpen = openSx === c.id;
              return (
                <div key={c.id} className="border-b py-1" style={{ borderColor: LIGHTGOLD }}>
                  <div onClick={() => designer && setOpenSx(isOpen ? null : c.id)} style={{ cursor: designer ? "pointer" : "default" }}>
                    <b>{FLAGS[c.team]} {c.team}</b> · W{c.window || "—"} · {c.posture} · re {c.subjectLabel}
                    {c.revisionOf && <b style={{ color: RED }}> (rev)</b>}{c.superseded && <span className="opacity-60"> (superseded)</span>}{c.scored ? <span style={{ fontFamily: MONO_FONT }}>{designer && c.sx ? <> — E{c.sx.e} L{c.sx.l} P{c.sx.p}</> : " —"}{designer && c.sx && c.sx.rel != null && ` R${c.sx.rel}`}{c.sx && c.sx.ad_hominem && (designer ? " ⚠AH" : " ⚠ personal attack")} → net {c.net > 0 ? "+" : ""}{c.net}{c.overridden && " (adjusted)"}</span> : " — scoring…"}
                    <div className="text-xs opacity-70">“{c.text}”</div>
                  </div>
                  {!designer && c.scored && !c.superseded && c.read && <div className="text-xs mt-0.5 opacity-80">{c.read}</div>}
                  {designer && isOpen && c.scored && ex && (
                    <div className="mt-1 p-2 rounded text-xs" style={{ background: LIGHTGOLD }}>
                      {ex.steps.map(([label, note, val], i) => (
                        <div key={i} className="flex justify-between border-b py-0.5" style={{ borderColor: "#e8d9a8" }}>
                          <span>{label}{note ? ` — ${note}` : ""}</span>
                          <b style={{ fontFamily: MONO_FONT }}>{val > 0 ? "+" : ""}{val}</b>
                        </div>
                      ))}
                      <div className="flex justify-between pt-1 font-bold">
                        <span>Credibility change applied</span>
                        <span style={{ fontFamily: MONO_FONT }}>{c.net > 0 ? "+" : ""}{c.net}</span>
                      </div>
                      <div className="flex gap-1 items-center mt-2">
                        <span className="opacity-70">Override net:</span>
                        <input value={override[c.id] ?? ""} onChange={(e) => setOverride((o) => ({ ...o, [c.id]: e.target.value }))}
                          placeholder="-10..10" className="w-20 px-1 py-0.5 rounded border" style={{ borderColor: CHARCOAL, background: "white" }} />
                        <button onClick={() => applyOverride(c)} disabled={!!busy}
                          className="px-2 py-0.5 rounded font-bold" style={{ background: CHARCOAL, color: GOLD }}>Apply</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {comms.length === 0 && <div className="opacity-60 italic">No communiqués filed yet.</div>}
          </div>

          <h3 className="font-bold tracking-wide mb-2" style={{ fontFamily: HEAD_FONT, letterSpacing: "0.06em" }}>INJECT LIBRARY <span className="font-normal text-xs opacity-60">(some shift the mood automatically)</span></h3>
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {INJECT_LIB.map((j) => (
              <div key={j.id} className="p-2 rounded flex gap-3 items-start" style={{ background: firedIds.has(j.id) ? LIGHTGOLD : "white", border: `1px solid ${LIGHTGOLD}` }}>
                <button onClick={() => fire(j)} aria-busy={busy === j.id ? "true" : "false"} disabled={!!busy || firedIds.has(j.id)}
                  className="px-2 py-1 rounded text-xs font-bold shrink-0"
                  style={firedIds.has(j.id) ? { background: "#d8d2c4", color: "#6b6b6b" } : { background: CHARCOAL, color: PAPER, fontFamily: BODY_HI }}>
                  {firedIds.has(j.id) ? "SENT" : "FIRE"}</button>
                <div>
                  <div className="text-xs tracking-widest pz-label opacity-60" style={{ fontFamily: MONO_FONT }}>
                    <span className="font-bold" style={{ color: CHARCOAL, opacity: 1 }}>{j.id}</span> · {j.tag}{j.mood && ` · MOOD → ${j.mood}`}{firedIds.has(j.id) && " · SENT"}
                  </div>
                  <div className="text-sm font-bold">{j.title}</div>
                  <div className="text-xs opacity-75">{j.body}</div>
                  {j.reaction && <div className="text-xs mt-0.5" style={{ color: "#a07800" }}>Reaction: {j.reaction}</div>}
                </div>
              </div>
            ))}
          </div>

          <h3 className="font-bold tracking-wide mt-5 mb-2">CUSTOM INJECT</h3>
          <input value={customTag} onChange={(e) => setCustomTag(e.target.value)} placeholder="Tag (e.g. FLASH)"
            className="w-full mb-2 px-2 py-1.5 rounded border text-sm" style={{ borderColor: GOLD, background: "white" }} />
          <input value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} placeholder="Headline"
            className="w-full mb-2 px-2 py-1.5 rounded border text-sm" style={{ borderColor: GOLD, background: "white" }} />
          <textarea value={customBody} onChange={(e) => setCustomBody(e.target.value)} placeholder="Dispatch text" rows={3}
            className="w-full mb-2 px-2 py-1.5 rounded border text-sm" style={{ borderColor: GOLD, background: "white" }} />
          <button onClick={fireCustom} disabled={!!busy || !customTitle.trim()}
            className="px-4 py-2 rounded font-bold text-sm" style={{ background: CHARCOAL, color: PAPER }}>Send to the wire</button>

        </div>
        <div>
          <h3 className="font-bold tracking-wide mb-2">CREDIBILITY</h3>
          <div className="space-y-1.5">{TEAMS.map((t) => <CredBar key={t} team={t} val={pub.cred[t] ?? S.scoring.startCred} />)}</div>

          {/* ---- Credibility override ---- */}
          <h3 className="font-bold tracking-wide mb-2" style={{ fontFamily: HEAD_FONT, letterSpacing: "0.06em" }}>CREDIBILITY OVERRIDE <span className="font-normal text-xs opacity-60">(set an absolute value; logged)</span></h3>
          <div className="grid grid-cols-2 gap-1.5 mb-6">
            {TEAMS.map((t) => (
              <div key={t} className="flex items-center gap-2 text-sm">
                <span className="w-20 font-bold truncate">{t}</span>
                <input type="number" min="0" max="100" defaultValue={Math.round((pub.cred || {})[t] ?? S.scoring.startCred)}
                  key={`${t}-${Math.round((pub.cred || {})[t] ?? 0)}`}
                  onKeyDown={(e) => { if (e.key === "Enter") setCredAbs(t, e.currentTarget.value); }}
                  onBlur={(e) => { const v = Number(e.currentTarget.value); if (v !== Math.round((pub.cred || {})[t] ?? S.scoring.startCred)) setCredAbs(t, v); }}
                  className="w-16 px-2 py-1 rounded border text-sm" style={{ borderColor: LIGHTGOLD, fontFamily: MONO_FONT }} />
              </div>
            ))}
          </div>

          <h3 className="font-bold tracking-wide mb-2">PUBLIC MOOD <span className="font-normal text-xs opacity-60">(players see only the dispatch text, never the label)</span></h3>
          <div className="flex flex-wrap gap-2">
            {Object.keys(MOODS).map((m) => (
              <button key={m} onClick={() => setMood(m)} disabled={!!busy}
                className="px-3 py-2 rounded font-bold text-sm"
                style={pub.mood === m ? { background: CHARCOAL, color: GOLD } : { background: PLATE, color: CHARCOAL }}>
                {m}
              </button>
            ))}
          </div>
          <div className="text-xs italic mt-2 opacity-70">Current dispatch: {MOODS[pub.mood]?.dispatch}{HIDE_INTL_MOOD ? " (hidden from players — they infer it from the wire)" : ""}</div>
          {TEAMS.some((t) => domesticOf(t)) && (
            <>
              <h3 className="font-bold tracking-wide mt-6 mb-2">DOMESTIC AUDIENCES <span className="font-normal text-xs opacity-60">(each delegation sees only its own)</span></h3>
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
                {TEAMS.filter((t) => domesticOf(t)).map((t) => {
                  const d = domesticOf(t); const cur = (pub.domestic || {})[t] || "";
                  return (
                    <div key={t} className="p-2 rounded text-xs" style={{ background: PLATE }}>
                      <div className="font-bold mb-1">{FLAGS[t]} {t} — {d.label}</div>
                      <div className="flex flex-wrap gap-1 mb-1">
                        <button onClick={() => setDomestic(t, "")} disabled={!!busy} className="px-2 py-1 rounded font-bold"
                          style={!cur ? { background: CHARCOAL, color: GOLD } : { background: PLATE, color: CHARCOAL }}>baseline</button>
                        {Object.keys(d.moods || {}).map((k2) => (
                          <button key={k2} onClick={() => setDomestic(t, k2)} disabled={!!busy} className="px-2 py-1 rounded font-bold"
                            style={cur === k2 ? { background: CHARCOAL, color: GOLD } : { background: PLATE, color: CHARCOAL }}>{k2}</button>
                        ))}
                      </div>
                      <div className="italic opacity-70">{domesticMoodText(t, cur)}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-6 mt-2">
        <div id="pz-messages">
          <h3 className="font-bold tracking-wide mb-2">GAMEMASTER MESSAGES <span className="font-normal text-xs opacity-60">(private, per delegation)</span></h3>
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {TEAMS.map((t) => {
              const th = gmThreads[t] || [];
              const lastTeamMsg = [...th].reverse().find((m) => m.from === "team");
              const awaiting = lastTeamMsg && !th.some((m) => m.from === "gm" && m.ts > lastTeamMsg.ts);
              return (
                <div key={t} className="p-2 rounded" style={{ background: awaiting ? LIGHTGOLD : "white", border: `1px solid ${LIGHTGOLD}` }}>
                  <div className="text-sm font-bold">{FLAGS[t]} {t} {awaiting && <span style={{ color: RED }}>● awaiting reply</span>}</div>
                  {th.slice(-3).map((m) => (
                    <div key={m.id} className="text-xs py-0.5">
                      <b>{m.from === "gm" ? "You" : t}:</b> {m.text}
                    </div>
                  ))}
                  {th.length === 0 && <div className="text-xs italic opacity-60">No messages.</div>}
                  <div className="flex gap-1 mt-1">
                    <input value={gmReplies[t] || ""} onChange={(e) => setGmReplies((r) => ({ ...r, [t]: e.target.value.slice(0, 500) }))}
                      placeholder="Reply…" className="flex-1 px-2 py-1 rounded border text-xs" style={{ borderColor: GOLD, background: "white" }} />
                    <button onClick={() => replyGm(t)} disabled={!!busy || !(gmReplies[t] || "").trim()}
                      className="px-2 py-1 rounded text-xs font-bold" style={{ background: CHARCOAL, color: GOLD }}>Send</button>
                  </div>
                </div>
              );
            })}
          </div>

          <h3 className="font-bold tracking-wide mb-2">GAMEMASTER ANNOUNCEMENT <span className="font-normal text-xs opacity-60">(pinned on every screen; not an inject)</span></h3>
          <textarea value={annText} onChange={(e) => setAnnText(e.target.value.slice(0, 300))} rows={2}
            placeholder="e.g. Breakout rooms close in 5 minutes — return to the main hall."
            className="w-full mb-2 px-2 py-1.5 rounded border text-sm" style={{ borderColor: GOLD, background: "white" }} />
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={postAnnouncement} disabled={!!busy || !annText.trim()} aria-busy={busy === "announce" ? "true" : "false"}
              className="px-4 py-2 rounded font-bold text-sm" style={{ background: CHARCOAL, color: PAPER, fontFamily: BODY_HI }}>Post announcement</button>
            <span className="text-xs opacity-70">for</span>
            {[5, 10, 20, 0].map((m) => (
              <button key={m} onClick={() => setAnnMin(m)} className="px-2 py-1 rounded text-xs font-bold"
                style={annMin === m ? { background: CHARCOAL, color: GOLD } : { background: PLATE, color: CHARCOAL }}>{m === 0 ? "until cleared" : `${m} min`}</button>
            ))}
            <button onClick={clearAnnouncement} disabled={!!busy || !liveAnnouncement(ann, now)} aria-busy={busy === "clearAnnounce" ? "true" : "false"}
              className="px-3 py-2 rounded font-bold text-sm" style={{ background: PLATE, color: RED, fontFamily: BODY_HI }}>Clear now</button>
          </div>
          {liveAnnouncement(ann, now)
            ? <div className="text-xs italic mt-1 opacity-70">Pinned now: "{liveAnnouncement(ann, now).text}"{liveAnnouncement(ann, now).ttlMs != null ? ` — clears in ${fmt(Math.max(0, liveAnnouncement(ann, now).ts + liveAnnouncement(ann, now).ttlMs - now))}` : " — until cleared"}</div>
            : <div className="text-xs italic mt-1 opacity-70">Nothing pinned.</div>}

        </div>
        <div>
          <h3 className="font-bold tracking-wide mb-2" style={{ fontFamily: HEAD_FONT, letterSpacing: "0.06em" }}>SEAT CONTROL <span className="font-normal text-xs opacity-60">(per session — AI seats play by their real matrix and act only while this console is open)</span></h3>
          <div className="grid grid-cols-2 gap-1.5 mb-6">
            {TEAMS.map((t) => (
              <SeatToggle key={t} team={t} value={seatLocal[t] ?? aiCtl[t]} onToggle={() => toggleSeat(t)} />
            ))}
          </div>

          {/* ---- AI capabilities (only shown for seats set to AI) ---- */}
          {TEAMS.some((t) => (seatLocal[t] ?? aiCtl[t]) === "ai") && (
            <div className="mb-6">
              <h3 className="font-bold tracking-wide mb-2" style={{ fontFamily: HEAD_FONT, letterSpacing: "0.06em" }}>AI SEAT CAPABILITIES <span className="font-normal text-xs opacity-60">(restrict what an AI seat may do)</span></h3>
              {TEAMS.filter((t) => (seatLocal[t] ?? aiCtl[t]) === "ai").map((t) => {
                const caps = aiCapsFor(t, (aiCtl || {}).__caps);
                return (
                  <div key={t} className="flex flex-wrap items-center gap-2 mb-1.5 text-sm">
                    <span className="w-24 font-bold">{t}</span>
                    {["table", "amend", "endorse", "speak"].map((c) => (
                      <button key={c} onClick={() => toggleCap(t, c)} disabled={!!busy}
                        className="px-2 py-1 rounded text-xs font-bold"
                        style={caps[c] ? { background: CHARCOAL, color: GOLD } : { background: "white", border: `1px solid ${CHARCOAL}`, color: CHARCOAL, opacity: 0.6 }}>
                        {c}{caps[c] ? " ✓" : " ✗"}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* ---- Endorsement override ---- */}
          {props.filter((p) => p.active).length > 0 && (
            <div className="mb-6">
              <h3 className="font-bold tracking-wide mb-2" style={{ fontFamily: HEAD_FONT, letterSpacing: "0.06em" }}>ENDORSEMENT OVERRIDE <span className="font-normal text-xs opacity-60">(force or remove any endorsement; logged. A draft adopts when every other delegation has endorsed it; the author's endorsement is implied)</span></h3>
              {orderDrafts(props.filter((p) => p.active), endo).map((p) => (
                <div key={p.id} className="mb-2 text-xs">
                  <div className="font-bold mb-1">Draft by {p.team} <span className="opacity-60" style={{ fontFamily: MONO_FONT }}>{p.id}</span>
                    {(() => { const lv = props.filter((x) => x.active); const newest = lv.length ? lv.reduce((m, x) => (x.ts > m.ts ? x : m)).id : null; const bd = draftBadge(p, endo, newest);
                      return <span className="ml-2 pz-label" style={{ letterSpacing: "0.12em", color: bd.color }}>{bd.text}</span>; })()}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {TEAMS.filter((t) => t !== p.team).map((t) => {
                      const on = typeof ((endo[p.id] || {})[t]) === "number";
                      return (
                        <button key={t} onClick={() => gmEndorse(t, p.id, !on)} disabled={!!busy}
                          className="px-2 py-1 rounded font-bold"
                          style={on ? { background: GREEN, color: "white" } : { background: "white", border: `1px solid ${CHARCOAL}`, color: CHARCOAL }}>
                          {t}{on ? " ✓" : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ---- Act as delegation (failsafe) ---- */}
          <h3 className="font-bold tracking-wide mb-2" style={{ fontFamily: HEAD_FONT, letterSpacing: "0.06em" }}>ACT AS DELEGATION <span className="font-normal text-xs opacity-60">(failsafe — every action is logged as GM-substituted)</span></h3>
          <div className="p-3 rounded mb-6" style={{ background: "white", border: `1px solid ${LIGHTGOLD}` }}>
            <div className="flex flex-wrap gap-1 mb-3">
              {TEAMS.map((t) => (
                <button key={t} onClick={() => { setSubTeam(t); const mine = props.find((p) => p.team === t && p.active); setSubDraft(mine ? mine.terms : {}); }}
                  className="px-2 py-1 rounded text-xs font-bold"
                  style={subTeam === t ? { background: CHARCOAL, color: GOLD } : { background: PAPER, border: `1px solid ${LIGHTGOLD}`, color: CHARCOAL }}>{t}</button>
              ))}
            </div>
            <div className="text-xs font-bold tracking-wide opacity-70 mb-1">TABLE / AMEND A DRAFT FOR {subTeam}</div>
            <TermForm terms={subDraft} setTerms={setSubDraft} />
            <button onClick={subTable} disabled={!!busy || !complete(subDraft) || !!flags.adoptedId}
              className="px-3 py-2 rounded font-bold text-sm mb-4" style={{ background: CHARCOAL, color: GOLD }}>
              {props.some((p) => p.team === subTeam && p.active) ? `Amend ${subTeam}'s draft` : `Table for ${subTeam}`}
            </button>
            <div className="text-xs font-bold tracking-wide opacity-70 mb-1">FILE A COMMUNIQUÉ FOR {subTeam}</div>
            <div className="flex flex-wrap gap-1 mb-1">
              {POSTURES.map((p) => (
                <button key={p} onClick={() => setSubPosture(p)} className="px-2 py-1 rounded text-xs font-bold"
                  style={subPosture === p ? { background: CHARCOAL, color: GOLD } : { background: PAPER, border: `1px solid ${LIGHTGOLD}`, color: CHARCOAL }}>{p}</button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1 mb-2">
              {["SITUATION", ...TEAMS.filter((t) => t !== subTeam)].map((sj) => (
                <button key={sj} onClick={() => setSubSubject(sj)} className="px-2 py-1 rounded text-xs"
                  style={subSubject === sj ? { background: CHARCOAL, color: GOLD } : { background: PAPER, border: `1px solid ${LIGHTGOLD}`, color: CHARCOAL }}>{sj}</button>
              ))}
            </div>
            <textarea value={subText} onChange={(e) => setSubText(e.target.value.slice(0, 400))} rows={3}
              placeholder="Statement text (20–400 characters)"
              className="w-full p-2 rounded border text-sm mb-2" style={{ borderColor: LIGHTGOLD }} />
            <button onClick={subFile} disabled={!!busy || !pub.window.open || subText.trim().length < 20}
              className="px-3 py-2 rounded font-bold text-sm" style={{ background: CHARCOAL, color: GOLD }}>
              {pub.window.open ? `File for ${subTeam}` : "No window open"}
            </button>
          </div>


        </div>
      </div>
      {designer && <details className="mt-6">
        <summary className="cursor-pointer font-bold tracking-wide" style={{ fontFamily: HEAD_FONT, letterSpacing: "0.06em" }}>CALIBRATION LAB & TEST BENCH <span className="font-normal text-xs opacity-60">(authoring tools; not used during play)</span></summary>
        <div className="mt-2">
          <h3 className="font-bold tracking-wide mt-6 mb-2">CALIBRATION LAB <span className="font-normal text-xs opacity-60">(tap a filing to see the full scoring math)</span></h3>
          <div className="text-xs mb-2 opacity-70">Current mood <b>{pub.mood}</b> — weights E×{MOODS[pub.mood]?.we} L×{MOODS[pub.mood]?.wl} P×{MOODS[pub.mood]?.wp}
            {MOODS[pub.mood]?.favored.length ? ` \u00b7 favors ${MOODS[pub.mood].favored.join(", ")}` : ""}
            {MOODS[pub.mood]?.penalized.length ? ` \u00b7 penalizes ${MOODS[pub.mood].penalized.join(", ")}` : ""}</div>

          <h3 className="font-bold tracking-wide mt-6 mb-2">TEST BENCH <span className="font-normal text-xs opacity-60">(scores a sample — affects nothing)</span></h3>
          <textarea value={benchText} onChange={(e) => setBenchText(e.target.value.slice(0, 400))} rows={3}
            placeholder="Paste or write a sample statement…"
            className="w-full mb-1 px-2 py-1.5 rounded border text-sm" style={{ borderColor: GOLD, background: "white" }} />
          <div className="flex flex-wrap gap-1 mb-2">
            {POSTURES.map((p) => (
              <button key={p} onClick={() => setBenchPosture(p)}
                className="px-2 py-1 rounded text-xs font-bold"
                style={benchPosture === p ? { background: CHARCOAL, color: GOLD } : { background: PLATE, color: CHARCOAL }}>{p}</button>
            ))}
          </div>
          <button onClick={runBench} disabled={!!busy || benchText.trim().length < 10}
            className="px-4 py-2 rounded font-bold text-sm" style={{ background: CHARCOAL, color: PAPER, fontFamily: BODY_HI }}>Score sample</button>
          {benchResult && (
            <div className="mt-2 p-2 rounded text-xs" style={{ background: LIGHTGOLD }}>
              {benchResult.pending && "Scoring…"}
              {benchResult.error && <span style={{ color: RED }}>Error: {benchResult.error}</span>}
              {benchResult.sx && (<>
                <div className="font-bold mb-1" style={{ fontFamily: MONO_FONT }}>
                  E{benchResult.sx.e} L{benchResult.sx.l} P{benchResult.sx.p}{benchResult.sx.ad_hominem && " ⚠AH"} → net {benchResult.net > 0 ? "+" : ""}{benchResult.net}
                </div>
                {benchResult.steps.map(([label, note, val], i) => (
                  <div key={i} className="flex justify-between"><span>{label}{note ? ` — ${note}` : ""}</span><b>{val > 0 ? "+" : ""}{val}</b></div>
                ))}
              </>)}
            </div>
          )}

          <h3 className="font-bold tracking-wide mt-6 mb-2">CALIBRATION EXAMPLES <span className="font-normal text-xs opacity-60">({exemplars.length}/8 — sent with every future scoring call)</span></h3>
          <div className="text-xs opacity-70 mb-2">Grade a statement yourself; the scorer is instructed to match your standard. Persists across games.</div>
          <textarea value={exForm.text} onChange={(e) => setExForm({ ...exForm, text: e.target.value.slice(0, 400) })} rows={2}
            placeholder="Statement text…" className="w-full mb-1 px-2 py-1.5 rounded border text-sm" style={{ borderColor: GOLD, background: "white" }} />
          <div className="flex gap-2 items-center mb-1 text-xs">
            {["e", "l", "p"].map((k) => (
              <label key={k} className="flex items-center gap-1">
                <b>{k.toUpperCase()}</b>
                <select value={exForm[k]} onChange={(e) => setExForm({ ...exForm, [k]: e.target.value })}
                  className="px-1 py-0.5 rounded border" style={{ borderColor: GOLD, background: "white" }}>
                  {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            ))}
            <label className="flex items-center gap-1"><input type="checkbox" checked={exForm.ad}
              onChange={(e) => setExForm({ ...exForm, ad: e.target.checked })} /> ad hominem</label>
          </div>
          <input value={exForm.note} onChange={(e) => setExForm({ ...exForm, note: e.target.value.slice(0, 200) })}
            placeholder="Why you graded it this way (optional but helps)"
            className="w-full mb-2 px-2 py-1.5 rounded border text-sm" style={{ borderColor: GOLD, background: "white" }} />
          <button onClick={addExemplar} disabled={!!busy || exForm.text.trim().length < 10}
            className="px-4 py-2 rounded font-bold text-sm" style={{ background: CHARCOAL, color: GOLD }}>Add calibration example</button>
          <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
            {exemplars.map((x) => (
              <div key={x.id} className="text-xs p-1.5 rounded flex justify-between gap-2" style={{ background: "white", border: `1px solid ${LIGHTGOLD}` }}>
                <span><b style={{ fontFamily: MONO_FONT }}>E{x.e} L{x.l} P{x.p}{x.ad ? " ⚠" : ""}</b> “{x.text.slice(0, 70)}{x.text.length > 70 ? "…" : ""}”</span>
                <button onClick={() => dropExemplar(x.id)} className="font-bold shrink-0" style={{ color: RED }}>remove</button>
              </div>
            ))}
          </div>
        </div>
      </details>}
    </div>
  );
}

/* ================= TEAM ================= */
function TermForm({ terms, setTerms }) {
  const Seg = ({ label, opts, val, onPick }) => (
    <div className="mb-3">
      <div className="text-xs font-bold tracking-wide mb-1 opacity-70">{label}</div>
      <div className="flex flex-wrap gap-1">
        {opts.map((o, i) => (
          <button key={o} onClick={() => onPick(i)}
            className="px-2.5 py-1.5 rounded text-sm font-bold"
            style={val === i ? { background: CHARCOAL, color: GOLD } : { background: PLATE, color: CHARCOAL }}>{o}</button>
        ))}
      </div>
    </div>
  );
  return (
    <div>
      {ISSUES.map((iss) => (
        <Seg key={iss.id} label={iss.label} opts={iss.options} val={terms[iss.id]}
          onPick={(i) => setTerms({ ...terms, [iss.id]: i })} />
      ))}
    </div>
  );
}

function TeamView({ team, sh, observer }) {
  const canAct = !observer;
  const { clock, props, endo, flags, pub, comms, injects, pull } = sh;
  const [tab, setTab] = useState("table");
  const [draft, setDraft] = useState(EMPTY_TERMS);
  const [calc, setCalc] = useState(EMPTY_TERMS);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [now, setNow] = useState(Date.now());
  const [posture, setPosture] = useState(null);
  const [seenWireTs, setSeenWireTs] = useState(() => Date.now());
  const [ackTs, setAckTs] = useState(() => Date.now());
  const [toasts, pushToast] = useToasts();
  const [gmMsgs, setGmMsgs] = useState([]);
  const [gmText, setGmText] = useState("");
  const [gmSeenTs, setGmSeenTs] = useState(() => Date.now());
  const [subject, setSubject] = useState(null);
  const [commText, setCommText] = useState("");

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const rem = remainingOf(clock, now);
  const liveRaw = props.filter((p) => p.active);
  const newestDraftId = liveRaw.length ? liveRaw.reduce((m, p) => (p.ts > m.ts ? p : m)).id : null;
  const live = orderDrafts(liveRaw, endo);
  const mine = live.find((p) => p.team === team);
  const adopted = !!flags.adoptedId;
  const isMed = MEDIATORS.includes(team);
  const winOpen = pub.window.open && pub.window.endsAt > now;
  const winN = pub.window.n;
  const filedThisWindow = comms.some((c) => c.team === team && c.window === winN);
  /* v1.5 — revision eligibility: my latest scored, unsuperseded, non-revision filing, within the window */
  const [revising, setRevising] = useState(null);
  /* The countdown starts when this device first displays the press read, so
     grading latency and clock differences between devices never eat the window. */
  const seenRef = React.useRef({});
  const revisable = REVISION ? [...comms].reverse().find((c) => {
    if (!(c.team === team && c.scored && !c.superseded && !c.revisionOf && !comms.some((r) => r.revisionOf === c.id))) return false;
    if (!seenRef.current[c.id]) seenRef.current[c.id] = now;
    if (revising === c.id) return true;                       // already revising: no countdown, only the window
    return (now - seenRef.current[c.id]) < REVISION.seconds * 1000;
  }) : null;
  const revisionLeft = revisable && revising !== revisable.id ? Math.max(0, Math.ceil((seenRef.current[revisable.id] + REVISION.seconds * 1000 - now) / 1000)) : 0;
  /* Typing time is bounded by the press window, not the decision countdown. */
  useEffect(() => { if (revising && (!revisable || !winOpen)) { setRevising(null); } }, [revising, revisable, winOpen]);
  const myCred = pub.cred[team] ?? S.scoring.startCred;
  const seenInj = new Set();
  const dedupedInj = injects.filter((j) => {
    const base = String(j.id).split("-")[0];
    if (seenInj.has(base)) return false;
    seenInj.add(base); return true;
  });
  const wireItems = [...dedupedInj.map((j) => ({ ...j, kind: "inject" })),
    ...comms.filter((c) => c.scored && c.team !== team).map((c) => ({ ...c, kind: "comm" }))].sort((a, b) => b.ts - a.ts);
  const unseenCount = wireItems.filter((w) => w.ts > seenWireTs).length;
  const unackedInjects = S.mechanics.injectAckRequired
    ? dedupedInj.filter((j) => j.ts > ackTs && !j.floor).sort((a, b) => b.ts - a.ts)
    : [];
  const seatIsAi = (sh.aiCtl || {})[team] === "ai";
  const { ann } = sh;

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const m = await sGet(gmKey(team), []);
      if (alive) setGmMsgs(m);
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [team]);
  const gmUnread = gmMsgs.filter((m) => m.from === "gm" && m.ts > gmSeenTs).length;

  /* Event notifications (chime + toast) */
  const lastInjectTs = injects.length ? Math.max(...injects.map((j) => j.ts)) : 0;
  const prevInjectTs = React.useRef(lastInjectTs);
  useEffect(() => {
    if (lastInjectTs > prevInjectTs.current) { SOUNDS.inject(); pushToast("◆ NEWS ON THE WIRE", GOLD); }
    prevInjectTs.current = lastInjectTs;
  }, [lastInjectTs, pushToast]);

  const otherComms = comms.filter((c) => c.scored && c.team !== team);
  /* Proposal alerts: any change to the set of live drafts (tabled, amended, withdrawn) by another team. */
  const propSig = props.filter((p) => p.active && p.team !== team).map((p) => `${p.id}:${p.ts || 0}`).join("|");
  const prevPropSig = React.useRef(propSig);
  useEffect(() => {
    if (prevPropSig.current !== propSig && prevPropSig.current !== "") {
      const before = new Set(prevPropSig.current.split("|").filter(Boolean).map((s) => s.split(":")[0]));
      const after = props.filter((p) => p.active && p.team !== team);
      const added = after.find((p) => !before.has(p.id));
      SOUNDS.inject();
      pushToast(added ? `◆ ${added.team.toUpperCase()} TABLED A DRAFT` : "◆ A DRAFT ON THE TABLE CHANGED", GOLD);
    }
    prevPropSig.current = propSig;
  }, [propSig, pushToast, props, team]);

  const lastCommTs = otherComms.length ? Math.max(...otherComms.map((c) => c.ts)) : 0;
  const prevCommTs = React.useRef(lastCommTs);
  useEffect(() => {
    if (lastCommTs > prevCommTs.current) {
      const c = otherComms.find((x) => x.ts === lastCommTs);
      SOUNDS.comm(); pushToast(`◆ ${c ? c.team.toUpperCase() : "A DELEGATION"} ISSUES A COMMUNIQUÉ`, LIGHTGOLD);
    }
    prevCommTs.current = lastCommTs;
  }, [lastCommTs, pushToast, otherComms]);

  const winState = `${pub.window.n}-${pub.window.open ? "o" : "c"}`;
  const prevWin = React.useRef(winState);
  useEffect(() => {
    const [pn, ps] = prevWin.current.split("-");
    const [cn, cs] = winState.split("-");
    if (prevWin.current !== winState) {
      if (cs === "o") { SOUNDS.windowOpen(); pushToast(`◆ PRESS WINDOW ${cn} IS OPEN — FILE YOUR COMMUNIQUÉ`, GOLD); }
      else if (ps === "o" && cs === "c") { SOUNDS.windowClose(); pushToast(`◆ PRESS WINDOW ${pn} HAS CLOSED`, RED); }
    }
    prevWin.current = winState;
  }, [winState, pushToast]);

  const lastAnnTs = ann.length ? Math.max(0, ...ann.filter((a) => !a.gm && !a.clear).map((a) => a.ts)) : 0;
  const prevAnnTs = React.useRef(lastAnnTs);
  useEffect(() => {
    if (lastAnnTs > prevAnnTs.current) { SOUNDS.announce(); pushToast("◆ GAMEMASTER ANNOUNCEMENT — SEE TOP OF SCREEN", GOLD); }
    prevAnnTs.current = lastAnnTs;
  }, [lastAnnTs, pushToast]);

  const lastGmTs = gmMsgs.length ? Math.max(...gmMsgs.filter((m) => m.from === "gm").map((m) => m.ts), 0) : 0;
  const prevGmTs = React.useRef(lastGmTs);
  useEffect(() => {
    if (lastGmTs > prevGmTs.current) { SOUNDS.gm(); pushToast("◆ THE GAMEMASTER HAS REPLIED", LIGHTGOLD); }
    prevGmTs.current = lastGmTs;
  }, [lastGmTs, pushToast]);

  /* Pending-reconfirmation notification: a draft I endorsed was amended */
  const myPendingIds = live.filter((p) => pendingList(endo, p.id).includes(team)).map((p) => p.id).join(",");
  const prevPending = React.useRef(myPendingIds);
  useEffect(() => {
    if (myPendingIds && myPendingIds !== prevPending.current) {
      pushToast("◆ A DRAFT YOU ENDORSED WAS AMENDED — REAFFIRM OR WITHDRAW", LIGHTGOLD);
    }
    prevPending.current = myPendingIds;
  }, [myPendingIds, pushToast]);

  const act = async (fn, okMsg) => {
    setBusy(true); setMsg("");
    try { await fn(); await pull(); if (okMsg) setMsg(okMsg); }
    catch (e) { setMsg(e && e.friendly ? e.friendly : "Something went wrong — try again."); }
    setBusy(false);
  };

  const submit = () => {
    const reconfirm = S.mechanics.amendmentPolicy === "reconfirm";
    return act(async () => {
      const r = await opSubmitDraft(team, draft);
      if (!r.ok && r.reason === "table-full") {
        throw Object.assign(new Error("full"), { friendly: `The table is full (${MAX_LIVE_DRAFTS} drafts max). Endorse a draft, or persuade its author to amend.` });
      }
    }, mine
      ? (reconfirm ? "Draft amended — endorsers have been asked to reaffirm." : "Draft amended — previous endorsements cleared.")
      : "Proposal tabled.");
  };

  const endorse = (pid, on) => act(async () => {
    await opEndorse(team, pid, on);
  }, on ? "Endorsement recorded." : "Endorsement withdrawn.");

  const subjectLabelOf = (s, ps) => {
    if (!s) return "";
    if (s.type === "general") return "the situation";
    if (s.type === "team") return `the ${s.team} delegation`;
    const p = ps.find((x) => x.id === s.id);
    return `${s.stance === "for" ? "IN SUPPORT OF" : "AGAINST"} the ${p ? p.team : "?"} draft`;
  };

  const fileCommunique = () => act(async () => {
    const label = subjectLabelOf(subject, props);
    const payload = { posture, subject, subjectLabel: label, text: commText.trim(), moodKey: pub.mood, revisionOf: revising || undefined };
    setCommText(""); setPosture(null); setSubject(null); setRevising(null);
    await opFileCommunique(team, payload);
  }, revising ? "Revised statement filed. The press pool is re-reading…" : "Communiqué filed. The press pool is reading…");
  const sendGm = () => act(async () => {
    const mid = `${team}-${Date.now()}`;
    await sUpdate(gmKey(team), [],
      (m) => (m.some((x) => x.id === mid) ? m : [...m, { id: mid, from: "team", text: gmText.trim(), ts: Date.now() }]),
      (m) => m.some((x) => x.id === mid));
    setGmText("");
    const m = await sGet(gmKey(team), []);
    setGmMsgs(m);
  }, "Message sent to the Gamemaster.");

  const calcScore = complete(calc) ? scoreTerms(team, calc) : null;
  const myComms = comms.filter((c) => c.team === team);
  const commReady = posture && subject && commText.trim().length >= 20;
  const [commHint, setCommHint] = useState("");
  const commMissing = [
    !posture && "choose a posture",
    !subject && "choose a subject",
    commText.trim().length < 20 && `write at least 20 characters (${commText.trim().length}/20)`,
  ].filter(Boolean);

  return (
    <div className="min-h-screen pb-10" style={{ background: PAPER, color: CHARCOAL, fontFamily: BODY_HI }}>
      <div className="flex justify-between items-center px-4 py-3" style={{ background: CHARCOAL, color: PAPER }}>
        <div>
          <div className="font-bold text-lg">{FLAGS[team]} {team} Delegation</div>
          <div className="text-xs" style={{ color: GOLD }}>
            {observer ? "OBSERVER — VIEW ONLY · your delegate acts for the team" : (isMed ? "MEDIATOR — you score on closure too" : "PRINCIPAL PARTY")} · CONFIDENTIAL
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums" style={{ color: rem < 600000 ? "#ff8a70" : GOLD }}>{fmt(rem)}</div>
          <div className="text-xs opacity-80">Credibility: <b style={{ color: myCred >= 50 ? GOLD : "#ff8a70" }}>{myCred}</b></div>
          <div className="flex items-center justify-end gap-3"><TextSize dark /><SyncDot sync={sh.sync} dark /></div>
        </div>
      </div>
      <GoldRule />
      <ToastStack toasts={toasts} />

      {/* v1.5 — Session paused: holding screen locks the console */}
      {flags.paused && !observer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(16,19,20,0.96)" }}>
          <div className="text-center max-w-md">
            <div className="text-xs tracking-widest pz-label mb-3" style={{ color: GOLD }}>{S.meta.gateTagline}</div>
            <div className="text-2xl font-bold mb-3" style={{ color: PAPER }}>The session is paused.</div>
            <div className="text-sm" style={{ color: PAPER, opacity: 0.85 }}>
              Talks resume when the facilitator restarts the clock. Your drafts, endorsements and statements are saved.
              {clock.remainingMs != null && <div className="mt-3 font-mono" style={{ color: GOLD }}>Time remaining when play resumes: {fmt(clock.remainingMs)}</div>}
            </div>
          </div>
        </div>
      )}
      {/* Inject acknowledgement interstitial — the Pulse may not be ignored */}
      {unackedInjects.length > 0 && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4" style={{ background: "rgba(16,19,20,0.88)" }}>
          <div className="w-full max-w-md rounded-lg overflow-hidden" style={{ background: PAPER }}>
            <div className="px-4 py-2 font-bold tracking-widest text-sm" style={unackedInjects[0].moodShift ? { background: RED, color: PAPER } : { background: GOLD, color: CHARCOAL }}>
              {unackedInjects[0].moodShift ? "◆ THE PUBLIC MOOD HAS SHIFTED — READ BEFORE CONTINUING" : "◆ BREAKING — READ BEFORE CONTINUING"}
            </div>
            <div className="p-4">
              <div className="text-xs tracking-widest pz-label font-bold mb-1" style={{ color: unackedInjects[0].moodShift ? RED : "#a07800", fontFamily: MONO_FONT }}>
                {unackedInjects[0].tag}{unackedInjects[0].moodShift ? "" : " · NEWS"}
              </div>
              <div className="font-bold mb-1">{unackedInjects[0].title}</div>
              <div className="text-sm mb-3" style={{ opacity: 0.9 }}>{unackedInjects[0].body}</div>
              {unackedInjects[0].reaction && <div className="text-sm mb-3 p-2 rounded italic" style={{ background: "rgba(232,179,54,0.15)", color: CHARCOAL }}><span className="text-xs pz-label not-italic" style={{ letterSpacing: "0.14em", color: RED }}>HOW IT'S PLAYING</span> {unackedInjects[0].reaction}</div>}
              {unackedInjects.length > 1 && (
                <div className="text-xs italic opacity-60 mb-2">{unackedInjects.length - 1} more dispatch{unackedInjects.length > 2 ? "es" : ""} on the wire.</div>
              )}
              <button onClick={() => setAckTs(unackedInjects[0].ts)}
                className="w-full py-2.5 rounded font-bold" style={{ background: CHARCOAL, color: GOLD }}>
                ACKNOWLEDGED
              </button>
            </div>
          </div>
        </div>
      )}

      {seatIsAi && (
        <div className="text-center py-2 text-sm font-bold" style={{ background: "#101314", color: GOLD, borderBottom: `2px solid ${GOLD}` }}>
          ◆ THIS SEAT IS CURRENTLY AI-CONTROLLED — ask the facilitator to hand it to you before making moves ◆
        </div>
      )}
      {liveAnnouncement(ann, now) && (
        <div className="px-4 py-2 text-sm" style={{ background: "#101314", color: PAPER, borderBottom: `2px solid ${GOLD}` }}>
          <span className="text-xs font-bold tracking-widest mr-2" style={{ color: GOLD }}>GAMEMASTER:</span>
          {liveAnnouncement(ann, now).text}
        </div>
      )}
      {winOpen && !filedThisWindow && (
        <div className="text-center py-2 text-sm font-bold" style={{ background: LIGHTGOLD }}>
          ◆ PRESS WINDOW {winN} OPEN ({fmt(pub.window.endsAt - now)}) — your ministry must file a communiqué ◆
        </div>
      )}

      <div className="flex">
        {[["table", "Table"], ["draft", mine ? "Amend" : "Draft"], ["ministry", "Ministry"], ["wire", unseenCount > 0 ? `Wire (${unseenCount})` : "Wire"], ["gm", gmUnread > 0 ? `GM (${gmUnread})` : "GM"], ["calc", "Calc"]].map(([k, l]) => (
          <button key={k} onClick={() => { setTab(k); setMsg(""); if (k === "draft" && mine) setDraft(mine.terms); if (k === "wire") setSeenWireTs(Date.now()); if (k === "gm") setGmSeenTs(Date.now()); }}
            className="flex-1 py-2.5 text-xs font-bold"
            style={{ background: tab === k ? GOLD : "white", color: CHARCOAL, borderBottom: `2px solid ${GOLD}` }}>{l}</button>
        ))}
      </div>

      {unseenCount > 0 && tab !== "wire" && (
        <button onClick={() => { setTab("wire"); setSeenWireTs(Date.now()); }}
          className="w-full py-2 text-sm font-bold text-center"
          style={{ background: RED, color: "white" }}>
          ◆ {unseenCount} NEW DISPATCH{unseenCount > 1 ? "ES" : ""} ON THE WIRE — TAP TO READ ◆
        </button>
      )}
      {msg && <div className="mx-4 mt-3 px-3 py-2 rounded text-sm font-bold" style={{ background: LIGHTGOLD }}>{msg}</div>}
      {adopted && <div className="mx-4 mt-3 px-3 py-2 rounded text-sm font-bold text-center" style={{ background: GOLD }}>A deal has been adopted. Await the debrief.</div>}

      <div className="p-4">
        {tab === "table" && (
          <div className="space-y-3">
            {live.length === 0 && <div className="opacity-60 italic text-sm">No proposals on the table yet. Be the first to table a draft.</div>}
            {live.map((p) => {
              const es = endorserList(endo, p.id);
              const pend = pendingList(endo, p.id);
              const iEndorsed = es.includes(team);
              const iPending = pend.includes(team);
              const own = p.team === team;
              const myScore = scoreTerms(team, p.terms).total;
              const sent = pub.sentiment[p.id];
              return (
                <div key={p.id} className="p-3 rounded" style={{ background: PLATE, outline: flags.adoptedId === p.id ? `3px solid ${GOLD}` : "none" }}>
                  <div className="flex justify-between items-baseline">
                    <b>{FLAGS[p.team]} {p.team} draft {own && "(yours)"}</b>
                    <span className="font-bold tabular-nums">{es.length + 1}/{N_TEAMS}{pend.length > 0 && <span className="text-xs opacity-60"> (+{pend.length} pending)</span>}</span>
                  </div>
                  {(() => { const bd = draftBadge(p, endo, newestDraftId); return <div className="text-xs pz-label mt-0.5 mb-1" style={{ letterSpacing: "0.12em", color: bd.color }}>{bd.text}</div>; })()}
                  <TermPills terms={p.terms} />
                  {sent != null && <div className="text-xs mt-1 opacity-70">Global public: <b>{sent}% support</b></div>}
                  {iPending && (
                    <div className="text-xs mt-1 font-bold px-2 py-1 rounded" style={{ background: LIGHTGOLD }}>
                      This draft was amended after you endorsed it. Reaffirm or withdraw.
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs px-2 py-1 rounded font-bold" style={{ background: LIGHTGOLD }}>Worth to you: {myScore}/{maxScoreFor(team)}</span>
                    {!own && !adopted && (
                      <div className="flex gap-1">
                        {iPending && (
                          <button onClick={() => endorse(p.id, false)} disabled={busy || !canAct}
                            className="px-3 py-1.5 rounded text-sm font-bold"
                            style={{ background: "white", border: `2px solid ${RED}`, color: RED }}>
                            Withdraw
                          </button>
                        )}
                        {crossedRedLines(team, p.terms).length > 0 && (
                          <div className="text-xs font-bold mb-1" style={{ color: RED }}>✕ Crosses your red line ({crossedRedLines(team, p.terms).join("; ")}) — your capital will not sign.</div>
                        )}
                        <button onClick={() => endorse(p.id, !iEndorsed || iPending)} disabled={busy || !canAct || crossedRedLines(team, p.terms).length > 0}
                          className="px-3 py-1.5 rounded text-sm font-bold"
                          style={iEndorsed && !iPending ? { background: "white", border: `2px solid ${RED}`, color: RED } : { background: CHARCOAL, color: GOLD }}>
                          {iPending ? "Reaffirm endorsement" : iEndorsed ? "Withdraw endorsement" : "Endorse"}
                        </button>
                      </div>
                    )}
                    {own && <span className="text-xs opacity-60 italic">You cannot endorse your own draft.</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "draft" && (
          <div>
            <div className="text-sm mb-3 opacity-75">
              {mine
                ? (S.mechanics.amendmentPolicy === "reconfirm"
                  ? "Amending replaces your current draft. Existing endorsers keep their endorsement as pending and are asked to reaffirm — a much cheaper edit than starting over."
                  : "Amending replaces your current draft and clears all endorsements it has gathered.")
                : "Your draft appears on the main screen. Terms are public; your preferences are not."}
            </div>
            <TermForm terms={draft} setTerms={setDraft} />
            {complete(draft) && (
              <div className="text-sm font-bold px-3 py-2 rounded mb-3" style={{ background: LIGHTGOLD }}>
                This package is worth {scoreTerms(team, draft).total}/{maxScoreFor(team)} to you. Only you can see this.{DELEG[team].priority ? ` Your priority issue (${shortLabel(ISSUES.find((i) => i.id === DELEG[team].priority))}) counts ${PRIORITY_W}×.` : ""}{noDealPct(team) ? ` No agreement is worth ${noDealPct(team)}/100 to you.` : ""}
              </div>
            )}
            <button onClick={submit} disabled={!complete(draft) || busy || adopted || !canAct} aria-busy={busy ? "true" : "false"}
              className="w-full py-3 rounded font-bold"
              style={{ background: complete(draft) && !adopted ? CHARCOAL : "#7a7a7a", color: GOLD }}>
              {mine ? "Amend draft" : "Table this draft"}
            </button>
            {mine && !adopted && canAct && (
              <button onClick={() => act(async () => {
                  const r = await opWithdrawDraft(team);
                  if (!r.ok) throw Object.assign(new Error("wd"), { friendly: r.reason === "adopted" ? "That draft has been adopted and cannot be withdrawn." : "No live draft to withdraw." });
                }, "Draft withdrawn from the table.")}
                disabled={busy} aria-busy={busy ? "true" : "false"}
                className="w-full py-2 rounded font-bold mt-2 text-sm"
                style={{ background: "white", border: `1px solid ${RED}`, color: RED }}>
                Withdraw my draft
              </button>
            )}
            {observer && <div className="text-xs italic opacity-60 mt-2 text-center">View-only access — compose and price packages freely; your delegate tables them.</div>}
          </div>
        )}

        {tab === "ministry" && (
          <div>
            <div className="p-3 rounded mb-3 text-sm" style={{ background: LIGHTGOLD }}>
              <b>{MINISTRY[team].title} — official communiqués.</b> One filing per press window ({winN}/{TOTAL_WINDOWS} opened).
              Statements are read by a global public whose mood shifts with events.
              A statement that lands builds your credibility ({CRED_W_PCT}% of final score) and moves opinion on the deal;
              empty rhetoric, tone-deaf spin, or trolling <b>backfires</b>. Silence during a window costs you too.
            </div>
            <div className={winOpen ? "sticky top-0 z-20" : ""}>
              <div className="p-3 rounded mb-3 text-sm" style={{ background: winOpen ? LIGHTGOLD : "white", border: `2px solid ${winOpen ? RED : GOLD}` }}>
                <div className="text-xs font-bold tracking-wide mb-1" style={{ color: winOpen ? RED : CHARCOAL }}>◆ THE PUBLIC PULSE{winOpen ? " — WINDOW OPEN: READ THIS BEFORE YOU FILE" : ""}</div>
                {HIDE_INTL_MOOD ? (
                  <>
                    <div className="text-xs font-bold mb-1">{domesticOf(team) ? `AT HOME — ${domesticOf(team).label.toUpperCase()}` : "AT HOME"}</div>
                    <span className="italic">{domesticMoodText(team, (pub.domestic || {})[team])}</span>
                    <div className="text-xs opacity-60 mt-1">The international public that reads your statements is not described here. Read the wire and watch how other delegations' statements are received; misjudging that public costs credibility.</div>
                  </>
                ) : (<>
                <span className="italic">{MOODS[pub.mood]?.dispatch}</span>
                <div className="text-xs opacity-60 mt-1">This is the scenario's public mood, set by events on the wire — not a summary of what other delegations posted. Statements that misjudge it pay for it.</div></>)}
              </div>
            </div>
            {!winOpen && <div className="text-sm italic opacity-70 mb-3">No press window is currently open. Draft now; file when the window opens.</div>}
            {winOpen && filedThisWindow && !revising && <div className="text-sm font-bold mb-3">Your ministry has filed for window {winN}. ✓</div>}
            {revisable && !revising && (
              <div className="p-3 rounded mb-3" style={{ background: LIGHTGOLD }}>
                <div className="text-sm font-bold">Press read is in. You have {revisionLeft}s to decide whether to revise; once you start, you have until the window closes.</div>
                <div className="text-sm mt-1">{revisable.read}</div>
                <button onClick={() => { setRevising(revisable.id); setCommText(revisable.text); setPosture(revisable.posture); setSubject(revisable.subject); setCommHint(""); }}
                  className="mt-2 px-3 py-2 rounded font-bold text-sm" style={{ background: CHARCOAL, color: GOLD, fontFamily: BODY_HI }}>Revise this statement</button>
                <div className="text-xs opacity-70 mt-1">The revision replaces the original's effect{REVISION.factor != null && REVISION.factor < 1 ? ` at ${Math.round(REVISION.factor * 100)}%` : ""}. Same window; you may change the posture and subject.</div>
              </div>
            )}
            {revising && <div className="text-sm font-bold mb-3" style={{ color: RED }}>Revising — file before the window closes. <button onClick={() => { setRevising(null); setCommText(""); setPosture(null); setSubject(null); }} className="ml-2 px-2 py-1 rounded text-xs" style={{ background: PLATE, color: CHARCOAL }}>cancel</button></div>}

            <div className="text-xs font-bold tracking-wide mb-0.5 opacity-70">POSTURE — what is YOUR statement trying to do?</div>
            <div className="text-xs opacity-60 mb-1">This describes your own communiqué's intent — not the public mood. The press pool judges how well your text delivers on the posture you declare, and how that move lands with the public right now.</div>
            <div className="flex flex-wrap gap-1 mb-3">
              {POSTURES.map((p) => (
                <button key={p} onClick={() => setPosture(p)}
                  className="px-2.5 py-1.5 rounded text-sm font-bold"
                  style={posture === p ? { background: CHARCOAL, color: GOLD } : { background: PLATE, color: CHARCOAL }}>{p}</button>
              ))}
            </div>

            <div className="text-xs font-bold tracking-wide mb-0.5 opacity-70">SUBJECT — who or what is your statement about? (choose one)</div>
            <div className="text-xs opacity-60 mb-1">Every scored statement moves your credibility. Statements FOR or AGAINST a specific draft additionally move public opinion on that draft — weighted by your credibility.</div>
            <div className="flex flex-wrap gap-1 mb-3">
              <button onClick={() => setSubject({ type: "general" })}
                className="px-2.5 py-1.5 rounded text-sm font-bold"
                style={subject?.type === "general" ? { background: CHARCOAL, color: GOLD } : { background: PLATE, color: CHARCOAL }}>
                The situation
              </button>
              {TEAMS.filter((t) => t !== team).map((t) => (
                <button key={t} onClick={() => setSubject({ type: "team", team: t })}
                  className="px-2.5 py-1.5 rounded text-sm font-bold"
                  style={subject?.type === "team" && subject.team === t ? { background: CHARCOAL, color: GOLD } : { background: PLATE, color: CHARCOAL }}>
                  {FLAGS[t]} {t}
                </button>
              ))}
              {live.map((p) => (
                <React.Fragment key={p.id}>
                  <button onClick={() => setSubject({ type: "prop", id: p.id, stance: "for" })}
                    className="px-2.5 py-1.5 rounded text-sm font-bold"
                    style={subject?.type === "prop" && subject.id === p.id && subject.stance === "for" ? { background: CHARCOAL, color: GOLD } : { background: PLATE, color: CHARCOAL }}>
                    FOR {p.team} draft
                  </button>
                  <button onClick={() => setSubject({ type: "prop", id: p.id, stance: "against" })}
                    className="px-2.5 py-1.5 rounded text-sm font-bold"
                    style={subject?.type === "prop" && subject.id === p.id && subject.stance === "against" ? { background: RED, color: "white" } : { background: "white", border: `1px solid ${RED}`, color: RED }}>
                    AGAINST {p.team} draft
                  </button>
                </React.Fragment>
              ))}
            </div>

            <div className="text-xs font-bold tracking-wide mb-1 opacity-70">STATEMENT ({commText.length}/400)</div>
            <textarea value={commText} onChange={(e) => setCommText(e.target.value.slice(0, 400))} rows={5}
              placeholder={MINISTRY[team].speaker + " states…"}
              className="w-full px-2 py-2 rounded border text-sm mb-3" style={{ borderColor: GOLD, background: "white" }} />

            {/* Readiness checklist — visible before the button so the missing
                step is named rather than silently blocking the press. */}
            <div className="text-xs mb-2 flex flex-wrap gap-x-4 gap-y-1" style={{ fontFamily: MONO_FONT }}>
              <span style={{ color: posture ? GREEN : RED }}>{posture ? "✓" : "○"} posture</span>
              <span style={{ color: subject ? GREEN : RED }}>{subject ? "✓" : "○"} subject</span>
              <span style={{ color: commText.trim().length >= 20 ? GREEN : RED }}>{commText.trim().length >= 20 ? "✓" : "○"} text {Math.min(commText.trim().length, 400)}/400</span>
            </div>
            <button
              onClick={() => {
                if (!canAct) return setCommHint("Observer access is view-only; your delegate files for the team.");
                if (adopted) return setCommHint("The Protocol has been adopted; the press room is closed.");
                if (!winOpen) return setCommHint("No press window is open. Your draft is kept; file when one opens.");
                if (filedThisWindow && !revising) return setCommHint(`Already filed for window ${winN}.`);
                if (!commReady) return setCommHint("Not yet: " + commMissing.join("; ") + ".");
                setCommHint(""); fileCommunique();
              }}
              aria-busy={busy ? "true" : "false"}
              className="w-full py-3 rounded font-bold"
              style={{ background: commReady && winOpen && (!filedThisWindow || revising) && !adopted && canAct ? CHARCOAL : "#7a7a7a", color: GOLD }}>
              {busy ? "Filing" : revising ? "File revised statement" : filedThisWindow ? `Filed for window ${winN}` : winOpen ? "File communiqué" : "Await press window"}
            </button>
            {commHint && <div className="text-sm mt-2 px-3 py-2 rounded" style={{ background: "#FBE9E4", color: RED, border: `1px solid ${RED}` }}>{commHint}</div>}
            {observer && <div className="text-xs italic opacity-60 mt-2 text-center">View-only access — only your delegate files for the ministry.</div>}

            {myComms.length > 0 && (
              <div className="mt-4">
                <div className="text-xs font-bold tracking-wide mb-1 opacity-70">YOUR MINISTRY'S RECORD</div>
                {[...myComms].reverse().map((c) => (
                  <div key={c.id} className="text-sm border-b py-1.5" style={{ borderColor: LIGHTGOLD }}>
                    <div className="opacity-70 text-xs">W{c.window} · {c.posture} · re {c.subjectLabel}</div>
                    <div>“{c.text}”</div>
                    <div className="text-xs italic font-bold mt-0.5" style={{ color: c.scored && c.net <= -5 ? RED : CHARCOAL }}>
                      {c.superseded ? "Superseded by your revision." : c.scored ? receptionLabel(c.net) : "The press pool is reading…"}{c.revisionOf && " (revised statement)"}
                    </div>
                    {c.scored && !c.superseded && c.read && <div className="text-xs mt-0.5 opacity-80">{c.read}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "wire" && (
          <div className="space-y-3">
            <div className="text-sm opacity-75 mb-1">The diplomatic wire — breaking news and world events, plus every delegation's official statements, for your delegation's private review.</div>
            {wireItems.length === 0 && <div className="opacity-60 italic text-sm">Nothing on the wire yet.</div>}
            {wireItems.map((w) => w.kind === "inject" ? (
              <div key={w.id} className="p-3 rounded" style={w.moodShift ? { background: RED, color: PAPER, borderLeft: `4px solid ${PAPER}` } : { background: "white", borderLeft: `4px solid ${GOLD}`, border: `1px solid ${LIGHTGOLD}` }}>
                <div className="text-xs tracking-widest pz-label font-bold" style={{ color: w.moodShift ? PAPER : "#a07800", fontFamily: MONO_FONT }}>{w.tag}{w.moodShift ? "" : " · NEWS"}</div>
                <div className="font-bold text-sm mt-0.5">{w.title}</div>
                <div className="text-sm opacity-85 mt-1">{w.body}</div>
                {w.reaction && <div className="text-sm mt-1 italic" style={{ color: PAPER, opacity: 0.92 }}><span className="text-xs pz-label not-italic" style={{ letterSpacing: "0.14em", color: GOLD }}>HOW IT'S PLAYING</span> {w.reaction}</div>}
              </div>
            ) : (
              <div key={w.id} className="p-3 rounded" style={{ background: "#101314", color: PAPER, borderLeft: `4px solid ${w.net <= -5 ? RED : GOLD}` }}>
                <div className="text-xs tracking-widest pz-label" style={{ color: GOLD, fontFamily: MONO_FONT }}>
                  {FLAGS[w.team]} {MINISTRY[w.team].wire} · {w.posture.toUpperCase()} · re: {w.subjectLabel}
                </div>
                <div className="text-sm mt-1">“{w.text}”</div>
                <div className="text-xs mt-1 italic font-bold" style={{ color: w.net <= -5 ? "#ff8a70" : GOLD }}>{receptionLabel(w.net)}</div>
              </div>
            ))}
          </div>
        )}

        {tab === "gm" && (
          <div>
            <div className="text-sm opacity-75 mb-3">A private line to the Gamemaster for rules questions and in-game requests. No other delegation can see this conversation.</div>
            <div className="space-y-2 mb-3 max-h-72 overflow-y-auto">
              {gmMsgs.length === 0 && <div className="opacity-60 italic text-sm">No messages yet.</div>}
              {gmMsgs.map((m) => (
                <div key={m.id} className="p-2 rounded text-sm"
                  style={m.from === "gm" ? { background: "#101314", color: PAPER } : { background: "white", background: PLATE }}>
                  <div className="text-xs font-bold tracking-wide mb-0.5" style={{ color: m.from === "gm" ? GOLD : CHARCOAL, opacity: 0.8 }}>
                    {m.from === "gm" ? "GAMEMASTER" : "YOUR DELEGATION"}
                  </div>
                  {m.text}
                </div>
              ))}
            </div>
            <textarea value={gmText} onChange={(e) => setGmText(e.target.value.slice(0, 500))} rows={3}
              placeholder="Ask the Gamemaster…"
              className="w-full px-2 py-2 rounded border text-sm mb-2" style={{ borderColor: GOLD, background: "white" }} />
            <button onClick={sendGm} disabled={busy || gmText.trim().length < 2 || !canAct}
              className="w-full py-2.5 rounded font-bold"
              style={{ background: gmText.trim().length >= 2 ? CHARCOAL : "#bbb", color: GOLD }}>
              Send to Gamemaster
            </button>
          </div>
        )}

        {tab === "calc" && (
          <div>
            <div className="text-sm mb-3 opacity-75">Test any hypothetical package against your confidential preferences. Nothing here is shared or submitted.</div>
            <TermForm terms={calc} setTerms={setCalc} />
            {calcScore && (
              <div className="p-3 rounded" style={{ background: CHARCOAL, color: PAPER }}>
                <div className="text-2xl font-bold" style={{ color: GOLD }}>{calcScore.total} / {MAX_SCORE}</div>
                {isMed && <div className="text-xs mb-1" style={{ color: LIGHTGOLD }}>Deal component = this ÷ {MAX_SCORE} × {Math.round((1 - S.scoring.mediatorClosureShare) * 100)}, plus {Math.round(S.scoring.mediatorClosureShare * 100)} if a deal closes. Final = {DEAL_W_PCT}% deal + {CRED_W_PCT}% credibility.</div>}
                {!isMed && <div className="text-xs mb-1" style={{ color: LIGHTGOLD }}>Final score = {DEAL_W_PCT}% deal outcome + {CRED_W_PCT}% public credibility.</div>}
                <div className="grid grid-cols-2 gap-x-4 text-sm mt-1">
                  {calcScore.parts.map(([n, v, mx]) => (
                    <div key={n} className="flex justify-between border-b py-0.5" style={{ borderColor: "#3a4142" }}>
                      <span className="opacity-80">{n}</span><span className="tabular-nums font-bold" style={{ color: v === mx ? GOLD : v === 0 ? "#ff8a70" : PAPER }}>{v}/{mx}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================= GATE ================= */
/* ============ ACCOUNTS ============
   Sign in / sign up against the Cognito user pool (src/auth.js). The role on
   the token (professor | student) comes from the backend's allow-list. */
const AUTH_INPUT = { background: CHARCOAL, color: PAPER, border: "1px solid #4a4f50", fontFamily: BODY_HI };
const AUTH_LINK = { color: GOLD, fontFamily: BODY_HI, background: "none", border: 0, padding: 0, cursor: "pointer", textDecoration: "underline" };

function AuthField({ label, ...props }) {
  return (
    <label className="block text-left mb-3">
      <span className="block text-xs pz-label mb-1" style={{ color: GOLD, fontFamily: MONO_FONT, letterSpacing: "0.08em" }}>{label}</span>
      <input {...props} required className="w-full px-3 py-3 rounded" style={AUTH_INPUT} />
    </label>
  );
}

const AUTH_TITLES = {
  signin: "Sign in", signup: "Create your account", confirm: "Confirm your email",
  forgot: "Reset your password", reset: "Choose a new password",
};

/* A professor invite link is <site>#invite=<email>. The email rides in the
   fragment so it never reaches the server or its logs. Read once, then cleared. */
function takeInvite() {
  const m = location.hash.match(/^#invite=(.+)$/);
  if (!m) return null;
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

function Login({ onSignedIn }) {
  const [invite] = useState(takeInvite);
  const [mode, setMode] = useState(invite ? "signup" : "signin");
  const [email, setEmail] = useState(invite || "");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(authConfigured ? "" : "Sign-in isn't configured for this build (VITE_COGNITO_* missing).");
  const [info, setInfo] = useState(invite ? "You've been invited as a professor. Create your account with this email, or sign in if you already have one." : "");

  const go = (m, msg = "") => { setMode(m); setErr(""); setInfo(msg); setCode(""); };
  const run = async (fn) => {
    setBusy(true); setErr("");
    try { await fn(); }
    catch (e) {
      if (e.code === "UserNotConfirmedException") {
        resendCode(email).catch(() => {});
        go("confirm", `Your email isn't confirmed yet. We sent a new code to ${email.trim()}.`);
      } else setErr(e.message || "Something went wrong.");
    } finally { setBusy(false); }
  };
  const passwordOk = () => {
    if (password.length >= 8 && /\d/.test(password)) return true;
    setErr("Use at least 8 characters, including a number."); return false;
  };

  const submit = (e) => {
    e.preventDefault();
    if (mode === "signin") run(async () => onSignedIn(await signIn(email, password)));
    if (mode === "signup" && passwordOk()) run(async () => {
      await signUp({ email, password, name });
      go("confirm", `We sent a 6-digit code to ${email.trim()}.`);
    });
    if (mode === "confirm") run(async () => {
      await confirmSignUp(email, code);
      if (password) onSignedIn(await signIn(email, password));
      else go("signin", "Email confirmed. Sign in to continue.");
    });
    if (mode === "forgot") run(async () => {
      await forgotPassword(email);
      go("reset", `If an account exists for ${email.trim()}, we sent it a reset code.`);
    });
    if (mode === "reset" && passwordOk()) run(async () => {
      await resetPassword(email, code, password);
      onSignedIn(await signIn(email, password));
    });
  };

  const emailField = <AuthField label="EMAIL" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />;
  const codeField = <AuthField label="CODE FROM YOUR EMAIL" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />;
  const passwordField = (isNew) => (
    <AuthField label={isNew ? (mode === "reset" ? "NEW PASSWORD" : "PASSWORD (8+ characters, with a number)") : "PASSWORD"}
      type="password" autoComplete={isNew ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
  );

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: DEEP, fontFamily: BODY_FONT }}>
      <form onSubmit={submit} className="w-full max-w-sm text-center">
        <div className="mb-3"><Wordmark light h="44px" /></div>
        <div className="text-xs tracking-widest pz-label mb-8" style={{ color: GOLD, fontFamily: MONO_FONT }}>ACCORD CONSOLE</div>
        <h1 className="text-lg font-bold mb-4" style={{ color: PAPER, fontFamily: HEAD_FONT, letterSpacing: "0.06em" }}>{AUTH_TITLES[mode].toUpperCase()}</h1>
        {info && <div className="mb-4 text-sm" style={{ color: PAPER, opacity: 0.85 }}>{info}</div>}

        {mode === "signup" && <AuthField label="FULL NAME" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}
        {(mode === "signin" || mode === "signup" || mode === "forgot") && emailField}
        {(mode === "confirm" || mode === "reset") && codeField}
        {mode === "signin" && passwordField(false)}
        {(mode === "signup" || mode === "reset") && passwordField(true)}

        <button type="submit" disabled={busy || !authConfigured} aria-busy={busy ? "true" : "false"}
          className="w-full py-3 rounded font-bold mt-1" style={{ background: GOLD, color: DEEP, fontFamily: BODY_HI }}>
          {{ signin: "Sign in", signup: "Create account", confirm: "Confirm", forgot: "Send reset code", reset: "Set password and sign in" }[mode]}
        </button>
        {err && <div className="mt-3 text-sm" role="alert" style={{ color: "#ff8a70" }}>{err}</div>}

        <div className="mt-6 text-sm flex flex-col gap-2 items-center" style={{ color: PAPER }}>
          {mode === "signin" && <>
            <span>New here? <button type="button" style={AUTH_LINK} onClick={() => go("signup")}>Create an account</button></span>
            <button type="button" style={AUTH_LINK} onClick={() => go("forgot")}>Forgot your password?</button>
          </>}
          {mode === "signup" && <span>Already have an account? <button type="button" style={AUTH_LINK} onClick={() => go("signin")}>Sign in</button></span>}
          {mode === "confirm" && <>
            <button type="button" style={AUTH_LINK} disabled={busy}
              onClick={() => run(async () => { await resendCode(email); setInfo(`We sent a new code to ${email.trim()}.`); })}>Send a new code</button>
            <button type="button" style={AUTH_LINK} onClick={() => go("signin")}>Back to sign in</button>
          </>}
          {(mode === "forgot" || mode === "reset") && <button type="button" style={AUTH_LINK} onClick={() => go("signin")}>Back to sign in</button>}
        </div>
      </form>
    </div>
  );
}

/* ============ PROFESSOR DASHBOARD ============
   The professor's games with their status, New game, and the buttons that open
   one (?game=<id>, see GameEntry). Starting or resuming flips the game to live
   first, so students can join and write again. */
const STATUS_CHIP = {
  lobby: { label: "NOT STARTED", bg: "transparent", fg: GOLD, border: GOLD },
  live: { label: "LIVE", bg: GREEN, fg: PAPER },
  paused: { label: "PAUSED", bg: GOLD, fg: DEEP },
  completed: { label: "COMPLETED", bg: "#3a3f40", fg: "#c9c4b8" },
};
const STATUS_ORDER = { live: 0, paused: 1, lobby: 2, completed: 3 };
const CARD = { background: CHARCOAL, border: "1px solid #34393a" };
const BTN_PRIMARY = { background: GOLD, color: DEEP, fontFamily: BODY_HI };
const BTN_SECONDARY = { background: "transparent", color: PAPER, fontFamily: BODY_HI, border: "1px solid #5a6061" };

function StatusChip({ status }) {
  const c = STATUS_CHIP[status] || STATUS_CHIP.completed;
  return (
    <span className="text-xs px-2 py-1 rounded font-bold whitespace-nowrap"
      style={{ background: c.bg, color: c.fg, border: `1px solid ${c.border || c.bg}`, fontFamily: MONO_FONT, letterSpacing: "0.06em" }}>
      {c.label}
    </span>
  );
}
const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
const projectorUrl = (gameId) => `${location.pathname}?game=${encodeURIComponent(gameId)}&view=projector`;

/* The cartridge a new game will use: the built-in template, or a library entry
   loaded into the engine (seat toggles, clock default and export import all
   read the loaded scenario). */
const BUILTIN_CHOICE = { id: null, key: BUILTIN, title: "Built-in template", cartridge: SCENARIO };
async function loadLibraryChoice(entry) {
  const { body } = await api("GET", `/scenarios/${encodeURIComponent(entry.scenarioId)}`);
  return { id: entry.scenarioId, key: `lib:${entry.scenarioId}@${entry.updatedAt}`, title: entry.title, cartridge: body };
}

function NewGameForm({ onCreated, onCancel }) {
  const [title, setTitle] = useState("");
  const [library, setLibrary] = useState(null); // scenario metadata, newest first
  const [choice, setChoice] = useState(null);   // BUILTIN_CHOICE or a loaded library entry
  const [minutes, setMinutes] = useState("");
  const [seats, setSeats] = useState({});
  const [fromFile, setFromFile] = useState(null); // { name, doc, summary }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const choose = useCallback(async (entry) => {
    setErr(""); setFromFile(null);
    try {
      const c = entry ? await loadLibraryChoice(entry) : BUILTIN_CHOICE;
      applyScenario(c.cartridge, c.key);
      setChoice(c);
      setMinutes(String(S.meta.deadlineMinutes));
      setSeats(DEFAULT_AI);
    } catch (e) { setErr(e.message); }
  }, []);

  // The newest library scenario is the default; the template when the library is empty.
  useEffect(() => {
    api("GET", "/scenarios")
      .then(({ scenarios }) => { setLibrary(scenarios); return choose(scenarios[0] || null); })
      .catch((e) => { setLibrary([]); setErr(e.message); choose(null); });
  }, [choose]);

  // Optional: continue from a session export instead of a blank game.
  const pickFile = async (file) => {
    setErr(""); setFromFile(null);
    if (!file) return;
    try {
      applyScenario(choice.cartridge, choice.key);
      const rec = JSON.parse(await file.text());
      const doc = docFromExport(rec);
      if (rec.seats) setSeats({ ...DEFAULT_AI, ...rec.seats });
      const drafts = (rec.props || []).filter((x) => x.active).length;
      const when = rec.exportedAt ? new Date(rec.exportedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "an earlier session";
      setFromFile({ name: file.name, doc, summary: `Saved ${when} · ${drafts} live draft${drafts === 1 ? "" : "s"} · ${fmt(doc[K.clock].remainingMs)} left on the clock. The game opens paused.` });
    } catch (e) {
      setErr(e instanceof SyntaxError ? "That file isn't valid JSON." : e.message);
    }
  };

  const create = async () => {
    const t = title.trim();
    const m = Math.round(Number(minutes));
    if (!choice) return;
    if (!t) { setErr("Give the game a name, e.g. your course and section."); return; }
    if (!(m >= 5 && m <= 300)) { setErr("The clock must be between 5 and 300 minutes."); return; }
    setBusy(true); setErr("");
    try {
      applyScenario(choice.cartridge, choice.key);
      const { game } = await api("POST", "/games", { title: t, scenarioId: choice.id, setup: { minutes: m, seats } });
      /* Seed the new game's state with the chosen seats and clock. If this
         write fails the game still works: the clock follows setup.minutes
         anyway, and seats can be switched in the console. */
      const seed = fromFile
        ? { ...fromFile.doc, [K.ai]: seats }
        : { [K.ai]: seats, [K.clock]: { running: false, remainingMs: m * 60 * 1000, endsAt: null } };
      await api("PUT", `/games/${game.gameId}/doc`, JSON.stringify(seed)).catch(() => {});
      onCreated(game);
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  const label = (text) => <div className="text-xs pz-label mb-1" style={{ color: GOLD, fontFamily: MONO_FONT, letterSpacing: "0.08em" }}>{text}</div>;
  return (
    <div className="rounded p-4 mb-6" style={CARD}>
      <h3 className="font-bold mb-3" style={{ color: PAPER, fontFamily: HEAD_FONT, letterSpacing: "0.06em" }}>NEW GAME</h3>
      <label className="block mb-3">
        {label("SCENARIO")}
        <select value={choice ? choice.id || "" : ""} disabled={!library || busy}
          onChange={(e) => choose(library.find((x) => x.scenarioId === e.target.value) || null)}
          className="w-full px-3 py-3 rounded" style={AUTH_INPUT}>
          {(library || []).map((x) => <option key={x.scenarioId} value={x.scenarioId}>{x.title}</option>)}
          <option value="">{BUILTIN_CHOICE.title}</option>
        </select>
        {library && library.length === 0 && (
          <span className="block mt-1 text-xs" style={{ opacity: 0.7 }}>Upload a cartridge under <b>Scenarios</b> below to run your own case.</span>
        )}
      </label>
      {!choice ? <div className="text-sm mb-4" style={{ opacity: 0.7 }}>Loading scenarios…</div> : <>
        <AuthField label="NAME (e.g. course and section)" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        <AuthField label="CLOCK (minutes)" type="number" min={5} max={300} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        {label("SEATS (you can switch these during play)")}
        <div className="grid gap-2 mb-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {TEAMS.map((t) => (
            <SeatToggle key={t} team={t} value={seats[t]} onToggle={() => setSeats((s) => ({ ...s, [t]: s[t] === "ai" ? "human" : "ai" }))} />
          ))}
        </div>
        {label("CONTINUE FROM A SAVED EXPORT (optional)")}
        <div className="mb-4 text-sm">
          <input type="file" accept="application/json,.json" aria-label="Session export file"
            onChange={(e) => pickFile(e.target.files && e.target.files[0])} style={{ color: PAPER }} />
          {fromFile && <div className="mt-2" style={{ color: GOLD }}>{fromFile.name}: {fromFile.summary}</div>}
        </div>
      </>}
      <div className="flex gap-2 flex-wrap">
        <button onClick={create} disabled={busy || !choice} aria-busy={busy ? "true" : "false"} className="px-4 py-2 rounded font-bold" style={BTN_PRIMARY}>Create game</button>
        <button onClick={onCancel} disabled={busy} className="px-4 py-2 rounded" style={BTN_SECONDARY}>Cancel</button>
      </div>
      {err && <div className="mt-3 text-sm" role="alert" style={{ color: "#ff8a70" }}>{err}</div>}
    </div>
  );
}

/* Shown right after creating a game: the join word, large enough to project. */
function ShareCode({ game, onOpen, onDone }) {
  return (
    <div className="rounded p-6 mb-6 text-center" style={{ ...CARD, border: `1px solid ${GOLD}` }}>
      <div className="text-xs pz-label mb-2" style={{ color: GOLD, fontFamily: MONO_FONT, letterSpacing: "0.12em" }}>SHARE THIS CODE WITH YOUR CLASS</div>
      <div className="font-bold mb-2" style={{ color: GOLD, fontFamily: MONO_FONT, fontSize: "clamp(2.4rem, 10vw, 4.5rem)", letterSpacing: "0.12em", lineHeight: 1.1, wordBreak: "break-all" }}>
        {game.code.toUpperCase()}
      </div>
      <div className="text-sm mb-5" style={{ opacity: 0.8 }}>{game.title} · students sign in, choose <b>Join a game</b> and type this word.</div>
      <div className="flex gap-2 justify-center flex-wrap">
        <button onClick={onOpen} className="px-4 py-2 rounded font-bold" style={BTN_PRIMARY}>Start game</button>
        <a href={projectorUrl(game.gameId)} target="_blank" rel="noreferrer" className="px-4 py-2 rounded" style={{ ...BTN_SECONDARY, textDecoration: "none" }}>Open projector</a>
        <button onClick={onDone} className="px-4 py-2 rounded" style={BTN_SECONDARY}>Back to games</button>
      </div>
    </div>
  );
}

function ProfessorGames() {
  const [games, setGames] = useState(null);
  const [err, setErr] = useState("");
  const [opening, setOpening] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null);

  const load = useCallback(async () => {
    try {
      const { games: list } = await api("GET", "/games");
      setGames(list
        .filter((g) => g.membership.role === "professor")
        .sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || (b.updatedAt || "").localeCompare(a.updatedAt || "")));
      setErr("");
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  // Starting (lobby) or resuming (paused) makes the game live, then opens the console.
  const open = async (g) => {
    setOpening(g.gameId); setErr("");
    try {
      if (g.status === "lobby" || g.status === "paused") await api("POST", `/games/${g.gameId}/status`, { status: "live" });
      openGame(g.gameId);
    } catch (e) { setErr(e.message); setOpening(""); load(); }
  };

  const actions = {
    lobby: [["Start game", true]],
    live: [["Open console", true], ["Projector", false]],
    paused: [["Resume", true]],
    completed: [["View results", true]],
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3 mt-6 mb-4 flex-wrap">
        <h2 className="text-xl font-bold" style={{ color: PAPER, fontFamily: HEAD_FONT, letterSpacing: "0.06em" }}>YOUR GAMES</h2>
        {!creating && !created && (
          <button onClick={() => setCreating(true)} className="px-4 py-2 rounded font-bold" style={BTN_PRIMARY}>+ New game</button>
        )}
      </div>
      {creating && <NewGameForm onCancel={() => setCreating(false)} onCreated={(g) => { setCreating(false); setCreated(g); load(); }} />}
      {created && <ShareCode game={created} onOpen={() => open(created)} onDone={() => setCreated(null)} />}
      {err && <div className="mb-4 text-sm" role="alert" style={{ color: "#ff8a70" }}>{err}</div>}
      {games === null && !err && <div className="text-sm" style={{ opacity: 0.7 }}>Loading your games…</div>}
      {games && games.length === 0 && !creating && !created && (
        <div className="text-sm" style={{ opacity: 0.75 }}>No games yet. Choose <b>New game</b> to set one up and get a code for your class.</div>
      )}
      <div className="flex flex-col gap-3">
        {(games || []).map((g) => (
          <div key={g.gameId} className="rounded p-4 flex items-center gap-3 flex-wrap" style={CARD}>
            <div className="flex-1" style={{ minWidth: 200 }}>
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="font-bold" style={{ fontFamily: BODY_HI }}>{g.title}</span>
                <StatusChip status={g.status} />
              </div>
              <div className="text-xs" style={{ opacity: 0.7, fontFamily: MONO_FONT }}>
                {g.scenarioTitle || BUILTIN_CHOICE.title} · {g.status !== "completed" && <>CODE <span style={{ color: GOLD }}>{g.code.toUpperCase()}</span> · </>}
                created {shortDate(g.createdAt)}{g.updatedAt !== g.createdAt && <> · updated {shortDate(g.updatedAt)}</>}
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {(actions[g.status] || []).map(([label, primary]) => primary
                ? <button key={label} onClick={() => open(g)} disabled={!!opening} aria-busy={opening === g.gameId ? "true" : "false"}
                    className="px-4 py-2 rounded font-bold text-sm" style={BTN_PRIMARY}>{label}</button>
                : <a key={label} href={projectorUrl(g.gameId)} target="_blank" rel="noreferrer"
                    className="px-4 py-2 rounded text-sm" style={{ ...BTN_SECONDARY, textDecoration: "none" }}>{label}</a>)}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ============ STUDENT DASHBOARD ============
   Join a game with the professor's word, and the games played so far. Only
   the professor resumes a paused game, so a paused game has no button here. */
const seatLabel = (d) => (!d ? "Not assigned yet" : d === "observer" ? "Observer" : DELEG[d] ? `${FLAGS[d]} ${DELEG[d].name}` : d);

function StudentGames() {
  const [games, setGames] = useState(null);
  const [err, setErr] = useState("");
  const [word, setWord] = useState("");
  const [joinErr, setJoinErr] = useState("");
  const [joining, setJoining] = useState(false);

  const load = useCallback(async () => {
    try {
      const { games: list } = await api("GET", "/games");
      setGames(list
        .filter((g) => g.membership.role === "student")
        .sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || (b.updatedAt || "").localeCompare(a.updatedAt || "")));
      setErr("");
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  const join = async (e) => {
    e.preventDefault();
    const code = word.trim();
    if (!code) { setJoinErr("Type the word your professor shared."); return; }
    setJoining(true); setJoinErr("");
    try {
      const { game } = await api("POST", "/games/join", { code });
      openGame(game.gameId);
    } catch (e2) { setJoinErr(e2.message); setJoining(false); load(); }
  };

  return (
    <>
      <form onSubmit={join} className="rounded p-4 mt-6 mb-6" style={CARD}>
        <h2 className="text-xl font-bold mb-3" style={{ color: PAPER, fontFamily: HEAD_FONT, letterSpacing: "0.06em" }}>JOIN A GAME</h2>
        <div className="flex gap-2 flex-wrap">
          <input value={word} onChange={(e) => setWord(e.target.value)} placeholder="e.g. southern"
            aria-label="Game code" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            className="flex-1 px-3 py-3 rounded text-lg font-bold" style={{ ...AUTH_INPUT, color: GOLD, fontFamily: MONO_FONT, letterSpacing: "0.08em", minWidth: 200 }} />
          <button type="submit" disabled={joining} aria-busy={joining ? "true" : "false"} className="px-5 py-3 rounded font-bold" style={BTN_PRIMARY}>Join</button>
        </div>
        {joinErr && <div className="mt-3 text-sm" role="alert" style={{ color: "#ff8a70" }}>{joinErr}</div>}
      </form>

      <h2 className="text-xl font-bold mb-4" style={{ color: PAPER, fontFamily: HEAD_FONT, letterSpacing: "0.06em" }}>YOUR GAMES</h2>
      {err && <div className="mb-4 text-sm" role="alert" style={{ color: "#ff8a70" }}>{err}</div>}
      {games === null && !err && <div className="text-sm" style={{ opacity: 0.7 }}>Loading your games…</div>}
      {games && games.length === 0 && <div className="text-sm" style={{ opacity: 0.75 }}>Games you join will be listed here.</div>}
      <div className="flex flex-col gap-3">
        {(games || []).map((g) => (
          <div key={g.gameId} className="rounded p-4 flex items-center gap-3 flex-wrap" style={CARD}>
            <div className="flex-1" style={{ minWidth: 200 }}>
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="font-bold" style={{ fontFamily: BODY_HI }}>{g.title}</span>
                <StatusChip status={g.status} />
              </div>
              <div className="text-xs" style={{ opacity: 0.7, fontFamily: MONO_FONT }}>
                {g.ownerName} · {g.scenarioTitle || BUILTIN_CHOICE.title} · {seatLabel(g.membership.delegation)} · joined {shortDate(g.membership.joinedAt)}
              </div>
            </div>
            {(g.status === "live" || g.status === "lobby") && (
              <button onClick={() => openGame(g.gameId)} className="px-4 py-2 rounded font-bold text-sm" style={BTN_PRIMARY}>Enter</button>
            )}
            {g.status === "paused" && <span className="text-sm" style={{ opacity: 0.75 }}>Your professor will resume it.</span>}
            {g.status === "completed" && (
              <button onClick={() => openGame(g.gameId)} className="px-4 py-2 rounded text-sm" style={BTN_SECONDARY}>View results</button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/* Professor settings: the designer key turns on scoring detail in the console
   for this browser (it used to be typed at the old access-code gate). */
function DesignerSetting() {
  const [on, setOn] = useState(false);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => { readDesigner().then(setOn); }, []);
  const enable = async () => {
    let h = null;
    try { h = await codeHash(key); } catch { /* no crypto: treated as wrong key */ }
    if (h !== DESIGNER_HASH) { setMsg("That isn't the designer key."); return; }
    try { await window.storage.set("pz-designer", "1", false); } catch { /* per-browser only */ }
    setOn(true); setKey(""); setMsg("");
  };
  const disable = async () => {
    try { await window.storage.delete("pz-designer", false); } catch { /* per-browser only */ }
    setOn(false);
  };
  return (
    <details className="mt-10 pt-4 text-sm" style={{ borderTop: "1px solid #34393a" }}>
      <summary className="cursor-pointer" style={{ opacity: 0.8 }}>Settings</summary>
      <div className="mt-3 rounded p-4" style={CARD}>
        <div className="font-bold mb-1" style={{ fontFamily: BODY_HI }}>Designer view {on ? "· on" : "· off"}</div>
        <div className="text-xs mb-3" style={{ opacity: 0.7 }}>Shows scoring detail and authoring tools in the console, in this browser only.</div>
        {on
          ? <button onClick={disable} className="px-3 py-2 rounded text-sm" style={BTN_SECONDARY}>Turn off</button>
          : <div className="flex gap-2 flex-wrap">
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && enable()}
                placeholder="Designer key" aria-label="Designer key" className="px-3 py-2 rounded" style={{ ...AUTH_INPUT, minWidth: 200 }} />
              <button onClick={enable} className="px-3 py-2 rounded font-bold text-sm" style={BTN_PRIMARY}>Turn on</button>
            </div>}
        {msg && <div className="mt-2 text-sm" role="alert" style={{ color: "#ff8a70" }}>{msg}</div>}
      </div>
    </details>
  );
}

/* Scenario library: cartridges uploaded by professors, shared by all of them.
   A file is parsed and checked in the browser (cartridge.js) and previewed
   before it is saved; hard findings block saving. Only the uploader replaces
   or deletes an entry. Games keep their own copy, so neither touches a game. */
function downloadJson(name, obj) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const fileSafe = (s) => String(s || "scenario").replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 60);

function CartridgePreview({ pending, onSave, onEdit, onCancel, busy }) {
  const { cartridge: c, findings, fileName, replacing } = pending;
  const hard = findings.filter((f) => f.level === "hard");
  const advisory = findings.filter((f) => f.level === "advisory");
  return (
    <div className="mb-4 p-3 rounded" style={{ border: `1px solid ${hard.length ? "#ff8a70" : GOLD}` }}>
      <div className="text-xs mb-1" style={{ opacity: 0.7, fontFamily: MONO_FONT }}>{fileName}{replacing && <> · replaces “{replacing.title}”</>}</div>
      {c.meta?.title && <div className="font-bold mb-1" style={{ fontFamily: BODY_HI }}>{c.meta.title}</div>}
      {!hard.length && <>
        <div className="mb-2 text-xs" style={{ opacity: 0.8 }}>{summarize(c).text} · {c.meta.deadlineMinutes} min clock</div>
        <div className="mb-2">{c.delegations.map((d) => <span key={d.id} className="inline-block mr-3">{d.flag} {d.name}{d.mediator ? " (mediator)" : ""}</span>)}</div>
        <details className="mb-2 text-xs">
          <summary className="cursor-pointer" style={{ opacity: 0.8 }}>Issues and injects</summary>
          <div className="mt-2" style={{ opacity: 0.85 }}>
            <div className="mb-1"><b>Issues:</b> {c.issues.map((i) => i.short || i.label).join(" · ")}</div>
            <div><b>Injects:</b> {c.injects.length ? c.injects.map((j) => `${j.id} ${j.title}`).join(" · ") : "none"}</div>
          </div>
        </details>
      </>}
      {hard.length > 0 && (
        <div className="mb-2" role="alert" style={{ color: "#ff8a70" }}>
          <div className="font-bold mb-1">Fix {hard.length === 1 ? "this" : `these ${hard.length} problems`} in the file, then upload it again:</div>
          <ul className="list-disc pl-5">{hard.slice(0, 12).map((f, i) => <li key={i}>{f.text}</li>)}</ul>
          {hard.length > 12 && <div>…and {hard.length - 12} more.</div>}
        </div>
      )}
      {advisory.length > 0 && (
        <details className="mb-2 text-xs">
          <summary className="cursor-pointer" style={{ color: "#a07800" }}>{advisory.length} design note{advisory.length === 1 ? "" : "s"} (won't stop the game)</summary>
          <ul className="list-disc pl-5 mt-1" style={{ opacity: 0.85 }}>{advisory.map((f, i) => <li key={i}>{f.text}</li>)}</ul>
        </details>
      )}
      <div className="flex gap-2 flex-wrap">
        {!hard.length && (
          <button onClick={onSave} disabled={busy} aria-busy={busy ? "true" : "false"} className="px-3 py-2 rounded font-bold text-sm" style={BTN_PRIMARY}>
            {replacing ? "Replace in library" : "Save to library"}
          </button>
        )}
        <button onClick={onEdit} disabled={busy} className="px-3 py-2 rounded text-sm" style={BTN_SECONDARY}>{hard.length ? "Fix in editor" : "Open in editor"}</button>
        <button onClick={onCancel} disabled={busy} className="px-3 py-2 rounded text-sm" style={BTN_SECONDARY}>Cancel</button>
      </div>
    </div>
  );
}

const EDITOR_UI = { GOLD, PAPER, CARD, BTN_PRIMARY, BTN_SECONDARY, INPUT: AUTH_INPUT, MONO_FONT, HEAD_FONT, BODY_HI };

function ScenarioLibrary({ me }) {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null); // { initial, replacing }
  const [wizard, setWizard] = useState(false);  // guided setup, hands off to the editor
  const [pending, setPending] = useState(null); // { cartridge, findings, fileName, replacing? }
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  const load = useCallback(async () => {
    try { setList((await api("GET", "/scenarios")).scenarios); setErr(""); }
    catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const pick = async (file, replacing = null) => {
    setErr(""); setDone(""); setPending(null);
    if (!file) return;
    try { setPending({ ...(await readCartridgeFile(file)), fileName: file.name, replacing }); }
    catch (e) { setErr(`${file.name}: ${e.message}`); }
  };
  const fileInput = (onFile, labelText, primary) => (
    <label className="px-3 py-2 rounded text-sm cursor-pointer inline-block" style={primary ? { ...BTN_PRIMARY, fontWeight: 700 } : BTN_SECONDARY}>
      {labelText}
      <input type="file" accept=".js,.json,application/json,text/javascript" className="hidden" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; onFile(f); }} />
    </label>
  );

  const save = async () => {
    setBusy("save"); setErr("");
    try {
      const r = pending.replacing
        ? await api("PUT", `/scenarios/${encodeURIComponent(pending.replacing.scenarioId)}`, { body: pending.cartridge })
        : await api("POST", "/scenarios", { body: pending.cartridge });
      setDone(`“${r.scenario.title}” is ${pending.replacing ? "updated" : "in the library"}. Choose it under New game.${pending.replacing ? " Games already created keep the version they started with." : ""}`);
      setPending(null);
      load();
    } catch (e) { setErr(e.message); }
    setBusy("");
  };
  const download = async (x) => {
    setBusy(x.scenarioId); setErr("");
    try { const { body } = await api("GET", `/scenarios/${encodeURIComponent(x.scenarioId)}`); downloadJson(`${fileSafe(body.meta?.id || x.title)}.json`, body); }
    catch (e) { setErr(e.message); }
    setBusy("");
  };
  // Edit your own entry in place, or start from a copy of anyone's.
  const openEditor = async (x, asCopy) => {
    setBusy(x.scenarioId); setErr(""); setDone(""); setPending(null);
    try {
      const { body } = await api("GET", `/scenarios/${encodeURIComponent(x.scenarioId)}`);
      const initial = normalizeCartridge(body);
      if (asCopy) initial.meta = { ...initial.meta, title: `COPY OF ${initial.meta.title}` };
      setEditing({ initial, replacing: asCopy ? null : x });
    } catch (e) { setErr(e.message); }
    setBusy("");
  };
  const saved = (sc, replaced) => {
    setEditing(null);
    setDone(`“${sc.title}” is ${replaced ? "updated" : "in the library"}. Choose it under New game.${replaced ? " Games already created keep the version they started with." : ""}`);
    load();
  };

  const remove = async (x) => {
    if (!window.confirm(`Delete “${x.title}” from the library? Games already created from it keep working.`)) return;
    setBusy(x.scenarioId); setErr(""); setDone("");
    try { await api("DELETE", `/scenarios/${encodeURIComponent(x.scenarioId)}`); load(); }
    catch (e) { setErr(e.message); }
    setBusy("");
  };

  return (
    <details className="mt-10 pt-4 text-sm" style={{ borderTop: "1px solid #34393a" }}>
      <summary className="cursor-pointer" style={{ opacity: 0.8 }}>Scenarios (upload a cartridge)</summary>
      <div className="mt-3 rounded p-4" style={CARD}>
        {editing ? (
          <ScenarioEditor key={editing.replacing?.scenarioId || "new"} initial={editing.initial} replacing={editing.replacing} ui={EDITOR_UI}
            onSaved={saved} onCancel={() => setEditing(null)} />
        ) : wizard ? (
          /* Guided setup builds the cartridge, then hands it to the editor —
             it never saves on its own, so the rankings get a pass first. */
          <ScenarioWizard ui={EDITOR_UI} onCancel={() => setWizard(false)}
            onBuilt={(cartridge) => { setWizard(false); setDone(""); setPending(null); setEditing({ initial: cartridge, replacing: null }); }} />
        ) : <>
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <button onClick={() => { setDone(""); setPending(null); setWizard(true); }}
            className="px-3 py-2 rounded text-sm font-bold" style={BTN_PRIMARY}>Guided setup</button>
          <button onClick={() => { setDone(""); setPending(null); setEditing({ initial: blankCartridge(SCENARIO), replacing: null }); }}
            className="px-3 py-2 rounded text-sm" style={BTN_SECONDARY}>New scenario</button>
          {fileInput((f) => pick(f), "Upload cartridge", false)}
          <button onClick={() => downloadJson("template.json", normalizeCartridge(SCENARIO))} className="px-3 py-2 rounded text-sm" style={BTN_SECONDARY}>Download template</button>
          <span className="text-xs" style={{ opacity: 0.7 }}>Answer a few questions and we'll build the cartridge, start from a blank one in the editor, or upload a .js cartridge (like islamabad_scenario.js) or .json. Every professor can use what you save.</span>
        </div>
        {pending && <CartridgePreview pending={pending} busy={busy === "save"} onSave={save} onCancel={() => setPending(null)}
          onEdit={() => { setEditing({ initial: pending.cartridge, replacing: pending.replacing }); setPending(null); }} />}
        {done && <div className="mb-3 p-3 rounded" role="status" style={{ border: `1px solid ${GOLD}` }}>{done}</div>}
        {err && <div className="mb-3 text-sm" role="alert" style={{ color: "#ff8a70" }}>{err}</div>}
        {list === null && !err && <div style={{ opacity: 0.7 }}>Loading…</div>}
        {list && list.length === 0 && <div style={{ opacity: 0.75 }}>No scenarios yet. Upload a cartridge to start games from it.</div>}
        <div className="flex flex-col gap-3">
          {(list || []).map((x) => {
            const mine = x.ownerId === me.userId;
            return (
              <div key={x.scenarioId} className="flex items-center gap-2 flex-wrap">
                <div className="flex-1" style={{ minWidth: 200 }}>
                  <div className="font-bold" style={{ fontFamily: BODY_HI }}>{x.title}</div>
                  <div className="text-xs" style={{ opacity: 0.7 }}>
                    {(x.summary?.delegations || []).map((d) => d.flag).join(" ")} {x.summary?.delegations?.length} delegations · {x.summary?.issues} issues · {x.summary?.injects} injects
                    {" · "}{mine ? "uploaded by you" : `by ${x.ownerName}`} {shortDate(x.updatedAt)}
                  </div>
                </div>
                {mine && <button onClick={() => openEditor(x, false)} disabled={busy === x.scenarioId} className="px-2 py-1 rounded text-xs" style={BTN_SECONDARY}>Edit</button>}
                <button onClick={() => openEditor(x, true)} disabled={busy === x.scenarioId} className="px-2 py-1 rounded text-xs" style={BTN_SECONDARY}>Copy</button>
                <button onClick={() => download(x)} disabled={busy === x.scenarioId} className="px-2 py-1 rounded text-xs" style={BTN_SECONDARY}>Download</button>
                {mine && fileInput((f) => pick(f, x), "Replace", false)}
                {mine && <button onClick={() => remove(x)} disabled={busy === x.scenarioId} className="px-2 py-1 rounded text-xs" style={BTN_SECONDARY}>Delete</button>}
              </div>
            );
          })}
        </div>
        </>}
      </div>
    </details>
  );
}

/* Professors: everyone who signs in with the professor role. Any professor can
   invite by email (they get a link to send) or remove an invited professor;
   professors from the deployment config are fixed. */
const inviteUrl = (email) => `${location.origin}${location.pathname}#invite=${encodeURIComponent(email)}`;
const PROF_STATUS = { active: "SIGNED IN", invited: "INVITED" };

function ProfessorsPanel({ me }) {
  const [list, setList] = useState(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(null); // { email, url, copied }

  const load = useCallback(async () => {
    try { setList((await api("GET", "/professors")).professors); setErr(""); }
    catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const copy = async (url) => {
    try { await navigator.clipboard.writeText(url); return true; } catch { return false; }
  };

  const invite = async (e) => {
    e.preventDefault();
    const addr = email.trim();
    if (!addr) { setErr("Type the new professor's email."); return; }
    setBusy("invite"); setErr("");
    try {
      const { professor } = await api("POST", "/professors", { email: addr });
      const url = inviteUrl(professor.email);
      setSent({ email: professor.email, url, copied: await copy(url) });
      setEmail("");
      load();
    } catch (e2) { setErr(e2.message); }
    setBusy("");
  };

  const remove = async (p) => {
    if (!window.confirm(`Remove ${p.email} as a professor? They keep their games but can't create new ones once their session renews (within an hour).`)) return;
    setBusy(p.email); setErr("");
    try { await api("DELETE", `/professors/${encodeURIComponent(p.email)}`); load(); }
    catch (e) { setErr(e.message); }
    setBusy("");
  };

  return (
    <details className="mt-10 pt-4 text-sm" style={{ borderTop: "1px solid #34393a" }}>
      <summary className="cursor-pointer" style={{ opacity: 0.8 }}>Invite or manage professors</summary>
      <div className="mt-3 rounded p-4" style={CARD}>
        <form onSubmit={invite} className="mb-4">
          <div className="text-xs pz-label mb-1" style={{ color: GOLD, fontFamily: MONO_FONT, letterSpacing: "0.08em" }}>INVITE A PROFESSOR</div>
          <div className="flex gap-2 flex-wrap">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@university.edu"
              aria-label="New professor's email" className="flex-1 px-3 py-2 rounded" style={{ ...AUTH_INPUT, minWidth: 200 }} />
            <button type="submit" disabled={busy === "invite"} aria-busy={busy === "invite" ? "true" : "false"}
              className="px-3 py-2 rounded font-bold text-sm" style={BTN_PRIMARY}>Invite</button>
          </div>
        </form>
        {sent && (
          <div className="mb-4 p-3 rounded" role="status" style={{ border: `1px solid ${GOLD}` }}>
            <div className="mb-2">
              <b>{sent.email}</b> can now sign in as a professor. {sent.copied ? "The invite link is copied: " : "Send them this link: "}
              paste it into an email to them.
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              <input readOnly value={sent.url} onFocus={(e) => e.target.select()} aria-label="Invite link"
                className="flex-1 px-2 py-1 rounded text-xs" style={{ ...AUTH_INPUT, fontFamily: MONO_FONT, minWidth: 200 }} />
              <button onClick={async () => setSent({ ...sent, copied: await copy(sent.url) })} className="px-3 py-1 rounded text-sm" style={BTN_SECONDARY}>
                {sent.copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <div className="mt-2 text-xs" style={{ opacity: 0.7 }}>If they already have a student account, they need to sign out and back in.</div>
          </div>
        )}
        {err && <div className="mb-3 text-sm" role="alert" style={{ color: "#ff8a70" }}>{err}</div>}
        {list === null && !err && <div style={{ opacity: 0.7 }}>Loading…</div>}
        <div className="flex flex-col gap-2">
          {(list || []).map((p) => (
            <div key={p.email} className="flex items-center gap-2 flex-wrap">
              <span className="flex-1" style={{ minWidth: 180, wordBreak: "break-all" }}>
                {p.email}
                {p.invitedByName && <span className="text-xs" style={{ opacity: 0.6 }}> · invited by {p.invitedByName} {shortDate(p.invitedAt)}</span>}
              </span>
              <span className="text-xs px-2 py-1 rounded font-bold" style={{ border: "1px solid #5a6061", fontFamily: MONO_FONT }}>
                {p.root ? "ADMIN" : PROF_STATUS[p.status] || p.status.toUpperCase()}
              </span>
              {!p.root && p.email !== (me.email || "").toLowerCase() && (
                <button onClick={() => remove(p)} disabled={busy === p.email} aria-busy={busy === p.email ? "true" : "false"}
                  className="px-2 py-1 rounded text-xs" style={BTN_SECONDARY}>Remove</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

/* Signed-in landing page: the professor or student dashboard. */
function AccountHome({ user, notice, onDismiss }) {
  const prof = user.role === "professor";
  return (
    <div className="min-h-screen p-6" style={{ background: DEEP, color: PAPER, fontFamily: BODY_FONT, textAlign: "left" }}>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <Wordmark light h="28px" />
          <div className="flex items-center gap-3 text-sm flex-wrap">
            <span style={{ fontFamily: BODY_HI }}>{user.name}</span>
            <span className="text-xs px-2 py-1 rounded font-bold" style={{ background: prof ? GOLD : CHARCOAL, color: prof ? DEEP : PAPER, fontFamily: MONO_FONT }}>
              {prof ? "PROFESSOR" : "STUDENT"}
            </span>
            <button onClick={signOut} style={AUTH_LINK}>Sign out</button>
          </div>
        </div>
        <GoldRule />
        {notice && (
          <div className="mt-6 p-3 rounded flex items-start gap-3 text-sm" role="status" style={{ background: CHARCOAL, border: `1px solid ${GOLD}` }}>
            <span className="flex-1">{notice}</span>
            <button onClick={onDismiss} aria-label="Dismiss" style={{ ...AUTH_LINK, textDecoration: "none" }}>✕</button>
          </div>
        )}
        {prof ? <ProfessorGames /> : <StudentGames />}
        {prof && <ScenarioLibrary me={user} />}
        {prof && <ProfessorsPanel me={user} />}
        {prof && DESIGNER_HASH && <DesignerSetting />}
      </div>
    </div>
  );
}

/* One mounted game. Keyed by game id by its parent, so polling, timers and
   the AI host all start fresh when a different game is opened. */
function GameRoom({ kind, team, observer, game, onExit }) {
  const sh = useShared(5000);
  if (kind === "projector") return <Projector sh={sh} />;
  if (kind === "facilitator") return <Facilitator sh={sh} game={game} onExit={onExit} />;
  return <TeamView team={team} sh={sh} observer={!!observer} />;
}

function GameMessage({ title, message, onLeave }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: DEEP, fontFamily: BODY_FONT }}>
      <div className="w-full max-w-sm text-center" style={{ color: PAPER }}>
        <div className="mb-6"><Wordmark light h="36px" /></div>
        {title && <h1 className="text-lg font-bold mb-3" style={{ color: PAPER, fontFamily: HEAD_FONT, letterSpacing: "0.06em" }}>{title.toUpperCase()}</h1>}
        <div className="text-sm mb-6" style={{ opacity: 0.85 }}>{message}</div>
        {onLeave && <button onClick={onLeave} className="text-sm" style={AUTH_LINK}>Back to your account</button>}
      </div>
    </div>
  );
}

/* Opens game `gameId` for the signed-in user: the owner gets the facilitator
   console (or the projector with ?view=projector), a student gets their
   assigned delegation. Shared storage is pointed at this game's document
   before the room mounts. A student still waiting for a seat is re-checked
   every few seconds. */
function GameEntry({ gameId, view, onLeave }) {
  const [state, setState] = useState({ phase: "loading" });
  const onLeaveRef = React.useRef(onLeave);
  useEffect(() => { onLeaveRef.current = onLeave; });

  useEffect(() => {
    let alive = true, timer = null, inRoom = false;
    const load = async () => {
      try {
        const { game, membership, scenario } = await api("GET", `/games/${encodeURIComponent(gameId)}`);
        if (!alive) return;
        // The game's own cartridge copy; games from before the library run the built-in template.
        if (scenario) applyScenario(scenario, `game:${gameId}`);
        else applyScenario(SCENARIO, BUILTIN);
        const owner = game.ownerId === membership.userId;
        // A student who was playing when the professor paused or ended goes home with a notice.
        if (!owner && inRoom && (game.status === "paused" || game.status === "completed")) {
          onLeaveRef.current(game.status === "paused"
            ? `Your professor paused "${game.title}" for next class. Your work is saved; you'll be able to rejoin once they resume it.`
            : `"${game.title}" has ended. You can view the results from your games.`);
          return;
        }
        let room = null, wait = null;
        if (owner) room = { kind: view === "projector" ? "projector" : "facilitator" };
        else if (game.status === "paused") wait = "This game is paused. Your professor will resume it.";
        else if (!membership.delegation) wait = game.status === "completed"
          ? "This game has ended. You weren't assigned a delegation, so there are no results to show."
          : "You're in. Waiting for your professor to assign your delegation.";
        else if (membership.delegation === "observer") room = { kind: "projector" };
        // A finished game opens read-only: the delegation's screen in observer mode.
        else if (TEAMS.includes(membership.delegation)) room = { kind: "team", team: membership.delegation, observer: game.status === "completed" };
        else wait = `Your delegation "${membership.delegation}" isn't part of this scenario. Ask your professor to reassign you.`;
        inRoom = !!room;
        if (room) {
          if (getActiveGame() !== gameId) { setActiveGame(gameId); resetDocState(); }
          setGameDeadline(game.setup?.minutes);
          // Same seat as before: keep the mounted room (no remount, no lost drafts).
          setState((prev) => (prev.phase === "room" && prev.room.kind === room.kind && prev.room.team === room.team && !!prev.room.observer === !!room.observer
            ? prev : { phase: "room", room, game }));
          // Students keep following their seat: reassigned, made observer, or unassigned.
          if (!owner) timer = setTimeout(load, 10000);
        } else {
          setState({ phase: "wait", message: wait, game });
          timer = setTimeout(load, 5000);
        }
      } catch (e) {
        if (!alive) return;
        // A blip while already playing shouldn't throw the student out; try again.
        if (inRoom && e.status !== 404) { timer = setTimeout(load, 10000); return; }
        setState({ phase: "error", message: e.message });
      }
    };
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, [gameId, view]);

  // Leaving the game (or switching to another) detaches storage from it.
  useEffect(() => () => { setActiveGame(null); resetDocState(); applyScenario(SCENARIO, BUILTIN); setGameDeadline(null); }, [gameId]);

  if (state.phase === "loading") return <GameMessage message="Opening the game…" />;
  if (state.phase === "error") return <GameMessage title="Can't open this game" message={state.message} onLeave={onLeave} />;
  if (state.phase === "wait") return <GameMessage title={state.game.title} message={state.message} onLeave={onLeave} />;
  return <GameRoom key={`${gameId}:${state.room.kind}:${state.room.team || ""}:${state.room.observer ? "ro" : "rw"}`} {...state.room} game={state.game} onExit={onLeave} />;
}

/* ?game=<id>[&view=projector] in the address bar is the open game, so a
   refresh mid-class lands back in it and Back returns to the account page. */
const readRoute = () => {
  const q = new URLSearchParams(location.search);
  return { gameId: q.get("game"), view: q.get("view") };
};
function openGame(gameId, view) {
  const q = new URLSearchParams(location.search);
  q.delete("game"); q.delete("view");
  if (gameId) q.set("game", gameId);
  if (gameId && view) q.set("view", view);
  const qs = q.toString();
  history.pushState(null, "", `${location.pathname}${qs ? `?${qs}` : ""}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export default function App() {
  useFontEmbed();
  const [user, setUser] = useState(currentUser);
  const [route, setRoute] = useState(readRoute);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Sign-out (or an expired refresh token) anywhere returns to the login screen.
  useEffect(() => onAuthChange(() => setUser(currentUser())), []);

  if (!user) return <Login onSignedIn={setUser} />;
  if (route.gameId) {
    const leave = (msg) => { setNotice(typeof msg === "string" ? msg : ""); openGame(null); };
    return <GameEntry key={route.gameId} gameId={route.gameId} view={route.view} onLeave={leave} />;
  }
  return <AccountHome user={user} notice={notice} onDismiss={() => setNotice("")} />;
}
