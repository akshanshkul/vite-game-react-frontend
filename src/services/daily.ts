// Daily rewards: a 7-day login calendar and 3 missions per local calendar
// day. Everything is local, kind and claimable once: missing a day restarts
// the calendar at day 1 but never takes anything away. Free of IndexedDB so
// the rules are unit tested.
import { prng } from "../../packages/engine/src/index";
import { MAX_UNDOS } from "./undos";
import type { Profile } from "./storage";
import { hasClaim, withClaim } from "./claims";
/** Local calendar day as YYYY-MM-DD (not UTC: a player's "today"). */
export const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const previousDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return localDay(new Date(y, m - 1, d - 1));
};
export type Reward = { coins: number; undos: number };
/** Login calendar: day 7 is the biggest. */
export const LOGIN_REWARDS: Reward[] = [
  { coins: 20, undos: 0 },
  { coins: 0, undos: 1 },
  { coins: 30, undos: 0 },
  { coins: 0, undos: 1 },
  { coins: 40, undos: 0 },
  { coins: 0, undos: 2 },
  { coins: 100, undos: 2 },
];
export type LoginState = { day: number; lastClaim: string | null };
/** Calendar day (1–7) that today's claim would be. */
export function loginDayFor(p: Profile, today: string) {
  const l = p.login;
  if (!l?.lastClaim) return 1;
  if (l.lastClaim === today) return l.day;
  return l.lastClaim === previousDay(today) ? (l.day % 7) + 1 : 1;
}
export const canClaimLogin = (p: Profile, today: string) =>
  p.login?.lastClaim !== today && !hasClaim(p, `gift:${today}`);
const grant = (p: Profile, r: Reward): Profile => ({
  ...p,
  bonusCoins: (p.bonusCoins ?? 0) + r.coins,
  undos: Math.min(MAX_UNDOS, p.undos + r.undos),
});
/** Claims today's login reward once; a second call the same day does nothing. */
export function claimLogin(p: Profile, today: string): Profile {
  if (!canClaimLogin(p, today)) return p;
  const day = loginDayFor(p, today);
  return withClaim(
    { ...grant(p, LOGIN_REWARDS[day - 1]), login: { day, lastClaim: today } },
    `gift:${today}`,
  );
}

/** What happened today, reset when the local day changes. */
export type TodayStats = {
  day: string;
  wins: number;
  noUndoWins: number;
  perfects: number;
  dailyWins: number;
  bonusPairs: number;
  maxCombo: number;
  bestScore: number;
  claimed: string[];
};
const fresh = (day: string): TodayStats => ({
  day,
  wins: 0,
  noUndoWins: 0,
  perfects: 0,
  dailyWins: 0,
  bonusPairs: 0,
  maxCombo: 0,
  bestScore: 0,
  claimed: [],
});
export const todayStats = (p: Profile, today: string): TodayStats =>
  p.today?.day === today ? p.today : fresh(today);
export type Mission = {
  id: string;
  text: string;
  target: number;
  coins: number;
  progress: (t: TodayStats) => number;
};
const POOL: Mission[] = [
  { id: "clear2", text: "Clear 2 gardens", target: 2, coins: 20, progress: (t) => t.wins },
  { id: "clear4", text: "Clear 4 gardens", target: 4, coins: 35, progress: (t) => t.wins },
  { id: "combo5", text: "Reach a ×5 combo", target: 5, coins: 30, progress: (t) => t.maxCombo },
  { id: "noUndo", text: "Clear a garden without undo", target: 1, coins: 20, progress: (t) => t.noUndoWins },
  { id: "bonus3", text: "Match 3 golden bonus pairs", target: 3, coins: 30, progress: (t) => t.bonusPairs },
  { id: "daily", text: "Clear today's daily puzzle", target: 1, coins: 25, progress: (t) => t.dailyWins },
  { id: "perfect", text: "Get a perfect clear", target: 1, coins: 30, progress: (t) => t.perfects },
  { id: "score", text: "Score 3,000 in one garden", target: 3000, coins: 25, progress: (t) => t.bestScore },
];
/** Today's 3 missions: the same for every player on a given date. */
export function missionsFor(day: string): Mission[] {
  const random = prng(`missions-${day}`),
    pool = [...POOL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 3);
}
export const missionDone = (m: Mission, t: TodayStats) => m.progress(t) >= m.target;
/** Pays a finished mission once per day. */
export function claimMission(p: Profile, id: string, today: string): Profile {
  const t = todayStats(p, today),
    m = missionsFor(today).find((m) => m.id === id);
  const key = `mission:${today}:${id.toLowerCase()}`;
  if (!m || t.claimed.includes(id) || hasClaim(p, key) || !missionDone(m, t))
    return p;
  return withClaim(
    {
      ...grant(p, { coins: m.coins, undos: 0 }),
      today: { ...t, claimed: [...t.claimed, id] },
    },
    key,
  );
}
/** Something on the Today sheet is waiting to be claimed. */
export const hasClaimable = (p: Profile, today: string) => {
  const t = todayStats(p, today);
  return (
    (p.chests ?? 0) > 0 ||
    canClaimLogin(p, today) ||
    missionsFor(today).some(
      (m) =>
        missionDone(m, t) &&
        !t.claimed.includes(m.id) &&
        !hasClaim(p, `mission:${today}:${m.id.toLowerCase()}`),
    )
  );
};
/** Records a cleared garden in today's stats. */
export function recordWin(
  p: Profile,
  today: string,
  win: { usedUndo: boolean; perfect: boolean; daily: boolean; maxCombo: number; score: number },
): Profile {
  const t = todayStats(p, today);
  return {
    ...p,
    today: {
      ...t,
      wins: t.wins + 1,
      noUndoWins: t.noUndoWins + (win.usedUndo ? 0 : 1),
      perfects: t.perfects + (win.perfect ? 1 : 0),
      dailyWins: t.dailyWins + (win.daily ? 1 : 0),
      maxCombo: Math.max(t.maxCombo, win.maxCombo),
      bestScore: Math.max(t.bestScore, win.score),
    },
  };
}
/** Records a matched bonus pair (and the combo reached) as it happens. */
export function recordPair(p: Profile, today: string, pair: { bonus: boolean; combo: number }): Profile {
  const t = todayStats(p, today);
  if (!pair.bonus && pair.combo <= t.maxCombo) return p;
  return {
    ...p,
    today: {
      ...t,
      bonusPairs: t.bonusPairs + (pair.bonus ? 1 : 0),
      maxCombo: Math.max(t.maxCombo, pair.combo),
    },
  };
}
