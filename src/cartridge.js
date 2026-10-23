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
  s.mode ??= "accord";
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

/* One-line description for library listings. */
export function summarize(s) {
  const n = (x, one) => `${x} ${one}${x === 1 ? "" : "s"}`;
  return {
    title: s.meta.title,
    delegations: s.delegations.map((d) => ({ id: d.id, name: d.name, flag: d.flag || "" })),
    text: [n(s.delegations.length, "delegation"), n(s.issues.length, "issue"), n(s.injects.length, "inject")].join(" · "),
  };
}

/* Read a picked file into a checked cartridge, ready to preview and save. */
export async function readCartridgeFile(file) {
  const raw = parseCartridge(await file.text());
  const cartridge = normalizeCartridge(raw);
  return { cartridge, findings: checkCartridge(cartridge) };
}
