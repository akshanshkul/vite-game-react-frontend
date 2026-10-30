import scheduled from "../../packages/content/levels/daily.json";
import content from "../../packages/content/levels/campaign.json";
import type { Puzzle } from "../../packages/engine/src/index";
import { generatePuzzle } from "../../packages/engine/src/index";
import { layouts } from "../../packages/content/layouts";
type Level = { number: number; name: string; hash: string; puzzle: Puzzle };
const band = { gentle: 0, balanced: 1, challenging: 2 };
// Campaign order is a difficulty curve: gentle → balanced → challenging, and
// within a band smaller boards with more open choices come first. Numbers are
// display order only; progress and the server key on stable puzzle ids.
export const levels: Level[] = (content.levels as Level[])
  .map((l, i) => ({ l, i }))
  .sort(
    (a, b) =>
      band[a.l.puzzle.difficulty] - band[b.l.puzzle.difficulty] ||
      a.l.puzzle.tiles.length - b.l.puzzle.tiles.length ||
      b.l.puzzle.metrics.choices - a.l.puzzle.metrics.choices ||
      a.i - b.i,
  )
  .map(({ l }, i) => ({ ...l, number: i + 1 }));
/** A level opens once the one before it is cleared (or it was cleared before). */
export function unlocked(index: number, completed: Record<string, unknown>) {
  return (
    index === 0 ||
    levels[index].puzzle.id in completed ||
    levels[index - 1].puzzle.id in completed
  );
}
export function daily(date = new Date().toISOString().slice(0, 10)) {
  const cached = scheduled.challenges.find((c) => c.date === date);
  if (cached) return cached.puzzle as Puzzle;
  const layout = layouts[Number(date.replaceAll("-", "")) % layouts.length];
  return {
    ...generatePuzzle(layout.slots, `daily-v1-${date}`, layout.id),
    id: `daily-${date}`,
  };
}
