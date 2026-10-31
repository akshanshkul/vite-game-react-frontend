import { test } from "vitest";
import assert from "node:assert/strict";
import {
  applyAction,
  extraSlot,
  freeze,
  initial,
  magnet,
  pick,
  undo,
  type Bonus,
  type State,
  type Tile,
} from "../src/index";
const tile = (id: string, x: number, group: string, y = 0, z = 0): Tile => ({
  id,
  x,
  y,
  z,
  suit: "dots",
  rank: "1",
  matchGroup: group,
  removed: false,
});
const tick = (s: State, ms: number) => applyAction(s, { type: "tick", ms });
// Five singles on row 0 (groups a–e) and their partners on row 4.
const board = () =>
  initial(
    ["a", "b", "c", "d", "e"].flatMap((g, i) => [
      tile(`${g}1`, i * 4, g),
      tile(`${g}2`, i * 4, g, 4),
    ]),
  );

test("extra slot gives 5 tray slots and rescues a full tray", () => {
  let s = board();
  for (const id of ["a1", "b1", "c1", "d1"]) s = pick(s, id);
  assert.equal(s.status, "lost");
  s = extraSlot(s);
  assert.equal(s.status, "playing", "a full tray of 4 is fine with 5 slots");
  assert.equal(s.traySize, 5);
  assert.equal(extraSlot(s), s, "only once per board");
  s = pick(s, "e1");
  assert.equal(s.status, "lost", "5 strangers still lose");
});

test("undo keeps a used extra slot", () => {
  let s = pick(board(), "a1");
  s = extraSlot(s);
  s = undo(s);
  assert.equal(s.traySize, 5);
  assert.deepEqual(s.tray, []);
});

test("freeze pauses bonus and rush timers for 10 s, and survives undo", () => {
  const live: Bonus = {
    id: "b1", tiles: ["a1", "a2"], kind: "multiplier", multiplier: 3, flat: 0,
    comboBoost: 0, durationMs: 15000, remainingMs: 15000, status: "live",
  };
  let s = initial(
    [{ ...tile("a1", 0, "a"), bonusId: "b1" }, { ...tile("a2", 8, "a"), bonusId: "b1" }, tile("x", 16, "x"), tile("y", 20, "x")],
    { bonuses: [live] },
  );
  s = { ...s, rush: { tag: "traditional", multiplier: 3, durationMs: 20000, remainingMs: 20000 } };
  s = freeze(s);
  s = tick(s, 6000);
  assert.equal(s.bonuses[0].remainingMs, 15000);
  assert.equal(s.rush?.remainingMs, 20000);
  s = pick(s, "x");
  s = undo(s);
  assert.equal(s.freezeMs, 4000, "undo doesn't give the freeze back or cancel it");
  s = tick(tick(s, 4000), 3000);
  assert.equal(s.bonuses[0].remainingMs, 12000, "timers run again after 10 s");
});

test("magnet pulls a tray tile's partner even from under a cover, and scores", () => {
  let s = initial([
    tile("a1", 0, "a"),
    tile("a2", 8, "a"),
    tile("lid", 8, "lid", 0, 1),
    tile("lid2", 16, "lid"),
  ]);
  s = pick(s, "a1");
  assert.deepEqual(s.tray, ["a1"]);
  s = magnet(s);
  assert.deepEqual(s.tray, []);
  assert.equal(s.tiles.find((t) => t.id === "a2")!.removed, true);
  assert.equal(s.score, 100);
  assert.equal(s.moves, 1);
});

test("magnet with an empty tray clears one free pair; undo takes it back", () => {
  const s = board(),
    pulled = magnet(s);
  assert.equal(pulled.moves, 1);
  assert.equal(pulled.tiles.filter((t) => t.removed).length, 2);
  const back = undo(pulled);
  assert.equal(back.tiles.filter((t) => t.removed).length, 0);
  assert.equal(back.score, 0);
});

test("power-ups do nothing when paused or won", () => {
  const paused = applyAction(board(), { type: "pause" });
  assert.equal(magnet(paused), paused);
  assert.equal(freeze(paused), paused);
  assert.equal(extraSlot(paused), paused);
});
