import { test } from "vitest";
import assert from "node:assert/strict";
import {
  LOGIN_REWARDS,
  canClaimLogin,
  claimLogin,
  claimMission,
  hasClaimable,
  loginDayFor,
  missionsFor,
  recordPair,
  recordWin,
  todayStats,
} from "../../../src/services/daily";
import type { Profile } from "../../../src/services/storage";
const base = (): Profile => ({
  name: "t",
  completed: {},
  dailyDates: [],
  purchases: [],
  undos: 7,
  undoMilestones: 0,
});
const days = (n: number, from = "2026-11-01") => {
  const [y, m, d] = from.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const t = new Date(y, m - 1, d + i);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  });
};

test("login calendar runs days 1–7, then cycles, one claim a day", () => {
  let p = base();
  const seen: number[] = [];
  for (const day of days(9)) {
    seen.push(loginDayFor(p, day));
    p = claimLogin(p, day);
    assert.equal(canClaimLogin(p, day), false);
    assert.equal(claimLogin(p, day), p, "second claim the same day does nothing");
  }
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7, 1, 2]);
  const coins = [...LOGIN_REWARDS, LOGIN_REWARDS[0], LOGIN_REWARDS[1]].reduce((n, r) => n + r.coins, 0);
  assert.equal(p.bonusCoins, coins);
});

test("a missed day restarts at day 1 and takes nothing away", () => {
  let p = base();
  const [d1, d2, , d4] = days(4);
  p = claimLogin(claimLogin(p, d1), d2);
  const coins = p.bonusCoins, undos = p.undos;
  assert.equal(loginDayFor(p, d4), 1);
  p = claimLogin(p, d4);
  assert.ok(p.bonusCoins! >= coins!);
  assert.ok(p.undos >= undos);
  assert.equal(p.login?.day, 1);
});

test("login undos never pass the cap of 20", () => {
  let p = { ...base(), undos: 19 };
  for (const day of days(7)) p = claimLogin(p, day);
  assert.equal(p.undos, 20);
});

test("missions: 3 per day, same for everyone, paid once when done", () => {
  const [day, next] = days(2);
  assert.equal(missionsFor(day).length, 3);
  assert.deepEqual(missionsFor(day).map((m) => m.id), missionsFor(day).map((m) => m.id));
  let p = claimLogin(base(), day);
  assert.equal(hasClaimable(p, day), false);
  for (let i = 0; i < 4; i++)
    p = recordWin(p, day, { usedUndo: false, perfect: true, daily: true, maxCombo: 6, score: 4000 });
  for (let i = 0; i < 3; i++) p = recordPair(p, day, { bonus: true, combo: 1 });
  assert.equal(hasClaimable(p, day), true);
  for (const m of missionsFor(day)) {
    const before = p.bonusCoins ?? 0;
    p = claimMission(p, m.id, day);
    assert.equal(p.bonusCoins, before + m.coins);
    assert.equal(claimMission(p, m.id, day), p, "paid once");
  }
  assert.equal(hasClaimable(p, day), false);
  assert.equal(todayStats(p, next).wins, 0, "progress resets on a new day");
});

test("unfinished missions can't be claimed", () => {
  const [day] = days(1);
  const p = base();
  for (const m of missionsFor(day)) assert.equal(claimMission(p, m.id, day), p);
});
