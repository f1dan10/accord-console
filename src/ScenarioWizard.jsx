/* Guided setup: builds a cartridge by asking a series of questions, for a
   professor who wants a game without learning the cartridge format or the
   editor's tabs. It produces the same normalized object an upload produces
   and hands it to the editor, so the checks, the library routes and New game
   all work unchanged.

   The first question is the GAME TYPE, because that decides which scoring
   rubric the engine applies and shapes everything after it (see GAME_MODES in
   cartridge.js).

   What this deliberately does NOT ask: the rank matrix. Asking a professor to
   rank every option on every issue for every delegation is N x M x K questions
   and is the part the editor's Rankings grid is actually good at. The wizard
   fills a placeholder ranking and says plainly that rankings are the next
   step — a cartridge that leaves them untouched is structurally valid but
   negotiates badly, since every delegation would want the same thing. */
import React, { useMemo, useState } from "react";
import { GAME_MODES, MODE_IDS, cartridgeFromAnswers, optionLines, checkCartridge, summarize } from "./cartridge.js";

const ERR = "#ff8a70";
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

const STEPS = [
  ["type", "Game type"],
  ["basics", "The game"],
  ["delegations", "Who plays"],
  ["issues", "What they negotiate"],
  ["review", "Review"],
];

const blankDelegation = () => ({ name: "", flag: "", mediator: false });
const blankIssue = () => ({ label: "", options: "" });

const optionsOf = (iss) => optionLines(iss.options);

/* What stops the current step from being finished. Empty = Next is enabled. */
function stepProblems(step, a) {
  const p = [];
  if (step === "type" && !MODE_IDS.includes(a.mode)) p.push("Choose a game type.");
  if (step === "basics") {
    if (!a.title.trim()) p.push("Give the game a title.");
    if (!(Number(a.minutes) > 0)) p.push("Set how many minutes the game runs.");
    if (a.metaId.trim() && !ID_RE.test(a.metaId.trim())) p.push("The short id can use letters, digits, - and _ only.");
  }
  if (step === "delegations") {
    const named = a.delegations.filter((d) => d.name.trim());
    if (named.length < 2) p.push("Name at least two delegations.");
    const lower = named.map((d) => d.name.trim().toLowerCase());
    if (new Set(lower).size !== lower.length) p.push("Two delegations share a name.");
  }
  if (step === "issues") {
    const real = a.issues.filter((i) => i.label.trim());
    if (!real.length) p.push("Add at least one issue.");
    real.forEach((i) => {
      if (optionsOf(i).length < 2) p.push(`“${i.label.trim()}” needs at least two options, one per line.`);
    });
  }
  return p;
}

export default function ScenarioWizard({ ui, onBuilt, onCancel }) {
  const [i, setI] = useState(0);
  const [a, setA] = useState({
    mode: "accord",
    title: "",
    metaId: "",
    minutes: "60",
    context: "",
    delegations: [blankDelegation(), blankDelegation()],
    issues: [blankIssue()],
  });

  const step = STEPS[i][0];
  const set = (patch) => setA((cur) => ({ ...cur, ...patch }));
  const setList = (key, n, patch) => setA((cur) => ({
    ...cur, [key]: cur[key].map((x, k) => (k === n ? { ...x, ...patch } : x)),
  }));
  const addTo = (key, blank) => setA((cur) => ({ ...cur, [key]: [...cur[key], blank()] }));
  const removeFrom = (key, n) => setA((cur) => ({ ...cur, [key]: cur[key].filter((_, k) => k !== n) }));

  const problems = stepProblems(step, a);
  /* The review step shows what the finished cartridge looks like, run through
     the same checks an upload gets, so nothing surprises them in the editor. */
  const built = useMemo(() => (step === "review" ? cartridgeFromAnswers(a) : null), [step, a]);
  const findings = useMemo(() => (built ? checkCartridge(built) : []), [built]);
  const hard = findings.filter((f) => f.level === "hard");
  const mode = GAME_MODES[a.mode] || GAME_MODES.accord;

  const field = { ...ui.INPUT, width: "100%" };
  const lab = { fontFamily: ui.MONO_FONT, fontSize: 11, letterSpacing: "0.12em", opacity: 0.75 };

  return (
    <div>
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <h3 className="font-bold tracking-wide" style={{ fontFamily: ui.HEAD_FONT, letterSpacing: "0.06em" }}>GUIDED SETUP</h3>
        <span className="text-xs" style={{ opacity: 0.7 }}>Step {i + 1} of {STEPS.length} · {STEPS[i][1]}</span>
      </div>
      <div className="flex gap-1 mb-4" aria-hidden="true">
        {STEPS.map(([k], n) => (
          <div key={k} style={{ height: 3, flex: 1, background: n <= i ? ui.GOLD : "#3a3f40" }} />
        ))}
      </div>

      {step === "type" && (
        <>
          <p className="text-sm mb-1">What kind of game is this?</p>
          <p className="text-xs mb-3" style={{ opacity: 0.7 }}>
            This comes first because each type is scored by its own rubric. It also decides what winning means,
            so it is worth getting right before anything else.
          </p>
          <div className="flex flex-col gap-2">
            {MODE_IDS.map((id) => {
              const m = GAME_MODES[id];
              const on = a.mode === id;
              return (
                <button key={id} onClick={() => set({ mode: id })} aria-pressed={on}
                  className="text-left p-3 rounded"
                  style={{ ...(on ? ui.BTN_PRIMARY : ui.BTN_SECONDARY), display: "block", width: "100%" }}>
                  <div className="font-bold text-sm" style={{ fontFamily: ui.BODY_HI }}>
                    {m.name}{!m.implemented && <span className="ml-2 text-xs font-normal">· scoring not built yet</span>}
                  </div>
                  <div className="text-xs mt-1" style={{ opacity: on ? 0.85 : 0.7 }}>{m.blurb}</div>
                </button>
              );
            })}
          </div>
          {!mode.implemented && (
            <div className="mt-3 p-3 rounded text-sm" role="status" style={{ border: `1px solid ${ui.GOLD}` }}>
              You can build and run a {mode.name.toLowerCase()} game, but the engine has no scoring rubric for it yet,
              so it won't produce final scores. Everything else — drafts, the press room, the wire, AI seats — works.
            </div>
          )}
        </>
      )}

      {step === "basics" && (
        <>
          <p className="text-sm mb-3">The basics. You can change any of this later in the editor.</p>
          <label className="block mb-3">
            <span style={lab}>TITLE</span>
            <input value={a.title} onChange={(e) => set({ title: e.target.value })} style={field}
              className="px-3 py-2 rounded mt-1" placeholder="The Islamabad Accord" />
          </label>
          <div className="flex gap-3 flex-wrap mb-3">
            <label className="block" style={{ flex: "1 1 160px" }}>
              <span style={lab}>MINUTES ON THE CLOCK</span>
              <input value={a.minutes} onChange={(e) => set({ minutes: e.target.value })} type="number" min="5" max="300"
                style={field} className="px-3 py-2 rounded mt-1" />
            </label>
            <label className="block" style={{ flex: "1 1 160px" }}>
              <span style={lab}>SHORT ID (OPTIONAL)</span>
              <input value={a.metaId} onChange={(e) => set({ metaId: e.target.value })} style={field}
                className="px-3 py-2 rounded mt-1" placeholder="auto" />
            </label>
          </div>
          <label className="block">
            <span style={lab}>SETTING, IN A PHRASE (OPTIONAL)</span>
            <input value={a.context} onChange={(e) => set({ context: e.target.value })} style={field}
              className="px-3 py-2 rounded mt-1" placeholder="a nuclear crisis summit in Islamabad" />
            <span className="text-xs block mt-1" style={{ opacity: 0.65 }}>
              Used when the press room scores statements, so it reads them in the right context.
            </span>
          </label>
        </>
      )}

      {step === "delegations" && (
        <>
          <p className="text-sm mb-1">Who is at the table?</p>
          <p className="text-xs mb-3" style={{ opacity: 0.7 }}>
            Two or more. A mediator earns part of its score from any agreement being reached, whatever the terms.
          </p>
          <div className="flex flex-col gap-2 mb-3">
            {a.delegations.map((d, n) => (
              <div key={n} className="flex gap-2 items-center flex-wrap">
                <input value={d.flag} onChange={(e) => setList("delegations", n, { flag: e.target.value })}
                  aria-label={`Delegation ${n + 1} flag`} placeholder="🏳️"
                  style={{ ...ui.INPUT, width: 56, textAlign: "center" }} className="px-2 py-2 rounded" />
                <input value={d.name} onChange={(e) => setList("delegations", n, { name: e.target.value })}
                  aria-label={`Delegation ${n + 1} name`} placeholder={`Delegation ${n + 1}`}
                  style={{ ...ui.INPUT, flex: "1 1 180px" }} className="px-3 py-2 rounded" />
                <label className="text-xs flex items-center gap-1" style={{ opacity: 0.8 }}>
                  <input type="checkbox" checked={d.mediator}
                    onChange={(e) => setList("delegations", n, { mediator: e.target.checked })} />
                  mediator
                </label>
                {a.delegations.length > 2 && (
                  <button onClick={() => removeFrom("delegations", n)} className="px-2 py-1 rounded text-xs"
                    style={ui.BTN_SECONDARY}>Remove</button>
                )}
              </div>
            ))}
          </div>
          <button onClick={() => addTo("delegations", blankDelegation)} className="px-3 py-2 rounded text-sm"
            style={ui.BTN_SECONDARY}>Add a delegation</button>
        </>
      )}

      {step === "issues" && (
        <>
          <p className="text-sm mb-1">What is being negotiated?</p>
          <p className="text-xs mb-3" style={{ opacity: 0.7 }}>
            One issue per block, and the positions each delegation could take on it — one per line, from most to
            least ambitious. Three or four options per issue usually plays best.
          </p>
          <div className="flex flex-col gap-3 mb-3">
            {a.issues.map((iss, n) => (
              <div key={n} className="p-3 rounded" style={{ border: "1px solid #3a3f40" }}>
                <div className="flex gap-2 items-center mb-2">
                  <input value={iss.label} onChange={(e) => setList("issues", n, { label: e.target.value })}
                    aria-label={`Issue ${n + 1} name`} placeholder="Length of agreement"
                    style={{ ...ui.INPUT, flex: 1 }} className="px-3 py-2 rounded" />
                  {a.issues.length > 1 && (
                    <button onClick={() => removeFrom("issues", n)} className="px-2 py-1 rounded text-xs"
                      style={ui.BTN_SECONDARY}>Remove</button>
                  )}
                </div>
                <textarea value={iss.options} onChange={(e) => setList("issues", n, { options: e.target.value })}
                  aria-label={`Issue ${n + 1} options`} rows={4} style={field} className="px-3 py-2 rounded"
                  placeholder={"10 yrs\n5 yrs\n2 yrs"} />
                <span className="text-xs" style={{ opacity: 0.6 }}>{optionsOf(iss).length} option{optionsOf(iss).length === 1 ? "" : "s"}</span>
              </div>
            ))}
          </div>
          <button onClick={() => addTo("issues", blankIssue)} className="px-3 py-2 rounded text-sm"
            style={ui.BTN_SECONDARY}>Add an issue</button>
        </>
      )}

      {step === "review" && built && (
        <>
          <p className="text-sm mb-3">Here is what this builds. Nothing is saved until you save it from the editor.</p>
          <div className="p-3 rounded mb-3" style={{ border: `1px solid ${ui.GOLD}` }}>
            <div className="font-bold" style={{ fontFamily: ui.BODY_HI }}>{built.meta.title}</div>
            <div className="text-xs mt-1" style={{ opacity: 0.8 }}>
              {summarize(built).text} · {built.meta.deadlineMinutes} min clock
            </div>
            <div className="text-xs mt-1" style={{ opacity: 0.8 }}>
              {built.delegations.map((d) => `${d.flag} ${d.name}${d.mediator ? " (mediator)" : ""}`).join(" · ")}
            </div>
          </div>
          {hard.length > 0 && (
            <div className="p-3 rounded mb-3 text-sm" role="alert" style={{ border: `1px solid ${ERR}`, color: ERR }}>
              <b>{hard.length} problem{hard.length === 1 ? "" : "s"} to fix in the editor</b>
              <ul className="list-disc ml-5 mt-1">{hard.map((f, k) => <li key={k}>{f.text}</li>)}</ul>
            </div>
          )}
          <div className="p-3 rounded mb-3 text-sm" style={{ border: "1px solid #3a3f40" }}>
            <b>Next: the rankings.</b> Every delegation currently ranks each issue's options in the order you listed
            them, which means they all want the same thing and there is nothing to negotiate. Open the editor's
            <b> Rankings</b> tab and set what each delegation actually wants — that is where the game comes from.
            {!mode.implemented && (
              <div className="mt-2">
                This is a {mode.name.toLowerCase()} game, so the engine will run it but cannot score it yet.
              </div>
            )}
          </div>
        </>
      )}

      {problems.length > 0 && step !== "review" && (
        <div className="mt-3 text-sm" role="alert" style={{ color: ERR }}>
          {problems.map((p, k) => <div key={k}>{p}</div>)}
        </div>
      )}

      <div className="flex gap-2 flex-wrap mt-5 pt-3" style={{ borderTop: "1px solid #34393a" }}>
        {i > 0 && (
          <button onClick={() => setI(i - 1)} className="px-3 py-2 rounded text-sm" style={ui.BTN_SECONDARY}>Back</button>
        )}
        {step !== "review" ? (
          <button onClick={() => setI(i + 1)} disabled={problems.length > 0}
            className="px-3 py-2 rounded text-sm font-bold" style={ui.BTN_PRIMARY}>Next</button>
        ) : (
          <button onClick={() => onBuilt(built)} className="px-3 py-2 rounded text-sm font-bold" style={ui.BTN_PRIMARY}>
            Open in editor
          </button>
        )}
        <button onClick={onCancel} className="px-3 py-2 rounded text-sm" style={ui.BTN_SECONDARY}>Cancel</button>
      </div>
    </div>
  );
}
