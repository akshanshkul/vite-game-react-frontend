// Weekend festival: Friday–Sunday (local date) a series of 10 boards that
// feature one tile pack, the same for everyone in an ISO week. Clearing all
// 10 earns a cosmetic badge. Pure (no IndexedDB) so the rules are tested.
import { generatePuzzle, type Puzzle } from "../../packages/engine/src/index";
import { campaignLayout } from "../../packages/content/layouts";
import { packs, type Pack } from "../game/TileDefinitions";
import type { Profile } from "./storage";
export const EVENT_BOARDS = 10;
/** ISO-8601 week key such as "2026-W44" (weeks start Monday). */
export function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())),
    day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)),
    week = Math.ceil(((t.getTime() - start.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
export type WeekendEvent = { key: string; pack: Pack; endsOn: string };
/** The pack featured in an ISO week ("2026-W44"). */
export const packForWeek = (key: string): Pack =>
  packs[Number(key.slice(-2)) % packs.length];
/** This weekend's festival, or null on Monday–Thursday. */
export function weekendEvent(d = new Date()): WeekendEvent | null {
  const day = d.getDay();
  if (day !== 5 && day !== 6 && day !== 0) return null;
  const key = isoWeek(d),
    sunday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + ((7 - day) % 7));
  return {
    key,
    pack: packForWeek(key),
    endsOn: sunday.toDateString(),
  };
}
/** Days until the next festival starts (for the off-week note). */
export const daysUntilFestival = (d = new Date()) => (5 - d.getDay() + 7) % 7;
export const eventPuzzleId = (key: string, i: number) => `event-${key}-${i}`;
export const parseEventId = (id: string) => {
  const m = /^event-(\d{4}-W\d{2})-(\d{1,2})$/.exec(id);
  return m ? { key: m[1], board: Number(m[2]) } : null;
};
/**
 * Board i (1–10) of a week: sizes grow from about 24 to 55 tiles. The same
 * week and board always give the same solver-verified puzzle.
 */
export function eventPuzzle(key: string, i: number): Puzzle {
  const layout = campaignLayout(10 + i * 5);
  let last: unknown;
  for (let k = 0; k < 10; k++)
    try {
      return {
        ...generatePuzzle(layout.slots, `event-v1-${key}-${i}-${k}`, layout.id),
        id: eventPuzzleId(key, i),
      };
    } catch (e) {
      last = e;
    }
  throw last;
}
export const eventCleared = (p: Profile, key: string) =>
  Array.from({ length: EVENT_BOARDS }, (_, i) => eventPuzzleId(key, i + 1)).filter(
    (id) => id in p.completed,
  ).length;
export const eventBoardOpen = (p: Profile, key: string, i: number) =>
  i === 1 || eventPuzzleId(key, i - 1) in p.completed || eventPuzzleId(key, i) in p.completed;
export const badgeId = (key: string) => `weekend:${key}`;
/** Adds the week's badge once all 10 boards are cleared (idempotent). */
export function awardBadge(p: Profile, key: string): Profile {
  const id = badgeId(key);
  if (eventCleared(p, key) < EVENT_BOARDS || p.badges?.includes(id)) return p;
  return { ...p, badges: [...(p.badges ?? []), id] };
}
