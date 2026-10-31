import { Dexie, type Table } from "dexie";
import {
  group,
  status,
  validateLayout,
  type State,
} from "../../packages/engine/src/index";
export type Settings = {
  sound: number;
  music: number;
  haptics: boolean;
  timer: boolean;
  large: boolean;
  contrast: boolean;
  reducedMotion: boolean;
  locale: "en" | "hi";
  analytics: boolean;
  theme:
    | "jade"
    | "night"
    | "sand"
    | "ocean"
    | "sakura"
    | "ember"
    | "midnight"
    | "slate";
};
export type Profile = {
  name: string;
  completed: Record<string, { score: number; time: number; stars: number }>;
  dailyDates: string[];
  purchases: string[];
  /** Coins spent in the shop. Older profiles predate it and paid 100 each. */
  spent?: number;
  /** Undos left (see services/undos.ts for how they are earned). */
  undos: number;
  /** 10-level milestones already paid out in undos. */
  undoMilestones: number;
  /** Coins from daily rewards, missions and chests (on top of 25 per win). */
  bonusCoins?: number;
  /** 7-day login calendar: last claimed day (1–7) and its local date. */
  login?: { day: number; lastClaim: string | null };
  /** Today's mission progress; reset when the local date changes. */
  today?: import("./daily").TodayStats;
  /** Stars toward the next chest (0–14), chests waiting, chests opened. */
  chestStars?: number;
  chests?: number;
  chestsOpened?: number;
  /** Power-ups owned. */
  powerUps?: Partial<Record<import("./chests").PowerUp, number>>;
};
export type Save = {
  id: string;
  version: 3;
  attemptId?: string;
  puzzleId: string;
  state: State;
};
class Saves extends Dexie {
  runs!: Table<Save>;
  meta!: Table<{ id: string; value: unknown }>;
  outbox!: Table<{ id: string; type: string; payload: unknown }>;
  constructor() {
    super("zen-tiles");
    this.version(1).stores({ runs: "id" });
    this.version(2).stores({ runs: "id", meta: "id", outbox: "id" });
  }
}
export const db = new Saves();
export const defaultSettings: Settings = {
  sound: 0.7,
  music: 0,
  haptics: true,
  timer: true,
  large: false,
  contrast: false,
  reducedMotion:
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
    false,
  locale: "en",
  analytics: false,
  theme: "jade",
};
export const defaultProfile: Profile = {
  name: "Guest gardener",
  completed: {},
  dailyDates: [],
  purchases: [],
  undos: 7,
  undoMilestones: 0,
};
export function validState(value: unknown): value is State {
  if (!value || typeof value !== "object") return false;
  const s = value as State;
  if (
    !Array.isArray(s.tiles) ||
    !Array.isArray(s.history) ||
    s.history.length > 500
  )
    return false;
  const snap = (v: unknown) => {
    const p = v as State;
    if (
      !p ||
      !Array.isArray(p.tiles) ||
      p.tiles.length > 144 ||
      p.tiles.some((t) => !t || typeof t !== "object") ||
      validateLayout(p.tiles).length
    )
      return false;
    if (
      !Array.isArray(p.bonuses) ||
      !Number.isSafeInteger(p.combo) ||
      !Number.isSafeInteger(p.streak) ||
      !Number.isSafeInteger(p.runCount) ||
      !Array.isArray(p.tray) ||
      p.tray.length > 5 ||
      p.tray.some((id) => !p.tiles.some((t) => t.id === id && t.removed)) ||
      ![p.score, p.moves, p.hints, p.shuffles].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      )
    )
      return false;
    return (
      p.tiles.every(
        (t) =>
          typeof t.removed === "boolean" &&
          [
            "bamboo",
            "dots",
            "characters",
            "winds",
            "dragons",
            "flowers",
            "seasons",
          ].includes(t.suit) &&
          typeof t.rank === "string" &&
          t.matchGroup === group(t.suit, t.rank),
      ) &&
      (p.selected === null ||
        p.tiles.some((t) => t.id === p.selected && !t.removed))
    );
  };
  return (
    !!s.rules &&
    Number.isFinite(s.rules.basePair) &&
    snap(s) &&
    s.history.every(
      (p) =>
        snap(p) &&
        p.tiles.length === s.tiles.length &&
        p.tiles.every((t) =>
          s.tiles.some(
            (c) => c.id === t.id && c.x === t.x && c.y === t.y && c.z === t.z,
          ),
        ),
    ) &&
    Number.isFinite(s.elapsedMs) &&
    s.elapsedMs >= 0 &&
    (s.status === status(s.tiles, s.tray, s.traySize ?? 4) ||
      (s.status === "paused" &&
        status(s.tiles, s.tray, s.traySize ?? 4) === "playing"))
  );
}
export function complete(profile: Profile, id: string, s: State): Profile {
  if (s.status !== "won") return profile;
  const old = profile.completed[id],
    stars = Math.max(1, 3 - Math.min(2, s.hints + s.shuffles));
  const completed = {
    ...profile.completed,
    [id]: {
      score: Math.max(old?.score ?? 0, s.score),
      time: Math.min(old?.time ?? Infinity, s.elapsedMs),
      stars: Math.max(old?.stars ?? 0, stars),
    },
  };
  return {
    ...profile,
    completed,
    dailyDates: id.startsWith("daily-")
      ? [...new Set([...profile.dailyDates, id.slice(6)])].sort()
      : profile.dailyDates,
  };
}
/** Each theme costs more than the one before it (25 coins per garden won). */
export const themePrices: Record<Settings["theme"], number> = {
  jade: 0,
  night: 100,
  sand: 175,
  ocean: 275,
  sakura: 400,
  ember: 550,
  midnight: 725,
  slate: 925,
};
export const balance = (p: Profile) =>
  Object.keys(p.completed).length * 25 +
  (p.bonusCoins ?? 0) -
  (p.spent ?? p.purchases.length * 100);
/** Buys a theme if affordable; returns the profile unchanged otherwise. */
export function buyTheme(p: Profile, theme: Settings["theme"]): Profile {
  const price = themePrices[theme];
  if (p.purchases.includes(theme) || balance(p) < price) return p;
  return {
    ...p,
    purchases: [...p.purchases, theme],
    spent: (p.spent ?? p.purchases.length * 100) + price,
  };
}
export function streak(
  dates: string[],
  today = new Date().toISOString().slice(0, 10),
) {
  let n = 0;
  const date = new Date(`${today}T00:00:00Z`);
  if (!dates.includes(today)) date.setUTCDate(date.getUTCDate() - 1);
  while (dates.includes(date.toISOString().slice(0, 10))) {
    n++;
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return n;
}
