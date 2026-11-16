/* Slack-style chat helpers. Pure functions: no storage, no React.
   Messages live in the game's shared doc under per-channel keys:
     ${P}-chan-table        everyone + the GM
     ${P}-dm-<a>-<b>        one delegation pair (names sorted, so both sides agree)
     ${P}-gm-<team>         the existing private line to the GM (see gmKey in App.jsx)
   A message is { id, from, text, ts }; from is a delegation name, "team" (legacy
   GM thread: the delegation itself) or "gm". */

export const CHAT_CAP = 200;      // newest messages kept per channel (doc size limit)
export const CHAT_MAX_LEN = 500;

export const tableKey = (P) => `${P}-chan-table`;
export const dmKey = (P, a, b) => `${P}-dm-${[a, b].sort().join("-")}`;

/* Channels a delegation sees, in sidebar order. */
export function channelsFor(P, me, teams, isHuman = () => true) {
  const out = [{ id: "table", label: "table", kind: "channel", key: tableKey(P) }];
  for (const t of teams) {
    if (t === me || !isHuman(t)) continue;
    out.push({ id: `dm:${t}`, label: t, kind: "dm", with: t, key: dmKey(P, me, t) });
  }
  out.push({ id: "gm", label: "Gamemaster", kind: "gm", key: `${P}-gm-${me}` });
  return out;
}

/* Append idempotently (same id twice is a no-op) and keep only the newest CHAT_CAP. */
export function appendMsg(list, msg, cap = CHAT_CAP) {
  if (list.some((m) => m.id === msg.id)) return list;
  const next = [...list, msg];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

export const newMsg = (from, text, ts = Date.now()) => ({
  id: `${from}-${ts}-${Math.random().toString(36).slice(2, 6)}`,
  from, text: text.trim().slice(0, CHAT_MAX_LEN), ts,
});

/* Messages from other people newer than lastRead. In the legacy GM thread my own
   messages are from "team", so "me" there is that value. */
export function unreadCount(msgs, lastRead, me) {
  return msgs.filter((m) => m.ts > lastRead && m.from !== me && m.from !== "team").length;
}

export function latestOther(msgs, me) {
  let t = 0;
  for (const m of msgs) if (m.from !== me && m.from !== "team" && m.ts > t) t = m.ts;
  return t;
}
