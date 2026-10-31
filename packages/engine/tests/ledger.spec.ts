import { test } from "vitest";
import assert from "node:assert/strict";
import {
  applyServerState,
  ledgerChanges,
  netCoins,
  openingEvents,
  type LedgerEvent,
} from "../../../src/services/ledger";
import { claimLogin, claimMission, missionsFor, recordWin, canClaimLogin } from "../../../src/services/daily";
import { earnUndos, spendUndo } from "../../../src/services/undos";
import { withClaim } from "../../../src/services/claims";
import type { Profile } from "../../../src/services/storage";
const base = (): Profile => ({
  name: "t", completed: {}, dailyDates: [], purchases: [], undos: 7, undoMilestones: 0,
});
let n = 0;
const id = () => `e${n++}`;
const server = (coins = 0, undos = 0, extra: Partial<{ purchases: string[]; claims: string[] }> = {}) => ({
  coins, undos, purchases: [], claims: [], version: 1, ...extra,
});

test("every coin or undo change becomes a ledger entry with its reason", () => {
  const p = base(),
    gift = claimLogin(p, "2026-11-01"),
    spent = spendUndo(gift);
  assert.deepEqual(
    ledgerChanges(p, gift, "gift", id).map((e) => [e.kind, e.delta, e.reason]),
    [["coins", 20, "gift"]],
  );
  assert.deepEqual(
    ledgerChanges(gift, spent, "undo:spend", id).map((e) => [e.kind, e.delta]),
    [["undos", -1]],
  );
  const bought = { ...spent, purchases: ["night"], spent: 100 };
  assert.deepEqual(
    ledgerChanges(spent, bought, "theme:night", id).map((e) => [e.kind, e.delta, e.reason]),
    [["coins", -100, "theme:night"]],
  );
  assert.deepEqual(ledgerChanges(p, { ...p, name: "x" }, "rename", id), []);
});

test("opening entries capture what a device held, with stable ids", () => {
  const p = { ...base(), bonusCoins: 150, spent: 100, undos: 12 },
    a = openingEvents(p, "dev1"),
    b = openingEvents(p, "dev1");
  assert.deepEqual(a, b, "same ids, so posting twice is harmless");
  assert.deepEqual(a.map((e) => [e.kind, e.delta]), [["coins", 50], ["undos", 5]]);
});

test("server totals plus unsent local entries give the account's view", () => {
  const p = { ...base(), bonusCoins: 20, purchases: ["sand"], spent: 175 },
    pending: LedgerEvent[] = [{ id: "x", kind: "coins", delta: 30, reason: "mission" }],
    merged = applyServerState(p, server(200, 4, { purchases: ["night"], claims: ["gift:2026-11-01"] }), pending);
  assert.equal(netCoins(merged), 230);
  assert.equal(merged.undos, 11);
  assert.deepEqual(merged.purchases.sort(), ["night", "sand"]);
  assert.deepEqual(merged.claims, ["gift:2026-11-01"]);
  assert.equal(applyServerState(p, server(0, 40), []).undos, 20, "shown clamped to 20");
  assert.equal(applyServerState(p, server(0, -30), []).undos, 0);
});

test("a gift or mission claimed on another device can't be claimed again", () => {
  const day = "2026-11-02";
  const other = withClaim(base(), `gift:${day}`);
  assert.equal(canClaimLogin(other, day), false);
  assert.equal(claimLogin(other, day), other);
  let p = base();
  for (let i = 0; i < 4; i++)
    p = recordWin(p, day, { usedUndo: false, perfect: true, daily: true, maxCombo: 6, score: 4000 });
  const m = missionsFor(day).find((m) => m.id !== "bonus3")!;
  const elsewhere = withClaim(p, `mission:${day}:${m.id.toLowerCase()}`);
  assert.equal(claimMission(elsewhere, m.id, day), elsewhere);
});

test("an undo milestone pays once per account", () => {
  const ten = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`level-${i}`, { score: 1, time: 1, stars: 3 }]),
  );
  const fresh = { ...base(), completed: ten };
  assert.equal(earnUndos(fresh).gained, 3);
  const paidElsewhere = withClaim(fresh, "undomilestone:1");
  const r = earnUndos(paidElsewhere);
  assert.equal(r.gained, 0);
  assert.equal(r.profile.undoMilestones, 1);
});
