import scheduled from "../../packages/content/levels/daily.json";
import content from "../../packages/content/levels/campaign.json";
import type { Puzzle } from "../../packages/engine/src/index";
import { generatePuzzle } from "../../packages/engine/src/index";
import { layouts } from "../../packages/content/layouts";
import {
  CAMPAIGN_SIZE,
  endlessId,
  endlessLayout,
  generateEndless,
} from "./endless";
type Level = { number: number; name: string; hash: string; puzzle: Puzzle };
/**
 * The bundled, solver-verified campaign. The content file is already a
 * difficulty ramp (12 tiles at level 1 up to 80 at level 100), so its order
 * is the play order. Progress and the server key on stable puzzle ids.
 */
export const levels: Level[] = content.levels as Level[];
if (levels.length !== CAMPAIGN_SIZE)
  throw Error(`Expected ${CAMPAIGN_SIZE} campaign levels, got ${levels.length}`);
export { CAMPAIGN_SIZE, endlessId, generateEndless };
/** Levels after the campaign that open together once level 100 is cleared. */
export const FIRST_ENDLESS_BATCH = 50;
/** Then every this many endless levels cleared opens this many more. */
export const ENDLESS_BATCH = 10;

/** Level number of any campaign or endless puzzle id (null for dailies). */
export function levelNumberOf(puzzleId: string): number | null {
  const m = /^endless-(\d+)$/.exec(puzzleId);
  if (m) return Number(m[1]);
  const i = levels.findIndex((l) => l.puzzle.id === puzzleId);
  return i < 0 ? null : i + 1;
}
export const isEndless = (n: number | null) => n !== null && n > CAMPAIGN_SIZE;
export function levelName(n: number) {
  return n <= CAMPAIGN_SIZE ? levels[n - 1].name : endlessLayout(n).name;
}
const clearedNumbers = (completed: Record<string, unknown>) =>
  Object.keys(completed)
    .map(levelNumberOf)
    .filter((n): n is number => n !== null);
/**
 * Campaign levels cleared in an unbroken run from level 1. Progress only
 * counts in order, so a stray clear (e.g. from an older level set) can't
 * skip ahead.
 */
export function clearedRun(completed: Record<string, unknown>) {
  let n = 0;
  while (n < CAMPAIGN_SIZE && levels[n].puzzle.id in completed) n++;
  return n;
}
/** Highest level reached in order (0 for none). */
export const highestCleared = (completed: Record<string, unknown>) => {
  const run = clearedRun(completed);
  return run < CAMPAIGN_SIZE
    ? run
    : Math.max(run, ...clearedNumbers(completed));
};
/** Endless levels cleared so far. */
export const endlessCleared = (completed: Record<string, unknown>) =>
  clearedNumbers(completed).filter((n) => n > CAMPAIGN_SIZE).length;
/**
 * Last endless level that is open: clearing level 100 opens 101–150, then
 * every 10 endless levels cleared opens the next 10, forever. 0 = none yet.
 */
export function endlessUnlockedUpTo(completed: Record<string, unknown>) {
  if (clearedRun(completed) < CAMPAIGN_SIZE) return 0;
  return (
    CAMPAIGN_SIZE +
    FIRST_ENDLESS_BATCH +
    ENDLESS_BATCH * Math.floor(endlessCleared(completed) / ENDLESS_BATCH)
  );
}
/** Endless clears still needed before the next batch opens. */
export const nextBatchIn = (completed: Record<string, unknown>) =>
  ENDLESS_BATCH - (endlessCleared(completed) % ENDLESS_BATCH);
/**
 * Campaign levels open strictly in order: a level opens only once every
 * level before it is cleared. Endless levels open a batch at a time.
 */
export function isUnlocked(n: number, completed: Record<string, unknown>) {
  if (n <= CAMPAIGN_SIZE) return n <= clearedRun(completed) + 1;
  return n <= endlessUnlockedUpTo(completed);
}
/** The level to continue with: the first open one not yet cleared. */
export function nextPlayable(completed: Record<string, unknown>) {
  const run = clearedRun(completed);
  if (run < CAMPAIGN_SIZE) return run + 1;
  const upTo = endlessUnlockedUpTo(completed);
  for (let n = CAMPAIGN_SIZE + 1; n <= upTo; n++)
    if (!(endlessId(n) in completed)) return n;
  return Math.max(CAMPAIGN_SIZE, upTo);
}
/** Endless chapter (one per unlock batch); null for campaign levels. */
export function chapterOf(n: number | null) {
  if (n === null || n <= CAMPAIGN_SIZE) return null;
  const first = CAMPAIGN_SIZE + FIRST_ENDLESS_BATCH;
  return n <= first ? 1 : 2 + Math.floor((n - first - 1) / ENDLESS_BATCH);
}
/** Names for each 30° slice of the colour wheel, so a name matches its felt. */
const hueNames = [
  "Ruby Night",
  "Amber Dusk",
  "Saffron",
  "Wild Fern",
  "Jade Grove",
  "Lagoon",
  "Glacier",
  "Deep Sea",
  "Moonstone",
  "Plum Blossom",
  "Orchid",
  "Rose Dusk",
];
/**
 * A generated board theme per chapter: the felt hue steps by the golden angle
 * so neighbouring chapters always look different, and the name follows the hue.
 */
export function chapterTheme(chapter: number) {
  const hue = (chapter * 137.5 + 30) % 360;
  return {
    name: `${hueNames[Math.floor(hue / 30)]} ${chapter}`,
    felt1: `hsl(${hue.toFixed(0)} 42% 36%)`,
    felt2: `hsl(${hue.toFixed(0)} 48% 14%)`,
  };
}
/**
 * Custom tile slots earned by progress: one at level 36, a second at 70,
 * then one more every 35 levels after that.
 */
export function customTileSlots(highest: number) {
  if (highest < 36) return 0;
  if (highest < 70) return 1;
  return 2 + Math.floor((highest - 70) / 35);
}
/** Level that earns the next custom tile slot. */
export const nextCustomSlotAt = (highest: number) =>
  highest < 36 ? 36 : highest < 70 ? 70 : 70 + 35 * (Math.floor((highest - 70) / 35) + 1);
export function daily(date = new Date().toISOString().slice(0, 10)) {
  const cached = scheduled.challenges.find((c) => c.date === date);
  if (cached) return cached.puzzle as Puzzle;
  const layout = layouts[Number(date.replaceAll("-", "")) % layouts.length];
  return {
    ...generatePuzzle(layout.slots, `daily-v1-${date}`, layout.id),
    id: `daily-${date}`,
  };
}
