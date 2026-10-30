// BonusTimerManager: special pairs, their countdowns and expiry.
// Timers are advanced only by the central `tick` action, so they pause with
// the game, rewind with undo, and never run while both tiles are blocked.
import { isTileFree } from "./layers";
import { prng } from "./random";
import type { Bonus, Pair, State, Tile } from "./types";
export type BonusConfig = {
  /** Share of pairs that become bonus pairs (0–1). */
  frequency: number;
  durationMs: number;
  /** Multipliers dealt to "multiplier" bonuses, low to high. */
  multipliers: number[];
  golden: { multiplier: number; flat: number };
  comboBoost: number;
};
export const defaultBonusConfig: BonusConfig = {
  frequency: 0.1,
  durationMs: 15000,
  multipliers: [2, 3, 5],
  golden: { multiplier: 2, flat: 250 },
  comboBoost: 2,
};
/**
 * Turns some pairs of the verified solution into bonus pairs. Because a bonus
 * pair is a pair the witness already matches together, every level stays
 * solvable with the extra "bonus tiles only pair with each other" rule.
 */
export function assignBonuses(
  tiles: Tile[],
  solution: Pair[],
  seed: string,
  config: BonusConfig = defaultBonusConfig,
): { tiles: Tile[]; bonuses: Bonus[] } {
  const count = Math.min(
    solution.length,
    Math.round(solution.length * Math.max(0, config.frequency)),
  );
  if (!count) return { tiles, bonuses: [] };
  const random = prng(`bonus-${seed}`),
    picks = solution
      .map((pair) => ({ pair, r: random() }))
      .sort((a, b) => a.r - b.r)
      .slice(0, count)
      .map((p) => p.pair),
    kinds: Bonus["kind"][] = ["multiplier", "multiplier", "golden", "multiplier", "combo"];
  const bonuses = picks.map((pair, i): Bonus => {
    const kind = kinds[i % kinds.length],
      m = config.multipliers;
    return {
      id: `b${i + 1}`,
      tiles: [pair[0], pair[1]],
      kind,
      multiplier:
        kind === "golden"
          ? config.golden.multiplier
          : kind === "combo"
            ? 1
            : m[Math.floor(random() * m.length)] ?? 2,
      flat: kind === "golden" ? config.golden.flat : 0,
      comboBoost: kind === "combo" ? config.comboBoost : 0,
      durationMs: config.durationMs,
      remainingMs: config.durationMs,
      status: "live",
    };
  });
  const owner = new Map(bonuses.flatMap((b) => b.tiles.map((t) => [t, b.id])));
  return {
    tiles: tiles.map((t) =>
      owner.has(t.id) ? { ...t, bonusId: owner.get(t.id) } : t,
    ),
    bonuses,
  };
}
/** A live bonus counts down once either of its tiles is reachable. */
export const isBonusRunning = (
  s: Pick<State, "tiles" | "tray">,
  b: Bonus,
) =>
  b.status === "live" &&
  b.tiles.some((id) => s.tray.includes(id) || isTileFree(s, id));
export const bonusOf = (s: Pick<State, "bonuses">, tile: Tile) =>
  tile.bonusId
    ? s.bonuses.find((b) => b.id === tile.bonusId && b.status === "live")
    : undefined;
/**
 * Advance every running countdown by `ms`. An expired pair loses its
 * multiplier and its tiles become ordinary tiles of their face group.
 */
export function tickBonuses(
  s: Pick<State, "tiles" | "tray" | "bonuses">,
  ms: number,
): { tiles: Tile[]; bonuses: Bonus[]; expired: string[] } {
  const expired: string[] = [];
  const bonuses = s.bonuses.map((b) => {
    if (!isBonusRunning(s, b)) return b;
    const remainingMs = Math.max(0, b.remainingMs - ms);
    if (remainingMs > 0) return { ...b, remainingMs };
    expired.push(b.id);
    return { ...b, remainingMs: 0, status: "expired" as const };
  });
  if (!expired.length) return { tiles: s.tiles, bonuses, expired };
  return {
    tiles: s.tiles.map((t) =>
      t.bonusId && expired.includes(t.bonusId)
        ? { ...t, bonusId: undefined }
        : t,
    ),
    bonuses,
    expired,
  };
}
/** After a shuffle moves faces, point each bonus at its tiles' new ids. */
export function syncBonusTiles(tiles: Tile[], bonuses: Bonus[]): Bonus[] {
  return bonuses.map((b) => {
    if (b.status !== "live") return b;
    const ids = tiles.filter((t) => t.bonusId === b.id).map((t) => t.id);
    return ids.length === 2 ? { ...b, tiles: [ids[0], ids[1]] } : b;
  });
}
