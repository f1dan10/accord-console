import test from "node:test";
import assert from "node:assert/strict";
import { dmKey, tableKey, channelsFor, appendMsg, unreadCount, latestOther, CHAT_CAP, newMsg } from "./chat.js";

test("dm key is the same from both sides", () => {
  assert.equal(dmKey("p", "Russia", "USA"), dmKey("p", "USA", "Russia"));
  assert.equal(tableKey("p"), "p-chan-table");
});

test("channels: table, a DM per other human seat, then the GM", () => {
  const ch = channelsFor("p", "Russia", ["Ukraine", "Russia", "USA"], (t) => t !== "USA");
  assert.deepEqual(ch.map((c) => c.id), ["table", "dm:Ukraine", "gm"]);
  assert.equal(ch[2].key, "p-gm-Russia");
});

test("append is idempotent and capped to the newest messages", () => {
  const a = { id: "1", from: "USA", text: "hi", ts: 1 };
  assert.equal(appendMsg([a], a).length, 1);
  let l = [];
  for (let i = 0; i < CHAT_CAP + 5; i++) l = appendMsg(l, { id: String(i), from: "USA", text: "x", ts: i });
  assert.equal(l.length, CHAT_CAP);
  assert.equal(l[0].id, "5");
});

test("unread ignores my own and legacy team messages", () => {
  const m = [
    { id: "1", from: "USA", text: "a", ts: 10 },
    { id: "2", from: "Russia", text: "b", ts: 11 },
    { id: "3", from: "team", text: "c", ts: 12 },
    { id: "4", from: "gm", text: "d", ts: 13 },
  ];
  assert.equal(unreadCount(m, 0, "Russia"), 2);
  assert.equal(unreadCount(m, 10, "Russia"), 1);
  assert.equal(latestOther(m, "Russia"), 13);
});

test("newMsg trims and limits length", () => {
  const m = newMsg("USA", "  " + "a".repeat(600) + "  ", 5);
  assert.equal(m.text.length, 500);
  assert.equal(m.ts, 5);
});
