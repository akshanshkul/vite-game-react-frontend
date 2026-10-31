import { test } from "vitest";
import assert from "node:assert/strict";
import {
  earnUndos,
  migrateUndos,
  spendUndo,
  START_UNDOS,
} from "../../../src/services/undos";
import type { Profile } from "../../../src/services/storage";
const profile = (cleared: number, undos = START_UNDOS, undoMilestones = 0): Profile => ({
  name: "t",
  completed: Object.fromEntries(
    Array.from({ length: cleared }, (_, i) => [`level-${i}`, { score: 1, time: 1, stars: 3 }]),
  ),
  dailyDates: [],
  purchases: [],
  undos,
  undoMilestones,
});

test("every 10 levels cleared pays 3 undos once", () => {
  assert.equal(earnUndos(profile(9)).gained, 0);
  const ten = earnUndos(profile(10));
  assert.equal(ten.gained, 3);
  assert.equal(ten.profile.undos, 10);
  assert.equal(ten.profile.undoMilestones, 1);
  // Replaying a cleared level keeps the count, so nothing is paid twice.
  assert.equal(earnUndos(ten.profile).gained, 0);
});

test("undos never exceed 20 and the cap does not bank milestones", () => {
  const capped = earnUndos(profile(40, 18));
  assert.equal(capped.profile.undos, 20);
  assert.equal(capped.gained, 2);
  assert.equal(capped.profile.undoMilestones, 4);
  const spent = spendUndo(capped.profile);
  assert.equal(earnUndos(spent).gained, 0, "old milestones stay spent");
});

test("dailies don't count toward milestones", () => {
  const p = profile(9);
  p.completed["daily-2026-10-31"] = { score: 1, time: 1, stars: 3 };
  assert.equal(earnUndos(p).gained, 0);
});

test("spending stops at zero", () => {
  assert.equal(spendUndo(profile(0, 1)).undos, 0);
  assert.equal(spendUndo(profile(0, 0)).undos, 0);
});

test("old profiles start at 7 with past milestones already paid", () => {
  const old = { ...profile(37) } as Partial<Profile>;
  delete old.undos;
  delete old.undoMilestones;
  const migrated = migrateUndos(old as Profile);
  assert.equal(migrated.undos, 7);
  assert.equal(migrated.undoMilestones, 3);
  assert.equal(earnUndos(migrated).gained, 0, "no burst on first load");
  assert.equal(migrateUndos(profile(0, 99)).undos, 20, "stored value is capped");
});
