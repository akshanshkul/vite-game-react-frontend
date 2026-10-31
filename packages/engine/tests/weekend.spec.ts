import { test } from "vitest";
import assert from "node:assert/strict";
import { solve } from "../src/index";
import {
  EVENT_BOARDS,
  awardBadge,
  eventBoardOpen,
  eventPuzzle,
  eventPuzzleId,
  isoWeek,
  parseEventId,
  weekendEvent,
} from "../../../src/services/weekend";
import type { Profile } from "../../../src/services/storage";
const base = (): Profile => ({
  name: "t", completed: {}, dailyDates: [], purchases: [], undos: 7, undoMilestones: 0,
});
const done = { score: 1, time: 1, stars: 3 };

test("ISO weeks and the Friday–Sunday window", () => {
  assert.equal(isoWeek(new Date(2026, 0, 1)), "2026-W01");
  assert.equal(isoWeek(new Date(2026, 9, 30)), "2026-W44");
  assert.equal(isoWeek(new Date(2027, 0, 1)), "2026-W53");
  assert.equal(weekendEvent(new Date(2026, 9, 29)), null, "Thursday");
  const fri = weekendEvent(new Date(2026, 9, 30))!,
    sun = weekendEvent(new Date(2026, 10, 1))!;
  assert.equal(fri.key, "2026-W44");
  assert.equal(sun.key, fri.key, "Sunday is the same festival");
  assert.equal(fri.pack.name, sun.pack.name);
  assert.equal(weekendEvent(new Date(2026, 10, 2)), null, "Monday");
});

test("event boards are deterministic, solvable and grow in size", () => {
  const a = eventPuzzle("2026-W44", 1),
    b = eventPuzzle("2026-W44", 1),
    last = eventPuzzle("2026-W44", EVENT_BOARDS);
  assert.deepEqual(a.tiles, b.tiles);
  assert.equal(a.id, "event-2026-W44-1");
  assert.deepEqual(parseEventId(a.id), { key: "2026-W44", board: 1 });
  assert.ok(last.tiles.length > a.tiles.length);
  assert.equal(solve(last.tiles, { maxNodes: 200000, maxMs: 5000 }).status, "solved");
});

test("boards open in order and the badge comes once after all 10", () => {
  const key = "2026-W44";
  let p = base();
  assert.equal(eventBoardOpen(p, key, 1), true);
  assert.equal(eventBoardOpen(p, key, 2), false);
  for (let i = 1; i < EVENT_BOARDS; i++) p.completed[eventPuzzleId(key, i)] = done;
  assert.equal(eventBoardOpen(p, key, EVENT_BOARDS), true);
  assert.equal(awardBadge(p, key), p, "no badge before board 10");
  p.completed[eventPuzzleId(key, EVENT_BOARDS)] = done;
  p = awardBadge(p, key);
  assert.deepEqual(p.badges, ["weekend:2026-W44"]);
  assert.equal(awardBadge(p, key), p, "awarded once");
});
