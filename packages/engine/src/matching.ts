// TileMatchingEngine: which two tiles may pair.
import { isTileFree, listFreeTiles } from "./layers";
import type { Pair, State, Suit, Tile } from "./types";
export const group = (suit: Suit, rank: string) =>
  suit === "flowers" || suit === "seasons" ? suit : `${suit}:${rank}`;
/**
 * Same face group, and the same bonus pairing: a live bonus tile only pairs
 * with its own partner, never with an ordinary tile showing the same symbol.
 */
export const compatible = (a: Tile, b: Tile) =>
  a.id !== b.id &&
  a.matchGroup === b.matchGroup &&
  (a.bonusId ?? null) === (b.bonusId ?? null);
export function canMatch(
  s: Pick<State, "tiles">,
  a: string,
  b: string,
): boolean {
  const ta = s.tiles.find((t) => t.id === a),
    tb = s.tiles.find((t) => t.id === b);
  return (
    !!ta &&
    !!tb &&
    compatible(ta, tb) &&
    isTileFree(s, a) &&
    isTileFree(s, b)
  );
}
export function listLegalPairs(s: Pick<State, "tiles">): Pair[] {
  const free = listFreeTiles(s);
  return free.flatMap((a, i) =>
    free
      .slice(i + 1)
      .filter((b) => compatible(a, b))
      .map((b) => [a.id, b.id] as Pair),
  );
}
