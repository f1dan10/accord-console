/* Checks the engine reads a Brown-build cartridge the way its author intends.
   The fixture holds every delegation's preferences in the clear, so it is kept
   out of git (see .gitignore); the tests skip when it isn't there. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { parseCartridge, normalizeCartridge, checkCartridge, rawDealPct, enumeratePackages, rankPoints } from "./cartridge.js";

const FIXTURE = new URL("../scenarios/istanbul_mit_abridged_v1.json", import.meta.url);
const skip = existsSync(FIXTURE) ? false : "scenarios/istanbul_mit_abridged_v1.json is not present";
const load = () => normalizeCartridge(parseCartridge(readFileSync(FIXTURE, "utf8")));

test("rankPoints: first choice earns the weight, last choice nothing", () => {
  assert.equal(rankPoints(4, 1, 4), 4);
  assert.equal(rankPoints(4, 4, 4), 0);
  assert.equal(rankPoints(4, 2, 8), 16 / 3);
});

test("Istanbul cartridge loads with no blocking findings", { skip }, () => {
  const s = load();
  assert.deepEqual(checkCartridge(s).filter((f) => f.level === "hard"), []);
  assert.deepEqual(s.matrix.Ukraine.terr, [1, 2, 3, 4]);
  assert.equal(s.schedule.items.length, 17);
  assert.equal(s.schedule.items[0].at, 70);
});

test("Istanbul test package scores as the README says", { skip }, () => {
  const s = load();
  const pkg = { terr: 2, align: 2, guar: 1, assets: 2, sanc: 1 };
  const got = Object.fromEntries(s.delegations.map((d) => [d.id, Math.round(rawDealPct(s, d.id, pkg))]));
  assert.deepEqual(got, { Ukraine: 50, Russia: 56, USA: 94, Germany: 72, Hungary: 72, Turkey: 80 });
});

test("exactly ten of the 1,024 packages beat walking away for everyone", { skip }, () => {
  const s = load();
  const all = enumeratePackages(s);
  assert.equal(all.length, 1024);
  /* "Better off" as the console shows it: no red line crossed, and the rounded
     deal score strictly above the delegation's no-deal value. */
  const crosses = (d, t) => Object.entries(d.redLines || {}).some(([k, opts]) => opts.includes(t[k]));
  const better = all.filter((t) => s.delegations.every((d) => !crosses(d, t) && Math.round(rawDealPct(s, d.id, t)) > d.noDealPct));
  assert.equal(better.length, 10);
});
