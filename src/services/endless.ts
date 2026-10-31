// Endless levels: generated after the bundled campaign, deterministic from the
// level number. Kept apart from content.ts so the generator worker does not
// pull the whole campaign file into its bundle.
import { generatePuzzle, type Puzzle } from "../../packages/engine/src/index";
import { campaignLayout } from "../../packages/content/layouts";
/** Number of bundled campaign levels; endless levels follow them. */
export const CAMPAIGN_SIZE = 100;
export const endlessId = (n: number) => `endless-${n}`;
/**
 * Endless levels reuse the shapes of the hardest campaign stretch (levels
 * 81–100, 66–80 tiles across all ten patterns) with a fresh seed each, so
 * every one is new but still fits a phone screen.
 */
export const endlessLayout = (n: number) =>
  campaignLayout(81 + ((n - CAMPAIGN_SIZE - 1) % 20));
/**
 * The same number always gives the same board. generatePuzzle runs the
 * solver and throws on an unverified board, so a returned puzzle is
 * solvable; a few seeds are tried in a fixed order.
 */
export function generateEndless(n: number): Puzzle {
  const layout = endlessLayout(n);
  let last: unknown;
  for (let k = 0; k < 10; k++)
    try {
      return {
        ...generatePuzzle(layout.slots, `endless-v1-${n}-${k}`, layout.id),
        id: endlessId(n),
      };
    } catch (e) {
      last = e;
    }
  throw last;
}
