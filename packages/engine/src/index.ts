// GameStateManager: the single reducer every game transition goes through.
// Selection, tray, bonus timers, scoring, undo and shuffle all read and write
// this one State, so they cannot drift apart.
import { isTileFree, listFreeTiles, overlap } from "./layers";
import { compatible, canMatch, group, listLegalPairs } from "./matching";
import { syncBonusTiles, tickBonuses } from "./bonus";
import { liveCombo } from "./combo";
import { defaultRules, tickRush } from "./events";
import { settlePair } from "./scoring";
import { prng } from "./random";
import type {
  Bonus,
  Pair,
  Puzzle,
  Rules,
  Slot,
  Snapshot,
  State,
  Suit,
  Tile,
} from "./types";
export type * from "./types";
export * from "./layers";
export * from "./matching";
export * from "./bonus";
export * from "./combo";
export * from "./events";
export * from "./scoring";
export * from "./random";
export const TRAY_SIZE = 4;
export const trayCap = (s: Pick<State, "traySize">) => s.traySize ?? TRAY_SIZE;
export function status(
  tiles: Tile[],
  tray: string[] = [],
  size = TRAY_SIZE,
): State["status"] {
  if (tiles.every((t) => t.removed) && !tray.length) return "won";
  if (tray.length >= size) return "lost";
  // With room in the tray the player can always lift a free tile.
  return listFreeTiles({ tiles }).length ? "playing" : "stuck";
}
export function initial(
  tiles: Tile[],
  setup: { bonuses?: Bonus[]; rules?: Rules } = {},
): State {
  return {
    tiles: structuredClone(tiles),
    score: 0,
    moves: 0,
    hints: 0,
    shuffles: 0,
    selected: null,
    tray: [],
    bonuses: structuredClone(setup.bonuses ?? []),
    combo: 0,
    maxCombo: 0,
    lastMatchMs: null,
    streak: 0,
    runCount: 0,
    rush: null,
    lastAward: null,
    history: [],
    elapsedMs: 0,
    status: status(tiles),
    rules: setup.rules ?? defaultRules,
  };
}
const snapshot = (s: State): Snapshot => ({
  tiles: s.tiles,
  score: s.score,
  moves: s.moves,
  hints: s.hints,
  shuffles: s.shuffles,
  selected: s.selected,
  tray: s.tray,
  bonuses: s.bonuses,
  combo: s.combo,
  maxCombo: s.maxCombo,
  lastMatchMs: s.lastMatchMs,
  streak: s.streak,
  runCount: s.runCount,
  rush: s.rush,
  lastAward: s.lastAward,
});
const byId = (s: Pick<State, "tiles">, id: string) =>
  s.tiles.find((t) => t.id === id)!;
/** Classic rule: remove two free compatible tiles directly. */
export function match(s: State, a: string, b: string): State {
  if (s.status !== "playing" || !canMatch(s, a, b)) return s;
  const tiles = s.tiles.map((t) =>
    t.id === a || t.id === b ? { ...t, removed: true } : t,
  );
  return {
    ...s,
    ...settlePair(s, byId(s, a), byId(s, b), { tiles, tray: s.tray }),
    tiles,
    selected: null,
    history: [...s.history, snapshot(s)],
    status: status(tiles, s.tray, trayCap(s)),
  };
}
/**
 * Tray rule: a tapped free tile leaves the board for the tray. If the tray
 * already holds a compatible partner, both are cleared and scored; a full
 * tray of strangers loses. Lifting a stray tile breaks the clean streak.
 */
export function pick(s: State, id: string): State {
  if (s.status !== "playing" || !isTileFree(s, id)) return s;
  const tile = byId(s, id),
    partner = s.tray.find((t) => compatible(byId(s, t), tile)),
    tiles = s.tiles.map((t) => (t.id === id ? { ...t, removed: true } : t)),
    tray = partner ? s.tray.filter((t) => t !== partner) : [...s.tray, id];
  return {
    ...s,
    ...(partner
      ? settlePair(s, byId(s, partner), tile, { tiles, tray })
      : { streak: s.tray.length ? 0 : s.streak }),
    tiles,
    tray,
    selected: null,
    history: [...s.history, snapshot(s)],
    status: status(tiles, tray, trayCap(s)),
  };
}
/** The tray tile a free board tile would complete right now, if any. */
export function trayHint(s: State): Pair | null {
  const free = listFreeTiles(s);
  for (const id of s.tray) {
    const partner = free.find((t) => compatible(byId(s, id), t));
    if (partner) return [id, partner.id];
  }
  return null;
}
/** Put lifted tiles back on the board (used before a shuffle). */
export function returnTray(s: State): State {
  if (!s.tray.length) return s;
  const back = new Set(s.tray);
  const tiles = s.tiles.map((t) =>
    back.has(t.id) ? { ...t, removed: false } : t,
  );
  return { ...s, tiles, tray: [], status: status(tiles) };
}
/**
 * Play time passes: bonus countdowns and Rush run down, a stale combo lapses.
 * When a bonus expires its tiles turn ordinary; any tray tiles that now pair
 * are cleared at base value so the tray never holds a matchable pair.
 */
function tick(s: State, ms: number): State {
  const elapsedMs = s.elapsedMs + ms,
    frozen = (s.freezeMs ?? 0) > 0,
    timed = frozen
      ? { tiles: s.tiles, bonuses: s.bonuses, expired: [] as string[] }
      : tickBonuses(s, ms);
  let next: State = {
    ...s,
    elapsedMs,
    tiles: timed.tiles,
    bonuses: timed.bonuses,
    rush: frozen ? s.rush : tickRush(s.rush, ms),
    freezeMs: Math.max(0, (s.freezeMs ?? 0) - ms),
    combo: liveCombo({ ...s, elapsedMs }),
  };
  if (timed.expired.length)
    for (const id of next.tray) {
      const tile = byId(next, id),
        partner = next.tray.find((t) => compatible(byId(next, t), tile));
      if (!partner) continue;
      const tray = next.tray.filter((t) => t !== id && t !== partner);
      next = {
        ...next,
        tray,
        score: next.score + next.rules.basePair,
        moves: next.moves + 1,
        status: status(next.tiles, tray, trayCap(next)),
      };
      break;
    }
  return next;
}
// ---------- Power-ups ----------
export const FREEZE_MS = 10000;
/**
 * Extra tray slot: 5 slots for the rest of this board. Also usable on a full
 * tray, turning "Tray full" back into play.
 */
export function extraSlot(s: State): State {
  if ((s.status !== "playing" && s.status !== "lost") || trayCap(s) > TRAY_SIZE)
    return s;
  const traySize = TRAY_SIZE + 1;
  return { ...s, traySize, status: status(s.tiles, s.tray, traySize) };
}
/** Freeze: bonus and Rush timers stop for 10 s of play. */
export function freeze(s: State): State {
  return s.status === "playing"
    ? { ...s, freezeMs: (s.freezeMs ?? 0) + FREEZE_MS }
    : s;
}
/**
 * Magnet: pulls the partner of a waiting tray tile off the board (even from
 * under other tiles) and clears the pair; with nothing waiting, clears one
 * free pair. It scores like a normal match and undo can take it back.
 */
export function magnet(s: State): State {
  if (s.status !== "playing") return s;
  for (const id of s.tray) {
    const t = byId(s, id),
      onBoard = s.tiles.filter((o) => !o.removed && compatible(t, o)),
      partner = onBoard.find((o) => isTileFree(s, o.id)) ?? onBoard[0];
    if (!partner) continue;
    const tiles = s.tiles.map((o) =>
        o.id === partner.id ? { ...o, removed: true } : o,
      ),
      tray = s.tray.filter((x) => x !== id);
    return {
      ...s,
      ...settlePair(s, t, partner, { tiles, tray }),
      tiles,
      tray,
      selected: null,
      history: [...s.history, snapshot(s)],
      status: status(tiles, tray, trayCap(s)),
    };
  }
  const pair = listLegalPairs(s)[0];
  return pair ? match(s, ...pair) : s;
}
export function undo(s: State): State {
  if (s.status === "paused" || !s.history.length) return s;
  const p = s.history.at(-1)!;
  return {
    ...s,
    ...p,
    history: s.history.slice(0, -1),
    status: status(p.tiles, p.tray, trayCap(s)),
  };
}
export type Action =
  | { type: "match"; a: string; b: string }
  | { type: "select"; id: string }
  | { type: "pick"; id: string }
  | { type: "tick"; ms: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "undo" }
  | { type: "hint"; pair: Pair }
  | { type: "extraSlot" }
  | { type: "freeze" }
  | { type: "magnet" };
export function applyAction(s: State, a: Action): State {
  switch (a.type) {
    case "match":
      return match(s, a.a, a.b);
    case "undo":
      return undo(s);
    case "extraSlot":
      return extraSlot(s);
    case "freeze":
      return freeze(s);
    case "magnet":
      return magnet(s);
    case "pick":
      return pick(s, a.id);
    case "pause":
      return s.status === "playing" ? { ...s, status: "paused" } : s;
    case "resume":
      return s.status === "paused"
        ? { ...s, status: status(s.tiles, s.tray, trayCap(s)) }
        : s;
    case "tick":
      return s.status === "playing" && Number.isFinite(a.ms) && a.ms >= 0
        ? tick(s, a.ms)
        : s;
    case "select":
      return s.status === "playing" && isTileFree(s, a.id)
        ? { ...s, selected: s.selected === a.id ? null : a.id }
        : s;
    case "hint":
      return s.status === "playing" &&
        (canMatch(s, ...a.pair) ||
          (s.tray.includes(a.pair[0]) &&
            isTileFree(s, a.pair[1]) &&
            compatible(byId(s, a.pair[0]), byId(s, a.pair[1]))))
        ? { ...s, selected: a.pair[0], hints: s.hints + 1 }
        : s;
  }
}
export type SolverLimits = { maxNodes: number; maxMs?: number };
export function solve(tiles: Tile[], limits: number | SolverLimits = 20000) {
  const { maxNodes, maxMs = 1000 } =
    typeof limits === "number" ? { maxNodes: limits } : limits;
  let visited = 0,
    limited = false,
    backtracks = 0,
    forced = 0,
    branching = 0,
    depth = 0;
  const start = performance.now(),
    seen = new Set<string>();
  function dfs(ts: Tile[], d: number): Pair[] | null {
    if (ts.every((t) => t.removed)) return [];
    if (visited >= maxNodes || performance.now() - start >= maxMs) {
      limited = true;
      return null;
    }
    visited++;
    depth = Math.max(depth, d);
    const key = ts.map((t) => (t.removed ? "0" : "1")).join("");
    if (seen.has(key)) return null;
    seen.add(key);
    const pairs = listLegalPairs({ tiles: ts });
    branching += pairs.length;
    if (pairs.length === 1) forced++;
    for (const [a, b] of pairs) {
      const rest = dfs(
        ts.map((t) => (t.id === a || t.id === b ? { ...t, removed: true } : t)),
        d + 1,
      );
      if (rest) return [[a, b], ...rest];
      if (limited) return null;
    }
    backtracks++;
    return null;
  }
  const solution = dfs(tiles, 0);
  return {
    status: (solution ? "solved" : limited ? "indeterminate" : "unsolved") as
      "solved" | "unsolved" | "indeterminate",
    solution: solution ?? [],
    visited,
    backtracks,
    forced,
    branching,
    depth,
    elapsedMs: performance.now() - start,
  };
}
export function getHint(
  s: State,
  mode: "legal" | "solutionAware" = "solutionAware",
): Pair | null {
  if (s.status !== "playing") return null;
  if (mode === "legal") return listLegalPairs(s)[0] ?? null;
  const r = solve(s.tiles, { maxNodes: 50000, maxMs: 200 });
  return r.status === "solved" ? (r.solution[0] ?? null) : null;
}
export function validateLayout(slots: Slot[]): string[] {
  const errors: string[] = [];
  if (!slots.length || slots.length % 2)
    errors.push("Tile count must be positive and even");
  if (slots.length > 144) errors.push("Maximum 144 tiles");
  if (new Set(slots.map((t) => t.id)).size !== slots.length)
    errors.push("Duplicate tile IDs");
  for (const t of slots) {
    if (
      !t.id ||
      ![t.x, t.y, t.z].every(Number.isFinite) ||
      t.z < 0 ||
      !Number.isInteger(t.z)
    )
      errors.push("Invalid coordinate or ID");
    for (const o of slots)
      if (o !== t && o.z === t.z && overlap(o.x, t.x) && overlap(o.y, t.y))
        errors.push("Same-layer overlap");
  }
  return [...new Set(errors)];
}
function removalOrder(tiles: Tile[], random: () => number): Pair[] {
  let nodes = 0;
  const seen = new Set<string>();
  function visit(ts: Tile[]): Pair[] | null {
    if (ts.every((t) => t.removed)) return [];
    if (++nodes > 100000) return null;
    const key = ts.map((t) => (t.removed ? "0" : "1")).join("");
    if (seen.has(key)) return null;
    seen.add(key);
    const free = listFreeTiles({ tiles: ts }),
      pairs: Pair[] = [];
    for (let i = 0; i < free.length; i++)
      for (let j = i + 1; j < free.length; j++)
        pairs.push([free[i].id, free[j].id]);
    for (let i = pairs.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }
    for (const [a, b] of pairs) {
      const rest = visit(
        ts.map((t) => (t.id === a || t.id === b ? { ...t, removed: true } : t)),
      );
      if (rest) return [[a, b], ...rest];
    }
    return null;
  }
  const result = visit(tiles.map((t) => ({ ...t, removed: false })));
  if (!result) throw Error("No paired geometric removal order within budget");
  return result;
}
export function generatePuzzle(
  layout: Slot[],
  seed: string,
  layoutId = "custom",
): Puzzle {
  const errors = validateLayout(layout);
  if (errors.length) throw Error(errors.join("; "));
  const random = prng(seed);
  const tiles: Tile[] = layout.map((t) => ({
    ...t,
    suit: "dots",
    rank: "1",
    matchGroup: "dots:1",
    removed: false,
  }));
  const order = removalOrder(tiles, random);
  const deck: { suit: Suit; rank: string; other: string }[] = [];
  for (const suit of [
    "bamboo",
    "dots",
    "characters",
    "winds",
    "dragons",
  ] as Suit[])
    for (
      let rank = 1;
      rank <= (suit === "winds" ? 4 : suit === "dragons" ? 3 : 9);
      rank++
    )
      for (let copy = 0; copy < 2; copy++)
        deck.push({ suit, rank: String(rank), other: String(rank) });
  for (const suit of ["flowers", "seasons"] as Suit[])
    for (let rank = 1; rank <= 3; rank += 2)
      deck.push({ suit, rank: String(rank), other: String(rank + 1) });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  // Assign a standard paired multiset to a proven forward geometric removal order.
  // A separate DFS still verifies the exact arrangement before accepting content.
  order.forEach(([a, b], i) => {
    const face = deck[i];
    for (const [id, rank] of [
      [a, face.rank],
      [b, face.other],
    ])
      Object.assign(
        tiles.find((t) => t.id === id)!,
        { suit: face.suit, rank, matchGroup: group(face.suit, rank) },
      );
  });
  const result = solve(tiles, { maxNodes: 100000, maxMs: 2000 });
  if (result.status !== "solved")
    throw Error("Candidate rejected: independent solver did not verify");
  let ts = tiles,
    choices = 0,
    forced = 0;
  for (const [a, b] of result.solution) {
    const n = listLegalPairs({ tiles: ts }).length;
    choices += n;
    if (n === 1) forced++;
    ts = ts.map((t) =>
      t.id === a || t.id === b ? { ...t, removed: true } : t,
    );
  }
  const metrics = {
    choices: choices / order.length,
    forcedRatio: forced / order.length,
    visited: result.visited,
  };
  return {
    id: `${layoutId}-${seed}`,
    layoutId,
    seed,
    rulesVersion: "1",
    layoutVersion: 1,
    tiles,
    solution: result.solution,
    metrics,
    difficulty:
      metrics.choices >= 2.6
        ? "gentle"
        : metrics.choices >= 2.1
          ? "balanced"
          : "challenging",
  };
}
export function validatePuzzle(p: Puzzle) {
  const errors = validateLayout(p.tiles);
  const counts = new Map<string, number>();
  for (const t of p.tiles) {
    if (t.removed || t.matchGroup !== group(t.suit, t.rank))
      errors.push("Invalid face or removed tile");
    counts.set(t.matchGroup, (counts.get(t.matchGroup) ?? 0) + 1);
  }
  if ([...counts.values()].some((n) => n % 2)) errors.push("Odd match count");
  let s = initial(p.tiles);
  for (const [a, b] of p.solution) {
    if (!canMatch(s, a, b)) {
      errors.push("Illegal witness");
      break;
    }
    s = match(s, a, b);
  }
  if (s.status !== "won") errors.push("Incomplete witness");
  const result = solve(p.tiles, { maxNodes: 100000, maxMs: 2000 });
  if (result.status !== "solved")
    errors.push("Independent verification failed");
  return { valid: !errors.length, errors };
}
export function shuffle(current: State, seed: string): State {
  if (current.status === "paused" || current.status === "won") return current;
  // Shuffling returns tray tiles to the board so every pair can be dealt again.
  const s = returnTray(current);
  const random = prng(seed);
  const remaining = s.tiles.filter((t) => !t.removed);
  const grouped = new Map<string, Tile[]>();
  // Bonus pairs travel together so their pairing survives the reshuffle.
  for (const t of remaining) {
    const key = `${t.matchGroup}|${t.bonusId ?? ""}`;
    grouped.set(key, [...(grouped.get(key) ?? []), t]);
  }
  if ([...grouped.values()].some((g) => g.length % 2)) return current;
  const identities = [...grouped.values()].flatMap((g) =>
    Array.from(
      { length: g.length / 2 },
      (_, i) => [g[i * 2], g[i * 2 + 1]] as [Tile, Tile],
    ),
  );
  for (let i = identities.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [identities[i], identities[j]] = [identities[j], identities[i]];
  }
  let order: Pair[];
  try {
    order = removalOrder(remaining, random);
  } catch {
    return current;
  }
  const assigned = new Map<string, Tile>();
  order.forEach(([a, b], i) =>
    [a, b].forEach((id, j) => assigned.set(id, identities[i][j])),
  );
  const tiles = s.tiles.map((t) => {
    const face = assigned.get(t.id);
    return face
      ? {
          ...t,
          suit: face.suit,
          rank: face.rank,
          matchGroup: face.matchGroup,
          bonusId: face.bonusId,
          tag: face.tag,
        }
      : t;
  });
  if (solve(tiles, { maxNodes: 100000, maxMs: 500 }).status !== "solved")
    return current;
  return {
    ...s,
    tiles,
    selected: null,
    shuffles: s.shuffles + 1,
    bonuses: syncBonusTiles(tiles, s.bonuses),
    history: [...s.history, snapshot(current)],
    status: status(tiles),
  };
}
export function fixture(): Tile[] {
  const rows = [8, 8, 8, 8];
  const slots = rows.flatMap((n, y) =>
    Array.from({ length: n }, (_, x) => ({
      id: `t${y * 8 + x}`,
      x: x * 2,
      y: y * 2,
      z: 0,
    })),
  );
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 2; x++)
      slots.push({
        id: `t${32 + y * 2 + x}`,
        x: 6 + x * 2,
        y: 2 + y * 2,
        z: 1,
      });
  return generatePuzzle(slots, "terrace-fixture", "terrace").tiles;
}
