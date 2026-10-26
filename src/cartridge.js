/* Scenario cartridges uploaded by professors. A cartridge is the SCENARIO
   object the engine reads (see the field list in App.jsx, BEGIN SCENARIO
   CONFIG). Files come as .json or as the original .js cartridge format:
     // comments …
     const SCENARIO = { meta: { id: "ind26", … }, … };
     export default SCENARIO;
   parseCartridge reads that object-literal syntax with a small tokenizer
   (comments, unquoted keys, single/double/backtick strings, trailing commas).
   Nothing is evaluated: a computed value is an error with its line number. */

export class CartridgeError extends Error {}

const DELEGATION_RE = /^[A-Za-z0-9_-]{1,40}$/; // same rule as the games API
export const MAX_CARTRIDGE_CHARS = 200_000;     // serialized JSON, same cap as the API

/* ---- game modes ----
   Every cartridge declares which of the three game types it is. The type is
   chosen FIRST when designing a game, because each type has its own scoring
   rubric: the engine dispatches on `mode` to pick the rubric to apply.

   `scoring` names that rubric (see the scoring registry in App.jsx).
   `implemented` says whether the engine actually has it yet. Today only
   "accord" does. A standoff or estimate cartridge is still valid — it can be
   authored, saved, shared and opened — but the engine says plainly that it
   cannot score it rather than quietly scoring it as an accord, which would
   produce confident wrong numbers.

   To implement a rubric: write it in App.jsx's registry, then flip
   `implemented` to true here. Nothing else needs to change. */
export const GAME_MODES = {
  accord: {
    id: "accord",
    name: "Accord",
    label: "Accord — cooperative, everyone works toward one deal",
    blurb: "Cooperative. All delegations work to reach an agreement. Not zero-sum: every team wins or loses together, though some win more than others. AI can play an antagonist Red Cell as well as the White Cell.",
    scoring: "accord",
    implemented: true,
  },
  standoff: {
    id: "standoff",
    name: "Standoff",
    label: "Standoff — zero-sum, one side wins and one loses",
    blurb: "Zero-sum, with one side winning and the other losing: a pure binary outcome. AI can play the White Cell, or a third party whose moves change what the two main cells do.",
    scoring: "standoff",
    implemented: false,
  },
  estimate: {
    id: "estimate",
    name: "Estimate",
    label: "Estimate — one team manages an external crisis",
    blurb: "A team faces an external crisis it has to address or manage, which may not be solvable. They succeed or they don't, and some scenarios allow an in-between. AI plays the antagonist and may play a White Cell role as well.",
    scoring: "estimate",
    implemented: false,
  },
};

export const MODE_IDS = Object.keys(GAME_MODES);
export const DEFAULT_MODE = "accord";

/* The mode record for a cartridge. Falls back to accord so callers never have
   to null-check; checkCartridge is what rejects an unknown mode. */
export function modeOf(s) {
  return GAME_MODES[s && s.mode] || GAME_MODES[DEFAULT_MODE];
}

/* Does the engine have a scoring rubric for this cartridge's game type?
   The editor and the facilitator console both use this to say plainly when a
   scenario can be run but not yet scored. */
export function scoringReady(s) {
  return modeOf(s).implemented === true;
}

/* ---- parsing ---- */

export function parseCartridge(text) {
  if (typeof text !== "string" || !text.trim()) throw new CartridgeError("The file is empty.");
  let i = 0;
  const lineAt = (pos) => text.slice(0, pos).split("\n").length;
  const err = (msg, pos = i) => { throw new CartridgeError(`Line ${lineAt(pos)}: ${msg}`); };

  const skip = () => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text.startsWith("//", i)) { while (i < text.length && text[i] !== "\n") i++; continue; }
      if (text.startsWith("/*", i)) {
        const end = text.indexOf("*/", i + 2);
        if (end < 0) err("a /* comment is never closed.");
        i = end + 2; continue;
      }
      return;
    }
  };
  const ident = () => {
    const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(i, i + 200));
    return m ? m[0] : null;
  };
  const word = (w) => { skip(); if (ident() === w) { i += w.length; return true; } return false; };

  function str() {
    const q = text[i];
    let out = "";
    i++;
    while (i < text.length && text[i] !== q) {
      const c = text[i];
      if (q === "`" && c === "$" && text[i + 1] === "{") err("template values like ${…} aren't allowed; write the text out in full.");
      if (c === "\n" && q !== "`") err("a string runs past the end of its line.");
      if (c === "\\") {
        const n = text[i + 1];
        const simple = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" };
        if (n === "u") {
          const hex = text[i + 2] === "{" ? text.slice(i + 3, text.indexOf("}", i)) : text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) err("bad \\u escape in a string.");
          out += String.fromCodePoint(parseInt(hex, 16));
          i += text[i + 2] === "{" ? hex.length + 4 : 6;
          continue;
        }
        if (n === "\n") { i += 2; continue; } // line continuation
        out += simple[n] ?? n;
        i += 2;
        continue;
      }
      out += c;
      i++;
    }
    if (i >= text.length) err("a string is never closed.");
    i++;
    return out;
  }

  function value() {
    skip();
    const c = text[i];
    if (c === "{") return obj();
    if (c === "[") return arr();
    if (c === '"' || c === "'" || c === "`") return str();
    const num = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(text.slice(i, i + 40));
    if (num) { i += num[0].length; return Number(num[0]); }
    const id = ident();
    if (id === "true" || id === "false" || id === "null") { i += id.length; return id === "true" ? true : id === "false" ? false : null; }
    if (i >= text.length) err("the file ends in the middle of a value.");
    err(`"${(id || text.slice(i, i + 20)).split("\n")[0]}" isn't a plain value. Values must be text in quotes, numbers, true/false/null, lists or objects; computed values (variables, function calls) aren't supported. Replace it with the value itself, or save the cartridge as JSON.`);
  }

  function obj() {
    const out = {};
    i++;
    for (;;) {
      skip();
      if (text[i] === "}") { i++; return out; }
      let key;
      const start = i;
      if (text[i] === '"' || text[i] === "'") key = str();
      else if ((key = ident()) || (key = /^\d+/.exec(text.slice(i, i + 20))?.[0])) i += key.length;
      else err("expected a property name.");
      if (key === "__proto__") err('"__proto__" can\'t be used as a key.', start);
      skip();
      if (text[i] !== ":") err(`expected ":" after "${key}".`);
      i++;
      out[key] = value();
      skip();
      if (text[i] === ",") { i++; continue; }
      if (text[i] === "}") { i++; return out; }
      err(`expected "," or "}" after "${key}".`);
    }
  }

  function arr() {
    const out = [];
    i++;
    for (;;) {
      skip();
      if (text[i] === "]") { i++; return out; }
      out.push(value());
      skip();
      if (text[i] === ",") { i++; continue; }
      if (text[i] === "]") { i++; return out; }
      err('expected "," or "]" in a list.');
    }
  }

  // Optional `const NAME =` / `export default` before the object.
  skip();
  if (word("export")) { if (!word("default")) err('expected "export default".'); }
  else if (["const", "let", "var"].some((w) => word(w))) {
    skip();
    const name = ident();
    if (!name) err("expected a variable name.");
    i += name.length;
    skip();
    if (text[i] !== "=") err(`expected "=" after "${name}".`);
    i++;
  }
  skip();
  if (text[i] !== "{") err("a cartridge must be an object that starts with {.");
  const result = obj();

  // Allowed after the object: ";" and "export default NAME;".
  skip();
  if (text[i] === ";") i++;
  if (word("export")) {
    if (!word("default")) err('expected "export default".');
    skip();
    const name = ident();
    if (name) i += name.length;
    skip();
    if (text[i] === ";") i++;
  }
  skip();
  if (i < text.length) err("unexpected text after the cartridge object.");
  return result;
}

/* ---- normalizing ---- */

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/* The engine assumes these exist; old cartridges sometimes leave them out.
   matrixB64 (base64 JSON) is decoded into a plain `matrix` object. */
export function normalizeCartridge(raw) {
  if (!isObj(raw)) throw new CartridgeError("A cartridge must be an object.");
  const s = structuredClone(raw);
  if (s.matrixB64 != null && s.matrix == null) {
    try { s.matrix = JSON.parse(atob(String(s.matrixB64))); }
    catch { throw new CartridgeError("matrixB64 isn't valid base64-encoded JSON."); }
  }
  delete s.matrixB64;
  /* Missing mode: an older cartridge, written before game types existed, and
     every one of those is an accord. Present but odd: trimmed and lowercased
     so "Standoff " matches, then left alone — checkCartridge rejects anything
     that still isn't one of the three, rather than silently calling it an
     accord and scoring it with the wrong rubric. */
  if (s.mode == null || s.mode === "") s.mode = DEFAULT_MODE;
  else if (typeof s.mode === "string") s.mode = s.mode.trim().toLowerCase();
  s.meta = isObj(s.meta) ? s.meta : {};
  s.scoring = { dealWeight: 0.8, credWeight: 0.2, mediatorClosureShare: 0.5, startCred: 50, ...(isObj(s.scoring) ? s.scoring : {}) };
  s.mechanics = { amendmentPolicy: "reconfirm", injectAckRequired: true, maxLiveDrafts: null, ...(isObj(s.mechanics) ? s.mechanics : {}) };
  s.synthesis = isObj(s.synthesis) ? s.synthesis : { enabled: false, pairs: [] };
  s.injects = Array.isArray(s.injects) ? s.injects : [];
  const pd = isObj(s.publicDiplomacy) ? s.publicDiplomacy : null;
  if (pd && isObj(pd.moods)) {
    for (const m of Object.values(pd.moods)) {
      if (!isObj(m)) continue;
      m.favored = Array.isArray(m.favored) ? m.favored : [];
      m.penalized = Array.isArray(m.penalized) ? m.penalized : [];
    }
  }
  return s;
}

/* ---- checks ---- */

/* Findings: { level: "hard" | "advisory", text }. Hard findings stop an upload
   (the engine would crash or score wrongly); advisory ones are design warnings.
   designRules is the integrity check the facilitator console shows. */
export function checkCartridge(s) {
  const hard = (text) => findings.push({ level: "hard", text });
  const findings = [];
  if (!isObj(s)) return [{ level: "hard", text: "A cartridge must be an object." }];

  /* Game type first: it decides which scoring rubric the engine applies, so a
     cartridge that doesn't name one the engine knows can't be scored at all. */
  if (!MODE_IDS.includes(s.mode)) {
    hard(`mode ${JSON.stringify(s.mode)} isn't a game type. Use one of: ${MODE_IDS.join(", ")}.`);
  }

  const meta = s.meta || {};
  if (!meta.id || typeof meta.id !== "string") hard("meta.id is missing (a short id such as \"ind26\").");
  if (!meta.title || typeof meta.title !== "string") hard("meta.title is missing.");
  if (!(Number(meta.deadlineMinutes) > 0)) hard("meta.deadlineMinutes must be a number of minutes.");

  const dels = Array.isArray(s.delegations) ? s.delegations : [];
  if (dels.length < 2) hard("delegations needs at least two delegations.");
  const ids = new Set();
  dels.forEach((d, n) => {
    const where = `Delegation ${n + 1}`;
    if (!isObj(d)) { hard(`${where} isn't an object.`); return; }
    if (typeof d.id !== "string" || !DELEGATION_RE.test(d.id)) hard(`${where}: id "${d.id}" must be 1–40 letters, digits, - or _.`);
    else if (d.id === "observer") hard(`${where}: "observer" is reserved.`);
    else if (ids.has(d.id)) hard(`${where}: id "${d.id}" is used twice.`);
    ids.add(d.id);
    if (!d.name) hard(`${where} (${d.id}): name is missing.`);
    if (!isObj(d.ministry)) hard(`${where} (${d.id}): ministry { wire, title, speaker } is missing.`);
  });

  const issues = Array.isArray(s.issues) ? s.issues : [];
  if (!issues.length) hard("issues needs at least one issue.");
  const issueIds = new Set();
  issues.forEach((iss, n) => {
    const where = `Issue ${n + 1}`;
    if (!isObj(iss)) { hard(`${where} isn't an object.`); return; }
    if (!iss.id) hard(`${where}: id is missing.`);
    else if (issueIds.has(iss.id)) hard(`${where}: id "${iss.id}" is used twice.`);
    issueIds.add(iss.id);
    if (!iss.label) hard(`${where} (${iss.id}): label is missing.`);
    if (!Array.isArray(iss.options) || iss.options.length < 2) hard(`${where} (${iss.id}): needs at least two options.`);
    if (iss.pillOptions && (!Array.isArray(iss.pillOptions) || iss.pillOptions.length !== (iss.options || []).length)) {
      hard(`${where} (${iss.id}): pillOptions must have one entry per option.`);
    }
  });

  if (!isObj(s.matrix)) hard("The rank matrix (matrix or matrixB64) is missing.");
  else {
    for (const d of dels) {
      for (const iss of issues) {
        const v = s.matrix[d?.id]?.[iss?.id];
        const n = (iss?.options || []).length;
        if (v == null) hard(`Matrix is missing ${d?.id} × ${iss?.id}.`);
        else if (iss.type === "ranked") {
          const ok = Array.isArray(v) && v.length === n && [...v].sort((a, b) => a - b).every((r, k) => r === k + 1);
          if (!ok) hard(`Matrix ${d.id} × ${iss.id} must rank the ${n} options 1…${n}, each once.`);
        } else if (!(Number.isInteger(v) && v >= 0 && v < n)) hard(`Matrix ${d.id} × ${iss.id} must be the index of the required option (0–${n - 1}).`);
      }
    }
  }

  for (const d of dels) {
    if (!isObj(d)) continue;
    if (d.priority != null && !issueIds.has(d.priority)) hard(`${d.id}: priority "${d.priority}" isn't an issue id.`);
    for (const k of Object.keys(isObj(d.redLines) ? d.redLines : {})) {
      if (!issueIds.has(k)) hard(`${d.id}: red line on unknown issue "${k}".`);
    }
  }

  const pd = s.publicDiplomacy;
  if (!isObj(pd)) hard("publicDiplomacy is missing.");
  else {
    if (!Array.isArray(pd.postures) || !pd.postures.length) hard("publicDiplomacy.postures needs at least one posture.");
    const w = pd.windows || {};
    if (!(w.total >= 0 && w.minutes > 0)) hard("publicDiplomacy.windows needs total and minutes.");
    if (!isObj(pd.moods) || !Object.keys(pd.moods).length) hard("publicDiplomacy.moods needs at least one mood.");
    else {
      if (!pd.moods[pd.defaultMood]) hard(`publicDiplomacy.defaultMood "${pd.defaultMood}" isn't one of the moods.`);
      for (const [k, m] of Object.entries(pd.moods)) {
        if (!isObj(m) || ![m.we, m.wl, m.wp].every((x) => typeof x === "number")) hard(`Mood ${k} needs numeric we, wl and wp weights.`);
      }
    }
  }

  const injIds = new Set();
  (Array.isArray(s.injects) ? s.injects : []).forEach((j, n) => {
    const where = `Inject ${n + 1}`;
    if (!isObj(j)) { hard(`${where} isn't an object.`); return; }
    if (!j.id) hard(`${where}: id is missing.`);
    else if (injIds.has(j.id)) hard(`${where}: id "${j.id}" is used twice.`);
    injIds.add(j.id);
    if (!j.title || !j.body) hard(`${where} (${j.id}): title and body are required.`);
    if (j.mood != null && isObj(pd?.moods) && !pd.moods[j.mood]) hard(`${where} (${j.id}): mood "${j.mood}" isn't one of the moods.`);
  });

  if (JSON.stringify(s).length > MAX_CARTRIDGE_CHARS) hard(`The cartridge is larger than ${MAX_CARTRIDGE_CHARS / 1000} KB.`);

  // Design rules only make sense on a structurally sound cartridge.
  if (!findings.length) findings.push(...designRules(s));
  return findings;
}

/* Design rules from the template spec (was scenarioIntegrity in App.jsx). */
export function designRules(s) {
  const findings = [];
  const teams = s.delegations.map((d) => d.id);
  const M = s.matrix || {};
  teams.forEach((t) => {
    s.issues.forEach((iss) => {
      const v = M[t] && M[t][iss.id];
      if (v == null) findings.push({ level: "hard", text: `Matrix missing: ${t} · ${iss.id}` });
      else if (iss.type === "ranked" && (!Array.isArray(v) || v.length !== iss.options.length))
        findings.push({ level: "hard", text: `Matrix malformed: ${t} · ${iss.id}` });
    });
  });
  s.issues.filter((iss) => iss.type === "ranked").forEach((iss) => {
    const firsts = {};
    teams.forEach((t) => {
      const arr = M[t] && M[t][iss.id];
      if (!Array.isArray(arr)) return;
      const i = arr.indexOf(1);
      (firsts[i] = firsts[i] || []).push(t);
    });
    Object.entries(firsts).forEach(([i, ts]) => {
      if (ts.length > 1) findings.push({ level: "advisory", text: `Shared #1 on ${iss.id}: "${iss.options[i]}" (${ts.join(", ")})` });
    });
    const n = iss.options.length;
    if (n >= 3) {
      const middles = Array.from({ length: n }, (_, i) => i).slice(1, -1);
      const safe = middles.some((i) => teams.every((t) => {
        const arr = M[t] && M[t][iss.id];
        return Array.isArray(arr) ? arr[i] !== n : true;
      }));
      if (!safe) findings.push({ level: "hard", text: `No safe middle on ${iss.id}: every compromise option is someone's worst` });
    }
  });
  return findings;
}

/* One-line description for library listings. The game type leads, since it is
   the first thing that decides how a scenario plays and how it is scored. */
export function summarize(s) {
  const n = (x, one) => `${x} ${one}${x === 1 ? "" : "s"}`;
  const mode = modeOf(s);
  return {
    title: s.meta.title,
    mode: mode.id,
    modeName: mode.name,
    scoringReady: mode.implemented,
    delegations: s.delegations.map((d) => ({ id: d.id, name: d.name, flag: d.flag || "" })),
    text: [mode.name, n(s.delegations.length, "delegation"), n(s.issues.length, "issue"), n(s.injects.length, "inject")].join(" · "),
  };
}

/* Read a picked file into a checked cartridge, ready to preview and save. */
export async function readCartridgeFile(file) {
  const raw = parseCartridge(await file.text());
  const cartridge = normalizeCartridge(raw);
  return { cartridge, findings: checkCartridge(cartridge) };
}

/* ---- editing ----
   Pure helpers for the scenario editor. Each takes a normalized cartridge and
   returns a new one, keeping every reference consistent: the rank matrix,
   delegation priorities and red lines, and moods used by injects. Option
   indices are what the matrix and red lines store, so adding, removing or
   moving an option rewrites them. */

const clone = (s) => structuredClone(s);
const uniqueId = (base, taken) => {
  let n = 1;
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
};
/* Default matrix cell: options ranked in listed order, or the first option required. */
const defaultCell = (iss) => (iss.type === "ranked" ? iss.options.map((_, i) => i + 1) : 0);
// Ranks 1..n in the same relative order, e.g. [4, 1, 3] -> [3, 1, 2].
const rerank = (ranks) => {
  const order = ranks.map((r, i) => [r, i]).sort((a, b) => a[0] - b[0]);
  const out = [];
  order.forEach(([, i], k) => { out[i] = k + 1; });
  return out;
};

export function blankCartridge(template) {
  const s = normalizeCartridge(template);
  s.meta = { ...s.meta, id: `sc${Date.now().toString(36).slice(-6)}`, title: "NEW SCENARIO", gateTagline: "NEW SCENARIO", projectorSubtitle: "NEW SCENARIO" };
  return s;
}

export function addDelegation(s0) {
  const s = clone(s0);
  const id = uniqueId("Delegation", new Set(s.delegations.map((d) => d.id)));
  s.delegations.push({
    id, name: id, flag: "🏳️", mediator: false,
    ministry: { wire: `${id.toUpperCase()} — FOREIGN MINISTRY`, title: "Foreign Ministry", speaker: `The Foreign Ministry of ${id}` },
    priority: null, noDealPct: 30, redLines: {},
    domestic: { label: `${id} public`, dispatch: "", moods: {} },
  });
  s.matrix[id] = Object.fromEntries(s.issues.map((iss) => [iss.id, defaultCell(iss)]));
  return s;
}

export function renameDelegation(s0, from, to) {
  if (from === to) return s0;
  const s = clone(s0);
  const d = s.delegations.find((x) => x.id === from);
  if (!d || s.delegations.some((x) => x.id === to)) return s0;
  d.id = to;
  s.matrix[to] = s.matrix[from] || {};
  delete s.matrix[from];
  return s;
}

export function removeDelegation(s0, id) {
  const s = clone(s0);
  s.delegations = s.delegations.filter((d) => d.id !== id);
  delete s.matrix[id];
  return s;
}

export function addIssue(s0) {
  const s = clone(s0);
  const id = uniqueId("issue", new Set(s.issues.map((i) => i.id)));
  const iss = { id, label: "NEW ISSUE", short: "New issue", type: "ranked", options: ["Option A", "Option B", "Option C"] };
  s.issues.push(iss);
  for (const d of s.delegations) (s.matrix[d.id] ||= {})[id] = defaultCell(iss);
  return s;
}

export function renameIssue(s0, from, to) {
  if (from === to) return s0;
  const s = clone(s0);
  const iss = s.issues.find((x) => x.id === from);
  if (!iss || s.issues.some((x) => x.id === to)) return s0;
  iss.id = to;
  for (const d of s.delegations) {
    const row = s.matrix[d.id] || {};
    if (from in row) { row[to] = row[from]; delete row[from]; }
    if (d.priority === from) d.priority = to;
    if (d.redLines && from in d.redLines) { d.redLines[to] = d.redLines[from]; delete d.redLines[from]; }
  }
  return s;
}

export function removeIssue(s0, id) {
  const s = clone(s0);
  s.issues = s.issues.filter((i) => i.id !== id);
  for (const d of s.delegations) {
    if (s.matrix[d.id]) delete s.matrix[d.id][id];
    if (d.priority === id) d.priority = null;
    if (d.redLines) delete d.redLines[id];
  }
  return s;
}

export function setIssueType(s0, id, type) {
  const s = clone(s0);
  const iss = s.issues.find((x) => x.id === id);
  if (!iss || iss.type === type) return s0;
  iss.type = type;
  for (const d of s.delegations) {
    const row = (s.matrix[d.id] ||= {});
    const v = row[id];
    if (type === "ranked") {
      // The required option becomes #1, the rest keep their listed order.
      const req = Number.isInteger(v) ? v : 0;
      const order = [req, ...iss.options.map((_, i) => i).filter((i) => i !== req)];
      row[id] = iss.options.map((_, i) => order.indexOf(i) + 1);
    } else {
      row[id] = Array.isArray(v) && v.indexOf(1) >= 0 ? v.indexOf(1) : 0;
    }
  }
  return s;
}

/* Add an option at the end: ranked last by everyone, nobody's requirement. */
export function addOption(s0, id) {
  const s = clone(s0);
  const iss = s.issues.find((x) => x.id === id);
  if (!iss) return s0;
  iss.options.push(`Option ${String.fromCharCode(65 + iss.options.length)}`);
  if (iss.pillOptions) iss.pillOptions.push(iss.options[iss.options.length - 1]);
  for (const d of s.delegations) {
    const row = (s.matrix[d.id] ||= {});
    if (iss.type === "ranked") row[id] = [...(Array.isArray(row[id]) ? row[id] : defaultCell({ ...iss, options: iss.options.slice(0, -1) })), iss.options.length];
  }
  return s;
}

export function removeOption(s0, id, k) {
  const s = clone(s0);
  const iss = s.issues.find((x) => x.id === id);
  if (!iss || iss.options.length <= 2) return s0;
  iss.options.splice(k, 1);
  if (iss.pillOptions) iss.pillOptions.splice(k, 1);
  for (const d of s.delegations) {
    const row = (s.matrix[d.id] ||= {});
    const v = row[id];
    if (iss.type === "ranked") row[id] = Array.isArray(v) ? rerank(v.filter((_, i) => i !== k)) : defaultCell(iss);
    else row[id] = v === k ? 0 : v > k ? v - 1 : v;
    if (d.redLines?.[id]) d.redLines[id] = d.redLines[id].filter((i) => i !== k).map((i) => (i > k ? i - 1 : i));
  }
  return s;
}

/* Move option k by delta (-1 up, +1 down); rankings follow the option. */
export function moveOption(s0, id, k, delta) {
  const j = k + delta;
  const s = clone(s0);
  const iss = s.issues.find((x) => x.id === id);
  if (!iss || j < 0 || j >= iss.options.length) return s0;
  const swap = (arr) => { if (Array.isArray(arr)) [arr[k], arr[j]] = [arr[j], arr[k]]; };
  swap(iss.options);
  swap(iss.pillOptions);
  const remap = (i) => (i === k ? j : i === j ? k : i);
  for (const d of s.delegations) {
    const row = (s.matrix[d.id] ||= {});
    if (iss.type === "ranked") swap(row[id]);
    else if (Number.isInteger(row[id])) row[id] = remap(row[id]);
    if (d.redLines?.[id]) d.redLines[id] = d.redLines[id].map(remap);
  }
  return s;
}

/* Put option `opt` at rank `rank` (1-based) for a delegation; whatever held
   that rank takes opt's old rank, so the cell stays a permutation. */
export function setRank(s0, delegation, id, rank, opt) {
  const s = clone(s0);
  const iss = s.issues.find((x) => x.id === id);
  const row = (s.matrix[delegation] ||= {});
  const ranks = Array.isArray(row[id]) && row[id].length === iss.options.length ? [...row[id]] : defaultCell(iss);
  const holder = ranks.indexOf(rank);
  const old = ranks[opt];
  if (holder >= 0) ranks[holder] = old;
  ranks[opt] = rank;
  row[id] = ranks;
  return s;
}

export function renameMood(s0, from, to) {
  if (from === to) return s0;
  const s = clone(s0);
  const moods = s.publicDiplomacy.moods;
  if (!(from in moods) || to in moods) return s0;
  // Keep key order so the console lists moods as before.
  s.publicDiplomacy.moods = Object.fromEntries(Object.entries(moods).map(([k, v]) => [k === from ? to : k, v]));
  if (s.publicDiplomacy.defaultMood === from) s.publicDiplomacy.defaultMood = to;
  for (const j of s.injects) if (j.mood === from) j.mood = to;
  return s;
}

export function removeMood(s0, key) {
  const s = clone(s0);
  const moods = s.publicDiplomacy.moods;
  if (Object.keys(moods).length <= 1) return s0;
  delete moods[key];
  if (s.publicDiplomacy.defaultMood === key) s.publicDiplomacy.defaultMood = Object.keys(moods)[0];
  for (const j of s.injects) if (j.mood === key) j.mood = null;
  return s;
}

/* Postures are referenced by name in each mood's favored/penalized lists. */
export function setPostures(s0, postures) {
  const s = clone(s0);
  const keep = new Set(postures);
  s.publicDiplomacy.postures = postures;
  for (const m of Object.values(s.publicDiplomacy.moods)) {
    m.favored = (m.favored || []).filter((p) => keep.has(p));
    m.penalized = (m.penalized || []).filter((p) => keep.has(p));
  }
  return s;
}

export function moveItem(list, i, delta) {
  const j = i + delta;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/* Fill in the structure the editor's forms need, without overwriting
   anything, so a cartridge with problems can still be opened and fixed. */
export function editableCartridge(s0) {
  const s = normalizeCartridge(s0);
  s.delegations = (Array.isArray(s.delegations) ? s.delegations : []).filter(isObj)
    .map((d) => ({ ...d, ministry: isObj(d.ministry) ? d.ministry : {}, redLines: isObj(d.redLines) ? d.redLines : {} }));
  s.issues = (Array.isArray(s.issues) ? s.issues : []).filter(isObj)
    .map((i) => ({ type: "ranked", ...i, options: Array.isArray(i.options) ? i.options : [] }));
  s.matrix = isObj(s.matrix) ? s.matrix : {};
  const pd = isObj(s.publicDiplomacy) ? s.publicDiplomacy : {};
  s.publicDiplomacy = {
    enabled: true, scoringContext: "", pressRoomTag: "PRESS ROOM", ...pd,
    postures: Array.isArray(pd.postures) && pd.postures.length ? pd.postures : ["Reassure", "Pressure", "Defend", "Condemn", "Signal flexibility"],
    windows: { total: 2, minutes: 6, missedPenalty: 4, ...(isObj(pd.windows) ? pd.windows : {}) },
    moods: isObj(pd.moods) && Object.keys(pd.moods).length ? pd.moods : { NEUTRAL: { dispatch: "", we: 1, wl: 1, wp: 1, favored: [], penalized: [] } },
  };
  if (!s.publicDiplomacy.moods[s.publicDiplomacy.defaultMood]) s.publicDiplomacy.defaultMood = Object.keys(s.publicDiplomacy.moods)[0];
  return normalizeCartridge(s);
}
