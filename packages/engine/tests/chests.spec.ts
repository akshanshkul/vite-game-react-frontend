import { test } from "vitest";
import assert from "node:assert/strict";
import {
  CHEST_REWARDS,
  addStars,
  openChest,
  powerUps,
  spendPowerUp,
  starsGained,
} from "../../../src/services/chests";
import type { Profile } from "../../../src/services/storage";
const base = (): Profile => ({
  name: "t", completed: {}, dailyDates: [], purchases: [], undos: 7, undoMilestones: 0,
});

test("only new stars count", () => {
  assert.equal(starsGained(undefined, 3), 3);
  assert.equal(starsGained(2, 3), 1);
  assert.equal(starsGained(3, 3), 0, "replaying a 3-star level adds nothing");
  assert.equal(starsGained(3, 1), 0);
});

test("every 15 stars fills a chest; leftovers carry over", () => {
  let p = base();
  for (let i = 0; i < 6; i++) p = addStars(p, 3);
  assert.equal(p.chests, 1);
  assert.equal(p.chestStars, 3);
  p = addStars(p, 30);
  assert.equal(p.chests, 3);
  assert.equal(p.chestStars, 3);
});

test("chests pay the fixed table in order, then repeat", () => {
  let p = addStars(base(), 15 * (CHEST_REWARDS.length + 1));
  const got = [];
  for (let i = 0; i <= CHEST_REWARDS.length; i++) {
    const opened = openChest(p)!;
    got.push(opened.reward);
    p = opened.profile;
  }
  assert.deepEqual(got, [...CHEST_REWARDS, CHEST_REWARDS[0]]);
  assert.equal(openChest(p), null, "no chests left");
  assert.equal(p.bonusCoins, 50 + 75 + 50);
  assert.deepEqual(powerUps(p), { slot: 2, magnet: 2, freeze: 1 });
});

test("power-ups are spent one at a time and never go negative", () => {
  let p = openChest(addStars(base(), 30))!.profile;
  p = openChest(p)!.profile;
  assert.equal(powerUps(p).magnet, 1);
  p = spendPowerUp(p, "magnet")!;
  assert.equal(powerUps(p).magnet, 0);
  assert.equal(spendPowerUp(p, "magnet"), null);
});
