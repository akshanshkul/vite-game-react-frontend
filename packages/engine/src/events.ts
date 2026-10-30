// Bonus events that appear during play: Rush (a tag scores extra for a while),
// Bamboo Streak (clean pairs in a row) and Animal Combo (one tag in a row).
import type { Rules, Rush, State } from "./types";
export const defaultRules: Rules = {
  basePair: 100,
  comboWindowMs: 8000,
  comboRewards: [
    [5, 150],
    [3, 50],
    [2, 20],
  ],
  rush: { every: 6, multiplier: 3, durationMs: 20000 },
  streak: { length: 5, reward: 500 },
  run: { tag: "animal", length: 3, reward: 300 },
};
export const tickRush = (rush: Rush | null, ms: number): Rush | null =>
  rush && rush.remainingMs > ms
    ? { ...rush, remainingMs: rush.remainingMs - ms }
    : null;
/**
 * Every `rush.every` pairs a Rush starts for the special category with the
 * most tiles still in play (programming first on ties), so it is reachable.
 */
export function startRush(
  s: Pick<State, "tiles" | "tray" | "rules" | "rush">,
  moves: number,
): Rush | null {
  const cfg = s.rules.rush;
  if (!cfg || s.rush || moves === 0 || moves % cfg.every) return s.rush;
  const counts = new Map<string, number>();
  for (const t of s.tiles)
    if ((!t.removed || s.tray.includes(t.id)) && t.tag)
      counts.set(t.tag, (counts.get(t.tag) ?? 0) + 1);
  const priority = (tag: string) =>
      ["programming", "animal", "traditional"].indexOf(tag) >>> 0,
    tag = [...counts.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1] || priority(a[0]) - priority(b[0]))[0]?.[0];
  return tag
    ? {
        tag,
        multiplier: cfg.multiplier,
        durationMs: cfg.durationMs,
        remainingMs: cfg.durationMs,
      }
    : null;
}
