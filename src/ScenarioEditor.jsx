/* Scenario editor: builds a cartridge through forms instead of a file. It
   edits the same object an upload produces (normalized, plain `matrix`) and
   saves through the same library routes, so the checks, the per-game copies
   and New game all work unchanged. Structural edits (renaming an id, adding
   or moving an option, switching an issue's type) go through the helpers in
   cartridge.js, which keep the rank matrix, priorities, red lines and mood
   references consistent. An unsaved draft is kept in this browser. */
import React, { useState, useEffect, useMemo, useRef } from "react";
import { api } from "./api.js";
import {
  checkCartridge, summarize, parseCartridge, normalizeCartridge,
  addDelegation, renameDelegation, removeDelegation,
  addIssue, renameIssue, removeIssue, setIssueType, addOption, removeOption, moveOption, setRank,
  renameMood, removeMood, setPostures, moveItem, editableCartridge,
} from "./cartridge.js";

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const ERR = "#ff8a70";
const ORDINAL = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
const draftKey = (replacing) => `accord-scenario-draft:${replacing ? replacing.scenarioId : "new"}`;
function readDraft(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
}
function writeDraft(key, value) {
  try { if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key); } catch { /* drafts are a convenience */ }
}

const TABS = [
  ["basics", "Basics"], ["delegations", "Delegations"], ["issues", "Issues"], ["rankings", "Rankings"],
  ["press", "Press & moods"], ["injects", "Injects"], ["json", "Advanced (JSON)"],
];

export default function ScenarioEditor({ initial, replacing, ui, onSaved, onCancel }) {
  const key = draftKey(replacing);
  const [s, setS] = useState(() => editableCartridge(initial));
  const [tab, setTab] = useState("basics");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState(() => {
    const d = readDraft(key);
    return d && JSON.stringify(d.cartridge) !== JSON.stringify(editableCartridge(initial)) ? d : null;
  });
  const dirty = useRef(false);

  // Keep a draft of every change (debounced), until it's saved or discarded.
  useEffect(() => {
    if (!dirty.current) return undefined;
    const t = setTimeout(() => writeDraft(key, { cartridge: s, savedAt: Date.now() }), 400);
    return () => clearTimeout(t);
  }, [s, key]);

  const findings = useMemo(() => checkCartridge(s), [s]);
  const hard = findings.filter((f) => f.level === "hard");
  const advisory = findings.filter((f) => f.level === "advisory");

  /* edit(mutator) for plain field changes; apply(helper, ...args) for
     structural changes that must keep references consistent. */
  const edit = (mutate) => { dirty.current = true; setS((cur) => { const n = structuredClone(cur); mutate(n); return n; }); };
  const apply = (fn, ...args) => { dirty.current = true; setS((cur) => fn(cur, ...args)); };

  const save = async () => {
    setBusy(true); setErr("");
    try {
      const r = replacing
        ? await api("PUT", `/scenarios/${encodeURIComponent(replacing.scenarioId)}`, { body: s })
        : await api("POST", "/scenarios", { body: s });
      writeDraft(key, null);
      onSaved(r.scenario, !!replacing);
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  const cancel = () => {
    if (dirty.current && !window.confirm("Discard your changes to this scenario?")) return;
    writeDraft(key, null);
    onCancel();
  };

  const p = { s, edit, apply, ui };
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <h3 className="font-bold flex-1" style={{ color: ui.PAPER, fontFamily: ui.HEAD_FONT, letterSpacing: "0.06em" }}>
          {replacing ? `EDIT · ${replacing.title}` : "NEW SCENARIO"}
        </h3>
        <button onClick={save} disabled={busy || hard.length > 0} aria-busy={busy ? "true" : "false"}
          className="px-3 py-2 rounded font-bold text-sm" style={{ ...ui.BTN_PRIMARY, opacity: hard.length ? 0.5 : 1 }}>
          {replacing ? "Save changes" : "Save to library"}
        </button>
        <button onClick={cancel} disabled={busy} className="px-3 py-2 rounded text-sm" style={ui.BTN_SECONDARY}>Cancel</button>
      </div>
      {replacing && <div className="text-xs mb-3" style={{ opacity: 0.7 }}>Games already created from this scenario keep the version they started with.</div>}

      {draft && (
        <div className="mb-3 p-3 rounded flex items-center gap-2 flex-wrap" role="status" style={{ border: `1px solid ${ui.GOLD}` }}>
          <span className="flex-1">You have unsaved changes from {new Date(draft.savedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.</span>
          <button onClick={() => { dirty.current = true; setS(draft.cartridge); setDraft(null); }} className="px-3 py-1 rounded text-sm font-bold" style={ui.BTN_PRIMARY}>Restore</button>
          <button onClick={() => { writeDraft(key, null); setDraft(null); }} className="px-3 py-1 rounded text-sm" style={ui.BTN_SECONDARY}>Discard</button>
        </div>
      )}

      <Checks hard={hard} advisory={advisory} s={s} ui={ui} />
      {err && <div className="mb-3 text-sm" role="alert" style={{ color: ERR }}>{err}</div>}

      <div className="flex gap-1 flex-wrap mb-3" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className="px-3 py-1 rounded text-sm"
            style={tab === id ? { ...ui.BTN_PRIMARY, fontWeight: 700 } : ui.BTN_SECONDARY}>{label}</button>
        ))}
      </div>

      {tab === "basics" && <Basics {...p} />}
      {tab === "delegations" && <Delegations {...p} />}
      {tab === "issues" && <Issues {...p} />}
      {tab === "rankings" && <Rankings {...p} />}
      {tab === "press" && <Press {...p} />}
      {tab === "injects" && <Injects {...p} />}
      {tab === "json" && <RawJson {...p} setS={(v) => { dirty.current = true; setS(v); }} />}
    </div>
  );
}

/* ---- checks summary ---- */
function Checks({ hard, advisory, s, ui }) {
  const sum = hard.length ? null : summarize(s).text;
  return (
    <div className="mb-3 p-3 rounded text-sm" style={{ border: `1px solid ${hard.length ? ERR : "#3a6b55"}` }}>
      {hard.length === 0
        ? <div><b style={{ color: "#46A07C" }}>✓ Ready to save</b> <span style={{ opacity: 0.75 }}>· {sum}</span></div>
        : <details open>
            <summary className="cursor-pointer" style={{ color: ERR }}><b>{hard.length} problem{hard.length === 1 ? "" : "s"} to fix before saving</b></summary>
            <ul className="list-disc pl-5 mt-1" style={{ color: ERR }}>{hard.slice(0, 15).map((f, i) => <li key={i}>{f.text}</li>)}</ul>
            {hard.length > 15 && <div style={{ color: ERR }}>…and {hard.length - 15} more.</div>}
          </details>}
      {advisory.length > 0 && (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer" style={{ color: "#a07800" }}>{advisory.length} design note{advisory.length === 1 ? "" : "s"} (won't stop the game)</summary>
          <ul className="list-disc pl-5 mt-1" style={{ opacity: 0.85 }}>{advisory.map((f, i) => <li key={i}>{f.text}</li>)}</ul>
        </details>
      )}
      <div className="text-xs mt-1" style={{ opacity: 0.6, color: ui.PAPER }}>Checks update as you type.</div>
    </div>
  );
}

/* ---- small form controls ---- */
function Label({ text, hint, ui, children }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs mb-1" style={{ color: ui.GOLD, fontFamily: ui.MONO_FONT, letterSpacing: "0.08em" }}>{text}</span>
      {children}
      {hint && <span className="block text-xs mt-1" style={{ opacity: 0.6 }}>{hint}</span>}
    </label>
  );
}
const inputStyle = (ui) => ({ ...ui.INPUT, width: "100%" });
function Text({ label, hint, value, onChange, ui, ...rest }) {
  return <Label text={label} hint={hint} ui={ui}><input value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="px-2 py-2 rounded" style={inputStyle(ui)} {...rest} /></Label>;
}
function Area({ label, hint, value, onChange, ui, rows = 3 }) {
  return <Label text={label} hint={hint} ui={ui}><textarea value={value ?? ""} rows={rows} onChange={(e) => onChange(e.target.value)} className="px-2 py-2 rounded" style={inputStyle(ui)} /></Label>;
}
function Num({ label, hint, value, onChange, ui, step = "any", min, max }) {
  return (
    <Label text={label} hint={hint} ui={ui}>
      <input type="number" step={step} min={min} max={max} value={value ?? ""} className="px-2 py-2 rounded" style={inputStyle(ui)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />
    </Label>
  );
}
function Pick({ label, hint, value, onChange, options, ui }) {
  return (
    <Label text={label} hint={hint} ui={ui}>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="px-2 py-2 rounded" style={inputStyle(ui)}>
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </Label>
  );
}
function Check({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 mb-3 text-sm cursor-pointer">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}
/* Ids are referenced elsewhere (matrix, priorities, injects), so a rename is
   committed on blur/Enter through a helper, never per keystroke. */
function IdInput({ label, hint, value, taken, onCommit, ui, pattern = ID_RE }) {
  const [v, setV] = useState(value);
  const [bad, setBad] = useState("");
  const [shown, setShown] = useState(value);
  if (shown !== value) { setShown(value); setV(value); setBad(""); } // renamed elsewhere (JSON tab, draft restore)
  const commit = () => {
    const next = v.trim();
    if (next === value) { setBad(""); return; }
    if (!pattern.test(next)) { setBad("Use 1–40 letters, digits, - or _."); return; }
    if (next === "observer" || taken.has(next)) { setBad(`"${next}" is already used.`); return; }
    setBad("");
    onCommit(next);
  };
  return (
    <Label text={label} hint={bad || hint} ui={ui}>
      <input value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="px-2 py-2 rounded" style={{ ...inputStyle(ui), fontFamily: ui.MONO_FONT, borderColor: bad ? ERR : undefined }} />
    </Label>
  );
}
function Row({ children }) {
  return <div className="grid gap-x-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>{children}</div>;
}
function Card({ title, onUp, onDown, onRemove, removeLabel = "Remove", ui, children }) {
  const btn = "px-2 py-1 rounded text-xs";
  return (
    <div className="rounded p-3 mb-3" style={{ border: "1px solid #3a3f40" }}>
      <div className="flex items-center gap-1 mb-2">
        <span className="font-bold flex-1" style={{ fontFamily: ui.BODY_HI }}>{title}</span>
        {onUp && <button onClick={onUp} className={btn} style={ui.BTN_SECONDARY} aria-label="Move up">↑</button>}
        {onDown && <button onClick={onDown} className={btn} style={ui.BTN_SECONDARY} aria-label="Move down">↓</button>}
        {onRemove && <button onClick={onRemove} className={btn} style={ui.BTN_SECONDARY}>{removeLabel}</button>}
      </div>
      {children}
    </div>
  );
}
const AddButton = ({ onClick, children, ui }) => (
  <button onClick={onClick} className="px-3 py-2 rounded text-sm" style={ui.BTN_SECONDARY}>+ {children}</button>
);
const confirmRemove = (what) => window.confirm(`Remove ${what}? Anything that refers to it is updated too.`);

/* ---- tabs ---- */
function Basics({ s, edit, ui }) {
  const m = s.meta, sc = s.scoring, mech = s.mechanics;
  return (
    <>
      <Text ui={ui} label="TITLE" value={m.title} onChange={(v) => edit((d) => { d.meta.title = v; })} />
      <Row>
        <Text ui={ui} label="LOGIN / GATE TAGLINE" value={m.gateTagline} onChange={(v) => edit((d) => { d.meta.gateTagline = v; })} />
        <Text ui={ui} label="PROJECTOR SUBTITLE" value={m.projectorSubtitle} onChange={(v) => edit((d) => { d.meta.projectorSubtitle = v; })} />
      </Row>
      <Row>
        <Num ui={ui} label="CLOCK (minutes)" min={5} max={300} step={1} value={m.deadlineMinutes} onChange={(v) => edit((d) => { d.meta.deadlineMinutes = v; })} />
        <Text ui={ui} label="CLOCK LABEL" value={m.clockLabel} placeholder="TIME TO CLOSE" onChange={(v) => edit((d) => { d.meta.clockLabel = v; })} />
        <IdInput ui={ui} label="SHORT ID" hint="Stamped on session exports." value={m.id} taken={new Set()} onCommit={(v) => edit((d) => { d.meta.id = v; })} />
      </Row>
      <Row>
        <Text ui={ui} label="AGREEMENT BANNER" value={m.adoptedBanner} onChange={(v) => edit((d) => { d.meta.adoptedBanner = v; })} />
        <Text ui={ui} label="NO-AGREEMENT BANNER" value={m.collapseBanner} onChange={(v) => edit((d) => { d.meta.collapseBanner = v; })} />
      </Row>
      <Text ui={ui} label="NO-AGREEMENT NOTE" value={m.collapseNote} onChange={(v) => edit((d) => { d.meta.collapseNote = v; })} />

      <div className="text-xs font-bold mt-2 mb-2" style={{ fontFamily: ui.MONO_FONT, opacity: 0.8 }}>SCORING</div>
      <Row>
        <Num ui={ui} label="DEAL WEIGHT" hint="0–1; deal + credibility = 1" value={sc.dealWeight} onChange={(v) => edit((d) => { d.scoring.dealWeight = v; })} />
        <Num ui={ui} label="CREDIBILITY WEIGHT" value={sc.credWeight} onChange={(v) => edit((d) => { d.scoring.credWeight = v; })} />
        <Num ui={ui} label="STARTING CREDIBILITY" value={sc.startCred} onChange={(v) => edit((d) => { d.scoring.startCred = v; })} />
        <Num ui={ui} label="MEDIATOR CLOSURE SHARE" hint="Part of a mediator's score earned by any agreement" value={sc.mediatorClosureShare} onChange={(v) => edit((d) => { d.scoring.mediatorClosureShare = v; })} />
        <Num ui={ui} label="PRIORITY ISSUE WEIGHT" hint="Default 2×" value={sc.priorityWeight} onChange={(v) => edit((d) => { d.scoring.priorityWeight = v; })} />
      </Row>

      <div className="text-xs font-bold mt-2 mb-2" style={{ fontFamily: ui.MONO_FONT, opacity: 0.8 }}>RULES</div>
      <Row>
        <Pick ui={ui} label="AFTER A DRAFT IS AMENDED" value={mech.amendmentPolicy}
          options={[["reconfirm", "Endorsers must reconfirm"], ["clear", "Endorsements are cleared"]]}
          onChange={(v) => edit((d) => { d.mechanics.amendmentPolicy = v; })} />
        <Pick ui={ui} label="RED LINES" value={mech.redLineMode || "hard"}
          options={[["hard", "Block endorsement"], ["soft", "Warn only"]]}
          onChange={(v) => edit((d) => { d.mechanics.redLineMode = v; })} />
        <Num ui={ui} label="MAX LIVE DRAFTS" hint="Blank: 4" step={1} min={1} value={mech.maxLiveDrafts} onChange={(v) => edit((d) => { d.mechanics.maxLiveDrafts = v; })} />
      </Row>
      <Check label="Players must acknowledge each inject" checked={mech.injectAckRequired} onChange={(v) => edit((d) => { d.mechanics.injectAckRequired = v; })} />
    </>
  );
}

function Delegations({ s, edit, apply, ui }) {
  const ids = s.delegations.map((d) => d.id);
  return (
    <>
      {s.delegations.map((del, i) => {
        const at = (mutate) => edit((d) => mutate(d.delegations[i]));
        return (
          <Card key={del.id} ui={ui} title={`${del.flag || ""} ${del.name || del.id}`}
            onUp={i > 0 ? () => edit((d) => { d.delegations = moveItem(d.delegations, i, -1); }) : null}
            onDown={i < ids.length - 1 ? () => edit((d) => { d.delegations = moveItem(d.delegations, i, 1); }) : null}
            onRemove={() => confirmRemove(`${del.name || del.id}`) && apply(removeDelegation, del.id)}>
            <Row>
              <IdInput ui={ui} label="ID" hint="Used for assignments; letters, digits, - _" value={del.id}
                taken={new Set(ids.filter((x) => x !== del.id))} onCommit={(v) => apply(renameDelegation, del.id, v)} />
              <Text ui={ui} label="NAME" value={del.name} onChange={(v) => at((x) => { x.name = v; })} />
              <Text ui={ui} label="FLAG (emoji)" value={del.flag} onChange={(v) => at((x) => { x.flag = v; })} />
            </Row>
            <Row>
              <Pick ui={ui} label="PRIORITY ISSUE" value={del.priority || ""} hint="Counts at the priority weight"
                options={[["", "None"], ...s.issues.map((iss) => [iss.id, iss.short || iss.label])]}
                onChange={(v) => at((x) => { x.priority = v || null; })} />
              <Num ui={ui} label="NO-DEAL VALUE (%)" hint="Score if talks collapse" min={0} max={100} value={del.noDealPct} onChange={(v) => at((x) => { x.noDealPct = v; })} />
              <Pick ui={ui} label="DEFAULT SEAT" value={del.defaultControl === "ai" ? "ai" : "human"}
                options={[["human", "Human"], ["ai", "AI"]]} onChange={(v) => at((x) => { x.defaultControl = v; })} />
            </Row>
            <Check label="Mediator (earns part of its score from any agreement)" checked={del.mediator} onChange={(v) => at((x) => { x.mediator = v; })} />
            <Row>
              <Text ui={ui} label="WIRE NAME" value={del.ministry?.wire} placeholder="USA STATE DEPARTMENT" onChange={(v) => at((x) => { x.ministry = { ...x.ministry, wire: v }; })} />
              <Text ui={ui} label="MINISTRY TITLE" value={del.ministry?.title} placeholder="State Department" onChange={(v) => at((x) => { x.ministry = { ...x.ministry, title: v }; })} />
              <Text ui={ui} label="SPEAKER" value={del.ministry?.speaker} placeholder="The State Department" onChange={(v) => at((x) => { x.ministry = { ...x.ministry, speaker: v }; })} />
            </Row>
            <Row>
              <Text ui={ui} label="DOMESTIC AUDIENCE" value={del.domestic?.label} placeholder="US public" onChange={(v) => at((x) => { x.domestic = { moods: {}, ...x.domestic, label: v }; })} />
            </Row>
            <Area ui={ui} label="DOMESTIC MOOD (shown to this delegation)" rows={2} value={del.domestic?.dispatch}
              onChange={(v) => at((x) => { x.domestic = { moods: {}, ...x.domestic, dispatch: v }; })} />
          </Card>
        );
      })}
      <AddButton ui={ui} onClick={() => apply(addDelegation)}>Add delegation</AddButton>
    </>
  );
}

function Issues({ s, edit, apply, ui }) {
  const ids = s.issues.map((i) => i.id);
  return (
    <>
      {s.issues.map((iss, i) => {
        const at = (mutate) => edit((d) => mutate(d.issues[i]));
        const pills = Array.isArray(iss.pillOptions);
        return (
          <Card key={iss.id} ui={ui} title={iss.label || iss.id}
            onUp={i > 0 ? () => edit((d) => { d.issues = moveItem(d.issues, i, -1); }) : null}
            onDown={i < ids.length - 1 ? () => edit((d) => { d.issues = moveItem(d.issues, i, 1); }) : null}
            onRemove={() => confirmRemove(`the issue "${iss.label || iss.id}"`) && apply(removeIssue, iss.id)}>
            <Row>
              <IdInput ui={ui} label="ID" value={iss.id} taken={new Set(ids.filter((x) => x !== iss.id))} onCommit={(v) => apply(renameIssue, iss.id, v)} />
              <Text ui={ui} label="LABEL" value={iss.label} placeholder="LENGTH OF AGREEMENT" onChange={(v) => at((x) => { x.label = v; })} />
              <Text ui={ui} label="SHORT NAME" value={iss.short} placeholder="Length" onChange={(v) => at((x) => { x.short = v; })} />
            </Row>
            <Pick ui={ui} label="SCORING" value={iss.type}
              hint={iss.type === "ranked" ? "Each delegation ranks every option; weight = number of options." : "Each delegation needs one option; weight 2."}
              options={[["ranked", "Ranked: delegations rank all options"], ["position", "Position: each delegation needs one option"]]}
              onChange={(v) => apply(setIssueType, iss.id, v)} />
            <div className="text-xs mb-1" style={{ color: ui.GOLD, fontFamily: ui.MONO_FONT, letterSpacing: "0.08em" }}>OPTIONS</div>
            {iss.options.map((opt, k) => (
              <div key={k} className="flex gap-2 mb-2 items-center flex-wrap">
                <input value={opt} aria-label={`Option ${k + 1}`} onChange={(e) => at((x) => { x.options[k] = e.target.value; })}
                  className="px-2 py-1 rounded flex-1" style={{ ...ui.INPUT, minWidth: 140 }} />
                {pills && <input value={iss.pillOptions[k] ?? ""} aria-label={`Short label ${k + 1}`} placeholder="short label"
                  onChange={(e) => at((x) => { x.pillOptions[k] = e.target.value; })} className="px-2 py-1 rounded" style={{ ...ui.INPUT, width: 150 }} />}
                <button onClick={() => apply(moveOption, iss.id, k, -1)} disabled={k === 0} className="px-2 py-1 rounded text-xs" style={ui.BTN_SECONDARY} aria-label="Move option up">↑</button>
                <button onClick={() => apply(moveOption, iss.id, k, 1)} disabled={k === iss.options.length - 1} className="px-2 py-1 rounded text-xs" style={ui.BTN_SECONDARY} aria-label="Move option down">↓</button>
                <button onClick={() => apply(removeOption, iss.id, k)} disabled={iss.options.length <= 2} className="px-2 py-1 rounded text-xs" style={ui.BTN_SECONDARY}>Remove</button>
              </div>
            ))}
            <div className="flex gap-2 flex-wrap items-center">
              <AddButton ui={ui} onClick={() => apply(addOption, iss.id)}>Add option</AddButton>
              <Check label="Short labels for the wire" checked={pills}
                onChange={(v) => at((x) => { if (v) x.pillOptions = [...x.options]; else delete x.pillOptions; })} />
            </div>
          </Card>
        );
      })}
      <AddButton ui={ui} onClick={() => apply(addIssue)}>Add issue</AddButton>
    </>
  );
}

/* One issue at a time: a row per delegation with its ranking (or required
   option) and its red lines on that issue. */
function Rankings({ s, edit, apply, ui }) {
  const [issueId, setIssueId] = useState(s.issues[0]?.id);
  const iss = s.issues.find((x) => x.id === issueId) || s.issues[0];
  if (!iss) return <div style={{ opacity: 0.75 }}>Add an issue first.</div>;
  const n = iss.options.length;
  const cell = (del) => s.matrix?.[del.id]?.[iss.id];
  const toggleRed = (di, k) => edit((d) => {
    const del = d.delegations[di];
    del.redLines = { ...(del.redLines || {}) };
    const cur = new Set(del.redLines[iss.id] || []);
    if (cur.has(k)) cur.delete(k); else cur.add(k);
    if (cur.size) del.redLines[iss.id] = [...cur].sort((a, b) => a - b); else delete del.redLines[iss.id];
  });
  const sel = { ...ui.INPUT, padding: "4px 6px", fontSize: 13 };
  return (
    <>
      <div className="flex gap-1 flex-wrap mb-3">
        {s.issues.map((x) => (
          <button key={x.id} onClick={() => setIssueId(x.id)} className="px-2 py-1 rounded text-xs"
            style={x.id === iss.id ? { ...ui.BTN_PRIMARY, fontWeight: 700 } : ui.BTN_SECONDARY}>{x.short || x.label}</button>
        ))}
      </div>
      <div className="text-xs mb-2" style={{ opacity: 0.75 }}>
        {iss.type === "ranked"
          ? `Pick each delegation's ${ORDINAL(1)} to ${ORDINAL(n)} choice. Picking an option that's already ranked swaps the two.`
          : "Pick the option each delegation needs."}
        {" "}Red lines: options a delegation can never accept{s.mechanics.redLineMode === "hard" || !s.mechanics.redLineMode ? " (it can't endorse a package containing one)" : ""}.
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="text-sm" style={{ borderCollapse: "separate", borderSpacing: "6px 6px" }}>
          <thead>
            <tr style={{ fontFamily: ui.MONO_FONT, fontSize: 11, color: ui.GOLD, textAlign: "left" }}>
              <th>DELEGATION</th>
              {iss.type === "ranked" ? iss.options.map((_, r) => <th key={r}>{ORDINAL(r + 1).toUpperCase()}</th>) : <th>NEEDS</th>}
              <th>RED LINES</th>
            </tr>
          </thead>
          <tbody>
            {s.delegations.map((del, di) => {
              const v = cell(del);
              const ranks = Array.isArray(v) && v.length === n ? v : null;
              return (
                <tr key={del.id}>
                  <td className="whitespace-nowrap">{del.flag} {del.name || del.id}{del.priority === iss.id ? " ★" : ""}</td>
                  {iss.type === "ranked"
                    ? iss.options.map((_, r) => (
                        <td key={r}>
                          <select value={ranks ? ranks.indexOf(r + 1) : ""} style={sel} aria-label={`${del.id} ${ORDINAL(r + 1)} choice`}
                            onChange={(e) => apply(setRank, del.id, iss.id, r + 1, Number(e.target.value))}>
                            {!ranks && <option value="">—</option>}
                            {iss.options.map((o, k) => <option key={k} value={k}>{o}</option>)}
                          </select>
                        </td>
                      ))
                    : (
                        <td>
                          <select value={Number.isInteger(v) ? v : ""} style={sel} aria-label={`${del.id} required option`}
                            onChange={(e) => edit((d) => { (d.matrix[del.id] ||= {})[iss.id] = Number(e.target.value); })}>
                            {!Number.isInteger(v) && <option value="">—</option>}
                            {iss.options.map((o, k) => <option key={k} value={k}>{o}</option>)}
                          </select>
                        </td>
                      )}
                  <td className="whitespace-nowrap">
                    {iss.options.map((o, k) => (
                      <label key={k} className="mr-2 text-xs cursor-pointer" title={o}>
                        <input type="checkbox" checked={(del.redLines?.[iss.id] || []).includes(k)} onChange={() => toggleRed(di, k)} /> {iss.pillOptions?.[k] || o}
                      </label>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-xs mt-1" style={{ opacity: 0.6 }}>★ priority issue for that delegation (set under Delegations).</div>
    </>
  );
}

function Press({ s, edit, apply, ui }) {
  const pd = s.publicDiplomacy;
  const joined = pd.postures.join(", ");
  const [postures, setPosturesText] = useState(joined);
  const [shown, setShown] = useState(joined);
  if (shown !== joined) { setShown(joined); setPosturesText(joined); }
  const moodKeys = Object.keys(pd.moods);
  const at = (mutate) => edit((d) => mutate(d.publicDiplomacy));
  const chip = (on) => ({ ...(on ? ui.BTN_PRIMARY : ui.BTN_SECONDARY), padding: "2px 8px", fontSize: 12, borderRadius: 999 });
  return (
    <>
      <Row>
        <Text ui={ui} label="PRESS ROOM NAME" value={pd.pressRoomTag} placeholder="PRESS ROOM — ISLAMABAD" onChange={(v) => at((x) => { x.pressRoomTag = v; })} />
        <Text ui={ui} label="CONTEXT FOR THE STATEMENT GRADER" value={pd.scoringContext} placeholder="a diplomacy simulation set during …" onChange={(v) => at((x) => { x.scoringContext = v; })} />
      </Row>
      <Label ui={ui} text="POSTURES (comma-separated)" hint="Teams pick one when filing a statement. Moods favor or penalize them.">
        <input value={postures} onChange={(e) => setPosturesText(e.target.value)} className="px-2 py-2 rounded" style={inputStyle(ui)}
          onBlur={() => {
            const list = [...new Set(postures.split(",").map((x) => x.trim()).filter(Boolean))];
            if (list.length) apply(setPostures, list); else setPosturesText(pd.postures.join(", "));
          }} />
      </Label>
      <Row>
        <Num ui={ui} label="PRESS WINDOWS" step={1} min={0} value={pd.windows.total} onChange={(v) => at((x) => { x.windows.total = v; })} />
        <Num ui={ui} label="WINDOW LENGTH (min)" min={1} value={pd.windows.minutes} onChange={(v) => at((x) => { x.windows.minutes = v; })} />
        <Num ui={ui} label="MISSED-FILING PENALTY" value={pd.windows.missedPenalty} onChange={(v) => at((x) => { x.windows.missedPenalty = v; })} />
      </Row>
      <Check label="Hide the international mood from players (they infer it from the wire)" checked={pd.hideInternationalMood}
        onChange={(v) => at((x) => { x.hideInternationalMood = v; })} />

      <div className="text-xs font-bold mt-2 mb-2" style={{ fontFamily: ui.MONO_FONT, opacity: 0.8 }}>INTERNATIONAL MOODS</div>
      {moodKeys.map((k) => {
        const m = pd.moods[k];
        const atm = (mutate) => at((x) => mutate(x.moods[k]));
        const toggle = (list, p) => atm((x) => {
          const other = list === "favored" ? "penalized" : "favored";
          const cur = new Set(x[list]);
          if (cur.has(p)) cur.delete(p); else { cur.add(p); x[other] = x[other].filter((y) => y !== p); }
          x[list] = pd.postures.filter((y) => cur.has(y));
        });
        return (
          <Card key={k} ui={ui} title={`${k}${pd.defaultMood === k ? " · starting mood" : ""}`}
            onRemove={moodKeys.length > 1 ? () => confirmRemove(`the mood ${k}`) && apply(removeMood, k) : null}>
            <Row>
              <IdInput ui={ui} label="NAME" value={k} taken={new Set(moodKeys.filter((x) => x !== k))} pattern={/^[A-Za-z0-9 _-]{1,40}$/}
                onCommit={(v) => apply(renameMood, k, v)} />
              <Num ui={ui} label="WEIGHT: DIMENSION A" value={m.we} onChange={(v) => atm((x) => { x.we = v; })} />
              <Num ui={ui} label="WEIGHT: DIMENSION B" value={m.wl} onChange={(v) => atm((x) => { x.wl = v; })} />
              <Num ui={ui} label="WEIGHT: DIMENSION C" value={m.wp} onChange={(v) => atm((x) => { x.wp = v; })} />
            </Row>
            <Area ui={ui} label="DISPATCH (what the press reports)" rows={2} value={m.dispatch} onChange={(v) => atm((x) => { x.dispatch = v; })} />
            {[["favored", "FAVORED POSTURES"], ["penalized", "PENALIZED POSTURES"]].map(([list, title]) => (
              <div key={list} className="mb-2">
                <div className="text-xs mb-1" style={{ color: ui.GOLD, fontFamily: ui.MONO_FONT, letterSpacing: "0.08em" }}>{title}</div>
                <div className="flex gap-1 flex-wrap">
                  {pd.postures.map((p) => <button key={p} onClick={() => toggle(list, p)} style={chip(m[list].includes(p))}>{p}</button>)}
                </div>
              </div>
            ))}
            {pd.defaultMood !== k && <button onClick={() => at((x) => { x.defaultMood = k; })} className="px-2 py-1 rounded text-xs mt-1" style={ui.BTN_SECONDARY}>Make starting mood</button>}
          </Card>
        );
      })}
      <AddButton ui={ui} onClick={() => at((x) => {
        let n = 1; while (x.moods[`MOOD ${n}`]) n++;
        x.moods[`MOOD ${n}`] = { dispatch: "", we: 1, wl: 1, wp: 1, favored: [], penalized: [] };
      })}>Add mood</AddButton>
    </>
  );
}

function Injects({ s, edit, ui }) {
  const ids = s.injects.map((j) => j.id);
  const moods = Object.keys(s.publicDiplomacy?.moods || {});
  return (
    <>
      <div className="text-xs mb-3" style={{ opacity: 0.75 }}>The facilitator fires these from the console's inject library, in this order. Ad-hoc injects can still be written live.</div>
      {s.injects.map((j, i) => {
        const at = (mutate) => edit((d) => mutate(d.injects[i]));
        return (
          <Card key={`${i}:${j.id}`} ui={ui} title={`${j.id} · ${j.title || "untitled"}`}
            onUp={i > 0 ? () => edit((d) => { d.injects = moveItem(d.injects, i, -1); }) : null}
            onDown={i < ids.length - 1 ? () => edit((d) => { d.injects = moveItem(d.injects, i, 1); }) : null}
            onRemove={() => window.confirm(`Remove inject ${j.id}?`) && edit((d) => { d.injects.splice(i, 1); })}>
            <Row>
              <IdInput ui={ui} label="ID" hint="Shown on the console, e.g. L1" value={j.id} taken={new Set(ids.filter((x, n) => n !== i))}
                onCommit={(v) => at((x) => { x.id = v; })} />
              <Text ui={ui} label="TAG" value={j.tag} placeholder="FLASH — MOSCOW" onChange={(v) => at((x) => { x.tag = v; })} />
              <Pick ui={ui} label="MOOD SHIFT" value={j.mood || ""} options={[["", "None"], ...moods.map((m) => [m, m])]}
                onChange={(v) => at((x) => { x.mood = v || null; })} />
            </Row>
            <Text ui={ui} label="HEADLINE" value={j.title} onChange={(v) => at((x) => { x.title = v; })} />
            <Area ui={ui} label="BODY" rows={3} value={j.body} onChange={(v) => at((x) => { x.body = v; })} />
            <Area ui={ui} label="REACTION (optional)" rows={2} value={j.reaction} onChange={(v) => at((x) => { if (v) x.reaction = v; else delete x.reaction; })} />
          </Card>
        );
      })}
      <AddButton ui={ui} onClick={() => edit((d) => {
        let n = d.injects.length + 1; while (d.injects.some((x) => x.id === `W${n}`)) n++;
        d.injects.push({ id: `W${n}`, tag: "WIRE", title: "", body: "", mood: null });
      })}>Add inject</AddButton>
    </>
  );
}

/* The whole cartridge as JSON, for fields without a form (synthesis, AI
   tuning, domestic mood variants) or to paste a cartridge in. */
function RawJson({ s, setS, ui }) {
  const [text, setText] = useState(() => JSON.stringify(s, null, 2));
  const [msg, setMsg] = useState("");
  const applyJson = () => {
    try { setS(normalizeCartridge(parseCartridge(text))); setMsg("Applied."); }
    catch (e) { setMsg(e.message); }
  };
  return (
    <>
      <div className="text-xs mb-2" style={{ opacity: 0.75 }}>Edit anything here, including fields without a form, then Apply. You can also paste a whole cartridge (.js or .json).</div>
      <textarea value={text} onChange={(e) => { setText(e.target.value); setMsg(""); }} rows={22} spellCheck={false}
        className="w-full px-2 py-2 rounded" style={{ ...ui.INPUT, fontFamily: ui.MONO_FONT, fontSize: 12 }} />
      <div className="flex gap-2 items-center mt-2 flex-wrap">
        <button onClick={applyJson} className="px-3 py-2 rounded text-sm font-bold" style={ui.BTN_PRIMARY}>Apply</button>
        <button onClick={() => { setText(JSON.stringify(s, null, 2)); setMsg(""); }} className="px-3 py-2 rounded text-sm" style={ui.BTN_SECONDARY}>Reset to current</button>
        {msg && <span className="text-sm" role="status" style={{ color: msg === "Applied." ? "#46A07C" : ERR }}>{msg}</span>}
      </div>
    </>
  );
}
