import { test } from "vitest";
import assert from "node:assert/strict";
import {
  applyAction,
  assignBonuses,
  fixture,
  initial,
  pick,
  shuffle,
  solve,
  undo,
  type Bonus,
  type State,
  type Tile,
} from "../src/index";
const tile = (
  id: string,
  x: number,
  extra: Partial<Tile> = {},
  y = 0,
  z = 0,
): Tile => ({
  id,
  x,
  y,
  z,
  suit: "dots",
  rank: "1",
  matchGroup: "dots:1",
  removed: false,
  ...extra,
});
const bonus = (over: Partial<Bonus> = {}): Bonus => ({
  id: "b1",
  tiles: ["a", "b"],
  kind: "multiplier",
  multiplier: 5,
  flat: 0,
  comboBoost: 0,
  durationMs: 15000,
  remainingMs: 15000,
  status: "live",
  ...over,
});
const tick = (s: State, ms: number) => applyAction(s, { type: "tick", ms });
// a, b: bonus pair. c, d: ordinary tiles with the same face.
const board = () =>
  initial(
    [
      tile("a", 0, { bonusId: "b1" }),
      tile("b", 4, { bonusId: "b1" }),
      tile("c", 8),
      tile("d", 12),
    ],
    { bonuses: [bonus()] },
  );

test("bonus tiles only pair with their own partner (rule 7, 8)", () => {
  let s = pick(board(), "a");
  s = pick(s, "c");
  assert.deepEqual(s.tray, ["a", "c"], "ordinary twin must not clear a bonus tile");
  s = pick(s, "b");
  assert.deepEqual(s.tray, ["c"]);
  assert.equal(s.score, 500, "5× multiplier");
  assert.equal(s.bonuses[0].status, "claimed");
  assert.deepEqual(s.lastAward?.labels, ["5× BONUS"]);
});

test("timer runs only for reachable tiles and pauses with the game (rules 1, 5, 6)", () => {
  const covered = initial(
    [
      tile("a", 0, { bonusId: "b1" }),
      tile("b", 4, { bonusId: "b1" }),
      tile("lidA", 0, { matchGroup: "x" }, 0, 1),
      tile("lidB", 4, { matchGroup: "x" }, 0, 1),
    ],
    { bonuses: [bonus()] },
  );
  assert.equal(tick(covered, 5000).bonuses[0].remainingMs, 15000);
  const running = tick(board(), 5000);
  assert.equal(running.bonuses[0].remainingMs, 10000);
  const paused = applyAction(running, { type: "pause" });
  assert.equal(tick(paused, 5000).bonuses[0].remainingMs, 10000);
});

test("expired bonus becomes an ordinary tile worth base points (rules 3, 4)", () => {
  let s = tick(board(), 15000);
  assert.equal(s.bonuses[0].status, "expired");
  assert.equal(s.tiles.find((t) => t.id === "a")!.bonusId, undefined);
  s = pick(pick(s, "a"), "c");
  assert.deepEqual(s.tray, [], "now pairs with an ordinary twin");
  assert.equal(s.score, 100);
});

test("expiry clears a tray that now holds a compatible pair", () => {
  let s = pick(pick(board(), "a"), "c");
  assert.equal(s.tray.length, 2);
  s = tick(s, 15000);
  assert.deepEqual(s.tray, []);
  assert.equal(s.score, 100);
});

test("undo restores timer, bonus, combo and score without duplication", () => {
  let s = tick(board(), 4000);
  s = pick(s, "a");
  s = tick(s, 3000);
  const before = s;
  s = pick(s, "b");
  assert.equal(s.score, 500);
  const back = undo(s);
  assert.equal(back.score, before.score);
  assert.equal(back.bonuses[0].status, "live");
  assert.equal(back.bonuses[0].remainingMs, 8000);
  assert.equal(pick(back, "b").score, 500, "re-matching scores once");
});

test("combo grows within the window and lapses after it", () => {
  const four = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      tile(`t${i}`, i * 4, { matchGroup: `g${Math.floor(i / 2)}` }),
    );
  let s = initial(four(6));
  s = pick(pick(s, "t0"), "t1");
  assert.equal(s.combo, 1);
  s = pick(pick(tick(s, 2000), "t2"), "t3");
  assert.equal(s.combo, 2);
  assert.equal(s.score, 100 + 100 + 20);
  s = tick(s, 9000);
  assert.equal(s.combo, 0, "lapses after the window");
  s = pick(pick(s, "t4"), "t5");
  assert.equal(s.combo, 1);
});

test("bonus pairs come from the witness, so the board stays solvable", () => {
  const tiles = fixture(),
    witness = solve(tiles).solution,
    dealt = assignBonuses(tiles, witness, "seed", {
      frequency: 0.5,
      durationMs: 15000,
      multipliers: [2, 3, 5],
      golden: { multiplier: 2, flat: 250 },
      comboBoost: 2,
    });
  assert.equal(dealt.bonuses.length, Math.round(witness.length * 0.5));
  assert.equal(solve(dealt.tiles).status, "solved");
});

test("shuffle keeps bonus pairs together and re-points their tiles", () => {
  const tiles = fixture(),
    dealt = assignBonuses(tiles, solve(tiles).solution, "s", {
      frequency: 0.3,
      durationMs: 15000,
      multipliers: [5],
      golden: { multiplier: 2, flat: 250 },
      comboBoost: 2,
    }),
    s = initial(dealt.tiles, { bonuses: dealt.bonuses }),
    next = shuffle(s, "shuffle-seed");
  assert.equal(next.shuffles, 1);
  for (const b of next.bonuses) {
    const [x, y] = b.tiles.map((id) => next.tiles.find((t) => t.id === id)!);
    assert.equal(x.bonusId, b.id);
    assert.equal(y.bonusId, b.id);
    assert.equal(x.matchGroup, y.matchGroup);
  }
});

test("max combo tracks the longest streak and undo restores it", () => {
  const tiles = Array.from({ length: 6 }, (_, i) =>
    tile(`t${i}`, i * 4, { matchGroup: `g${Math.floor(i / 2)}` }),
  );
  let s = initial(tiles);
  s = pick(pick(s, "t0"), "t1");
  s = pick(pick(tick(s, 1000), "t2"), "t3");
  assert.equal(s.maxCombo, 2);
  s = pick(pick(tick(s, 20000), "t4"), "t5");
  assert.equal(s.combo, 1, "combo restarted after the window");
  assert.equal(s.maxCombo, 2, "max keeps the best streak");
  assert.equal(undo(undo(s)).maxCombo, 2);
  assert.equal(undo(undo(undo(undo(s)))).maxCombo, 1);
});
