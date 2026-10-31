import { test } from "vitest";
import assert from "node:assert/strict";
import { solve } from "../src/index";
import { generateEndless } from "../../../src/services/endless";
import {
  CAMPAIGN_SIZE,
  chapterOf,
  customTileSlots,
  endlessUnlockedUpTo,
  isUnlocked,
  levelNumberOf,
  levels,
  nextBatchIn,
  nextPlayable,
} from "../../../src/services/content";
const cleared = (...ids: string[]) =>
  Object.fromEntries(ids.map((id) => [id, { score: 1, time: 1, stars: 3 }]));
const campaignDone = () => cleared(...levels.map((l) => l.puzzle.id));
const endless = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => `endless-${from + i}`);

test("endless levels are deterministic, solvable and numbered", () => {
  for (const n of [101, 137, 250]) {
    const a = generateEndless(n),
      b = generateEndless(n);
    assert.deepEqual(a.tiles, b.tiles, "same number, same board");
    assert.equal(a.id, `endless-${n}`);
    assert.equal(levelNumberOf(a.id), n);
    assert.equal(solve(a.tiles, { maxNodes: 200000, maxMs: 5000 }).status, "solved");
  }
  assert.notDeepEqual(generateEndless(101).tiles, generateEndless(121).tiles);
});

test("campaign opens one level at a time", () => {
  assert.equal(isUnlocked(1, {}), true);
  assert.equal(isUnlocked(2, {}), false);
  assert.equal(isUnlocked(2, cleared(levels[0].puzzle.id)), true);
  assert.equal(nextPlayable(cleared(levels[0].puzzle.id)), 2);
});

test("clearing level 100 opens 50, then every 10 cleared opens 10 more", () => {
  const almost = cleared(...levels.slice(0, -1).map((l) => l.puzzle.id));
  assert.equal(endlessUnlockedUpTo(almost), 0);
  assert.equal(isUnlocked(CAMPAIGN_SIZE + 1, almost), false);
  const done = campaignDone();
  assert.equal(endlessUnlockedUpTo(done), 150);
  assert.equal(isUnlocked(150, done), true);
  assert.equal(isUnlocked(151, done), false);
  assert.equal(nextPlayable(done), 101);
  const nine = { ...done, ...cleared(...endless(101, 9)) };
  assert.equal(endlessUnlockedUpTo(nine), 150);
  assert.equal(nextBatchIn(nine), 1);
  const ten = { ...done, ...cleared(...endless(101, 10)) };
  assert.equal(endlessUnlockedUpTo(ten), 160);
  const many = { ...done, ...cleared(...endless(101, 55)) };
  assert.equal(endlessUnlockedUpTo(many), 200);
  assert.equal(nextPlayable(many), 156);
});

test("chapters and custom tile slots follow progress", () => {
  assert.equal(chapterOf(100), null);
  assert.equal(chapterOf(101), 1);
  assert.equal(chapterOf(150), 1);
  assert.equal(chapterOf(151), 2);
  assert.equal(chapterOf(161), 3);
  assert.deepEqual(
    [0, 35, 36, 69, 70, 104, 105, 140].map(customTileSlots),
    [0, 0, 1, 1, 2, 2, 3, 4],
  );
});
