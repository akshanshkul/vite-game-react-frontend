// LayerManager: which tiles are reachable on the multi-layer board.
import type { State, Tile } from "./types";
export const EPS = 1e-7;
export const overlap = (a: number, b: number) =>
  Math.min(a + 2, b + 2) - Math.max(a, b) > EPS;
/** Free = nothing on a higher layer overlaps it and one side is open. */
export function isTileFree(s: Pick<State, "tiles">, id: string): boolean {
  const t = s.tiles.find((t) => t.id === id);
  if (!t || t.removed) return false;
  const others = s.tiles.filter((o) => !o.removed && o.id !== id);
  if (others.some((o) => o.z > t.z && overlap(o.x, t.x) && overlap(o.y, t.y)))
    return false;
  const side = (d: number) =>
    others.some(
      (o) => o.z === t.z && Math.abs(o.x - t.x - d) < EPS && overlap(o.y, t.y),
    );
  return !side(-2) || !side(2);
}
export const listFreeTiles = (s: Pick<State, "tiles">): Tile[] =>
  s.tiles.filter((t) => isTileFree(s, t.id));
